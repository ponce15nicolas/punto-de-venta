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
  calculateCartPromotions,
  isPromotionCurrentlyActive,
  normalizePromotions,
} from "../lib/promotions";

import {
  checkoutCloud,
  getProductsOnce,
  closeCashSessionCloud,
  createManualReceivableCloud,
  registerReceivablePaymentCloud,
  loadPurchasingDataCloud,
  loadPromotionsCloud,
  upsertPromotionCloud,
  deletePromotionCloud,
  createShoppingItemCloud,
  completeShoppingItemCloud,
  createManualPayableCloud,
  registerPayablePaymentCloud,
  migrateHistoricalProfitsCloud,
  deleteCashSessionCloud,
  deleteProductCloud,
  openCashSessionCloud,
  restockProductCloud,
  saveShopNameCloud,
  subscribeCashSessions,
  subscribeCuentasPorCobrar,
  subscribePosConfig,
  subscribeProducts,
  subscribeSales,
  upsertProductCloud,
} from "../services/pos/posFirestore";

import {
  markLocalPosMigrationHandled,
  migrateLocalPosToFirestore,
} from "../services/pos/posMigration";

import {
  clearOfflineSyncHistory,
  enqueueOfflineSale,
  listOfflineOperations,
  listOfflineSyncHistory,
  patchOfflineOperation,
  recordOfflineSyncHistory,
  removeOfflineOperation,
  subscribeOfflineQueue,
} from "../lib/offlineQueue";

import {
  browserIsOnline,
  isNetworkError,
} from "../lib/network";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const PAYMENT_METHODS = [
  "efectivo",
  "transferencia",
  "qr",
  "tarjeta",
];

const SALE_METHODS = [
  ...PAYMENT_METHODS,
  "cuenta",
  "mixto",
];

const PRODUCT_TYPES = [
  "unidad",
  "peso",
  "precio-libre",
];

const DEFAULT_SHOP_NAME =
  "Mi Negocio";

/*
 * Identifica a qué cliente pertenecen
 * las claves planas heredadas.
 *
 * La caché Cloud nueva se publica como un único sobre con
 * owner propio, para que snapshots parciales nunca mezclen
 * datos de dos comercios en el mismo navegador.
 */
const LOCAL_OWNER_KEY =
  "cloudOwnerClienteId";

const LOCAL_CLOUD_CACHE_KEY =
  "cloudCacheV1";

const LOCAL_CLOUD_CACHE_VERSION =
  1;

const MIGRATION_SAFE_DISCARD_REASONS =
  new Set([
    "migration-multiple-open-cash-sessions",
  ]);

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

function readOwnedCloudCache(
  clienteId
) {
  const cache =
    storeGet(
      LOCAL_CLOUD_CACHE_KEY,
      null
    );

  if (
    !cache ||
    typeof cache !==
      "object" ||
    Array.isArray(cache) ||
    cache.version !==
      LOCAL_CLOUD_CACHE_VERSION ||
    cache.complete !== true ||
    String(
      cache.owner ||
      ""
    ).trim() !==
      clienteId
  ) {
    return null;
  }

  return cache;
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

    cost:
      tipoVenta ===
      "precio-libre"
        ? 0
        : roundMoney(
            Math.max(
              0,
              toNumber(
                product.cost
              )
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

function applyOfflineSalesToCatalog(
  baseCatalog,
  operations,
  confirmedSaleIds = new Set()
) {
  const nextCatalog = {
    ...normalizeCatalog(
      baseCatalog
    ),
  };

  for (
    const operation of
    normalizeArray(operations)
  ) {
    if (
      operation?.type !==
        "sale" ||
      confirmedSaleIds.has(
        String(
          operation?.saleId ||
            ""
        )
      )
    ) {
      continue;
    }

    for (
      const [
        barcode,
        rawRequired,
      ] of Object.entries(
        operation?.stockNeeded ||
          {}
      )
    ) {
      const current =
        nextCatalog[barcode];

      if (!current) {
        continue;
      }

      const required =
        Math.max(
          0,
          toNumber(
            rawRequired
          )
        );

      if (required <= 0) {
        continue;
      }

      const tipoVenta =
        normalizeProductType(
          current.tipoVenta
        );

      const nextStock =
        Math.max(
          0,
          toNumber(
            current.stock
          ) - required
        );

      nextCatalog[barcode] = {
        ...current,
        stock:
          tipoVenta ===
          "peso"
            ? roundQuantity(
                nextStock
              )
            : Math.trunc(
                nextStock
              ),
      };
    }
  }

  return nextCatalog;
}

function mergeOfflineSales(
  cloudSales,
  operations
) {
  const next = [
    ...normalizeArray(
      cloudSales
    ),
  ];

  const cloudIds =
    new Set(
      next.map((sale) =>
        String(
          sale?.id ||
            ""
        )
      )
    );

  for (
    const operation of
    normalizeArray(operations)
  ) {
    const localSale =
      operation?.localSale;

    if (
      !localSale?.id ||
      cloudIds.has(
        String(localSale.id)
      )
    ) {
      continue;
    }

    next.push({
      ...localSale,
      offlinePending:
        operation.status !==
        "synced",
      offlineStatus:
        operation.status ||
        "pending",
      offlineError:
        operation.lastError ||
        null,
    });
  }

  return next.sort((a, b) =>
    String(
      a?.timestamp ||
        ""
    ).localeCompare(
      String(
        b?.timestamp ||
          ""
      )
    )
  );
}

function offlineErrorText(error) {
  return String(
    error?.message ||
      mapCloudError(error) ||
      "No se pudo sincronizar la venta"
  ).trim();
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
  deviceSessionId = null,
  operadorSesion = null,
  operadorEsAdministrador = false,
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

  const cleanDeviceSessionId =
    String(
      deviceSessionId ||
        ""
    ).trim();

  const operadorSesionId =
    String(
      operadorSesion?.id ||
        ""
    ).trim();

  const operadorSesionToken =
    String(
      operadorSesion?.token ||
        ""
    ).trim();

  const cloudRequested =
    Boolean(
      cleanClienteId &&
      cleanDeviceId &&
      cleanDeviceSessionId &&
      operadorSesionId &&
      operadorSesionToken
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
    accountsReceivable,
    setAccountsReceivable,
  ] = useState([]);

  const [
    shoppingList,
    setShoppingList,
  ] = useState([]);

  const [
    accountsPayable,
    setAccountsPayable,
  ] = useState([]);

  const [
    promotions,
    setPromotions,
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
    migrationNeedsAdmin,
    setMigrationNeedsAdmin,
  ] = useState(false);

  const [
    toastMsg,
    setToastMsg,
  ] = useState(null);

  const [
    isOnline,
    setIsOnline,
  ] = useState(
    browserIsOnline
  );

  const [
    offlineOperations,
    setOfflineOperations,
  ] = useState([]);

  const [
    offlineSyncHistory,
    setOfflineSyncHistory,
  ] = useState([]);

  const [
    offlineQueueLoaded,
    setOfflineQueueLoaded,
  ] = useState(
    !cloudRequested
  );

  const [
    offlineSyncState,
    setOfflineSyncState,
  ] = useState(
    browserIsOnline()
      ? "idle"
      : "offline"
  );

  const [
    offlineLastSyncAt,
    setOfflineLastSyncAt,
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

  const shopNameRef =
    useRef(
      DEFAULT_SHOP_NAME
    );

  const accountsReceivableRef =
    useRef([]);

  const accountsPayableRef =
    useRef([]);

  const promotionsRef =
    useRef([]);

  const cloudActiveRef =
    useRef(false);

  const cloudCacheCompleteRef =
    useRef(false);

  const offlineOperationsRef =
    useRef([]);

  const syncingOfflineRef =
    useRef(false);

  const confirmedCloudSaleIdsRef =
    useRef(new Set());

  const offlineSyncedTimerRef =
    useRef(null);

  /*
   * Firestore puede emitir varios snapshots seguidos por una sola operación.
   * Serializar toda la caché Cloud en localStorage en cada snapshot bloquea
   * el hilo principal, especialmente cuando el historial de ventas crece.
   * Este timer agrupa esas escrituras y las ejecuta fuera del camino crítico.
   */
  const cloudCachePersistTimerRef =
    useRef(null);

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

  useEffect(() => {
    offlineOperationsRef.current =
      offlineOperations;
  }, [
    offlineOperations,
  ]);

  useEffect(() => {
    accountsReceivableRef.current =
      accountsReceivable;
  }, [
    accountsReceivable,
  ]);

  useEffect(() => {
    accountsPayableRef.current =
      accountsPayable;
  }, [
    accountsPayable,
  ]);


  useEffect(() => {
    promotionsRef.current =
      promotions;
  }, [
    promotions,
  ]);

  useEffect(() => {
    if (
      typeof window ===
      "undefined"
    ) {
      return undefined;
    }

    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
      setOfflineSyncState(
        "offline"
      );

      if (cloudRequested) {
        cloudActiveRef.current =
          false;
        setSyncStatus(
          "offline"
        );
      }
    }

    window.addEventListener(
      "online",
      handleOnline
    );

    window.addEventListener(
      "offline",
      handleOffline
    );

    const recoveryTimer =
      window.setInterval(() => {
        if (
          !isOnline &&
          browserIsOnline()
        ) {
          setIsOnline(true);
        }
      }, 8000);

    return () => {
      window.removeEventListener(
        "online",
        handleOnline
      );
      window.removeEventListener(
        "offline",
        handleOffline
      );
      window.clearInterval(
        recoveryTimer
      );
    };
  }, [
    cloudRequested,
    isOnline,
  ]);

  useEffect(() => () => {
    if (
      offlineSyncedTimerRef.current !==
      null &&
      typeof window !==
      "undefined"
    ) {
      window.clearTimeout(
        offlineSyncedTimerRef.current
      );
    }
  }, []);

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

  const persistCompleteCloudCache =
    useCallback(() => {
      if (
        !cleanClienteId ||
        offlineOperationsRef.current
          .length > 0
      ) {
        return false;
      }

      return storeSet(
        LOCAL_CLOUD_CACHE_KEY,
        {
          version:
            LOCAL_CLOUD_CACHE_VERSION,

          owner:
            cleanClienteId,

          complete: true,

          catalog:
            catalogRef.current,

          sales:
            salesRef.current,

          cashSessions:
            cashSessionsRef.current,

          promotions:
            promotionsRef.current,

          shopName:
            shopNameRef.current,

          updatedAt:
            new Date()
              .toISOString(),
        }
      );
    }, [
      cleanClienteId,
    ]);

  const scheduleCompleteCloudCachePersist =
    useCallback(() => {
      if (
        !cleanClienteId ||
        typeof window === "undefined"
      ) {
        return;
      }

      if (
        cloudCachePersistTimerRef
          .current !== null
      ) {
        window.clearTimeout(
          cloudCachePersistTimerRef
            .current
        );
      }

      /*
       * Esperamos a que termine la ráfaga de snapshots. En uso Cloud
       * Firestore sigue siendo la fuente autoritativa; esta copia local
       * es solamente respaldo para arranque/consulta.
       */
      cloudCachePersistTimerRef.current =
        window.setTimeout(
          () => {
            cloudCachePersistTimerRef.current =
              null;

            persistCompleteCloudCache();
          },
          700
        );
    }, [
      cleanClienteId,
      persistCompleteCloudCache,
    ]);

  useEffect(() => {
    if (
      typeof document === "undefined" ||
      typeof window === "undefined"
    ) {
      return undefined;
    }

    function flushPendingCloudCache() {
      if (
        cloudCachePersistTimerRef
          .current === null
      ) {
        return;
      }

      window.clearTimeout(
        cloudCachePersistTimerRef
          .current
      );

      cloudCachePersistTimerRef.current =
        null;

      persistCompleteCloudCache();
    }

    function handleVisibilityChange() {
      if (
        document.visibilityState ===
        "hidden"
      ) {
        flushPendingCloudCache();
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener(
      "pagehide",
      flushPendingCloudCache
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener(
        "pagehide",
        flushPendingCloudCache
      );

      if (
        cloudCachePersistTimerRef
          .current !== null
      ) {
        window.clearTimeout(
          cloudCachePersistTimerRef
            .current
        );

        cloudCachePersistTimerRef.current =
          null;
      }
    };
  }, [
    persistCompleteCloudCache,
  ]);

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

        if (
          cloudRequested
        ) {
          if (
            cloudActiveRef
              .current &&
            cloudCacheCompleteRef
              .current &&
            offlineOperationsRef.current
              .length === 0
          ) {
            scheduleCompleteCloudCachePersist();
          }
        } else {
          storeSet(
            "catalog",
            normalized
          );
        }
      },
      [
        cloudRequested,
        scheduleCompleteCloudCachePersist,
      ]
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

        if (
          cloudRequested
        ) {
          if (
            cloudActiveRef
              .current &&
            cloudCacheCompleteRef
              .current &&
            offlineOperationsRef.current
              .length === 0
          ) {
            scheduleCompleteCloudCachePersist();
          }
        } else {
          storeSet(
            "sales",
            normalized
          );
        }
      },
      [
        cloudRequested,
        scheduleCompleteCloudCachePersist,
      ]
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

        if (
          cloudRequested
        ) {
          if (
            cloudActiveRef
              .current &&
            cloudCacheCompleteRef
              .current &&
            offlineOperationsRef.current
              .length === 0
          ) {
            scheduleCompleteCloudCachePersist();
          }
        } else {
          storeSet(
            "cashSessions",
            normalized
          );
        }
      },
      [
        cloudRequested,
        scheduleCompleteCloudCachePersist,
      ]
    );

  const persistPromotions =
    useCallback(
      (next) => {
        const normalized =
          normalizePromotions(
            next
          );

        promotionsRef.current =
          normalized;

        setPromotions(
          normalized
        );

        if (
          cloudRequested
        ) {
          if (
            cloudActiveRef
              .current &&
            cloudCacheCompleteRef
              .current &&
            offlineOperationsRef.current
              .length === 0
          ) {
            scheduleCompleteCloudCachePersist();
          }
        } else {
          storeSet(
            "promotions",
            normalized
          );
        }
      },
      [
        cloudRequested,
        scheduleCompleteCloudCachePersist,
      ]
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

        shopNameRef.current =
          cleanName;

        if (
          cloudRequested
        ) {
          if (
            cloudActiveRef
              .current &&
            cloudCacheCompleteRef
              .current &&
            offlineOperationsRef.current
              .length === 0
          ) {
            scheduleCompleteCloudCachePersist();
          }
        } else {
          storeSet(
            "shopName",
            cleanName
          );
        }
      },
      [
        cloudRequested,
        scheduleCompleteCloudCachePersist,
      ]
    );

  /* =========================================================
     CARGAR LOCALSTORAGE
  ========================================================= */

  useEffect(() => {
    try {
      const ownedCloudCache =
        cloudRequested
          ? readOwnedCloudCache(
              cleanClienteId
            )
          : null;

      const flatOwner =
        String(
          storeGet(
            LOCAL_OWNER_KEY,
            ""
          ) ||
          ""
        ).trim();

      const canReadFlatCache =
        !cloudRequested ||
        !flatOwner ||
        flatOwner ===
          cleanClienteId;

      const savedCatalog =
        normalizeCatalog(
          ownedCloudCache
            ?.catalog ||
          (
            canReadFlatCache
              ? storeGet(
                  "catalog",
                  {}
                )
              : {}
          ) ||
          {}
        );

      const savedSales =
        normalizeArray(
          ownedCloudCache
            ?.sales ||
          (
            canReadFlatCache
              ? storeGet(
                  "sales",
                  []
                )
              : []
          ) ||
          []
        );

      const savedCashSessions =
        sortCashSessions(
          normalizeArray(
            ownedCloudCache
              ?.cashSessions ||
            (
              canReadFlatCache
                ? storeGet(
                    "cashSessions",
                    []
                  )
                : []
            ) ||
            []
          )
        );

      const savedPromotions =
        normalizePromotions(
          ownedCloudCache
            ?.promotions ||
          (
            canReadFlatCache
              ? storeGet(
                  "promotions",
                  []
                )
              : []
          ) ||
          []
        );

      const savedShopName =
        String(
          ownedCloudCache
            ?.shopName ||
          (
            canReadFlatCache
              ? storeGet(
                  "shopName",
                  DEFAULT_SHOP_NAME
                )
              : DEFAULT_SHOP_NAME
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

      promotionsRef.current =
        savedPromotions;

      shopNameRef.current =
        savedShopName;

      accountsReceivableRef.current =
        [];

      setCatalog(
        savedCatalog
      );

      setSales(
        savedSales
      );

      setCashSessions(
        savedCashSessions
      );

      setPromotions(
        savedPromotions
      );

      setShopNameState(
        savedShopName
      );

      setAccountsReceivable([]);
      setCart([]);
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

      promotionsRef.current =
        [];

      shopNameRef.current =
        DEFAULT_SHOP_NAME;

      accountsReceivableRef.current =
        [];

      setCatalog({});
      setSales([]);
      setCashSessions([]);
      setPromotions([]);
      setAccountsReceivable([]);
      setCart([]);

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
    cleanClienteId,
  ]);

  /* =========================================================
     COLA OFFLINE
  ========================================================= */

  useEffect(() => {
    if (
      !cloudRequested
    ) {
      offlineOperationsRef.current =
        [];
      setOfflineOperations([]);
      setOfflineSyncHistory([]);
      setOfflineLastSyncAt(null);
      setOfflineQueueLoaded(true);
      setOfflineSyncState(
        "idle"
      );
      return undefined;
    }

    let cancelled = false;
    let firstLoad = true;
    let loadVersion = 0;

    setOfflineQueueLoaded(false);

    async function loadQueue() {
      const version =
        ++loadVersion;

      try {
        const [
          operations,
          history,
        ] = await Promise.all([
          listOfflineOperations(
            cleanClienteId
          ),
          listOfflineSyncHistory(
            cleanClienteId
          ),
        ]);

        if (
          cancelled ||
          version !== loadVersion
        ) {
          return;
        }

        offlineOperationsRef.current =
          operations;
        setOfflineOperations(
          operations
        );
        setOfflineSyncHistory(
          history
        );

        const latestSyncedAt =
          history.find(
            (item) =>
              item?.status ===
              "synced"
          )?.createdAt ||
          null;

        if (latestSyncedAt) {
          setOfflineLastSyncAt(
            (current) =>
              !current ||
              String(latestSyncedAt) >
                String(current)
                ? latestSyncedAt
                : current
          );
        }

        if (
          firstLoad &&
          operations.length > 0
        ) {
          persistCatalog(
            applyOfflineSalesToCatalog(
              catalogRef.current,
              operations,
              confirmedCloudSaleIdsRef.current
            )
          );

          persistSales(
            mergeOfflineSales(
              salesRef.current,
              operations
            )
          );
        } else if (
          !firstLoad
        ) {
          persistSales(
            mergeOfflineSales(
              salesRef.current,
              operations
            )
          );
        }

        firstLoad = false;

        const attentionCount =
          operations.filter(
            (operation) =>
              operation?.status ===
              "attention"
          ).length;

        if (attentionCount > 0) {
          setOfflineSyncState(
            "attention"
          );
        } else if (operations.length > 0) {
          setOfflineSyncState(
            browserIsOnline()
              ? "pending"
              : "offline"
          );
        } else if (!browserIsOnline()) {
          setOfflineSyncState(
            "offline"
          );
        }
      } catch (error) {
        console.error(
          "No se pudo cargar la cola offline:",
          error
        );

        if (!cancelled) {
          setOfflineSyncState(
            "storage-error"
          );
        }
      } finally {
        if (
          !cancelled &&
          version === loadVersion
        ) {
          setOfflineQueueLoaded(true);
        }
      }
    }

    loadQueue();

    const unsubscribe =
      subscribeOfflineQueue(() => {
        loadQueue();
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [
    cloudRequested,
    cleanClienteId,
    persistCatalog,
    persistSales,
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

      cloudCacheCompleteRef.current =
        false;

      setMigrationNeedsAdmin(
        false
      );

      setSyncStatus(
        "local"
      );

      setLoaded(
        true
      );

      return undefined;
    }

    if (
      !offlineQueueLoaded
    ) {
      cloudActiveRef.current =
        false;
      setLoaded(false);
      return undefined;
    }

    if (
      !isOnline
    ) {
      cloudActiveRef.current =
        false;
      setSyncStatus(
        "offline"
      );
      setOfflineSyncState(
        "offline"
      );
      setLoaded(true);
      return undefined;
    }

    let cancelled =
      false;

    let unsubscribers =
      [];

    cloudActiveRef.current =
      false;

    cloudCacheCompleteRef.current =
      false;

    syncErrorShownRef.current =
      false;

    setMigrationNeedsAdmin(
      false
    );

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

        const ownedCloudCache =
          readOwnedCloudCache(
            cleanClienteId
          );

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
          if (
            !ownedCloudCache
          ) {
            catalogRef.current =
              {};

            salesRef.current =
              [];

            cashSessionsRef.current =
              [];

            promotionsRef.current =
              [];

            shopNameRef.current =
              DEFAULT_SHOP_NAME;

            setCatalog({});
            setSales([]);
            setCashSessions([]);
            setPromotions([]);
            setAccountsReceivable([]);
            setCart([]);

            setShopNameState(
              DEFAULT_SHOP_NAME
            );
          }

          accountsReceivableRef.current =
            [];

          setAccountsReceivable([]);
          setCart([]);

          /*
           * La caché descartada pertenece a otro comercio. Marcamos
           * este par cliente/dispositivo para que los snapshots Cloud
           * que siguen no se confundan con datos legacy al reiniciar.
           */
          markLocalPosMigrationHandled({
            clienteId:
              cleanClienteId,

            deviceId:
              cleanDeviceId,

            reason:
              "foreign-cache-discarded",
          });
        }

        /*
         * Migración de datos históricos.
         */
        if (
          cacheBelongsToClient
        ) {
          try {
            let migrationResult =
              await migrateLocalPosToFirestore({
                clienteId:
                  cleanClienteId,

                deviceId:
                  cleanDeviceId,

                deviceSessionId:
                  cleanDeviceSessionId,

                operadorSesion: {
                  id:
                    operadorSesionId,

                  token:
                    operadorSesionToken,
                },

                cacheWasPreviouslyOwned:
                  Boolean(
                    cachedOwner
                  ),
              });

            if (
              cancelled
            ) {
              return;
            }

            if (
              migrationResult
                ?.reason ===
              "migration-review-required"
            ) {
              if (
                !operadorEsAdministrador
              ) {
                const reviewError =
                  new Error(
                    "Un administrador debe revisar la copia local de esta versión anterior antes de activar la nube."
                  );

                reviewError.code =
                  "migration-admin-required";

                setMigrationNeedsAdmin(
                  true
                );

                throw reviewError;
              }

              const importLegacy =
                window.confirm(
                  "Se encontró una copia local de una versión anterior sin estado verificable.\n\nAceptar: importar sólo los registros que falten en Cloud.\nCancelar: descartar esta copia local y usar el estado actual de Cloud.\n\nSi no sabés que hay datos sin sincronizar, elegí Cancelar."
                );

              if (importLegacy) {
                migrationResult =
                  await migrateLocalPosToFirestore({
                    clienteId:
                      cleanClienteId,

                    deviceId:
                      cleanDeviceId,

                    deviceSessionId:
                      cleanDeviceSessionId,

                    operadorSesion: {
                      id:
                        operadorSesionId,

                      token:
                        operadorSesionToken,
                    },

                    cacheWasPreviouslyOwned:
                      true,

                    allowOwnedLegacyImport:
                      true,
                  });
              } else {
                markLocalPosMigrationHandled({
                  clienteId:
                    cleanClienteId,

                  deviceId:
                    cleanDeviceId,

                  reason:
                    "legacy-cache-discarded",
                });

                migrationResult = {
                  ok: true,
                  migrated: false,
                  reason:
                    "legacy-cache-discarded",
                };
              }
            }

            if (
              migrationResult
                ?.reason ===
              "admin-required"
            ) {
              const adminError =
                new Error(
                  "Un administrador del negocio debe migrar los datos locales antes de activar la nube en este dispositivo."
                );

              adminError.code =
                "migration-admin-required";

              setMigrationNeedsAdmin(
                true
              );

              throw adminError;
            }

          } catch (
            migrationError
          ) {
            let migrationConflictResolved =
              false;

            const migrationReason =
              String(
                migrationError
                  ?.details
                  ?.motivo ||
                migrationError
                  ?.code ||
                ""
              );

            if (
              migrationError
                ?.details
                ?.safeToDiscard ===
                true &&
              MIGRATION_SAFE_DISCARD_REASONS.has(
                migrationReason
              )
            ) {
              if (
                !operadorEsAdministrador
              ) {
                setMigrationNeedsAdmin(
                  true
                );

                const adminError =
                  new Error(
                    "Un administrador debe revisar el conflicto de la copia local antes de activar la nube."
                  );

                adminError.code =
                  "migration-admin-required";

                throw adminError;
              }

              const discardLocalCopy =
                window.confirm(
                  "La copia local no puede importarse de forma segura porque entra en conflicto con Cloud.\n\nAceptar: conservar Cloud y descartar esta copia como fuente de migración.\nCancelar: mantener la copia local y dejar la sincronización bloqueada para revisarla."
                );

              if (
                discardLocalCopy
              ) {
                markLocalPosMigrationHandled({
                  clienteId:
                    cleanClienteId,

                  deviceId:
                    cleanDeviceId,

                  reason:
                    "migration-conflict-discarded",
                });

                console.warn(
                  "La migración local fue descartada por un administrador:",
                  migrationReason
                );

                migrationConflictResolved =
                  true;
              }
            }

            if (
              !migrationConflictResolved
            ) {
            /*
             * No montamos listeners si la migración pendiente
             * falla: esos listeners reemplazarían la caché y
             * podrían destruir el único dato legacy disponible.
             */
            console.error(
              "No se pudieron migrar los datos locales del POS:",
              migrationError
            );

            throw migrationError;
            }
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
          receivables: false,
          purchasing: false,
          promotions: false,
          config: false,
        };

        let initialSyncCompleted =
          false;

        function markSnapshot(
          key
        ) {
          initialSnapshots[
            key
          ] = true;

          /*
           * Después de completar la carga inicial, los snapshots nuevos
           * ya programan su propia persistencia diferida. Evitamos volver
           * a serializar toda la caché desde este marcador.
           */
          if (
            initialSyncCompleted
          ) {
            return;
          }

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
            initialSyncCompleted =
              true;

            cloudCacheCompleteRef.current =
              true;

            if (
              offlineOperationsRef.current
                .length === 0
            ) {
              persistCompleteCloudCache();
            }

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

          if (
            isNetworkError(error)
          ) {
            cloudActiveRef.current =
              false;
            setIsOnline(false);
            setSyncStatus(
              "offline"
            );
            setOfflineSyncState(
              "offline"
            );
            setLoaded(true);
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

        loadPromotionsCloud(
          cleanClienteId,
          {
            operadorSesion,
            deviceId:
              cleanDeviceId,
          }
        )
          .then((nextPromotions) => {
            if (cancelled) {
              return;
            }

            persistPromotions(
              nextPromotions
            );

            markSnapshot(
              "promotions"
            );
          })
          .catch(
            handleListenerError
          );

        loadPurchasingDataCloud(
          cleanClienteId,
          {
            operadorSesion,
            deviceId:
              cleanDeviceId,
          }
        )
          .then((data) => {
            if (cancelled) {
              return;
            }

            const nextShoppingList =
              Array.isArray(
                data?.shoppingList
              )
                ? data.shoppingList
                : [];

            const nextAccountsPayable =
              Array.isArray(
                data?.accountsPayable
              )
                ? data.accountsPayable
                : [];

            setShoppingList(
              nextShoppingList
            );

            setAccountsPayable(
              nextAccountsPayable
            );

            accountsPayableRef.current =
              nextAccountsPayable;

            markSnapshot(
              "purchasing"
            );
          })
          .catch(
            handleListenerError
          );

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
                applyOfflineSalesToCatalog(
                  nextCatalog,
                  offlineOperationsRef.current,
                  confirmedCloudSaleIdsRef.current
                )
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

              confirmedCloudSaleIdsRef.current =
                new Set(
                  normalizeArray(
                    nextSales
                  ).map((sale) =>
                    String(
                      sale?.id ||
                        ""
                    )
                  )
                );

              persistSales(
                mergeOfflineSales(
                  nextSales,
                  offlineOperationsRef.current
                )
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

          subscribeCuentasPorCobrar(
            cleanClienteId,

            (nextAccounts) => {
              if (
                cancelled
              ) {
                return;
              }

              setAccountsReceivable(
                Array.isArray(
                  nextAccounts
                )
                  ? nextAccounts
                  : []
              );

              markSnapshot(
                "receivables"
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

        if (
          isNetworkError(error)
        ) {
          cloudActiveRef.current =
            false;
          setIsOnline(false);
          setSyncStatus(
            "offline"
          );
          setOfflineSyncState(
            "offline"
          );
          setLoaded(true);
          return;
        }

        /*
         * Si Firestore todavía no puede inicializarse por un error
         * no relacionado con la red, conservamos la caché sólo
         * para consulta y bloqueamos mutaciones Cloud.
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

      cloudCacheCompleteRef.current =
        false;
    };
  }, [
    cloudRequested,
    offlineQueueLoaded,
    isOnline,
    cleanClienteId,
    cleanDeviceId,
    cleanDeviceSessionId,
    operadorSesionId,
    operadorSesionToken,
    operadorEsAdministrador,
    persistCompleteCloudCache,
    persistCatalog,
    persistSales,
    persistCashSessions,
    persistPromotions,
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
          if (
            cloudRequested
          ) {
            showToast(
              "Necesitás conexión con la nube para cambiar el nombre del negocio",
              true
            );

            return false;
          }

          persistShopName(
            cleanName
          );

          return true;
        }

        try {
          await saveShopNameCloud(
            cleanClienteId,
            cleanName,
            {
              operadorSesion: {
                id:
                  operadorSesionId,

                token:
                  operadorSesionToken,
              },

              deviceId:
                cleanDeviceId,

              sessionId:
                cleanDeviceSessionId,
            }
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
        cleanDeviceId,
        cleanDeviceSessionId,
        cloudRequested,
        operadorSesionId,
        operadorSesionToken,
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

        const cost =
          tipoVenta ===
          "precio-libre"
            ? 0
            : toNumber(
                product.cost,
                0
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
              cost
            ) ||
            cost < 0
          )
        ) {
          showToast(
            tipoVenta ===
              "peso"
              ? "Ingresá un costo por kg válido"
              : "Ingresá un costo de mercadería válido",
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
            cost,
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
        add,
        unitCost = null
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

        const normalizedUnitCost =
          unitCost === null ||
          unitCost === undefined ||
          unitCost === ""
            ? roundMoney(
                toNumber(
                  product.cost
                )
              )
            : roundMoney(
                toNumber(
                  unitCost,
                  NaN
                )
              );

        if (
          !Number.isFinite(
            normalizedUnitCost
          ) ||
          normalizedUnitCost < 0
        ) {
          showToast(
            "Ingresá un costo unitario válido",
            true
          );

          return false;
        }

        try {
          let nextStock;
          let nextCost;

          if (
            cloudActiveRef
              .current
          ) {
            const result =
              await restockProductCloud(
                cleanClienteId,
                code,
                amount,
                {
                  operadorSesion,

                  deviceId:
                    cleanDeviceId,

                  unitCost:
                    normalizedUnitCost,
                }
              );

            nextStock =
              result.stockNuevo;

            nextCost =
              result.costoNuevo;
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

            const currentCost =
              roundMoney(
                toNumber(
                  product.cost
                )
              );

            nextCost =
              nextStock > 0
                ? roundMoney(
                    (
                      currentStock *
                        currentCost +
                      amount *
                        normalizedUnitCost
                    ) /
                      nextStock
                  )
                : currentCost;
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

              cost:
                roundMoney(
                  nextCost
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
     PROMOCIONES
  ========================================================= */

  const refreshPromotions =
    useCallback(
      async () => {
        if (
          !cloudActiveRef
            .current
        ) {
          return promotionsRef.current;
        }

        try {
          const next =
            await loadPromotionsCloud(
              cleanClienteId,
              {
                operadorSesion,
                deviceId:
                  cleanDeviceId,
              }
            );

          persistPromotions(
            next
          );

          return next;
        } catch (error) {
          console.error(
            "Error cargando promociones:",
            error
          );

          showToast(
            mapCloudError(error),
            true
          );

          return null;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        operadorSesion,
        persistPromotions,
        showToast,
      ]
    );

  const upsertPromotion =
    useCallback(
      async (promotion) => {
        if (
          !operadorEsAdministrador
        ) {
          showToast(
            "La gestión de promociones requiere un Administrador",
            true
          );

          return false;
        }

        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para guardar promociones",
            true
          );

          return false;
        }

        try {
          const saved =
            await upsertPromotionCloud(
              cleanClienteId,
              promotion,
              {
                operadorSesion,
                deviceId:
                  cleanDeviceId,
              }
            );

          const next = [
            ...promotionsRef.current.filter(
              (item) =>
                item.id !== saved.id
            ),
            saved,
          ].sort((a, b) =>
            String(a?.name || "")
              .localeCompare(
                String(b?.name || ""),
                "es"
              )
          );

          persistPromotions(
            next
          );

          showToast(
            promotion?.id
              ? "Promoción actualizada"
              : "Promoción creada"
          );

          return saved;
        } catch (error) {
          console.error(
            "Error guardando promoción:",
            error
          );

          showToast(
            mapCloudError(error),
            true
          );

          return false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        operadorEsAdministrador,
        operadorSesion,
        persistPromotions,
        showToast,
      ]
    );

  const deletePromotion =
    useCallback(
      async (promotionId) => {
        if (
          !operadorEsAdministrador
        ) {
          showToast(
            "La gestión de promociones requiere un Administrador",
            true
          );

          return false;
        }

        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para eliminar promociones",
            true
          );

          return false;
        }

        try {
          const ok =
            await deletePromotionCloud(
              cleanClienteId,
              promotionId,
              {
                operadorSesion,
                deviceId:
                  cleanDeviceId,
              }
            );

          if (!ok) {
            return false;
          }

          persistPromotions(
            promotionsRef.current.filter(
              (item) =>
                item.id !== promotionId
            )
          );

          showToast(
            "Promoción eliminada"
          );

          return true;
        } catch (error) {
          console.error(
            "Error eliminando promoción:",
            error
          );

          showToast(
            mapCloudError(error),
            true
          );

          return false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        operadorEsAdministrador,
        operadorSesion,
        persistPromotions,
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
     AGREGAR PROMOCIÓN AL CARRITO
  ========================================================= */

  const addPromotionToCart =
    useCallback(
      (promotion) => {
        const normalized =
          normalizePromotions([
            promotion,
          ])[0];

        if (
          !normalized ||
          !isPromotionCurrentlyActive(
            normalized
          )
        ) {
          showToast(
            "La promoción ya no está disponible",
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

        if (!currentOpenSession) {
          showToast(
            "Abrí la caja primero",
            true
          );

          return false;
        }

        const nextCart =
          cart.map((item) => ({
            ...item,
          }));

        for (
          const requirement of
          normalized.items
        ) {
          const product =
            catalogRef.current[
              requirement.barcode
            ];

          if (
            !product ||
            normalizeProductType(
              product.tipoVenta
            ) !== "unidad"
          ) {
            showToast(
              "Uno de los productos de la promoción ya no está disponible",
              true
            );

            return false;
          }

          const existingIndex =
            nextCart.findIndex(
              (item) =>
                item.barcode ===
                  requirement.barcode &&
                normalizeProductType(
                  item.tipoVenta
                ) === "unidad"
            );

          const existingQty =
            existingIndex >= 0
              ? Math.max(
                  0,
                  Math.trunc(
                    toNumber(
                      nextCart[
                        existingIndex
                      ]?.qty
                    )
                  )
                )
              : 0;

          const nextQty =
            existingQty +
            requirement.qty;

          if (
            nextQty >
            Math.max(
              0,
              Math.trunc(
                toNumber(
                  product.stock
                )
              )
            )
          ) {
            showToast(
              `Stock insuficiente para ${product.name}`,
              true
            );

            return false;
          }

          if (
            existingIndex >= 0
          ) {
            nextCart[
              existingIndex
            ] = {
              ...nextCart[
                existingIndex
              ],
              qty:
                nextQty,
              subtotal:
                roundMoney(
                  nextQty *
                  toNumber(
                    nextCart[
                      existingIndex
                    ].price
                  )
                ),
            };
          } else {
            nextCart.push({
              cartLineId:
                uid(),
              barcode:
                requirement.barcode,
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
              qty:
                requirement.qty,
              subtotal:
                roundMoney(
                  requirement.qty *
                  toNumber(
                    product.price
                  )
                ),
            });
          }
        }

        setCart(
          nextCart
        );

        showToast(
          `${normalized.name} agregado`
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
     TOTAL + PROMOCIONES AUTOMÁTICAS
  ========================================================= */

  const cartPricing =
    useMemo(
      () =>
        calculateCartPromotions(
          cart,
          promotions
        ),
      [
        cart,
        promotions,
      ]
    );

  const getCartTotal =
    useCallback(
      () =>
        cartPricing.total,
      [
        cartPricing.total,
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

        const saleTotals = {
          efectivo: 0,
          transferencia: 0,
          qr: 0,
          tarjeta: 0,
        };

        for (
          const sale of
          sessSales
        ) {
          const parts = Array.isArray(sale.payment?.parts)
            ? sale.payment.parts
            : [];

          if (parts.length > 0) {
            for (const part of parts) {
              const partMethod = PAYMENT_METHODS.includes(part?.method)
                ? part.method
                : null;

              if (!partMethod) continue;

              saleTotals[partMethod] = roundMoney(
                saleTotals[partMethod] + Math.max(0, toNumber(part?.amount))
              );
            }

            continue;
          }

          const requestedMethod = sale.payment?.method || "efectivo";

          if (requestedMethod === "cuenta") continue;

          const method = PAYMENT_METHODS.includes(requestedMethod)
            ? requestedMethod
            : "efectivo";

          saleTotals[method] = roundMoney(
            saleTotals[method] + toNumber(sale.total)
          );
        }

        const receivablePayments =
          accountsReceivableRef.current
            .flatMap(
              (account) =>
                Array.isArray(
                  account?.pagos
                )
                  ? account.pagos.map(
                      (pago) => ({
                        ...pago,
                        cuentaId:
                          account.id,
                        clienteNombre:
                          account.clienteNombre,
                      })
                    )
                  : []
            )
            .filter(
              (pago) =>
                pago?.sessionId ===
                sessionId
            );

        const receivableTotals = {
          efectivo: 0,
          transferencia: 0,
          qr: 0,
          tarjeta: 0,
        };

        for (
          const pago of
          receivablePayments
        ) {
          const requestedMethod =
            pago?.metodoPago ||
            "efectivo";

          const method =
            PAYMENT_METHODS.includes(
              requestedMethod
            )
              ? requestedMethod
              : "efectivo";

          receivableTotals[
            method
          ] =
            roundMoney(
              receivableTotals[
                method
              ] +
                toNumber(
                  pago?.importe
                )
            );
        }

        const payablePayments =
          accountsPayableRef.current
            .flatMap(
              (account) =>
                Array.isArray(
                  account?.pagos
                )
                  ? account.pagos.map(
                      (pago) => ({
                        ...pago,
                        cuentaId:
                          account.id,
                        proveedorNombre:
                          account.proveedorNombre,
                      })
                    )
                  : []
            )
            .filter(
              (pago) =>
                pago?.sessionId ===
                sessionId
            );

        const payableTotals = {
          efectivo: 0,
          transferencia: 0,
          qr: 0,
          tarjeta: 0,
        };

        for (
          const pago of
          payablePayments
        ) {
          const requestedMethod =
            pago?.metodoPago ||
            "efectivo";

          const method =
            PAYMENT_METHODS.includes(
              requestedMethod
            )
              ? requestedMethod
              : "efectivo";

          payableTotals[
            method
          ] =
            roundMoney(
              payableTotals[
                method
              ] +
                toNumber(
                  pago?.importe
                )
            );
        }

        const totals =
          Object.fromEntries(
            PAYMENT_METHODS.map(
              (method) => [
                method,
                roundMoney(
                  toNumber(
                    saleTotals[method]
                  ) +
                    toNumber(
                      receivableTotals[
                        method
                      ]
                    )
                ),
              ]
            )
          );

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

        const totalReceivablePayments =
          roundMoney(
            receivablePayments.reduce(
              (
                accumulator,
                pago
              ) =>
                accumulator +
                toNumber(
                  pago?.importe
                ),
              0
            )
          );

        const totalPayablePayments =
          roundMoney(
            payablePayments.reduce(
              (
                accumulator,
                pago
              ) =>
                accumulator +
                toNumber(
                  pago?.importe
                ),
              0
            )
          );

        const totalCreditSales =
          roundMoney(
            sessSales.reduce(
              (
                accumulator,
                sale
              ) =>
                sale?.payment
                  ?.method ===
                "cuenta"
                  ? accumulator +
                    toNumber(
                      sale?.total
                    )
                  : accumulator,
              0
            )
          );

        return {
          sessSales,
          saleTotals,
          receivablePayments,
          receivableTotals,
          payablePayments,
          payableTotals,
          totals,
          totalSales,
          totalReceivablePayments,
          totalPayablePayments,
          totalCreditSales,
        };
      },
      []
    );

  /* =========================================================
     VENTAS OFFLINE
  ========================================================= */

  const pendingOfflineCount =
    useMemo(
      () =>
        offlineOperations.filter(
          (operation) =>
            operation?.type ===
              "sale" &&
            operation?.status !==
              "synced"
        ).length,
      [offlineOperations]
    );

  const offlineAttentionCount =
    useMemo(
      () =>
        offlineOperations.filter(
          (operation) =>
            operation?.type ===
              "sale" &&
            operation?.status ===
              "attention"
        ).length,
      [offlineOperations]
    );

  const offlineQueueItems =
    useMemo(
      () =>
        offlineOperations
          .filter(
            (operation) =>
              operation?.type ===
              "sale"
          )
          .map((operation) => ({
            id:
              operation.id,
            saleId:
              operation.saleId,
            status:
              operation.status ||
              "pending",
            attempts:
              Math.max(
                0,
                Math.trunc(
                  toNumber(
                    operation.attempts
                  )
                )
              ),
            createdAt:
              operation.createdAt ||
              null,
            updatedAt:
              operation.updatedAt ||
              null,
            lastError:
              operation.lastError ||
              null,
            total:
              toNumber(
                operation?.localSale
                  ?.total
              ),
            itemCount:
              Array.isArray(
                operation?.localSale
                  ?.items
              )
                ? operation.localSale
                    .items.length
                : 0,
            paymentMethod:
              String(
                operation?.localSale
                  ?.payment?.method ||
                  ""
              ).trim() ||
              null,
          }))
          .sort((a, b) =>
            String(
              b?.createdAt ||
                ""
            ).localeCompare(
              String(
                a?.createdAt ||
                  ""
              )
            )
          ),
      [offlineOperations]
    );

  const clearOfflineHistory =
    useCallback(
      async () => {
        if (
          !cleanClienteId ||
          !operadorEsAdministrador
        ) {
          if (!operadorEsAdministrador) {
            showToast(
              "Solo un administrador puede limpiar este historial",
              true
            );
          }

          return false;
        }

        try {
          await clearOfflineSyncHistory(
            cleanClienteId
          );
          setOfflineSyncHistory([]);
          setOfflineLastSyncAt(null);
          showToast(
            "Historial local de sincronización eliminado"
          );
          return true;
        } catch (error) {
          console.error(
            "No se pudo limpiar el historial de sincronización:",
            error
          );
          showToast(
            "No se pudo limpiar el historial local",
            true
          );
          return false;
        }
      },
      [
        cleanClienteId,
        operadorEsAdministrador,
        showToast,
      ]
    );

  const rememberSyncedOperation =
    useCallback(
      async (operation) => {
        if (
          !cleanClienteId ||
          !operation?.saleId
        ) {
          return;
        }

        try {
          const localSale =
            operation.localSale ||
            {};

          await recordOfflineSyncHistory(
            cleanClienteId,
            {
              saleId:
                operation.saleId,
              status:
                "synced",
              queuedAt:
                operation.createdAt ||
                null,
              createdAt:
                new Date().toISOString(),
              total:
                toNumber(
                  localSale.total
                ),
              itemCount:
                Array.isArray(
                  localSale.items
                )
                  ? localSale.items.length
                  : 0,
              paymentMethod:
                String(
                  localSale?.payment
                    ?.method ||
                    ""
                ).trim() ||
                null,
            }
          );
        } catch (error) {
          console.warn(
            "No se pudo guardar el historial local de sincronización:",
            error
          );
        }
      },
      [cleanClienteId]
    );

  const persistOfflineSale =
    useCallback(
      async ({
        saleId,
        timestamp,
        saleItems,
        total,
        totalCost,
        grossProfit,
        pricing,
        normalizedPayment,
        sessionId,
        stockNecesario,
      }) => {
        if (
          !cloudRequested ||
          !offlineQueueLoaded
        ) {
          return null;
        }

        const localSale = {
          id: saleId,
          timestamp,
          items: saleItems,
          total,
          totalCost,
          grossProfit,
          promotionDiscountTotal:
            pricing.discountTotal,
          promotionsApplied:
            pricing.applications,
          profitCostStatus:
            "exact",
          sessionId,
          payment:
            normalizedPayment,
          deviceId:
            cleanDeviceId ||
            null,
          offlinePending:
            true,
          offlineStatus:
            "pending",
          offlineCreatedAt:
            timestamp,
        };

        try {
          const record =
            await enqueueOfflineSale(
              cleanClienteId,
              {
                saleId,
                createdAt:
                  timestamp,
                sessionId,
                stockNeeded:
                  stockNecesario,
                payload: {
                  saleId,
                  items:
                    saleItems,
                  payment:
                    normalizedPayment,
                  deviceId:
                    cleanDeviceId,
                  timestamp,
                  sessionId,
                },
                localSale,
              }
            );

          const nextOperations = [
            ...offlineOperationsRef.current.filter(
              (operation) =>
                operation?.id !==
                record.id
            ),
            record,
          ].sort((a, b) =>
            String(
              a?.createdAt ||
                ""
            ).localeCompare(
              String(
                b?.createdAt ||
                  ""
              )
            )
          );

          offlineOperationsRef.current =
            nextOperations;
          setOfflineOperations(
            nextOperations
          );

          /*
           * El catálogo visible descuenta la venta inmediatamente.
           * No escribimos esta versión provisional en la caché Cloud:
           * IndexedDB es la fuente durable de pendientes.
           */
          persistCatalog(
            applyOfflineSalesToCatalog(
              catalogRef.current,
              [record]
            )
          );

          persistSales(
            mergeOfflineSales(
              salesRef.current,
              nextOperations
            )
          );

          setOfflineSyncState(
            browserIsOnline()
              ? "pending"
              : "offline"
          );

          return localSale;
        } catch (error) {
          console.error(
            "No se pudo guardar la venta en IndexedDB:",
            error
          );

          setOfflineSyncState(
            "storage-error"
          );

          return null;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        cloudRequested,
        offlineQueueLoaded,
        persistCatalog,
        persistSales,
      ]
    );

  const processOfflineQueue =
    useCallback(
      async ({
        includeAttention = false,
      } = {}) => {
        if (
          !cloudRequested ||
          !offlineQueueLoaded ||
          !cloudActiveRef.current ||
          !browserIsOnline() ||
          syncingOfflineRef.current
        ) {
          return false;
        }

        syncingOfflineRef.current =
          true;
        setOfflineSyncState(
          "syncing"
        );

        let stoppedByNetwork = false;
        let hasAttention = false;

        try {
          const operations =
            await listOfflineOperations(
              cleanClienteId
            );

          for (const operation of operations) {
            if (
              operation?.type !==
                "sale" ||
              (
                operation?.status ===
                  "attention" &&
                !includeAttention
              )
            ) {
              if (
                operation?.status ===
                "attention"
              ) {
                hasAttention = true;
              }
              continue;
            }

            const payload =
              operation?.payload ||
              {};

            try {
              const result =
                await checkoutCloud(
                  cleanClienteId,
                  {
                    saleId:
                      operation.saleId,
                    items:
                      payload.items ||
                      operation?.localSale?.items ||
                      [],
                    payment:
                      payload.payment ||
                      operation?.localSale?.payment ||
                      {},
                    deviceId:
                      payload.deviceId ||
                      cleanDeviceId,
                    timestamp:
                      payload.timestamp ||
                      operation.createdAt,
                    sessionId:
                      operation.sessionId ||
                      payload.sessionId ||
                      null,
                    offlineQueued:
                      true,
                    offlineCreatedAt:
                      operation.createdAt,
                    operadorSesion,
                  }
                );

              const confirmedSale =
                result?.sale ||
                {
                  ...operation.localSale,
                  offlinePending:
                    false,
                };

              confirmedCloudSaleIdsRef.current.add(
                String(
                  operation.saleId
                )
              );

              const nextSales =
                salesRef.current.some(
                  (sale) =>
                    String(
                      sale?.id ||
                        ""
                    ) ===
                    String(
                      operation.saleId
                    )
                )
                  ? salesRef.current.map(
                      (sale) =>
                        String(
                          sale?.id ||
                            ""
                        ) ===
                        String(
                          operation.saleId
                        )
                          ? confirmedSale
                          : sale
                    )
                  : [
                      ...salesRef.current,
                      confirmedSale,
                    ];

              persistSales(
                nextSales
              );

              await removeOfflineOperation(
                operation.id
              );

              await rememberSyncedOperation(
                operation
              );
            } catch (error) {
              if (
                isNetworkError(error)
              ) {
                stoppedByNetwork =
                  true;

                await patchOfflineOperation(
                  operation.id,
                  {
                    status:
                      "pending",
                    attempts:
                      Math.max(
                        0,
                        Math.trunc(
                          toNumber(
                            operation.attempts
                          )
                        )
                      ) + 1,
                    lastError:
                      offlineErrorText(
                        error
                      ),
                  }
                );

                cloudActiveRef.current =
                  false;
                setIsOnline(false);
                setSyncStatus(
                  "offline"
                );
                setOfflineSyncState(
                  "offline"
                );
                break;
              }

              hasAttention = true;

              const patched =
                await patchOfflineOperation(
                  operation.id,
                  {
                    status:
                      "attention",
                    attempts:
                      Math.max(
                        0,
                        Math.trunc(
                          toNumber(
                            operation.attempts
                          )
                        )
                      ) + 1,
                    lastError:
                      offlineErrorText(
                        error
                      ),
                  }
                );

              if (patched?.localSale) {
                persistSales(
                  salesRef.current.map(
                    (sale) =>
                      String(
                        sale?.id ||
                          ""
                      ) ===
                      String(
                        operation.saleId
                      )
                        ? {
                            ...sale,
                            offlinePending:
                              true,
                            offlineStatus:
                              "attention",
                            offlineError:
                              offlineErrorText(
                                error
                              ),
                          }
                        : sale
                  )
                );
              }
            }
          }

          const remaining =
            await listOfflineOperations(
              cleanClienteId
            );

          offlineOperationsRef.current =
            remaining;
          setOfflineOperations(
            remaining
          );

          if (
            !stoppedByNetwork &&
            cloudActiveRef.current
          ) {
            try {
              const authoritativeCatalog =
                await getProductsOnce(
                  cleanClienteId
                );

              persistCatalog(
                applyOfflineSalesToCatalog(
                  authoritativeCatalog,
                  remaining,
                  confirmedCloudSaleIdsRef.current
                )
              );
            } catch (refreshError) {
              if (
                isNetworkError(
                  refreshError
                )
              ) {
                stoppedByNetwork =
                  true;
                cloudActiveRef.current =
                  false;
                setIsOnline(false);
                setSyncStatus(
                  "offline"
                );
              } else {
                console.error(
                  "No se pudo refrescar el stock después de sincronizar:",
                  refreshError
                );
              }
            }
          }

          persistSales(
            mergeOfflineSales(
              salesRef.current,
              remaining
            )
          );

          hasAttention =
            hasAttention ||
            remaining.some(
              (operation) =>
                operation?.status ===
                "attention"
            );

          if (stoppedByNetwork) {
            setOfflineSyncState(
              "offline"
            );
            return false;
          }

          if (hasAttention) {
            setOfflineSyncState(
              "attention"
            );
            return false;
          }

          if (remaining.length > 0) {
            setOfflineSyncState(
              "pending"
            );
            return false;
          }

          persistCompleteCloudCache();
          setOfflineLastSyncAt(
            new Date().toISOString()
          );
          setOfflineSyncState(
            "synced"
          );

          if (
            typeof window !==
            "undefined"
          ) {
            if (
              offlineSyncedTimerRef.current !==
              null
            ) {
              window.clearTimeout(
                offlineSyncedTimerRef.current
              );
            }

            offlineSyncedTimerRef.current =
              window.setTimeout(() => {
                setOfflineSyncState(
                  "idle"
                );
                offlineSyncedTimerRef.current =
                  null;
              }, 4500);
          }

          return true;
        } catch (error) {
          console.error(
            "No se pudo procesar la cola offline:",
            error
          );

          if (isNetworkError(error)) {
            cloudActiveRef.current =
              false;
            setIsOnline(false);
            setSyncStatus(
              "offline"
            );
            setOfflineSyncState(
              "offline"
            );
          } else {
            setOfflineSyncState(
              "attention"
            );
          }

          return false;
        } finally {
          syncingOfflineRef.current =
            false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        cloudRequested,
        offlineQueueLoaded,
        operadorSesion,
        persistCatalog,
        persistCompleteCloudCache,
        persistSales,
        rememberSyncedOperation,
      ]
    );

  const retryOfflineSync =
    useCallback(
      () =>
        processOfflineQueue({
          includeAttention: true,
        }),
      [processOfflineQueue]
    );

  useEffect(() => {
    if (
      !cloudRequested ||
      !offlineQueueLoaded ||
      !isOnline ||
      syncStatus !==
        "synced" ||
      offlineOperations.length ===
        0
    ) {
      return;
    }

    processOfflineQueue();
  }, [
    cloudRequested,
    offlineQueueLoaded,
    isOnline,
    syncStatus,
    offlineOperations.length,
    processOfflineQueue,
  ]);

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

        const pricing =
          calculateCartPromotions(
            cart,
            promotionsRef.current
          );

        const total =
          pricing.total;

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
          SALE_METHODS.includes(
            requestedMethod
          )
            ? requestedMethod
            : "efectivo";

        let receivable =
          null;

        if (
          method ===
          "cuenta"
        ) {
          if (
            !cloudActiveRef
              .current
          ) {
            showToast(
              "Necesitás conexión con la nube para registrar una venta a cuenta",
              true
            );

            return false;
          }

          const clienteNombre =
            String(
              payment?.receivable
                ?.clienteNombre ||
              ""
            ).trim();

          const clienteTelefono =
            String(
              payment?.receivable
                ?.clienteTelefono ||
              ""
            ).trim();

          const fechaOrigen =
            String(
              payment?.receivable
                ?.fechaOrigen ||
              ""
            ).trim();

          const vencimiento =
            String(
              payment?.receivable
                ?.vencimiento ||
              ""
            ).trim();

          const notas =
            String(
              payment?.receivable
                ?.notas ||
              ""
            ).trim();

          if (
            !clienteNombre
          ) {
            showToast(
              "Ingresá el nombre del cliente",
              true
            );

            return false;
          }

          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(
              fechaOrigen
            )
          ) {
            showToast(
              "La fecha de la cuenta no es válida",
              true
            );

            return false;
          }

          if (
            vencimiento &&
            (
              !/^\d{4}-\d{2}-\d{2}$/.test(
                vencimiento
              ) ||
              vencimiento <
                fechaOrigen
            )
          ) {
            showToast(
              "El vencimiento de la cuenta no es válido",
              true
            );

            return false;
          }

          receivable = {
            clienteNombre,
            clienteTelefono,
            fechaOrigen,
            vencimiento:
              vencimiento ||
              null,
            notas,
          };
        }

        let paymentParts = [];

        if (method === "mixto") {
          const rawParts = Array.isArray(payment?.parts) ? payment.parts : [];

          if (rawParts.length !== 2) {
            showToast("El pago combinado debe tener exactamente 2 medios", true);
            return false;
          }

          paymentParts = rawParts.map((part) => {
            const partMethod = PAYMENT_METHODS.includes(part?.method)
              ? part.method
              : null;
            const amount = roundMoney(Math.max(0, toNumber(part?.amount)));
            const partReceived = partMethod === "efectivo"
              ? roundMoney(toNumber(part?.received, amount))
              : amount;
            const partChange = partMethod === "efectivo"
              ? roundMoney(partReceived - amount)
              : 0;

            return {
              method: partMethod,
              amount,
              received: partReceived,
              change: partChange,
            };
          });

          if (
            paymentParts.some((part) => !part.method || part.amount <= 0) ||
            paymentParts[0].method === paymentParts[1].method ||
            Math.abs(paymentParts.reduce((sum, part) => sum + part.amount, 0) - total) > 0.01 ||
            paymentParts.some((part) => part.method === "efectivo" && part.received < part.amount)
          ) {
            showToast("Revisá los importes y medios del pago combinado", true);
            return false;
          }
        }

        const received =
          method === "mixto"
            ? roundMoney(paymentParts.reduce((sum, part) => sum + part.received, 0))
            : method ===
          "efectivo"
            ? toNumber(
                payment?.received,
                total
              )
            : method ===
                "cuenta"
              ? 0
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
          method === "mixto"
            ? roundMoney(paymentParts.reduce((sum, part) => sum + part.change, 0))
            : method === "efectivo"
              ? roundMoney(received - total)
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

              const product =
                catalogRef.current[
                  item.barcode
                ] ||
                {};

              const qty =
                tipoVenta ===
                "peso"
                  ? roundQuantity(
                      item.qty
                    )
                  : toNumber(
                      item.qty
                    );

              const cost =
                tipoVenta ===
                "precio-libre"
                  ? 0
                  : roundMoney(
                      Math.max(
                        0,
                        toNumber(
                          product.cost
                        )
                      )
                    );

              const baseSubtotal =
                getItemSubtotal(
                  item
                );

              const promotionDiscount =
                tipoVenta === "unidad"
                  ? roundMoney(
                      Math.min(
                        baseSubtotal,
                        Math.max(
                          0,
                          toNumber(
                            pricing
                              .discountByBarcode
                              ?.[item.barcode]
                          )
                        )
                      )
                    )
                  : 0;

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

                cost,

                qty,

                baseSubtotal,

                promotionDiscount,

                subtotal:
                  roundMoney(
                    baseSubtotal -
                    promotionDiscount
                  ),

                costSubtotal:
                  roundMoney(
                    qty * cost
                  ),

                costSource:
                  "exact",
              };
            }
          );

        const totalCost =
          roundMoney(
            saleItems.reduce(
              (sum, item) =>
                sum +
                toNumber(
                  item.costSubtotal
                ),
              0
            )
          );

        const grossProfit =
          roundMoney(
            total -
              totalCost
          );

        const normalizedPayment = {
          method,

          received:
            roundMoney(
              received
            ),

          change,

          ...(method === "mixto"
            ? { parts: paymentParts }
            : {}),

          ...(method ===
            "cuenta"
            ? {
                receivable,
              }
            : {}),
        };

        checkoutInFlightRef.current =
          true;

        try {
          let sale;

          /* ---------------------------------------------------
             CLOUD
          --------------------------------------------------- */

          let savedOffline =
            false;

          if (
            cloudActiveRef
              .current
          ) {
            try {
              /*
               * La misma saleId viaja también en reintentos.
               * El backend es idempotente y además valida que
               * la venta pertenezca a esta sesión de caja.
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

                    sessionId:
                      currentOpenSession.id,

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

                  totalCost,

                  grossProfit,

                  promotionDiscountTotal:
                    pricing.discountTotal,

                  promotionsApplied:
                    pricing.applications,

                  profitCostStatus:
                    "exact",

                  sessionId:
                    currentOpenSession.id,

                  payment:
                    normalizedPayment,

                  deviceId:
                    cleanDeviceId ||
                    null,
                };
            } catch (cloudError) {
              if (
                !isNetworkError(
                  cloudError
                )
              ) {
                throw cloudError;
              }

              cloudActiveRef.current =
                false;
              setIsOnline(false);
              setSyncStatus(
                "offline"
              );
              setOfflineSyncState(
                "offline"
              );

              if (
                method ===
                "cuenta"
              ) {
                showToast(
                  "La conexión se interrumpió. Las ventas a cuenta requieren conexión y el ticket quedó sin registrar",
                  true
                );
                return false;
              }

              sale =
                await persistOfflineSale({
                  saleId,
                  timestamp,
                  saleItems,
                  total,
                  totalCost,
                  grossProfit,
                  pricing,
                  normalizedPayment,
                  sessionId:
                    currentOpenSession.id,
                  stockNecesario,
                });

              if (!sale) {
                showToast(
                  "No se pudo guardar la venta sin conexión. El ticket se conserva para reintentar",
                  true
                );
                return false;
              }

              savedOffline =
                true;
            }

            if (
              !savedOffline &&
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
          } else if (
            cloudRequested
          ) {
            if (
              isOnline &&
              browserIsOnline()
            ) {
              showToast(
                "La nube todavía se está reconectando. Esperá unos segundos e intentá nuevamente",
                true
              );
              return false;
            }

            if (
              method ===
              "cuenta"
            ) {
              showToast(
                "Las ventas a cuenta requieren conexión con la nube",
                true
              );
              return false;
            }

            sale =
              await persistOfflineSale({
                saleId,
                timestamp,
                saleItems,
                total,
                totalCost,
                grossProfit,
                pricing,
                normalizedPayment,
                sessionId:
                  currentOpenSession.id,
                stockNecesario,
              });

            if (!sale) {
              showToast(
                "No se pudo guardar la venta sin conexión. El ticket se conserva para reintentar",
                true
              );
              return false;
            }

            savedOffline =
              true;
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

              totalCost,

              grossProfit,

              promotionDiscountTotal:
                pricing.discountTotal,

              promotionsApplied:
                pricing.applications,

              profitCostStatus:
                "exact",

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
            savedOffline
              ? "Venta guardada en este dispositivo · se sincronizará al recuperar la conexión"
              : method ===
                  "cuenta"
                ? `Venta a cuenta registrada · ${total.toFixed(
                    2
                  )}`
                : `Venta registrada · ${total.toFixed(
                    2
                  )}`
          );

          return true;
        } catch (error) {
          console.error(
            "Error registrando venta:",
            error
          );

          if (
            error?.code ===
              "promotion-changed" &&
            cloudActiveRef.current
          ) {
            try {
              const nextPromotions =
                await loadPromotionsCloud(
                  cleanClienteId,
                  {
                    operadorSesion,
                    deviceId:
                      cleanDeviceId,
                  }
                );

              persistPromotions(
                nextPromotions
              );
            } catch (refreshError) {
              console.error(
                "Error actualizando promociones después de un cambio de precio:",
                refreshError
              );
            }
          }

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
        cloudRequested,
        isOnline,
        operadorSesion,
        persistCatalog,
        persistOfflineSale,
        persistPromotions,
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

        const pendingForSession =
          offlineOperationsRef.current.filter(
            (operation) =>
              operation?.type ===
                "sale" &&
              operation?.status !==
                "synced" &&
              String(
                operation?.sessionId ||
                  ""
              ) ===
                String(
                  currentOpenSession.id ||
                    ""
                )
          );

        if (
          pendingForSession.length > 0
        ) {
          showToast(
            `Hay ${pendingForSession.length} ${
              pendingForSession.length === 1
                ? "venta pendiente"
                : "ventas pendientes"
            } de sincronización. Conectate y esperá su confirmación antes de cerrar la caja.`,
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
     COMPRAS — RECARGAR DATOS
  ========================================================= */

  const refreshPurchasingData =
    useCallback(
      async (
        {
          silent = false,
        } = {}
      ) => {
        if (
          !cloudActiveRef
            .current
        ) {
          if (!silent) {
            showToast(
              "Necesitás conexión con la nube para cargar compras",
              true
            );
          }

          return false;
        }

        try {
          const data =
            await loadPurchasingDataCloud(
              cleanClienteId,
              {
                operadorSesion,
                deviceId:
                  cleanDeviceId,
              }
            );

          const nextShoppingList =
            Array.isArray(
              data?.shoppingList
            )
              ? data.shoppingList
              : [];

          const nextAccountsPayable =
            Array.isArray(
              data?.accountsPayable
            )
              ? data.accountsPayable
              : [];

          setShoppingList(
            nextShoppingList
          );

          setAccountsPayable(
            nextAccountsPayable
          );

          accountsPayableRef.current =
            nextAccountsPayable;

          return true;
        } catch (error) {
          console.error(
            "Error cargando compras:",
            error
          );

          if (!silent) {
            showToast(
              mapCloudError(
                error
              ),
              true
            );
          }

          return false;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        operadorSesion,
        showToast,
      ]
    );

  const createShoppingItem =
    useCallback(
      async (payload) => {
        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para agregar compras",
            true
          );

          return false;
        }

        try {
          await createShoppingItemCloud(
            cleanClienteId,
            payload,
            {
              operadorSesion,
              deviceId:
                cleanDeviceId,
            }
          );

          await refreshPurchasingData({
            silent: true,
          });

          showToast(
            "Agregado a la lista de compras"
          );

          return true;
        } catch (error) {
          console.error(
            "Error agregando compra:",
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
        operadorSesion,
        refreshPurchasingData,
        showToast,
      ]
    );

  const completeShoppingItem =
    useCallback(
      async (
        compraId,
        payload
      ) => {
        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para completar compras",
            true
          );

          return false;
        }

        try {
          const result =
            await completeShoppingItemCloud(
              cleanClienteId,
              compraId,
              payload,
              {
                operadorSesion,
                deviceId:
                  cleanDeviceId,
              }
            );

          await refreshPurchasingData({
            silent: true,
          });

          if (
            result?.stockNuevo !==
              null &&
            result?.stockNuevo !==
              undefined &&
            payload?.productoBarcode
          ) {
            const code =
              String(
                payload.productoBarcode
              ).trim();

            const current =
              catalogRef.current[
                code
              ];

            if (current) {
              persistCatalog({
                ...catalogRef.current,
                [code]: {
                  ...current,
                  stock:
                    normalizeProductType(
                      current.tipoVenta
                    ) === "peso"
                      ? roundQuantity(
                          result.stockNuevo
                        )
                      : Math.max(
                          0,
                          Math.trunc(
                            result.stockNuevo
                          )
                        ),
                  cost:
                    roundMoney(
                      result.costoNuevo
                    ),
                },
              });
            }
          }

          showToast(
            result?.cuentaPorPagarId
              ? "Compra registrada y cuenta por pagar creada"
              : "Compra registrada"
          );

          return true;
        } catch (error) {
          console.error(
            "Error completando compra:",
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
        operadorSesion,
        persistCatalog,
        refreshPurchasingData,
        showToast,
      ]
    );

  const createManualPayable =
    useCallback(
      async (payload) => {
        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para registrar una cuenta por pagar",
            true
          );

          return false;
        }

        try {
          await createManualPayableCloud(
            cleanClienteId,
            payload,
            {
              operadorSesion,
              deviceId:
                cleanDeviceId,
            }
          );

          await refreshPurchasingData({
            silent: true,
          });

          showToast(
            "Cuenta por pagar registrada"
          );

          return true;
        } catch (error) {
          console.error(
            "Error registrando cuenta por pagar:",
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
        operadorSesion,
        refreshPurchasingData,
        showToast,
      ]
    );

  const registerPayablePayment =
    useCallback(
      async (
        cuentaId,
        payload
      ) => {
        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para registrar un pago",
            true
          );

          return false;
        }

        const metodoPago =
          String(
            payload?.metodoPago ||
              "efectivo"
          )
            .trim()
            .toLowerCase();

        const requiereCaja =
          metodoPago ===
          "efectivo";

        if (requiereCaja) {
          const currentOpenSession =
            cashSessionsRef.current
              .find(
                (session) =>
                  session?.status ===
                  "open"
              ) ||
            null;

          if (!currentOpenSession) {
            showToast(
              "Abrí una caja para registrar un pago en efectivo",
              true
            );

            return false;
          }
        }

        try {
          await registerPayablePaymentCloud(
            cleanClienteId,
            cuentaId,
            payload,
            {
              operadorSesion,
              deviceId:
                cleanDeviceId,
            }
          );

          await refreshPurchasingData({
            silent: true,
          });

          showToast(
            "Pago registrado"
          );

          return true;
        } catch (error) {
          console.error(
            "Error registrando pago de cuenta por pagar:",
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
        operadorSesion,
        refreshPurchasingData,
        showToast,
      ]
    );

  /* =========================================================
     CUENTAS POR COBRAR — ALTA MANUAL
  ========================================================= */

  const createManualReceivable =
    useCallback(
      async (payload) => {
        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para registrar una deuda",
            true
          );

          return false;
        }

        try {
          const created =
            await createManualReceivableCloud(
              cleanClienteId,
              payload,
              {
                operadorSesion,
                deviceId:
                  cleanDeviceId,
              }
            );

          showToast(
            created
              ?.agrupadaEnCuentaExistente
              ? "Deuda agregada a la cuenta del cliente"
              : "Deuda registrada"
          );

          return true;
        } catch (error) {
          console.error(
            "Error registrando cuenta por cobrar:",
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
        operadorSesion,
        showToast,
      ]
    );


  /* =========================================================
     CUENTAS POR COBRAR — REGISTRAR PAGO
  ========================================================= */

  const registerReceivablePayment =
    useCallback(
      async (
        cuentaId,
        payload
      ) => {
        if (
          !cloudActiveRef
            .current
        ) {
          showToast(
            "Necesitás conexión con la nube para registrar un cobro",
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
            "Abrí una caja antes de registrar el cobro",
            true
          );

          return false;
        }

        try {
          await registerReceivablePaymentCloud(
            cleanClienteId,
            cuentaId,
            payload,
            {
              operadorSesion,
              deviceId:
                cleanDeviceId,
            }
          );

          showToast(
            "Pago registrado"
          );

          return true;
        } catch (error) {
          console.error(
            "Error registrando pago de cuenta por cobrar:",
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
        operadorSesion,
        showToast,
      ]
    );


  /* =========================================================
     GANANCIAS HISTÓRICAS
  ========================================================= */

  const migrateHistoricalProfits =
    useCallback(
      async (rules) => {
        if (
          !cloudActiveRef.current
        ) {
          showToast(
            "Necesitás conexión con la nube para completar ganancias históricas",
            true
          );

          return null;
        }

        try {
          const result =
            await migrateHistoricalProfitsCloud(
              cleanClienteId,
              rules,
              {
                operadorSesion,
                deviceId:
                  cleanDeviceId,
              }
            );

          const updated =
            Math.max(
              0,
              Math.trunc(
                toNumber(
                  result
                    ?.ventasActualizadas
                )
              )
            );

          showToast(
            updated > 0
              ? `${updated} ${updated === 1 ? "venta actualizada" : "ventas actualizadas"}`
              : "No había ventas para actualizar"
          );

          return result;
        } catch (error) {
          console.error(
            "Error migrando ganancias históricas:",
            error
          );

          showToast(
            mapCloudError(error),
            true
          );

          return null;
        }
      },
      [
        cleanClienteId,
        cleanDeviceId,
        operadorSesion,
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

    isOnline,
    offlineQueueLoaded,
    offlineSyncState,
    offlineLastSyncAt,
    pendingOfflineCount,
    offlineAttentionCount,
    offlineQueueItems,
    offlineSyncHistory,
    retryOfflineSync,
    clearOfflineHistory,

    migrationNeedsAdmin,

    cloudEnabled:
      cloudRequested &&
      cloudActiveRef.current,

    catalog,
    sales,
    cashSessions,
    accountsReceivable,
    shoppingList,
    accountsPayable,
    promotions,

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

    refreshPromotions,
    upsertPromotion,
    deletePromotion,

    getProductByBarcode,
    addProductToCart,
    addPromotionToCart,
    addToCartByBarcode,

    changeCartQty,
    updateCartWeight,
    updateCartAmount,

    removeFromCart,
    clearCart,

    getCartTotal,
    cartPricing,

    checkout,

    openCashSession,
    closeCashSession,
    deleteCashSession,

    createManualReceivable,
    registerReceivablePayment,

    refreshPurchasingData,
    createShoppingItem,
    completeShoppingItem,
    createManualPayable,
    registerPayablePayment,
    migrateHistoricalProfits,

    paymentBreakdown,
  };
}
