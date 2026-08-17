// src/hooks/usePosData.js
//
// Estado y lógica principal del punto de venta.
//
// Soporta:
// - productos por unidad
// - productos por peso
// - productos de importe libre
// - stock entero o decimal
// - carrito
// - ventas
// - caja
// - métodos de pago
// - persistencia local
// - notificaciones
//
// Compatibilidad:
// Los productos antiguos que no tengan "tipoVenta"
// se consideran automáticamente "unidad".

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  storeGet,
  storeSet,
} from "../lib/storage";

import { uid } from "../lib/format";

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

/* =========================================================
   HELPERS GENERALES
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

function roundMoney(
  value
) {
  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * 100
    ) / 100
  );
}

function roundQuantity(
  value
) {
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
        : tipoVenta === "peso"
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

function getItemSubtotal(
  item
) {
  if (!item) {
    return 0;
  }

  if (
    Number.isFinite(
      Number(item.subtotal)
    )
  ) {
    return roundMoney(
      item.subtotal
    );
  }

  return roundMoney(
    toNumber(item.qty) *
      toNumber(item.price)
  );
}

function generarCodigoInterno() {
  return `manual-${Date.now()}-${uid()}`;
}

/* =========================================================
   HOOK
========================================================= */

export function usePosData() {
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
    "Mi Negocio"
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
    toastMsg,
    setToastMsg,
  ] = useState(null);

  /* =========================================================
     CARGAR DATOS
  ========================================================= */

  useEffect(() => {
    try {
      const savedCatalog =
        storeGet(
          "catalog",
          {}
        ) || {};

      /*
       * Normalizamos productos antiguos.
       *
       * De esta forma no hace falta editar
       * todos los productos existentes.
       */
      const normalizedCatalog =
        Object.fromEntries(
          Object.entries(
            savedCatalog
          ).map(
            ([
              barcode,
              product,
            ]) => [
              barcode,
              normalizeProduct({
                ...product,
                barcode:
                  product?.barcode ||
                  barcode,
              }),
            ]
          )
        );

      setCatalog(
        normalizedCatalog
      );

      setSales(
        storeGet(
          "sales",
          []
        ) || []
      );

      setCashSessions(
        storeGet(
          "cashSessions",
          []
        ) || []
      );

      setShopNameState(
        storeGet(
          "shopName",
          "Mi Negocio"
        ) ||
          "Mi Negocio"
      );
    } catch (error) {
      console.error(
        "Error cargando datos del POS:",
        error
      );

      setCatalog({});
      setSales([]);
      setCashSessions([]);

      setShopNameState(
        "Mi Negocio"
      );
    } finally {
      setLoaded(true);
    }
  }, []);

  /* =========================================================
     TOAST
  ========================================================= */

  const clearToast =
    useCallback(() => {
      setToastMsg(null);
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
     PERSISTENCIA
  ========================================================= */

  const persistCatalog =
    useCallback(
      (next) => {
        setCatalog(next);

        storeSet(
          "catalog",
          next
        );
      },
      []
    );

  const persistSales =
    useCallback(
      (next) => {
        setSales(next);

        storeSet(
          "sales",
          next
        );
      },
      []
    );

  const persistCashSessions =
    useCallback(
      (next) => {
        setCashSessions(next);

        storeSet(
          "cashSessions",
          next
        );
      },
      []
    );

  const setShopName =
    useCallback(
      (name) => {
        const cleanName =
          String(
            name || ""
          ).trim();

        if (!cleanName) {
          return;
        }

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
     CAJA ABIERTA
  ========================================================= */

  const openSession =
    cashSessions.find(
      (session) =>
        session.status ===
        "open"
    ) || null;

  /* =========================================================
     BUSCAR PRODUCTO
  ========================================================= */

  const getProductByBarcode =
    useCallback(
      (barcode) => {
        const code =
          String(
            barcode || ""
          ).trim();

        if (!code) {
          return null;
        }

        return (
          catalog[code] ||
          null
        );
      },
      [
        catalog,
      ]
    );

  /* =========================================================
     GUARDAR PRODUCTO
  ========================================================= */

  const upsertProduct =
    useCallback(
      (
        product,
        isEdit
      ) => {
        if (!product) {
          showToast(
            "Datos del producto inválidos",
            true
          );

          return false;
        }

        const tipoVenta =
          normalizeProductType(
            product.tipoVenta
          );

        let barcode =
          String(
            product.barcode ||
              ""
          ).trim();

        if (!barcode) {
          barcode =
            generarCodigoInterno();
        }

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

        if (!name) {
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

        if (
          !isEdit &&
          catalog[barcode]
        ) {
          showToast(
            "Ya existe un producto con ese código",
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

        persistCatalog({
          ...catalog,

          [barcode]:
            normalizedProduct,
        });

        showToast(
          isEdit
            ? "Producto actualizado"
            : "Producto agregado"
        );

        return true;
      },
      [
        catalog,
        persistCatalog,
        showToast,
      ]
    );

  /* =========================================================
     ELIMINAR PRODUCTO
  ========================================================= */

  const deleteProduct =
    useCallback(
      (barcode) => {
        const code =
          String(
            barcode || ""
          ).trim();

        if (
          !code ||
          !catalog[code]
        ) {
          return;
        }

        const next = {
          ...catalog,
        };

        delete next[code];

        persistCatalog(
          next
        );

        /*
         * Si estaba agregado al ticket,
         * también lo quitamos.
         */
        setCart(
          (previous) =>
            previous.filter(
              (item) =>
                item.barcode !==
                code
            )
        );

        showToast(
          "Producto eliminado"
        );
      },
      [
        catalog,
        persistCatalog,
        showToast,
      ]
    );

  /* =========================================================
     SUMAR STOCK
  ========================================================= */

  const restock =
    useCallback(
      (
        barcode,
        add
      ) => {
        const code =
          String(
            barcode || ""
          ).trim();

        const product =
          catalog[code];

        if (!product) {
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

        const currentStock =
          toNumber(
            product.stock
          );

        const nextStock =
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

        persistCatalog({
          ...catalog,

          [code]: {
            ...product,

            stock:
              nextStock,
          },
        });

        showToast(
          tipoVenta ===
          "peso"
            ? "Stock por peso actualizado"
            : "Stock actualizado"
        );

        return true;
      },
      [
        catalog,
        persistCatalog,
        showToast,
      ]
    );

  /* =========================================================
     AGREGAR PRODUCTO CONFIGURADO AL CARRITO
  ========================================================= */

  const addProductToCart =
    useCallback(
      (
        product,
        options = {}
      ) => {
        if (!product) {
          showToast(
            "Producto no encontrado",
            true
          );

          return false;
        }

        if (!openSession) {
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
           POR UNIDAD
        ----------------------------------------------------- */

        if (
          tipoVenta ===
          "unidad"
        ) {
          const stock =
            toNumber(
              product.stock
            );

          if (stock <= 0) {
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
              nextQty > stock
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
           POR PESO
        ----------------------------------------------------- */

        if (
          tipoVenta ===
          "peso"
        ) {
          const stock =
            toNumber(
              product.stock
            );

          if (stock <= 0) {
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
           * Si ingresaron importe,
           * calculamos automáticamente
           * el peso.
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
           * Si ingresaron peso,
           * calculamos automáticamente
           * el importe.
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

          /*
           * Sumamos el peso que ya está
           * dentro del ticket para evitar
           * superar el stock disponible.
           */
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
                  maximumFractionDigits: 3,
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
           PRECIO LIBRE
        ----------------------------------------------------- */

        const amount =
          roundMoney(
            toNumber(
              options.amount ??
                options.importe,
              0
            )
          );

        if (amount <= 0) {
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

            /*
             * Para mantener compatibilidad
             * con los cálculos existentes,
             * price contiene el importe.
             */
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
        openSession,
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
            barcode || ""
          ).trim();

        if (!code) {
          return false;
        }

        if (!openSession) {
          showToast(
            "Abrí la caja primero",
            true
          );

          return false;
        }

        const product =
          catalog[code];

        if (!product) {
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
         * Para peso o precio libre,
         * Vender.jsx debe mostrar primero
         * el modal correspondiente.
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
        catalog,
        openSession,
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

        if (!item) {
          return;
        }

        const tipoVenta =
          normalizeProductType(
            item.tipoVenta
          );

        /*
         * Peso e importe libre se editan
         * mediante su valor específico.
         */
        if (
          tipoVenta !==
          "unidad"
        ) {
          return;
        }

        const product =
          catalog[
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
        catalog,
        showToast,
      ]
    );

  /* =========================================================
     ACTUALIZAR PESO DE UNA LÍNEA
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
          catalog[
            item.barcode
          ];

        if (!product) {
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

        /*
         * Peso de otras líneas del
         * mismo producto.
         */
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

        const stock =
          toNumber(
            product.stock
          );

        if (
          roundQuantity(
            otherWeight +
              nextQuantity
          ) > stock
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
        catalog,
        showToast,
      ]
    );

  /* =========================================================
     ACTUALIZAR IMPORTE DE UNA LÍNEA
  ========================================================= */

  const updateCartAmount =
    useCallback(
      (
        index,
        amount
      ) => {
        const item =
          cart[index];

        if (!item) {
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
          (previous) =>
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
     TOTAL DEL CARRITO
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
          sales.filter(
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

        sessSales.forEach(
          (sale) => {
            const method =
              sale.payment
                ?.method ||
              "efectivo";

            if (
              totals[
                method
              ] ===
              undefined
            ) {
              totals[
                method
              ] = 0;
            }

            totals[method] =
              roundMoney(
                totals[
                  method
                ] +
                  toNumber(
                    sale.total
                  )
              );
          }
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

        return {
          sessSales,
          totals,
          totalSales,
        };
      },
      [
        sales,
      ]
    );

  /* =========================================================
     CHECKOUT
  ========================================================= */

  const checkout =
    useCallback(
      (payment) => {
        if (!openSession) {
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

        /* ---------------------------------------------------
           VALIDAR STOCK
        --------------------------------------------------- */

        const stockNecesario =
          {};

        for (
          const item of cart
        ) {
          const tipoVenta =
            normalizeProductType(
              item.tipoVenta
            );

          /*
           * Importe libre no descuenta
           * stock.
           */
          if (
            tipoVenta ===
            "precio-libre"
          ) {
            continue;
          }

          const product =
            catalog[
              item.barcode
            ];

          if (!product) {
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
            catalog[
              barcode
            ];

          if (
            !product ||
            toNumber(
              product.stock
            ) + 0.000001 <
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

        /* ---------------------------------------------------
           TOTAL
        --------------------------------------------------- */

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

        /* ---------------------------------------------------
           MÉTODO
        --------------------------------------------------- */

        const requestedMethod =
          payment?.method ||
          "efectivo";

        const method =
          PAYMENT_METHODS.includes(
            requestedMethod
          )
            ? requestedMethod
            : "efectivo";

        /* ---------------------------------------------------
           MONTO RECIBIDO
        --------------------------------------------------- */

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

        /* ---------------------------------------------------
           CREAR VENTA
        --------------------------------------------------- */

        const sale = {
          id: uid(),

          timestamp:
            new Date()
              .toISOString(),

          items:
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
            ),

          total,

          sessionId:
            openSession.id,

          payment: {
            method,

            received:
              roundMoney(
                received
              ),

            change,
          },
        };

        /* ---------------------------------------------------
           DESCONTAR STOCK
        --------------------------------------------------- */

        const nextCatalog = {
          ...catalog,
        };

        Object.entries(
          stockNecesario
        ).forEach(
          ([
            barcode,
            required,
          ]) => {
            const current =
              nextCatalog[
                barcode
              ];

            if (!current) {
              return;
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
        );

        /* ---------------------------------------------------
           GUARDAR
        --------------------------------------------------- */

        persistSales([
          ...sales,
          sale,
        ]);

        persistCatalog(
          nextCatalog
        );

        setCart([]);

        showToast(
          `Venta registrada · ${total.toFixed(
            2
          )}`
        );

        return true;
      },
      [
        openSession,
        cart,
        catalog,
        sales,
        persistSales,
        persistCatalog,
        showToast,
      ]
    );

  /* =========================================================
     ABRIR CAJA
  ========================================================= */

  const openCashSession =
    useCallback(
      (openAmount) => {
        if (openSession) {
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

        const session = {
          id: uid(),

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
            null,

          salesCount:
            null,

          paymentTotals:
            null,

          status:
            "open",
        };

        persistCashSessions([
          ...cashSessions,
          session,
        ]);

        showToast(
          "Caja abierta"
        );

        return true;
      },
      [
        openSession,
        cashSessions,
        persistCashSessions,
        showToast,
      ]
    );

  /* =========================================================
     CERRAR CAJA
  ========================================================= */

  const closeCashSession =
    useCallback(
      (counted) => {
        if (!openSession) {
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

        const {
          sessSales,
          totals,
          totalSales,
        } =
          paymentBreakdown(
            openSession.id
          );

        /*
         * Solo el efectivo entra
         * físicamente en la caja.
         */
        const expected =
          roundMoney(
            toNumber(
              openSession.openAmount
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

        const now =
          new Date()
            .toISOString();

        const next =
          cashSessions.map(
            (session) =>
              session.id ===
              openSession.id
                ? {
                    ...session,

                    closeTime:
                      now,

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
                  }
                : session
          );

        persistCashSessions(
          next
        );

        if (diff === 0) {
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
      },
      [
        openSession,
        cashSessions,
        paymentBreakdown,
        persistCashSessions,
        showToast,
      ]
    );

  /* =========================================================
     RETURN
  ========================================================= */

  return {
    loaded,

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
    paymentBreakdown,
  };
}