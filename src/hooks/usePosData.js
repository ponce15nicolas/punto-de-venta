// src/hooks/usePosData.js
// Estado y lógica principal del punto de venta.
//
// Maneja:
// - catálogo
// - carrito
// - ventas
// - caja
// - métodos de pago
// - stock
// - persistencia local
// - notificaciones
//
// Mantiene la misma API utilizada por el resto de la aplicación.

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

const PAYMENT_METHODS = [
  "efectivo",
  "transferencia",
  "qr",
  "tarjeta",
];

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
  return Math.round(
    (toNumber(value) +
      Number.EPSILON) *
    100
  ) / 100;
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
  ] = useState("Mi Negocio");

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
      setCatalog(
        storeGet(
          "catalog",
          {}
        ) || {}
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
        ) || "Mi Negocio"
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
          String(name || "")
            .trim();

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
     PRODUCTOS
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

        const barcode =
          String(
            product.barcode ||
            ""
          ).trim();

        const name =
          String(
            product.name || ""
          ).trim();

        const price =
          toNumber(
            product.price,
            NaN
          );

        const stock =
          parseInt(
            product.stock,
            10
          );

        if (
          !barcode ||
          !name ||
          !Number.isFinite(
            price
          ) ||
          price < 0 ||
          !Number.isFinite(
            stock
          ) ||
          stock < 0
        ) {
          showToast(
            "Completá correctamente los datos del producto",
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

        const normalizedProduct = {
          ...product,
          barcode,
          name,
          price:
            roundMoney(price),
          stock,
          expiry:
            product.expiry ||
            null,
        };

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

        persistCatalog(next);

        /*
         * Si estaba agregado al ticket,
         * también lo quitamos.
         */
        setCart((prev) =>
          prev.filter(
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

        const amount =
          parseInt(add, 10);

        const product =
          catalog[code];

        if (!product) {
          showToast(
            "Producto no encontrado",
            true
          );

          return false;
        }

        if (
          !Number.isFinite(
            amount
          ) ||
          amount <= 0
        ) {
          showToast(
            "Ingresá una cantidad válida",
            true
          );

          return false;
        }

        const currentStock =
          toNumber(
            product.stock
          );

        persistCatalog({
          ...catalog,

          [code]: {
            ...product,

            stock:
              currentStock +
              amount,
          },
        });

        showToast(
          "Stock actualizado"
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
     AGREGAR AL CARRITO
  ========================================================= */

  const addToCartByBarcode =
    useCallback(
      (barcode) => {
        const code =
          String(
            barcode || ""
          ).trim();

        if (!code) {
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

        const existing =
          cart.find(
            (item) =>
              item.barcode ===
              code
          );

        if (
          existing &&
          existing.qty >= stock
        ) {
          showToast(
            "No hay más stock disponible",
            true
          );

          return false;
        }

        if (existing) {
          setCart(
            cart.map(
              (item) =>
                item.barcode ===
                  code
                  ? {
                    ...item,

                    qty:
                      item.qty +
                      1,
                  }
                  : item
            )
          );
        } else {
          setCart([
            ...cart,

            {
              barcode: code,
              name:
                product.name,
              price:
                toNumber(
                  product.price
                ),
              qty: 1,
            },
          ]);
        }

        showToast(
          `${product.name} agregado`
        );

        return true;
      },
      [
        catalog,
        cart,
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

        const product =
          catalog[
          item.barcode
          ];

        const nextQty =
          toNumber(item.qty) +
          toNumber(delta);

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
     ELIMINAR DEL CARRITO
  ========================================================= */

  const removeFromCart =
    useCallback(
      (index) => {
        setCart((prev) =>
          prev.filter(
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
                acc,
                sale
              ) =>
                acc +
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
      [sales]
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
          cart.length ===
          0
        ) {
          return false;
        }

        /* ---------------------------------------------------
           VALIDAR STOCK
        --------------------------------------------------- */

        for (
          const item of cart
        ) {
          const product =
            catalog[
            item.barcode
            ];

          if (
            !product ||
            toNumber(
              product.stock
            ) <
            toNumber(
              item.qty
            )
          ) {
            showToast(
              `Stock insuficiente para ${item.name}`,
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
                acc,
                item
              ) =>
                acc +
                toNumber(
                  item.qty
                ) *
                toNumber(
                  item.price
                ),
              0
            )
          );

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
            new Date().toISOString(),

          items:
            cart.map(
              (item) => ({
                barcode:
                  item.barcode,

                name:
                  item.name,

                price:
                  toNumber(
                    item.price
                  ),

                qty:
                  toNumber(
                    item.qty
                  ),
              })
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

        cart.forEach(
          (item) => {
            const current =
              nextCatalog[
              item.barcode
              ];

            nextCatalog[
              item.barcode
            ] = {
              ...current,

              stock:
                toNumber(
                  current.stock
                ) -
                toNumber(
                  item.qty
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
            new Date().toISOString(),

          openAmount:
            roundMoney(
              amount
            ),

          closeTime: null,

          closeAmount: null,

          expectedAmount:
            null,

          counted: null,

          diff: null,

          totalSales:
            null,

          salesCount:
            null,

          paymentTotals:
            null,

          status: "open",
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
          new Date().toISOString();

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

    addToCartByBarcode,
    changeCartQty,
    removeFromCart,
    clearCart,

    checkout,

    openCashSession,
    closeCashSession,
    paymentBreakdown,
  };
}