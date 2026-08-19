// src/hooks/usePosData.js
//
// Lógica principal del POS.
// - unidad / peso / importe libre
// - carrito, ventas y caja
// - sincronización en tiempo real con Firestore
// - migración desde localStorage
// - caché local de respaldo

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  storeGet,
  storeSet,
} from "../lib/storage";

import { uid } from "../lib/format";

import {
  checkoutCloud,
  closeCashSessionCloud,
  deleteCashSessionCloud,
  deleteProductCloud,
  openCashSessionCloud,
  restockProductCloud,
  saveShopNameCloud,
  subscribeCashSessions,
  subscribePosConfig,
  subscribeProducts,
  subscribeSales,
  upsertProductCloud,
} from "../services/pos/posFirestore";

import {
  migrateLocalPosToFirestore,
} from "../services/pos/posMigration";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const PAYMENT_METHODS = [
  "efectivo",
  "transferencia",
  "qr",
  "tarjeta",
];

const PRODUCT_TYPES = [
  "unidad",
  "peso",
  "precio-libre",
];

const DEFAULT_SHOP_NAME =
  "Mi Negocio";

/*
 * Identifica a qué cliente pertenece
 * la caché local actual.
 *
 * Evita migrar datos de un comercio
 * hacia otro si utilizan el mismo navegador.
 */
const LOCAL_OWNER_KEY =
  "cloudOwnerClienteId";

/* =========================================================
   HELPERS
========================================================= */

function toNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function roundMoney(value) {
  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * 100
    ) / 100
  );
}

function roundQuantity(value) {
  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * 1000
    ) / 1000
  );
}

function normalizeProductType(
  value
) {
  return PRODUCT_TYPES.includes(
    value
  )
    ? value
    : "unidad";
}

function normalizeProduct(
  product
) {
  if (!product) {
    return null;
  }

  const tipoVenta =
    normalizeProductType(
      product.tipoVenta
    );

  return {
    ...product,

    barcode:
      String(
        product.barcode ||
          ""
      ).trim(),

    name:
      String(
        product.name ||
          ""
      ).trim(),

    tipoVenta,

    unidadMedida:
      tipoVenta === "peso"
        ? product.unidadMedida ||
          "kg"
        : null,

    price:
      tipoVenta ===
      "precio-libre"
        ? 0
        : roundMoney(
            toNumber(
              product.price
            )
          ),

    stock:
      tipoVenta ===
      "precio-libre"
        ? 0
        : tipoVenta ===
            "peso"
          ? roundQuantity(
              toNumber(
                product.stock
              )
            )
          : Math.max(
              0,
              Math.trunc(
                toNumber(
                  product.stock
                )
              )
            ),
  };
}

function normalizeCatalog(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  const entries = [];

  for (
    const [
      barcode,
      product,
    ] of Object.entries(
      value
    )
  ) {
    const normalized =
      normalizeProduct({
        ...product,

        barcode:
          product?.barcode ||
          barcode,
      });

    if (
      normalized?.barcode
    ) {
      entries.push([
        normalized.barcode,
        normalized,
      ]);
    }
  }

  return Object.fromEntries(
    entries
  );
}

function normalizeArray(
  value
) {
  return Array.isArray(value)
    ? value.filter(Boolean)
    : [];
}

function getItemSubtotal(
  item
) {
  if (!item) {
    return 0;
  }

  if (
    Number.isFinite(
      Number(
        item.subtotal
      )
    )
  ) {
    return roundMoney(
      item.subtotal
    );
  }

  return roundMoney(
    toNumber(
      item.qty
    ) *
      toNumber(
        item.price
      )
  );
}

function generarCodigoInterno() {
  return `manual-${Date.now()}-${uid()}`;
}

function sortCashSessions(
  sessions
) {
  return [
    ...sessions,
  ].sort(
    (
      a,
      b
    ) => {
      const aTime =
        new Date(
          a?.openTime ||
            0
        ).getTime();

      const bTime =
        new Date(
          b?.openTime ||
            0
        ).getTime();

      return (
        (
          Number.isFinite(
            aTime
          )
            ? aTime
            : 0
        ) -
        (
          Number.isFinite(
            bTime
          )
            ? bTime
            : 0
        )
      );
    }
  );
}

function mapCloudError(
  error
) {
  const code =
    String(
      error?.code ||
        ""
    ).toLowerCase();

  if (
    code.includes(
      "permission-denied"
    )
  ) {
    return "No tenés permisos para sincronizar estos datos";
  }

  if (
    code.includes(
      "unavailable"
    ) ||
    code.includes(
      "network"
    )
  ) {
    return "No se pudo conectar con la nube. Revisá tu conexión";
  }

  if (
    code.includes(
      "cash-already-open"
    )
  ) {
    return "Ya hay una caja abierta en otro dispositivo";
  }

  if (
    code.includes(
      "cash-not-open"
    ) ||
    code.includes(
      "cash-session-mismatch"
    ) ||
    code.includes(
      "cash-already-closed"
    )
  ) {
    return "La caja cambió en otro dispositivo. Actualizá e intentá nuevamente";
  }

  if (
    code.includes(
      "product-changed"
    )
  ) {
    return (
      error?.message ||
      "El producto cambió. Volvé a agregarlo al ticket"
    );
  }

  return (
    error?.message ||
    "No se pudo completar la operación"
  );
}

/* =========================================================
   HOOK
========================================================= */

export function usePosData({
  clienteId = null,
  deviceId = null,
  operadorSesion = null,
} = {}) {
  const cleanClienteId =
    String(
      clienteId ||
        ""
    ).trim();

  const cleanDeviceId =
    String(
      deviceId ||
        ""
    ).trim();

  const cloudRequested =
    Boolean(
      cleanClienteId &&
      cleanDeviceId
    );

  /* =========================================================
     ESTADO
  ========================================================= */

  const [
    catalog,
    setCatalog,
  ] = useState({});

  const [
    sales,
    setSales,
  ] = useState([]);

  const [
    cashSessions,
    setCashSessions,
  ] = useState([]);

  const [
    shopName,
    setShopNameState,
  ] = useState(
    DEFAULT_SHOP_NAME
  );

  const [
    cart,
    setCart,
  ] = useState([]);

  const [
    loaded,
    setLoaded,
  ] = useState(false);

  const [
    syncStatus,
    setSyncStatus,
  ] = useState(
    cloudRequested
      ? "starting"
      : "local"
  );

  const [
    toastMsg,
    setToastMsg,
  ] = useState(null);

  /* =========================================================
     REFS
  ========================================================= */

  const catalogRef =
    useRef({});

  const salesRef =
    useRef([]);

  const cashSessionsRef =
    useRef([]);

  const cloudActiveRef =
    useRef(false);

  const syncErrorShownRef =
    useRef(false);

  const checkoutInFlightRef =
    useRef(false);

  const openingCashRef =
    useRef(false);

  const closingCashRef =
    useRef(false);

  /*
   * Evita ejecutar dos veces la eliminación del mismo cierre.
   * Usamos Set porque distintos cierres podrían gestionarse
   * independientemente sin bloquear toda la pantalla.
   */
  const deletingCashSessionsRef =
    useRef(new Set());

  useEffect(() => {
    catalogRef.current =
      catalog;
  }, [
    catalog,
  ]);

  useEffect(() => {
    salesRef.current =
      sales;
  }, [
    sales,
  ]);

  useEffect(() => {
    cashSessionsRef.current =
      cashSessions;
  }, [
    cashSessions,
  ]);

  /* =========================================================
     TOAST
  ========================================================= */

  const clearToast =
    useCallback(() => {
      setToastMsg(
        null
      );
    }, []);

  const showToast =
    useCallback(
      (
        text,
        error = false
      ) => {
        setToastMsg({
          text,
          error,
          key: uid(),
        });
      },
      []
    );

  /* =========================================================
     CACHÉ LOCAL
  ========================================================= */

  const persistCatalog =
    useCallback(
      (next) => {
        const normalized =
          normalizeCatalog(
            next
          );

        catalogRef.current =
          normalized;

        setCatalog(
          normalized
        );

        storeSet(
          "catalog",
          normalized
        );
      },
      []
    );

  const persistSales =
    useCallback(
      (next) => {
        const normalized =
          normalizeArray(
            next
          );

        salesRef.current =
          normalized;

        setSales(
          normalized
        );

        storeSet(
          "sales",
          normalized
        );
      },
      []
    );

  const persistCashSessions =
    useCallback(
      (next) => {
        const normalized =
          sortCashSessions(
            normalizeArray(
              next
            )
          );

        cashSessionsRef.current =
          normalized;

        setCashSessions(
          normalized
        );

        storeSet(
          "cashSessions",
          normalized
        );
      },
      []
    );

  const persistShopName =
    useCallback(
      (name) => {
        const cleanName =
          String(
            name ||
              ""
          ).trim() ||
          DEFAULT_SHOP_NAME;

        setShopNameState(
          cleanName
        );

        storeSet(
          "shopName",
          cleanName
        );
      },
      []
    );

  /* =========================================================
     CARGAR LOCALSTORAGE
  ========================================================= */

  useEffect(() => {
    try {
      const savedCatalog =
        normalizeCatalog(
          storeGet(
            "catalog",
            {}
          ) || {}
        );

      const savedSales =
        normalizeArray(
          storeGet(
            "sales",
            []
          ) || []
        );

      const savedCashSessions =
        sortCashSessions(
          normalizeArray(
            storeGet(
              "cashSessions",
              []
            ) || []
          )
        );

      const savedShopName =
        String(
          storeGet(
            "shopName",
            DEFAULT_SHOP_NAME
          ) ||
            DEFAULT_SHOP_NAME
        ).trim() ||
        DEFAULT_SHOP_NAME;

      catalogRef.current =
        savedCatalog;

      salesRef.current =
        savedSales;

      cashSessionsRef.current =
        savedCashSessions;

      setCatalog(
        savedCatalog
      );

      setSales(
        savedSales
      );

      setCashSessions(
        savedCashSessions
      );

      setShopNameState(
        savedShopName
      );
    } catch (error) {
      console.error(
        "Error cargando datos locales del POS:",
        error
      );

      catalogRef.current =
        {};

      salesRef.current =
        [];

      cashSessionsRef.current =
        [];

      setCatalog({});
      setSales([]);
      setCashSessions([]);

      setShopNameState(
        DEFAULT_SHOP_NAME
      );
    } finally {
      if (
        !cloudRequested
      ) {
        setSyncStatus(
          "local"
        );

        setLoaded(
          true
        );
      }
    }
  }, [
    cloudRequested,
  ]);

    /* =========================================================
     MIGRACIÓN + FIRESTORE
  ========================================================= */

  useEffect(() => {
    if (
      !cloudRequested
    ) {
      cloudActiveRef.current =
        false;

      setSyncStatus(
        "local"
      );

      setLoaded(
        true
      );

      return undefined;
    }

    let cancelled =
      false;

    let unsubscribers =
      [];

    cloudActiveRef.current =
      false;

    syncErrorShownRef.current =
      false;

    setLoaded(
      false
    );

    setSyncStatus(
      "starting"
    );

    async function startCloudSync() {
      try {
        const cachedOwner =
          String(
            storeGet(
              LOCAL_OWNER_KEY,
              ""
            ) ||
              ""
          ).trim();

        const cacheBelongsToClient =
          !cachedOwner ||
          cachedOwner ===
            cleanClienteId;

        /*
         * Primera activación Cloud.
         *
         * Los datos locales existentes
         * se consideran pertenecientes
         * al cliente autenticado.
         */
        if (
          !cachedOwner
        ) {
          storeSet(
            LOCAL_OWNER_KEY,
            cleanClienteId
          );
        }

        /*
         * Si la caché pertenece a otro
         * cliente no la migramos.
         */
        if (
          cachedOwner &&
          !cacheBelongsToClient
        ) {
          catalogRef.current =
            {};

          salesRef.current =
            [];

          cashSessionsRef.current =
            [];

          setCatalog({});
          setSales([]);
          setCashSessions([]);
          setCart([]);

          setShopNameState(
            DEFAULT_SHOP_NAME
          );
        }

        /*
         * Migración de datos históricos.
         */
        if (
          cacheBelongsToClient
        ) {
          const migrationResult =
            await migrateLocalPosToFirestore({
              clienteId:
                cleanClienteId,

              deviceId:
                cleanDeviceId,
            });

          if (
            cancelled
          ) {
            return;
          }

          if (
            migrationResult
              ?.reason ===
            "migration-in-progress"
          ) {
            setSyncStatus(
              "syncing"
            );
          }
        }

        if (
          cancelled
        ) {
          return;
        }

        /*
         * Desde acá Firestore pasa a ser
         * la fuente principal.
         *
         * No hacemos fallback automático
         * a escrituras locales si una
         * operación Cloud falla.
         *
         * Eso evita divergencias entre
         * distintos dispositivos.
         */
        cloudActiveRef.current =
          true;

        const initialSnapshots = {
          products: false,
          sales: false,
          cash: false,
          config: false,
        };

        function markSnapshot(
          key
        ) {
          initialSnapshots[
            key
          ] = true;

          const ready =
            Object.values(
              initialSnapshots
            ).every(
              Boolean
            );

          if (
            ready &&
            !cancelled
          ) {
            storeSet(
              LOCAL_OWNER_KEY,
              cleanClienteId
            );

            setSyncStatus(
              "synced"
            );

            setLoaded(
              true
            );
          }
        }

        function handleListenerError(
          error
        ) {
          console.error(
            "Error en sincronización del POS:",
            error
          );

          if (
            cancelled
          ) {
            return;
          }

          setSyncStatus(
            "error"
          );

          setLoaded(
            true
          );

          if (
            !syncErrorShownRef
              .current
          ) {
            syncErrorShownRef.current =
              true;

            showToast(
              mapCloudError(
                error
              ),
              true
            );
          }
        }

        unsubscribers = [
          subscribeProducts(
            cleanClienteId,

            (
              nextCatalog
            ) => {
              if (
                cancelled
              ) {
                return;
              }

              persistCatalog(
                nextCatalog
              );

              markSnapshot(
                "products"
              );
            },

            handleListenerError
          ),

          subscribeSales(
            cleanClienteId,

            (
              nextSales
            ) => {
              if (
                cancelled
              ) {
                return;
              }

              persistSales(
                nextSales
              );

              markSnapshot(
                "sales"
              );
            },

            handleListenerError
          ),

          subscribeCashSessions(
            cleanClienteId,

            (
              nextSessions
            ) => {
              if (
                cancelled
              ) {
                return;
              }

              persistCashSessions(
                nextSessions
              );

              markSnapshot(
                "cash"
              );
            },

            handleListenerError
          ),

          subscribePosConfig(
            cleanClienteId,

            (config) => {
              if (
                cancelled
              ) {
                return;
              }

              persistShopName(
                config?.shopName ||
                  DEFAULT_SHOP_NAME
              );

              markSnapshot(
                "config"
              );
            },

            handleListenerError
          ),
        ];
      } catch (error) {
        console.error(
          "No se pudo iniciar la sincronización Cloud del POS:",
          error
        );

        if (
          cancelled
        ) {
          return;
        }

        /*
         * Si Firestore todavía no puede
         * inicializarse, conservamos el
         * funcionamiento local.
         *
         * Esto es útil si temporalmente
         * Cloud no está disponible.
         */
        cloudActiveRef.current =
          false;

        setSyncStatus(
          "error"
        );

        setLoaded(
          true
        );

        if (
          !syncErrorShownRef
            .current
        ) {
          syncErrorShownRef.current =
            true;

          showToast(
            mapCloudError(
              error
            ),
            true
          );
        }
      }
    }

    startCloudSync();

    return () => {
      cancelled =
        true;

      for (
        const unsubscribe of
        unsubscribers
      ) {
        try {
          unsubscribe?.();
        } catch (error) {
          console.error(
            "Error cerrando listener del POS:",
            error
          );
        }
      }

      cloudActiveRef.current =
        false;
    };
  }, [
    cloudRequested,
    cleanClienteId,
    cleanDeviceId,
    persistCatalog,
    persistSales,
    persistCashSessions,
    persistShopName,
    showToast,
  ]);
  
  /* =========================================================
     NOMBRE DEL NEGOCIO
  ========================================================= */

  const setShopName =
    useCallback(
      async (name) => {
        const cleanName =
          String(
            name ||
              ""
          ).trim();

        if (
          !cleanName
        ) {
          return false;
        }

        if (
          !cloudActiveRef
            .current
        ) {
          persistShopName(
            cleanName
          );

          return true;
        }

        try {
          await saveShopNameCloud(
            cleanClienteId,
            cleanName
          );

          persistShopName(
            cleanName
          );

          return true;
        } catch (error) {
          console.error(
            "Error guardando nombre del negocio:",
            error
          );

          showToast(
            mapCloudError(
              error
            ),
            true
          );

          return false;
        }
      },
      [
        cleanClienteId,
        persistShopName,
        showToast,
      ]
    );

  /* =========================================================
     CAJA ABIERTA
  ========================================================= */

  const openSession =
    useMemo(
      () =>
        cashSessions.find(
          (session) =>
            session?.status ===
            "open"
        ) || null,
      [
        cashSessions,
      ]
    );

  /* =========================================================
     BUSCAR PRODUCTO
  ========================================================= */

  const getProductByBarcode =
    useCallback(
      (barcode) => {
        const code =
          String(
            barcode ||
              ""
          ).trim();

        if (
          !code
        ) {
          return null;
        }

        return (
          catalogRef.current[
            code
          ] || null
        );
      },
      []
    );

  /* =========================================================
     GUARDAR PRODUCTO
  ========================================================= */

  const upsertProduct =
    useCallback(
      async (
        product,
        isEdit = false,
        previousBarcode = null
      ) => {
        if (
          !product
        ) {
          showToast(
            "Datos del producto inválidos",
            true
          );

          return false;
        }

        const currentCatalog =
          catalogRef.current;

        const tipoVenta =
          normalizeProductType(
            product.tipoVenta
          );

        let barcode =
          String(
            product.barcode ||
              ""
          ).trim();

        if (
          !barcode
        ) {
          barcode =
            generarCodigoInterno();
        }

        const previousCode =
          String(
            previousBarcode ||
              product?.originalBarcode ||
              ""
          ).trim();

        const name =
          String(
            product.name ||
              ""
          ).trim();

        const price =
          tipoVenta ===
          "precio-libre"
            ? 0
            : toNumber(
                product.price,
                NaN
              );

        let stock = 0;

        if (
          tipoVenta ===
          "peso"
        ) {
          stock =
            toNumber(
              product.stock,
              NaN
            );
        } else if (
          tipoVenta ===
          "unidad"
        ) {
          stock =
            parseInt(
              product.stock,
              10
            );
        }

        if (
          !name
        ) {
          showToast(
            "Ingresá el nombre del producto",
            true
          );

          return false;
        }

        if (
          tipoVenta !==
            "precio-libre" &&
          (
            !Number.isFinite(
              price
            ) ||
            price < 0
          )
        ) {
          showToast(
            tipoVenta ===
              "peso"
              ? "Ingresá un precio por kg válido"
              : "Ingresá un precio de venta válido",
            true
          );

          return false;
        }

        if (
          tipoVenta !==
            "precio-libre" &&
          (
            !Number.isFinite(
              stock
            ) ||
            stock < 0
          )
        ) {
          showToast(
            "Ingresá un stock válido",
            true
          );

          return false;
        }

        const conflict =
          currentCatalog[
            barcode
          ];

        if (
          !isEdit &&
          conflict
        ) {
          showToast(
            "Ya existe un producto con ese código",
            true
          );

          return false;
        }

        if (
          isEdit &&
          previousCode &&
          previousCode !==
            barcode &&
          conflict
        ) {
          showToast(
            "Ya existe otro producto con ese código",
            true
          );

          return false;
        }

        const normalizedProduct =
          normalizeProduct({
            ...product,

            barcode,
            name,
            price,
            stock,
            tipoVenta,

            unidadMedida:
              tipoVenta ===
              "peso"
                ? product.unidadMedida ||
                  "kg"
                : null,

            expiry:
              product.expiry ||
              null,
          });

        try {
          if (
            cloudRequested &&
            !cloudActiveRef
              .current
          ) {
            showToast(
              isEdit
                ? "Necesitás conexión con la nube para editar productos"
                : "Necesitás conexión con la nube para agregar productos",
              true
            );

            return false;
          }

          if (
            cloudActiveRef
              .current
          ) {
            await upsertProductCloud(
              cleanClienteId,
              normalizedProduct,
              {
                previousBarcode:
                  previousCode ||
                  undefined,

                auditEdit:
                  Boolean(
                    isEdit
                  ),

                auditCreate:
                  !isEdit,

                operadorSesion,

                deviceId:
                  cleanDeviceId,
              }
            );
          }

          /*
           * Actualización local inmediata.
           *
           * Si Cloud está activo, el listener
           * confirmará después el estado final.
           */
          const next = {
            ...catalogRef.current,
          };

          if (
            isEdit &&
            previousCode &&
            previousCode !==
              barcode
          ) {
            delete next[
              previousCode
            ];
          }

          next[
            barcode
          ] =
            normalizedProduct;

          persistCatalog(
            next
          );

          showToast(
            isEdit
              ? "Producto actualizado"
              : "Producto agregado"
          );

          return true;
        } catch (error) {
          console.error(
            "Error guardando producto:",
            error
          );

          showToast(
            mapCloudError(
              error
            ),
            true
          );

          return false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        cloudRequested,
        operadorSesion,
        persistCatalog,
        showToast,
      ]
    );

  /* =========================================================
     ELIMINAR PRODUCTO
  ========================================================= */

  const deleteProduct =
    useCallback(
      async (barcode) => {
        const code =
          String(
            barcode ||
              ""
          ).trim();

        if (
          !code ||
          !catalogRef.current[
            code
          ]
        ) {
          return false;
        }

        try {
          if (
            cloudActiveRef
              .current
          ) {
            await deleteProductCloud(
              cleanClienteId,
              code,
              {
                operadorSesion,

                deviceId:
                  cleanDeviceId,

                auditDelete:
                  true,
              }
            );
          } else if (
            cloudRequested
          ) {
            showToast(
              "Necesitás conexión con la nube para eliminar productos",
              true
            );

            return false;
          }

          const next = {
            ...catalogRef.current,
          };

          delete next[
            code
          ];

          persistCatalog(
            next
          );

          /*
           * Si estaba en el ticket,
           * también lo quitamos.
           */
          setCart(
            (
              previous
            ) =>
              previous.filter(
                (item) =>
                  item.barcode !==
                  code
              )
          );

          showToast(
            "Producto eliminado"
          );

          return true;
        } catch (error) {
          console.error(
            "Error eliminando producto:",
            error
          );

          showToast(
            mapCloudError(
              error
            ),
            true
          );

          return false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        cloudRequested,
        operadorSesion,
        persistCatalog,
        showToast,
      ]
    );

  /* =========================================================
     SUMAR STOCK
  ========================================================= */

  const restock =
    useCallback(
      async (
        barcode,
        add
      ) => {
        const code =
          String(
            barcode ||
              ""
          ).trim();

        const product =
          catalogRef.current[
            code
          ];

        if (
          !product
        ) {
          showToast(
            "Producto no encontrado",
            true
          );

          return false;
        }

        const tipoVenta =
          normalizeProductType(
            product.tipoVenta
          );

        if (
          tipoVenta ===
          "precio-libre"
        ) {
          showToast(
            "Este producto no utiliza stock",
            true
          );

          return false;
        }

        const amount =
          tipoVenta ===
          "peso"
            ? toNumber(
                add,
                NaN
              )
            : parseInt(
                add,
                10
              );

        if (
          !Number.isFinite(
            amount
          ) ||
          amount <= 0
        ) {
          showToast(
            tipoVenta ===
              "peso"
              ? "Ingresá un peso válido"
              : "Ingresá una cantidad válida",
            true
          );

          return false;
        }

        try {
          let nextStock;

          if (
            cloudActiveRef
              .current
          ) {
            nextStock =
              await restockProductCloud(
                cleanClienteId,
                code,
                amount,
                {
                  operadorSesion,

                  deviceId:
                    cleanDeviceId,
                }
              );
          } else if (
            cloudRequested
          ) {
            showToast(
              "Necesitás conexión con la nube para reponer stock",
              true
            );

            return false;
          } else {
            const currentStock =
              toNumber(
                product.stock
              );

            nextStock =
              tipoVenta ===
              "peso"
                ? roundQuantity(
                    currentStock +
                      amount
                  )
                : Math.trunc(
                    currentStock +
                      amount
                  );
          }

          const current =
            catalogRef.current[
              code
            ] || product;

          persistCatalog({
            ...catalogRef.current,

            [code]: {
              ...current,

              stock:
                tipoVenta ===
                "peso"
                  ? roundQuantity(
                      nextStock
                    )
                  : Math.max(
                      0,
                      Math.trunc(
                        nextStock
                      )
                    ),
            },
          });

          showToast(
            tipoVenta ===
            "peso"
              ? "Stock por peso actualizado"
              : "Stock actualizado"
          );

          return true;
        } catch (error) {
          console.error(
            "Error actualizando stock:",
            error
          );

          showToast(
            mapCloudError(
              error
            ),
            true
          );

          return false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        cloudRequested,
        operadorSesion,
        persistCatalog,
        showToast,
      ]
    );

  /* =========================================================
     AGREGAR PRODUCTO AL CARRITO
  ========================================================= */

  const addProductToCart =
    useCallback(
      (
        product,
        options = {}
      ) => {
        if (
          !product
        ) {
          showToast(
            "Producto no encontrado",
            true
          );

          return false;
        }

        const currentOpenSession =
          cashSessionsRef.current
            .find(
              (session) =>
                session?.status ===
                "open"
            ) ||
          null;

        if (
          !currentOpenSession
        ) {
          showToast(
            "Abrí la caja primero",
            true
          );

          return false;
        }

        const tipoVenta =
          normalizeProductType(
            product.tipoVenta
          );

        const code =
          String(
            product.barcode ||
              ""
          ).trim();

        /* -----------------------------------------------------
           UNIDAD
        ----------------------------------------------------- */

        if (
          tipoVenta ===
          "unidad"
        ) {
          const stock =
            toNumber(
              product.stock
            );

          if (
            stock <= 0
          ) {
            showToast(
              "Sin stock disponible",
              true
            );

            return false;
          }

          const existingIndex =
            cart.findIndex(
              (item) =>
                item.barcode ===
                  code &&
                normalizeProductType(
                  item.tipoVenta
                ) ===
                  "unidad"
            );

          if (
            existingIndex >= 0
          ) {
            const existing =
              cart[
                existingIndex
              ];

            const nextQty =
              toNumber(
                existing.qty
              ) + 1;

            if (
              nextQty >
              stock
            ) {
              showToast(
                "No hay más stock disponible",
                true
              );

              return false;
            }

            setCart(
              cart.map(
                (
                  item,
                  index
                ) =>
                  index ===
                  existingIndex
                    ? {
                        ...item,

                        qty:
                          nextQty,

                        subtotal:
                          roundMoney(
                            nextQty *
                              toNumber(
                                item.price
                              )
                          ),
                      }
                    : item
              )
            );
          } else {
            setCart([
              ...cart,

              {
                cartLineId:
                  uid(),

                barcode:
                  code,

                name:
                  product.name,

                tipoVenta:
                  "unidad",

                unidadMedida:
                  null,

                price:
                  roundMoney(
                    product.price
                  ),

                qty: 1,

                subtotal:
                  roundMoney(
                    product.price
                  ),
              },
            ]);
          }

          showToast(
            `${product.name} agregado`
          );

          return true;
        }

        /* -----------------------------------------------------
           PESO
        ----------------------------------------------------- */

        if (
          tipoVenta ===
          "peso"
        ) {
          const stock =
            toNumber(
              product.stock
            );

          if (
            stock <= 0
          ) {
            showToast(
              "Sin stock disponible",
              true
            );

            return false;
          }

          const pricePerKg =
            toNumber(
              product.price
            );

          let quantity =
            toNumber(
              options.quantity ??
                options.peso,
              0
            );

          let amount =
            toNumber(
              options.amount ??
                options.importe,
              0
            );

          /*
           * Importe -> peso.
           */
          if (
            amount > 0 &&
            quantity <= 0
          ) {
            if (
              pricePerKg <= 0
            ) {
              showToast(
                "El precio por kg debe ser mayor a cero",
                true
              );

              return false;
            }

            quantity =
              amount /
              pricePerKg;
          }

          /*
           * Peso -> importe.
           */
          if (
            quantity > 0 &&
            amount <= 0
          ) {
            amount =
              quantity *
              pricePerKg;
          }

          quantity =
            roundQuantity(
              quantity
            );

          amount =
            roundMoney(
              amount
            );

          if (
            quantity <= 0 ||
            amount <= 0
          ) {
            showToast(
              "Ingresá el peso o el importe",
              true
            );

            return false;
          }

          const alreadyInCart =
            cart
              .filter(
                (item) =>
                  item.barcode ===
                    code &&
                  normalizeProductType(
                    item.tipoVenta
                  ) ===
                    "peso"
              )
              .reduce(
                (
                  total,
                  item
                ) =>
                  total +
                  toNumber(
                    item.qty
                  ),
                0
              );

          if (
            roundQuantity(
              alreadyInCart +
                quantity
            ) > stock
          ) {
            showToast(
              `Stock insuficiente. Disponible: ${stock.toLocaleString(
                "es-AR",
                {
                  maximumFractionDigits:
                    3,
                }
              )} kg`,
              true
            );

            return false;
          }

          setCart([
            ...cart,

            {
              cartLineId:
                uid(),

              barcode:
                code,

              name:
                product.name,

              tipoVenta:
                "peso",

              unidadMedida:
                product.unidadMedida ||
                "kg",

              price:
                roundMoney(
                  pricePerKg
                ),

              qty:
                quantity,

              subtotal:
                amount,
            },
          ]);

          showToast(
            `${product.name} agregado`
          );

          return true;
        }

        /* -----------------------------------------------------
           IMPORTE LIBRE
        ----------------------------------------------------- */

        const amount =
          roundMoney(
            toNumber(
              options.amount ??
                options.importe,
              0
            )
          );

        if (
          amount <= 0
        ) {
          showToast(
            "Ingresá un importe válido",
            true
          );

          return false;
        }

        setCart([
          ...cart,

          {
            cartLineId:
              uid(),

            barcode:
              code,

            name:
              product.name,

            tipoVenta:
              "precio-libre",

            unidadMedida:
              null,

            price:
              amount,

            qty: 1,

            subtotal:
              amount,
          },
        ]);

        showToast(
          `${product.name} agregado`
        );

        return true;
      },
      [
        cart,
        showToast,
      ]
    );

  /* =========================================================
     AGREGAR POR CÓDIGO
  ========================================================= */

  const addToCartByBarcode =
    useCallback(
      (
        barcode,
        options = null
      ) => {
        const code =
          String(
            barcode ||
              ""
          ).trim();

        if (
          !code
        ) {
          return false;
        }

        const currentOpenSession =
          cashSessionsRef.current
            .find(
              (session) =>
                session?.status ===
                "open"
            ) ||
          null;

        if (
          !currentOpenSession
        ) {
          showToast(
            "Abrí la caja primero",
            true
          );

          return false;
        }

        const product =
          catalogRef.current[
            code
          ];

        if (
          !product
        ) {
          showToast(
            "Producto no encontrado. Cargalo en Stock.",
            true
          );

          return false;
        }

        const normalized =
          normalizeProduct(
            product
          );

        /*
         * Peso e importe libre
         * requieren modal previo.
         */
        if (
          normalized.tipoVenta !==
            "unidad" &&
          !options
        ) {
          return {
            ok: false,

            requiresInput:
              true,

            product:
              normalized,
          };
        }

        return addProductToCart(
          normalized,
          options || {}
        );
      },
      [
        addProductToCart,
        showToast,
      ]
    );

  /* =========================================================
     CAMBIAR CANTIDAD
  ========================================================= */

  const changeCartQty =
    useCallback(
      (
        index,
        delta
      ) => {
        const item =
          cart[index];

        if (
          !item
        ) {
          return;
        }

        if (
          normalizeProductType(
            item.tipoVenta
          ) !== "unidad"
        ) {
          return;
        }

        const product =
          catalogRef.current[
            item.barcode
          ];

        const nextQty =
          toNumber(
            item.qty
          ) +
          toNumber(
            delta
          );

        if (
          delta > 0 &&
          product &&
          nextQty >
            toNumber(
              product.stock
            )
        ) {
          showToast(
            "No hay más stock disponible",
            true
          );

          return;
        }

        if (
          nextQty <= 0
        ) {
          setCart(
            cart.filter(
              (
                _,
                itemIndex
              ) =>
                itemIndex !==
                index
            )
          );

          return;
        }

        setCart(
          cart.map(
            (
              current,
              itemIndex
            ) =>
              itemIndex ===
              index
                ? {
                    ...current,

                    qty:
                      nextQty,

                    subtotal:
                      roundMoney(
                        nextQty *
                          toNumber(
                            current.price
                          )
                      ),
                  }
                : current
          )
        );
      },
      [
        cart,
        showToast,
      ]
    );

  /* =========================================================
     ACTUALIZAR PESO
  ========================================================= */

  const updateCartWeight =
    useCallback(
      (
        index,
        quantity
      ) => {
        const item =
          cart[index];

        if (
          !item ||
          normalizeProductType(
            item.tipoVenta
          ) !== "peso"
        ) {
          return false;
        }

        const product =
          catalogRef.current[
            item.barcode
          ];

        if (
          !product
        ) {
          return false;
        }

        const nextQuantity =
          roundQuantity(
            quantity
          );

        if (
          nextQuantity <= 0
        ) {
          return false;
        }

        const otherWeight =
          cart.reduce(
            (
              total,
              current,
              itemIndex
            ) => {
              if (
                itemIndex ===
                  index ||
                current.barcode !==
                  item.barcode ||
                normalizeProductType(
                  current.tipoVenta
                ) !==
                  "peso"
              ) {
                return total;
              }

              return (
                total +
                toNumber(
                  current.qty
                )
              );
            },
            0
          );

        if (
          roundQuantity(
            otherWeight +
              nextQuantity
          ) >
          toNumber(
            product.stock
          )
        ) {
          showToast(
            "El peso supera el stock disponible",
            true
          );

          return false;
        }

        setCart(
          cart.map(
            (
              current,
              itemIndex
            ) =>
              itemIndex ===
              index
                ? {
                    ...current,

                    qty:
                      nextQuantity,

                    subtotal:
                      roundMoney(
                        nextQuantity *
                          toNumber(
                            current.price
                          )
                      ),
                  }
                : current
          )
        );

        return true;
      },
      [
        cart,
        showToast,
      ]
    );

  /* =========================================================
     ACTUALIZAR IMPORTE
  ========================================================= */

  const updateCartAmount =
    useCallback(
      (
        index,
        amount
      ) => {
        const item =
          cart[index];

        if (
          !item
        ) {
          return false;
        }

        const nextAmount =
          roundMoney(
            amount
          );

        if (
          nextAmount <= 0
        ) {
          return false;
        }

        const tipoVenta =
          normalizeProductType(
            item.tipoVenta
          );

        if (
          tipoVenta ===
          "precio-libre"
        ) {
          setCart(
            cart.map(
              (
                current,
                itemIndex
              ) =>
                itemIndex ===
                index
                  ? {
                      ...current,

                      price:
                        nextAmount,

                      subtotal:
                        nextAmount,
                    }
                  : current
            )
          );

          return true;
        }

        if (
          tipoVenta ===
          "peso"
        ) {
          const pricePerKg =
            toNumber(
              item.price
            );

          if (
            pricePerKg <= 0
          ) {
            return false;
          }

          const quantity =
            roundQuantity(
              nextAmount /
                pricePerKg
            );

          return updateCartWeight(
            index,
            quantity
          );
        }

        return false;
      },
      [
        cart,
        updateCartWeight,
      ]
    );

  /* =========================================================
     ELIMINAR DEL CARRITO
  ========================================================= */

  const removeFromCart =
    useCallback(
      (index) => {
        setCart(
          (
            previous
          ) =>
            previous.filter(
              (
                _,
                itemIndex
              ) =>
                itemIndex !==
                index
            )
        );
      },
      []
    );

  /* =========================================================
     VACIAR CARRITO
  ========================================================= */

  const clearCart =
    useCallback(() => {
      setCart([]);
    }, []);

  /* =========================================================
     TOTAL
  ========================================================= */

  const getCartTotal =
    useCallback(
      () =>
        roundMoney(
          cart.reduce(
            (
              total,
              item
            ) =>
              total +
              getItemSubtotal(
                item
              ),
            0
          )
        ),
      [
        cart,
      ]
    );

  /* =========================================================
     DESGLOSE DE PAGOS
  ========================================================= */

  const paymentBreakdown =
    useCallback(
      (sessionId) => {
        const sessSales =
          salesRef.current.filter(
            (sale) =>
              sale.sessionId ===
              sessionId
          );

        const totals = {
          efectivo: 0,
          transferencia: 0,
          qr: 0,
          tarjeta: 0,
        };

        for (
          const sale of
          sessSales
        ) {
          const requestedMethod =
            sale.payment?.method ||
            "efectivo";

          const method =
            PAYMENT_METHODS.includes(
              requestedMethod
            )
              ? requestedMethod
              : "efectivo";

          totals[
            method
          ] =
            roundMoney(
              totals[
                method
              ] +
                toNumber(
                  sale.total
                )
            );
        }

        const totalSales =
          roundMoney(
            sessSales.reduce(
              (
                accumulator,
                sale
              ) =>
                accumulator +
                toNumber(
                  sale.total
                ),
              0
            )
          );

        return {
          sessSales,
          totals,
          totalSales,
        };
      },
      []
    );

  /* =========================================================
     CHECKOUT
  ========================================================= */

  const checkout =
    useCallback(
      async (payment) => {
        /*
         * Protección adicional contra
         * doble click / doble confirmación.
         */
        if (
          checkoutInFlightRef
            .current
        ) {
          return false;
        }

        const currentOpenSession =
          cashSessionsRef.current
            .find(
              (session) =>
                session?.status ===
                "open"
            ) ||
          null;

        if (
          !currentOpenSession
        ) {
          showToast(
            "Abrí la caja primero",
            true
          );

          return false;
        }

        if (
          cart.length === 0
        ) {
          return false;
        }

        const currentCatalog =
          catalogRef.current;

        /* -----------------------------------------------------
           VALIDACIÓN LOCAL PREVIA
        ----------------------------------------------------- */

        const stockNecesario =
          {};

        for (
          const item of
          cart
        ) {
          const tipoVenta =
            normalizeProductType(
              item.tipoVenta
            );

          if (
            tipoVenta ===
            "precio-libre"
          ) {
            continue;
          }

          const product =
            currentCatalog[
              item.barcode
            ];

          if (
            !product
          ) {
            showToast(
              `Producto no encontrado: ${item.name}`,
              true
            );

            return false;
          }

          stockNecesario[
            item.barcode
          ] =
            toNumber(
              stockNecesario[
                item.barcode
              ]
            ) +
            toNumber(
              item.qty
            );
        }

        for (
          const [
            barcode,
            required,
          ] of Object.entries(
            stockNecesario
          )
        ) {
          const product =
            currentCatalog[
              barcode
            ];

          if (
            !product ||
            toNumber(
              product.stock
            ) +
              0.000001 <
              required
          ) {
            showToast(
              `Stock insuficiente para ${
                product?.name ||
                barcode
              }`,
              true
            );

            return false;
          }
        }

        /* -----------------------------------------------------
           TOTAL
        ----------------------------------------------------- */

        const total =
          roundMoney(
            cart.reduce(
              (
                accumulator,
                item
              ) =>
                accumulator +
                getItemSubtotal(
                  item
                ),
              0
            )
          );

        if (
          total <= 0
        ) {
          showToast(
            "El total de la venta debe ser mayor a cero",
            true
          );

          return false;
        }

        /* -----------------------------------------------------
           PAGO
        ----------------------------------------------------- */

        const requestedMethod =
          payment?.method ||
          "efectivo";

        const method =
          PAYMENT_METHODS.includes(
            requestedMethod
          )
            ? requestedMethod
            : "efectivo";

        const received =
          method ===
          "efectivo"
            ? toNumber(
                payment?.received,
                total
              )
            : total;

        if (
          method ===
            "efectivo" &&
          received < total
        ) {
          showToast(
            "El monto recibido es menor al total",
            true
          );

          return false;
        }

        const change =
          method ===
          "efectivo"
            ? roundMoney(
                received -
                  total
              )
            : 0;

        const saleId =
          uid();

        const timestamp =
          new Date()
            .toISOString();

        const saleItems =
          cart.map(
            (item) => {
              const tipoVenta =
                normalizeProductType(
                  item.tipoVenta
                );

              return {
                barcode:
                  item.barcode,

                name:
                  item.name,

                tipoVenta,

                unidadMedida:
                  tipoVenta ===
                  "peso"
                    ? item.unidadMedida ||
                      "kg"
                    : null,

                price:
                  roundMoney(
                    item.price
                  ),

                qty:
                  tipoVenta ===
                  "peso"
                    ? roundQuantity(
                        item.qty
                      )
                    : toNumber(
                        item.qty
                      ),

                subtotal:
                  getItemSubtotal(
                    item
                  ),
              };
            }
          );

        const normalizedPayment = {
          method,

          received:
            roundMoney(
              received
            ),

          change,
        };

        checkoutInFlightRef.current =
          true;

        try {
          let sale;

          /* ---------------------------------------------------
             CLOUD
          --------------------------------------------------- */

          if (
            cloudActiveRef
              .current
          ) {
            /*
             * checkoutCloud utiliza una transacción:
             *
             * - verifica stock real en Firestore;
             * - descuenta stock;
             * - registra la venta;
             * - actualiza los totales de caja;
             * - registra la auditoría del operador;
             * - evita repetir el mismo saleId.
             */
            const result =
              await checkoutCloud(
                cleanClienteId,
                {
                  saleId,

                  items:
                    saleItems,

                  payment:
                    normalizedPayment,

                  deviceId:
                    cleanDeviceId,

                  timestamp,

                  operadorSesion,
                }
              );

            sale =
              result?.sale ||
              {
                id:
                  saleId,

                timestamp,

                items:
                  saleItems,

                total,

                sessionId:
                  currentOpenSession.id,

                payment:
                  normalizedPayment,

                deviceId:
                  cleanDeviceId ||
                  null,
              };

            /*
             * Lo mostramos de inmediato.
             *
             * El listener reemplazará luego
             * el estado con la versión Cloud.
             */
            if (
              !salesRef.current.some(
                (item) =>
                  item.id ===
                  sale.id
              )
            ) {
              persistSales([
                ...salesRef.current,
                sale,
              ]);
            }
          } else {
            /* -------------------------------------------------
               MODO LOCAL
            ------------------------------------------------- */

            sale = {
              id:
                saleId,

              timestamp,

              items:
                saleItems,

              total,

              sessionId:
                currentOpenSession.id,

              payment:
                normalizedPayment,
            };

            const nextCatalog = {
              ...catalogRef.current,
            };

            for (
              const [
                barcode,
                required,
              ] of Object.entries(
                stockNecesario
              )
            ) {
              const current =
                nextCatalog[
                  barcode
                ];

              if (
                !current
              ) {
                continue;
              }

              const tipoVenta =
                normalizeProductType(
                  current.tipoVenta
                );

              const nextStock =
                toNumber(
                  current.stock
                ) -
                required;

              nextCatalog[
                barcode
              ] = {
                ...current,

                stock:
                  tipoVenta ===
                  "peso"
                    ? roundQuantity(
                        Math.max(
                          0,
                          nextStock
                        )
                      )
                    : Math.max(
                        0,
                        Math.trunc(
                          nextStock
                        )
                      ),
              };
            }

            persistCatalog(
              nextCatalog
            );

            persistSales([
              ...salesRef.current,
              sale,
            ]);
          }

          setCart([]);

          showToast(
            `Venta registrada · ${total.toFixed(
              2
            )}`
          );

          return true;
        } catch (error) {
          console.error(
            "Error registrando venta:",
            error
          );

          showToast(
            mapCloudError(
              error
            ),
            true
          );

          return false;
        } finally {
          checkoutInFlightRef.current =
            false;
        }
      },
      [
        cart,
        cleanClienteId,
        cleanDeviceId,
        operadorSesion,
        persistCatalog,
        persistSales,
        showToast,
      ]
    );

  /* =========================================================
     ABRIR CAJA
  ========================================================= */

  const openCashSession =
    useCallback(
      async (
        openAmount
      ) => {
        if (
          openingCashRef
            .current
        ) {
          return false;
        }

        const currentOpenSession =
          cashSessionsRef.current
            .find(
              (session) =>
                session?.status ===
                "open"
            ) ||
          null;

        if (
          currentOpenSession
        ) {
          showToast(
            "Ya hay una caja abierta",
            true
          );

          return false;
        }

        const amount =
          toNumber(
            openAmount,
            NaN
          );

        if (
          !Number.isFinite(
            amount
          ) ||
          amount < 0
        ) {
          showToast(
            "Ingresá un monto inicial válido",
            true
          );

          return false;
        }

        const sessionId =
          uid();

        openingCashRef.current =
          true;

        try {
          let session;

          if (
            cloudActiveRef
              .current
          ) {
            session =
              await openCashSessionCloud(
                cleanClienteId,
                {
                  sessionId,

                  openAmount:
                    roundMoney(
                      amount
                    ),

                  deviceId:
                    cleanDeviceId,

                  operadorSesion,
                }
              );
          } else if (
            cloudRequested
          ) {
            showToast(
              "Necesitás conexión con la nube para abrir la caja",
              true
            );

            return false;
          } else {
            session = {
              id:
                sessionId,

              openTime:
                new Date()
                  .toISOString(),

              openAmount:
                roundMoney(
                  amount
                ),

              closeTime:
                null,

              closeAmount:
                null,

              expectedAmount:
                null,

              counted:
                null,

              diff:
                null,

              totalSales:
                0,

              salesCount:
                0,

              paymentTotals: {
                efectivo:
                  0,

                transferencia:
                  0,

                qr:
                  0,

                tarjeta:
                  0,
              },

              status:
                "open",
            };
          }

          if (
            !cashSessionsRef
              .current.some(
                (item) =>
                  item.id ===
                  session.id
              )
          ) {
            persistCashSessions([
              ...cashSessionsRef.current,
              session,
            ]);
          }

          showToast(
            "Caja abierta"
          );

          return true;
        } catch (error) {
          console.error(
            "Error abriendo caja:",
            error
          );

          showToast(
            mapCloudError(
              error
            ),
            true
          );

          return false;
        } finally {
          openingCashRef.current =
            false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        cloudRequested,
        operadorSesion,
        persistCashSessions,
        showToast,
      ]
    );

  /* =========================================================
     CERRAR CAJA
  ========================================================= */

  const closeCashSession =
    useCallback(
      async (
        counted
      ) => {
        if (
          closingCashRef
            .current
        ) {
          return false;
        }

        const currentOpenSession =
          cashSessionsRef.current
            .find(
              (session) =>
                session?.status ===
                "open"
            ) ||
          null;

        if (
          !currentOpenSession
        ) {
          showToast(
            "No hay una caja abierta",
            true
          );

          return false;
        }

        const countedAmount =
          toNumber(
            counted,
            NaN
          );

        if (
          !Number.isFinite(
            countedAmount
          ) ||
          countedAmount < 0
        ) {
          showToast(
            "Ingresá un efectivo contado válido",
            true
          );

          return false;
        }

        closingCashRef.current =
          true;

        try {
          let closedSession;

          if (
            cloudActiveRef
              .current
          ) {
            closedSession =
              await closeCashSessionCloud(
                cleanClienteId,
                {
                  sessionId:
                    currentOpenSession.id,

                  counted:
                    countedAmount,

                  deviceId:
                    cleanDeviceId,

                  operadorSesion,
                }
              );
          } else if (
            cloudRequested
          ) {
            showToast(
              "Necesitás conexión con la nube para cerrar la caja",
              true
            );

            return false;
          } else {
            const {
              sessSales,
              totals,
              totalSales,
            } =
              paymentBreakdown(
                currentOpenSession.id
              );

            /*
             * Solamente efectivo forma
             * parte de la caja física.
             */
            const expected =
              roundMoney(
                toNumber(
                  currentOpenSession
                    .openAmount
                ) +
                  toNumber(
                    totals.efectivo
                  )
              );

            const diff =
              roundMoney(
                countedAmount -
                  expected
              );

            closedSession = {
              ...currentOpenSession,

              closeTime:
                new Date()
                  .toISOString(),

              closeAmount:
                roundMoney(
                  countedAmount
                ),

              expectedAmount:
                expected,

              counted:
                roundMoney(
                  countedAmount
                ),

              diff,

              totalSales,

              salesCount:
                sessSales.length,

              paymentTotals:
                totals,

              status:
                "closed",
            };
          }

          persistCashSessions(
            cashSessionsRef.current.map(
              (session) =>
                session.id ===
                currentOpenSession.id
                  ? {
                      ...session,
                      ...closedSession,

                      status:
                        "closed",
                    }
                  : session
            )
          );

          const diff =
            roundMoney(
              closedSession?.diff
            );

          if (
            diff === 0
          ) {
            showToast(
              "Caja cerrada · sin diferencia"
            );
          } else {
            showToast(
              `Caja cerrada · diferencia ${diff.toFixed(
                2
              )}`
            );
          }

          return true;
        } catch (error) {
          console.error(
            "Error cerrando caja:",
            error
          );

          showToast(
            mapCloudError(
              error
            ),
            true
          );

          return false;
        } finally {
          closingCashRef.current =
            false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        cloudRequested,
        operadorSesion,
        paymentBreakdown,
        persistCashSessions,
        showToast,
      ]
    );

  /* =========================================================
     ELIMINAR CIERRE HISTÓRICO
  ========================================================= */

  const deleteCashSession =
    useCallback(
      async (sessionId) => {
        const cleanSessionId =
          String(
            sessionId ||
            ""
          ).trim();

        if (!cleanSessionId) {
          showToast(
            "Cierre de caja inválido",
            true
          );

          return false;
        }

        if (
          deletingCashSessionsRef
            .current.has(
              cleanSessionId
            )
        ) {
          return false;
        }

        const session =
          cashSessionsRef.current
            .find(
              (item) =>
                item?.id ===
                cleanSessionId
            ) ||
          null;

        if (!session) {
          showToast(
            "No encontramos ese cierre de caja",
            true
          );

          return false;
        }

        /*
         * Nunca permitimos eliminar una caja abierta,
         * incluso antes de consultar al backend.
         * La Cloud Function vuelve a validarlo.
         */
        if (
          session.status !==
          "closed"
        ) {
          showToast(
            "Sólo podés eliminar cajas cerradas",
            true
          );

          return false;
        }

        /*
         * Esta operación destructiva sólo se permite con
         * Cloud activo. No hacemos fallback local porque
         * podría dejar datos divergentes entre dispositivos.
         */
        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para eliminar un cierre",
            true
          );

          return false;
        }

        deletingCashSessionsRef
          .current.add(
            cleanSessionId
          );

        try {
          const result =
            await deleteCashSessionCloud(
              cleanClienteId,
              cleanSessionId,
              {
                operadorSesion,

                deviceId:
                  cleanDeviceId,
              }
            );

          /*
           * Reflejo local inmediato.
           * Los listeners de Firestore confirmarán después
           * el estado definitivo en todos los dispositivos.
           */
          persistSales(
            salesRef.current.filter(
              (sale) =>
                sale?.sessionId !==
                cleanSessionId
            )
          );

          persistCashSessions(
            cashSessionsRef.current.filter(
              (item) =>
                item?.id !==
                cleanSessionId
            )
          );

          const ventasEliminadas =
            Math.max(
              0,
              Math.trunc(
                toNumber(
                  result
                    ?.ventasEliminadas,
                  0
                )
              )
            );

          showToast(
            ventasEliminadas === 1
              ? "Cierre eliminado · 1 venta eliminada"
              : `Cierre eliminado · ${ventasEliminadas} ventas eliminadas`
          );

          return true;
        } catch (error) {
          console.error(
            "Error eliminando cierre de caja:",
            error
          );

          showToast(
            mapCloudError(
              error
            ),
            true
          );

          return false;
        } finally {
          deletingCashSessionsRef
            .current.delete(
              cleanSessionId
            );
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        operadorSesion,
        persistSales,
        persistCashSessions,
        showToast,
      ]
    );


  /* =========================================================
     RETURN
  ========================================================= */

  return {
    clienteId:
      cleanClienteId || null,

    loaded,

    syncStatus,

    cloudEnabled:
      cloudRequested &&
      cloudActiveRef.current,

    catalog,
    sales,
    cashSessions,

    shopName,
    setShopName,

    cart,

    openSession,

    toastMsg,
    showToast,
    clearToast,

    upsertProduct,
    deleteProduct,
    restock,

    getProductByBarcode,
    addProductToCart,
    addToCartByBarcode,

    changeCartQty,
    updateCartWeight,
    updateCartAmount,

    removeFromCart,
    clearCart,

    getCartTotal,

    checkout,

    openCashSession,
    closeCashSession,
    deleteCashSession,
    paymentBreakdown,
  };
}