// src/services/pos/posFirestore.js
// Capa de acceso a Cloud Firestore para el POS.
// No contiene React ni lógica visual.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../firebase/config";

import {
  cajaPath,
  cajasPath,
  configuracionPosPath,
  productoPath,
  productosPath,
  ventaPath,
  ventasPath,
} from "./posPaths";

/* =========================================================
   CONSTANTES
========================================================= */

const PRODUCT_TYPES = Object.freeze([
  "unidad",
  "peso",
  "precio-libre",
]);

const PAYMENT_METHODS = Object.freeze([
  "efectivo",
  "transferencia",
  "qr",
  "tarjeta",
]);

const MAX_CART_LINES = 100;

const eliminarCierreCajaFunction =
  httpsCallable(
    functions,
    "eliminarCierreCaja"
  );

/* =========================================================
   ERROR CONTROLADO
========================================================= */

export class PosFirestoreError extends Error {
  constructor(
    code,
    message,
    details = {}
  ) {
    super(message);

    this.name = "PosFirestoreError";
    this.code = code;
    this.details = details;
  }
}

function fail(
  code,
  message,
  details = {}
) {
  throw new PosFirestoreError(
    code,
    message,
    details
  );
}

/* =========================================================
   HELPERS GENERALES
========================================================= */

function requireString(
  value,
  fieldName
) {
  const clean =
    String(value ?? "").trim();

  if (!clean) {
    fail(
      "invalid-argument",
      `${fieldName} es obligatorio`
    );
  }

  return clean;
}

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

function normalizePaymentMethod(
  value
) {
  return PAYMENT_METHODS.includes(
    value
  )
    ? value
    : "efectivo";
}

function isPlainObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(
      value
    );

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

/*
 * Firestore no admite undefined.
 *
 * Quitamos undefined sin destruir
 * objetos especiales de Firebase
 * como serverTimestamp().
 */
function removeUndefined(value) {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map(removeUndefined)
      .filter(
        (item) =>
          item !== undefined
      );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(
          ([key, item]) => [
            key,
            removeUndefined(item),
          ]
        )
        .filter(
          ([, item]) =>
            item !== undefined
        )
    );
  }

  return value;
}

function safeIsoDate(
  value = null
) {
  if (!value) {
    return new Date()
      .toISOString();
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return new Date()
      .toISOString();
  }

  return date.toISOString();
}

/* =========================================================
   NORMALIZAR PRODUCTO
========================================================= */

function normalizeProductForCloud(
  product
) {
  if (!product) {
    fail(
      "invalid-product",
      "Datos del producto inválidos"
    );
  }

  const barcode =
    requireString(
      product.barcode,
      "barcode"
    );

  const name =
    requireString(
      product.name,
      "name"
    );

  const tipoVenta =
    normalizeProductType(
      product.tipoVenta
    );

  const price =
    tipoVenta ===
    "precio-libre"
      ? 0
      : roundMoney(
          toNumber(
            product.price,
            NaN
          )
        );

  let stock = 0;

  if (
    tipoVenta === "peso"
  ) {
    stock =
      roundQuantity(
        toNumber(
          product.stock,
          NaN
        )
      );
  } else if (
    tipoVenta === "unidad"
  ) {
    stock =
      Math.trunc(
        toNumber(
          product.stock,
          NaN
        )
      );
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
    fail(
      "invalid-price",
      "El precio del producto no es válido"
    );
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
    fail(
      "invalid-stock",
      "El stock del producto no es válido"
    );
  }

  return removeUndefined({
    ...product,

    barcode,
    name,
    tipoVenta,

    unidadMedida:
      tipoVenta === "peso"
        ? product.unidadMedida ||
          "kg"
        : null,

    price,
    stock,

    expiry:
      product.expiry ||
      null,

    updatedAt:
      serverTimestamp(),
  });
}

function normalizeProductFromCloud(
  data,
  documentId
) {
  const tipoVenta =
    normalizeProductType(
      data?.tipoVenta
    );

  let barcode =
    String(
      data?.barcode || ""
    ).trim();

  if (!barcode) {
    try {
      barcode =
        decodeURIComponent(
          documentId
        );
    } catch {
      barcode =
        documentId;
    }
  }

  return {
    ...data,

    barcode,
    tipoVenta,

    unidadMedida:
      tipoVenta === "peso"
        ? data?.unidadMedida ||
          "kg"
        : null,

    price:
      tipoVenta ===
      "precio-libre"
        ? 0
        : roundMoney(
            toNumber(
              data?.price
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
                data?.stock
              )
            )
          : Math.max(
              0,
              Math.trunc(
                toNumber(
                  data?.stock
                )
              )
            ),
  };
}

/* =========================================================
   NORMALIZAR ÍTEMS DE VENTA
========================================================= */

function normalizeSaleItem(
  item
) {
  if (!item) {
    fail(
      "invalid-sale-item",
      "Hay un producto inválido en la venta"
    );
  }

  const barcode =
    requireString(
      item.barcode,
      "barcode"
    );

  const name =
    requireString(
      item.name,
      "name"
    );

  const tipoVenta =
    normalizeProductType(
      item.tipoVenta
    );

  let qty;

  if (
    tipoVenta === "peso"
  ) {
    qty =
      roundQuantity(
        toNumber(
          item.qty,
          NaN
        )
      );
  } else if (
    tipoVenta === "unidad"
  ) {
    qty =
      Math.trunc(
        toNumber(
          item.qty,
          NaN
        )
      );
  } else {
    qty = 1;
  }

  if (
    !Number.isFinite(
      qty
    ) ||
    qty <= 0
  ) {
    fail(
      "invalid-quantity",
      `Cantidad inválida para ${name}`
    );
  }

  const price =
    roundMoney(
      toNumber(
        item.price,
        NaN
      )
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price < 0
  ) {
    fail(
      "invalid-price",
      `Precio inválido para ${name}`
    );
  }

  const calculatedSubtotal =
    roundMoney(
      qty * price
    );

  const hasSubtotal =
    item.subtotal !== null &&
    item.subtotal !== "" &&
    Number.isFinite(
      Number(
        item.subtotal
      )
    );

  const subtotal =
    hasSubtotal
      ? roundMoney(
          item.subtotal
        )
      : calculatedSubtotal;

  if (subtotal <= 0) {
    fail(
      "invalid-subtotal",
      `Importe inválido para ${name}`
    );
  }

  return {
    barcode,
    name,
    tipoVenta,

    unidadMedida:
      tipoVenta === "peso"
        ? item.unidadMedida ||
          "kg"
        : null,

    price,
    qty,
    subtotal,
  };
}

function normalizeSaleItems(
  items
) {
  if (
    !Array.isArray(items)
  ) {
    fail(
      "invalid-cart",
      "El carrito no es válido"
    );
  }

  if (
    items.length === 0
  ) {
    fail(
      "empty-cart",
      "El carrito está vacío"
    );
  }

  if (
    items.length >
    MAX_CART_LINES
  ) {
    fail(
      "cart-too-large",
      "La venta contiene demasiados productos"
    );
  }

  return items.map(
    normalizeSaleItem
  );
}

/* =========================================================
   REFERENCIAS
========================================================= */

function productosRef(
  clienteId
) {
  return collection(
    db,
    ...productosPath(
      clienteId
    )
  );
}

function productoRef(
  clienteId,
  barcode
) {
  return doc(
    db,
    ...productoPath(
      clienteId,
      barcode
    )
  );
}

function ventasRef(
  clienteId
) {
  return collection(
    db,
    ...ventasPath(
      clienteId
    )
  );
}

function ventaRef(
  clienteId,
  ventaId
) {
  return doc(
    db,
    ...ventaPath(
      clienteId,
      ventaId
    )
  );
}

function cajasRef(
  clienteId
) {
  return collection(
    db,
    ...cajasPath(
      clienteId
    )
  );
}

function cajaRef(
  clienteId,
  cajaId
) {
  return doc(
    db,
    ...cajaPath(
      clienteId,
      cajaId
    )
  );
}

function configuracionRef(
  clienteId
) {
  return doc(
    db,
    ...configuracionPosPath(
      clienteId
    )
  );
}

function sortByIsoField(
  items,
  field
) {
  return [...items].sort(
    (a, b) =>
      String(
        a?.[field] || ""
      ).localeCompare(
        String(
          b?.[field] || ""
        )
      )
  );
}

/* =========================================================
   LECTURAS ÚNICAS
========================================================= */

export async function getProductsOnce(
  clienteId
) {
  requireString(
    clienteId,
    "clienteId"
  );

  const snapshot =
    await getDocs(
      productosRef(
        clienteId
      )
    );

  return Object.fromEntries(
    snapshot.docs.map(
      (snapshotDoc) => {
        const product =
          normalizeProductFromCloud(
            snapshotDoc.data(),
            snapshotDoc.id
          );

        return [
          product.barcode,
          product,
        ];
      }
    )
  );
}

export async function getSalesOnce(
  clienteId
) {
  requireString(
    clienteId,
    "clienteId"
  );

  const snapshot =
    await getDocs(
      ventasRef(
        clienteId
      )
    );

  return sortByIsoField(
    snapshot.docs.map(
      (snapshotDoc) => ({
        id:
          snapshotDoc.id,

        ...snapshotDoc.data(),
      })
    ),
    "timestamp"
  );
}

export async function getCashSessionsOnce(
  clienteId
) {
  requireString(
    clienteId,
    "clienteId"
  );

  const snapshot =
    await getDocs(
      cajasRef(
        clienteId
      )
    );

  return sortByIsoField(
    snapshot.docs.map(
      (snapshotDoc) => ({
        id:
          snapshotDoc.id,

        ...snapshotDoc.data(),
      })
    ),
    "openTime"
  );
}

export async function getPosConfigOnce(
  clienteId
) {
  requireString(
    clienteId,
    "clienteId"
  );

  const snapshot =
    await getDoc(
      configuracionRef(
        clienteId
      )
    );

  return snapshot.exists()
    ? {
        id:
          snapshot.id,

        ...snapshot.data(),
      }
    : null;
}

/* =========================================================
   LISTENERS EN TIEMPO REAL
========================================================= */

export function subscribeProducts(
  clienteId,
  onData,
  onError = console.error
) {
  requireString(
    clienteId,
    "clienteId"
  );

  if (
    typeof onData !==
    "function"
  ) {
    fail(
      "invalid-callback",
      "subscribeProducts necesita onData"
    );
  }

  return onSnapshot(
    productosRef(
      clienteId
    ),

    (snapshot) => {
      const catalog =
        Object.fromEntries(
          snapshot.docs.map(
            (
              snapshotDoc
            ) => {
              const product =
                normalizeProductFromCloud(
                  snapshotDoc.data(),
                  snapshotDoc.id
                );

              return [
                product.barcode,
                product,
              ];
            }
          )
        );

      onData(catalog);
    },

    onError
  );
}

export function subscribeSales(
  clienteId,
  onData,
  onError = console.error
) {
  requireString(
    clienteId,
    "clienteId"
  );

  if (
    typeof onData !==
    "function"
  ) {
    fail(
      "invalid-callback",
      "subscribeSales necesita onData"
    );
  }

  return onSnapshot(
    ventasRef(
      clienteId
    ),

    (snapshot) => {
      const sales =
        sortByIsoField(
          snapshot.docs.map(
            (
              snapshotDoc
            ) => ({
              id:
                snapshotDoc.id,

              ...snapshotDoc.data(),
            })
          ),
          "timestamp"
        );

      onData(sales);
    },

    onError
  );
}

export function subscribeCashSessions(
  clienteId,
  onData,
  onError = console.error
) {
  requireString(
    clienteId,
    "clienteId"
  );

  if (
    typeof onData !==
    "function"
  ) {
    fail(
      "invalid-callback",
      "subscribeCashSessions necesita onData"
    );
  }

  return onSnapshot(
    cajasRef(
      clienteId
    ),

    (snapshot) => {
      const sessions =
        sortByIsoField(
          snapshot.docs.map(
            (
              snapshotDoc
            ) => ({
              id:
                snapshotDoc.id,

              ...snapshotDoc.data(),
            })
          ),
          "openTime"
        );

      onData(
        sessions
      );
    },

    onError
  );
}

export function subscribePosConfig(
  clienteId,
  onData,
  onError = console.error
) {
  requireString(
    clienteId,
    "clienteId"
  );

  if (
    typeof onData !==
    "function"
  ) {
    fail(
      "invalid-callback",
      "subscribePosConfig necesita onData"
    );
  }

  return onSnapshot(
    configuracionRef(
      clienteId
    ),

    (snapshot) => {
      onData(
        snapshot.exists()
          ? {
              id:
                snapshot.id,

              ...snapshot.data(),
            }
          : null
      );
    },

    onError
  );
}

/* =========================================================
   CONFIGURACIÓN
========================================================= */

export async function saveShopNameCloud(
  clienteId,
  shopName
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanShopName =
    requireString(
      shopName,
      "shopName"
    );

  await setDoc(
    configuracionRef(
      cleanClienteId
    ),
    {
      shopName:
        cleanShopName,

      updatedAt:
        serverTimestamp(),
    },
    {
      merge: true,
    }
  );

  return true;
}

/* =========================================================
   PRODUCTOS
========================================================= */

export async function upsertProductCloud(
  clienteId,
  product,
  options = {}
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const normalized =
    normalizeProductForCloud(
      product
    );

  const previousBarcode =
    String(
      options.previousBarcode ||
      ""
    ).trim();

  const nextRef =
    productoRef(
      cleanClienteId,
      normalized.barcode
    );

  /*
   * Si cambia el código,
   * creamos el nuevo documento
   * y eliminamos el anterior
   * dentro del mismo batch.
   */
  if (
    previousBarcode &&
    previousBarcode !==
      normalized.barcode
  ) {
    const batch =
      writeBatch(db);

    batch.set(
      nextRef,
      {
        ...normalized,

        createdAt:
          serverTimestamp(),
      },
      {
        merge: true,
      }
    );

    batch.delete(
      productoRef(
        cleanClienteId,
        previousBarcode
      )
    );

    await batch.commit();

    return normalized;
  }

  const existing =
    await getDoc(
      nextRef
    );

  await setDoc(
    nextRef,
    {
      ...normalized,

      ...(
        existing.exists()
          ? {}
          : {
              createdAt:
                serverTimestamp(),
            }
      ),
    },
    {
      merge: true,
    }
  );

  return normalized;
}

export async function deleteProductCloud(
  clienteId,
  barcode
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanBarcode =
    requireString(
      barcode,
      "barcode"
    );

  await deleteDoc(
    productoRef(
      cleanClienteId,
      cleanBarcode
    )
  );

  return true;
}

/* =========================================================
   SUMAR STOCK
========================================================= */

export async function restockProductCloud(
  clienteId,
  barcode,
  add
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanBarcode =
    requireString(
      barcode,
      "barcode"
    );

  const ref =
    productoRef(
      cleanClienteId,
      cleanBarcode
    );

  return runTransaction(
    db,

    async (
      transaction
    ) => {
      const snapshot =
        await transaction.get(
          ref
        );

      if (
        !snapshot.exists()
      ) {
        fail(
          "product-not-found",
          "Producto no encontrado"
        );
      }

      const data =
        snapshot.data();

      const tipoVenta =
        normalizeProductType(
          data.tipoVenta
        );

      if (
        tipoVenta ===
        "precio-libre"
      ) {
        fail(
          "product-without-stock",
          "Este producto no utiliza stock"
        );
      }

      const amount =
        tipoVenta === "peso"
          ? roundQuantity(
              toNumber(
                add,
                NaN
              )
            )
          : Math.trunc(
              toNumber(
                add,
                NaN
              )
            );

      if (
        !Number.isFinite(
          amount
        ) ||
        amount <= 0
      ) {
        fail(
          "invalid-restock",

          tipoVenta === "peso"
            ? "Ingresá un peso válido"
            : "Ingresá una cantidad válida"
        );
      }

      const currentStock =
        toNumber(
          data.stock
        );

      const nextStock =
        tipoVenta === "peso"
          ? roundQuantity(
              currentStock +
              amount
            )
          : Math.trunc(
              currentStock +
              amount
            );

      transaction.update(
        ref,
        {
          stock:
            nextStock,

          updatedAt:
            serverTimestamp(),
        }
      );

      return nextStock;
    }
  );
}

/* =========================================================
   ABRIR CAJA
========================================================= */

export async function openCashSessionCloud(
  clienteId,
  {
    sessionId,
    openAmount,
    deviceId = null,
  }
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanSessionId =
    requireString(
      sessionId,
      "sessionId"
    );

  const amount =
    roundMoney(
      toNumber(
        openAmount,
        NaN
      )
    );

  if (
    !Number.isFinite(
      amount
    ) ||
    amount < 0
  ) {
    fail(
      "invalid-open-amount",
      "Ingresá un monto inicial válido"
    );
  }

  const configRef =
    configuracionRef(
      cleanClienteId
    );

  const sessionRef =
    cajaRef(
      cleanClienteId,
      cleanSessionId
    );

  return runTransaction(
    db,

    async (
      transaction
    ) => {
      /*
       * La configuración mantiene
       * el ID de la única caja
       * abierta del cliente.
       */
      const configSnap =
        await transaction.get(
          configRef
        );

      const existingOpenId =
        String(
          configSnap.data()
            ?.openCashSessionId ||
          ""
        ).trim();

      if (
        existingOpenId
      ) {
        const existingRef =
          cajaRef(
            cleanClienteId,
            existingOpenId
          );

        const existingSnap =
          await transaction.get(
            existingRef
          );

        if (
          existingSnap.exists() &&
          existingSnap.data()
            ?.status ===
            "open"
        ) {
          /*
           * Si es exactamente
           * la misma operación,
           * devolvemos la caja.
           *
           * Esto hace la apertura
           * idempotente ante un
           * posible reintento.
           */
          if (
            existingOpenId ===
            cleanSessionId
          ) {
            return {
              id:
                existingSnap.id,

              ...existingSnap.data(),
            };
          }

          fail(
            "cash-already-open",
            "Ya hay una caja abierta",
            {
              sessionId:
                existingOpenId,
            }
          );
        }
      }

      const targetSnap =
        await transaction.get(
          sessionRef
        );

      if (
        targetSnap.exists()
      ) {
        const existing = {
          id:
            targetSnap.id,

          ...targetSnap.data(),
        };

        /*
         * Recuperación ante una
         * configuración desactualizada.
         */
        if (
          existing.status ===
          "open"
        ) {
          transaction.set(
            configRef,
            {
              openCashSessionId:
                cleanSessionId,

              updatedAt:
                serverTimestamp(),
            },
            {
              merge: true,
            }
          );

          return existing;
        }

        fail(
          "cash-session-id-used",
          "El identificador de caja ya fue utilizado"
        );
      }

      const now =
        new Date()
          .toISOString();

      const session = {
        id:
          cleanSessionId,

        openTime:
          now,

        openAmount:
          amount,

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

        /*
         * Estos acumuladores se
         * actualizan dentro de la
         * misma transacción de venta.
         *
         * Así cerrar caja no depende
         * de calcular nuevamente todo
         * el historial.
         */
        totalSales:
          0,

        salesCount:
          0,

        paymentTotals: {
          efectivo: 0,
          transferencia: 0,
          qr: 0,
          tarjeta: 0,
        },

        status:
          "open",

        openedByDeviceId:
          deviceId || null,

        createdAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp(),
      };

      transaction.set(
        sessionRef,
        removeUndefined(
          session
        )
      );

      transaction.set(
        configRef,
        {
          openCashSessionId:
            cleanSessionId,

          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return {
        ...session,

        createdAt:
          null,

        updatedAt:
          null,
      };
    }
  );
}

/* =========================================================
   CHECKOUT ATÓMICO
========================================================= */

export async function checkoutCloud(
  clienteId,
  {
    saleId,
    items,
    payment,
    deviceId = null,
    timestamp = null,
  }
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanSaleId =
    requireString(
      saleId,
      "saleId"
    );

  const normalizedItems =
    normalizeSaleItems(
      items
    );

  const total =
    roundMoney(
      normalizedItems.reduce(
        (
          sum,
          item
        ) =>
          sum +
          item.subtotal,
        0
      )
    );

  if (
    total <= 0
  ) {
    fail(
      "invalid-total",
      "El total de la venta debe ser mayor a cero"
    );
  }

  const method =
    normalizePaymentMethod(
      payment?.method
    );

  const received =
    method ===
    "efectivo"
      ? roundMoney(
          toNumber(
            payment?.received,
            total
          )
        )
      : total;

  if (
    method ===
      "efectivo" &&
    received < total
  ) {
    fail(
      "insufficient-received",
      "El monto recibido es menor al total"
    );
  }

  const change =
    method ===
    "efectivo"
      ? roundMoney(
          received -
          total
        )
      : 0;

  const configRef =
    configuracionRef(
      cleanClienteId
    );

  const saleRef =
    ventaRef(
      cleanClienteId,
      cleanSaleId
    );

  return runTransaction(
    db,

    async (
      transaction
    ) => {
      /*
       * IMPORTANTE:
       * todas las lecturas se hacen
       * antes de las escrituras.
       */

      /* -----------------------------------------------------
         CONFIGURACIÓN
      ----------------------------------------------------- */

      const configSnap =
        await transaction.get(
          configRef
        );

      const sessionId =
        String(
          configSnap.data()
            ?.openCashSessionId ||
          ""
        ).trim();

      if (!sessionId) {
        fail(
          "cash-not-open",
          "Abrí la caja primero"
        );
      }

      /* -----------------------------------------------------
         CAJA
      ----------------------------------------------------- */

      const sessionRef =
        cajaRef(
          cleanClienteId,
          sessionId
        );

      const sessionSnap =
        await transaction.get(
          sessionRef
        );

      if (
        !sessionSnap.exists() ||
        sessionSnap.data()
          ?.status !==
          "open"
      ) {
        fail(
          "cash-not-open",
          "La caja ya no se encuentra abierta"
        );
      }

      /* -----------------------------------------------------
         IDEMPOTENCIA DE VENTA
      ----------------------------------------------------- */

      /*
       * Si una petición se repite
       * con el mismo saleId,
       * no duplicamos la venta.
       */
      const existingSaleSnap =
        await transaction.get(
          saleRef
        );

      if (
        existingSaleSnap.exists()
      ) {
        return {
          alreadyExists:
            true,

          sale: {
            id:
              existingSaleSnap.id,

            ...existingSaleSnap.data(),
          },
        };
      }

      /* -----------------------------------------------------
         STOCK REQUERIDO
      ----------------------------------------------------- */

      const requiredByBarcode =
        new Map();

      for (
        const item of
        normalizedItems
      ) {
        /*
         * Precio libre no utiliza
         * control de stock.
         */
        if (
          item.tipoVenta ===
          "precio-libre"
        ) {
          continue;
        }

        const current =
          requiredByBarcode.get(
            item.barcode
          ) || 0;

        requiredByBarcode.set(
          item.barcode,

          roundQuantity(
            current +
            item.qty
          )
        );
      }

      /* -----------------------------------------------------
         LEER PRODUCTOS
      ----------------------------------------------------- */

      const productEntries =
        [];

      for (
        const [
          barcode,
          required,
        ] of
        requiredByBarcode.entries()
      ) {
        const ref =
          productoRef(
            cleanClienteId,
            barcode
          );

        const snapshot =
          await transaction.get(
            ref
          );

        if (
          !snapshot.exists()
        ) {
          fail(
            "product-not-found",
            `Producto no encontrado: ${barcode}`,
            {
              barcode,
            }
          );
        }

        const data =
          snapshot.data();

        const tipoVenta =
          normalizeProductType(
            data.tipoVenta
          );

        /*
         * Si otro dispositivo
         * modificó el tipo de venta
         * mientras el producto estaba
         * en el carrito, no intentamos
         * vender datos obsoletos.
         */
        const cartItem =
          normalizedItems.find(
            (item) =>
              item.barcode ===
                barcode &&
              item.tipoVenta !==
                "precio-libre"
          );

        const cartItemType =
          normalizeProductType(
            cartItem?.tipoVenta
          );

        if (
          tipoVenta !==
          cartItemType
        ) {
          fail(
            "product-changed",
            `El tipo de venta de ${
              data.name ||
              barcode
            } cambió. Volvé a agregarlo al ticket.`,
            {
              barcode,
            }
          );
        }

        const currentStock =
          toNumber(
            data.stock
          );

        /*
         * Pequeña tolerancia para
         * números decimales.
         */
        if (
          currentStock +
            0.000001 <
          required
        ) {
          fail(
            "insufficient-stock",
            `Stock insuficiente para ${
              data.name ||
              barcode
            }`,
            {
              barcode,
              required,

              available:
                currentStock,
            }
          );
        }

        productEntries.push({
          ref,
          tipoVenta,
          required,
          currentStock,
        });
      }

      /* -----------------------------------------------------
         CREAR VENTA
      ----------------------------------------------------- */

      const sale = {
        id:
          cleanSaleId,

        timestamp:
          safeIsoDate(
            timestamp
          ),

        items:
          normalizedItems,

        total,

        sessionId,

        payment: {
          method,
          received,
          change,
        },

        deviceId:
          deviceId || null,

        createdAt:
          serverTimestamp(),
      };

      /*
       * A partir de aquí comienzan
       * las escrituras.
       */

      transaction.set(
        saleRef,
        removeUndefined(
          sale
        )
      );

      /* -----------------------------------------------------
         DESCONTAR STOCK
      ----------------------------------------------------- */

      for (
        const entry of
        productEntries
      ) {
        const nextStockRaw =
          entry.currentStock -
          entry.required;

        const nextStock =
          entry.tipoVenta ===
          "peso"
            ? roundQuantity(
                Math.max(
                  0,
                  nextStockRaw
                )
              )
            : Math.max(
                0,
                Math.trunc(
                  nextStockRaw
                )
              );

        transaction.update(
          entry.ref,
          {
            stock:
              nextStock,

            updatedAt:
              serverTimestamp(),
          }
        );
      }

      /* -----------------------------------------------------
         ACTUALIZAR CAJA
      ----------------------------------------------------- */

      const sessionData =
        sessionSnap.data();

      const paymentTotals = {
        efectivo:
          roundMoney(
            sessionData
              ?.paymentTotals
              ?.efectivo ||
            0
          ),

        transferencia:
          roundMoney(
            sessionData
              ?.paymentTotals
              ?.transferencia ||
            0
          ),

        qr:
          roundMoney(
            sessionData
              ?.paymentTotals
              ?.qr ||
            0
          ),

        tarjeta:
          roundMoney(
            sessionData
              ?.paymentTotals
              ?.tarjeta ||
            0
          ),
      };

      paymentTotals[
        method
      ] =
        roundMoney(
          paymentTotals[
            method
          ] +
          total
        );

      const nextTotalSales =
        roundMoney(
          toNumber(
            sessionData.totalSales
          ) +
          total
        );

      const nextSalesCount =
        Math.max(
          0,
          Math.trunc(
            toNumber(
              sessionData.salesCount
            )
          )
        ) + 1;

      transaction.update(
        sessionRef,
        {
          totalSales:
            nextTotalSales,

          salesCount:
            nextSalesCount,

          paymentTotals,

          updatedAt:
            serverTimestamp(),
        }
      );

      return {
        alreadyExists:
          false,

        sale: {
          ...sale,

          createdAt:
            null,
        },
      };
    }
  );
}

/* =========================================================
   ELIMINAR CIERRE DE CAJA
========================================================= */

export async function deleteCashSessionCloud(
  clienteId,
  cajaId
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanCajaId =
    requireString(
      cajaId,
      "cajaId"
    );

  try {
    const response =
      await eliminarCierreCajaFunction({
        clienteId:
          cleanClienteId,

        cajaId:
          cleanCajaId,
      });

    const data =
      response?.data || {};

    if (!data.ok) {
      fail(
        "delete-cash-session-failed",
        "No se pudo eliminar el cierre de caja"
      );
    }

    return {
      ok: true,

      cajaId:
        data.cajaId ||
        cleanCajaId,

      ventasEliminadas:
        Math.max(
          0,
          Math.trunc(
            toNumber(
              data.ventasEliminadas,
              0
            )
          )
        ),

      alreadyDeleted:
        Boolean(
          data.alreadyDeleted
        ),
    };
  } catch (error) {
    /*
     * Si ya viene como error propio de esta capa,
     * no lo envolvemos nuevamente.
     */
    if (
      error instanceof
      PosFirestoreError
    ) {
      throw error;
    }

    const code =
      String(
        error?.code ||
        "unknown"
      )
        .split("/")
        .pop();

    const serverMessage =
      String(
        error?.details?.mensaje ||
        error?.details?.message ||
        error?.message ||
        ""
      ).trim();

    if (
      code ===
      "failed-precondition"
    ) {
      fail(
        "cash-session-not-closed",
        serverMessage ||
        "Sólo se pueden eliminar cierres de caja finalizados"
      );
    }

    if (
      code ===
      "unauthenticated"
    ) {
      fail(
        "unauthenticated",
        "Tu sesión dejó de ser válida. Iniciá sesión nuevamente."
      );
    }

    if (
      code ===
      "permission-denied"
    ) {
      fail(
        "permission-denied",
        "No tenés permisos para eliminar este cierre."
      );
    }

    if (
      code ===
      "not-found"
    ) {
      fail(
        "cash-session-not-found",
        "No encontramos el cierre de caja."
      );
    }

    fail(
      "delete-cash-session-failed",
      serverMessage ||
      "No se pudo eliminar el cierre de caja"
    );
  }
}


/* =========================================================
   CERRAR CAJA
========================================================= */

export async function closeCashSessionCloud(
  clienteId,
  {
    sessionId,
    counted,
    deviceId = null,
  }
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanSessionId =
    requireString(
      sessionId,
      "sessionId"
    );

  const countedAmount =
    roundMoney(
      toNumber(
        counted,
        NaN
      )
    );

  if (
    !Number.isFinite(
      countedAmount
    ) ||
    countedAmount < 0
  ) {
    fail(
      "invalid-counted-amount",
      "Ingresá un efectivo contado válido"
    );
  }

  const configRef =
    configuracionRef(
      cleanClienteId
    );

  const sessionRef =
    cajaRef(
      cleanClienteId,
      cleanSessionId
    );

  return runTransaction(
    db,

    async (
      transaction
    ) => {
      /*
       * Las dos lecturas ocurren
       * antes de escribir.
       */
      const configSnap =
        await transaction.get(
          configRef
        );

      const sessionSnap =
        await transaction.get(
          sessionRef
        );

      if (
        !sessionSnap.exists()
      ) {
        fail(
          "cash-session-not-found",
          "No encontramos la caja"
        );
      }

      const session =
        sessionSnap.data();

      if (
        session.status !==
        "open"
      ) {
        fail(
          "cash-already-closed",
          "La caja ya está cerrada"
        );
      }

      const activeSessionId =
        String(
          configSnap.data()
            ?.openCashSessionId ||
          ""
        ).trim();

      if (
        activeSessionId !==
        cleanSessionId
      ) {
        fail(
          "cash-session-mismatch",
          "Esta caja ya no es la caja activa"
        );
      }

      /*
       * Los totales ya fueron
       * acumulados atómicamente
       * durante cada venta.
       */
      const paymentTotals = {
        efectivo:
          roundMoney(
            session
              .paymentTotals
              ?.efectivo ||
            0
          ),

        transferencia:
          roundMoney(
            session
              .paymentTotals
              ?.transferencia ||
            0
          ),

        qr:
          roundMoney(
            session
              .paymentTotals
              ?.qr ||
            0
          ),

        tarjeta:
          roundMoney(
            session
              .paymentTotals
              ?.tarjeta ||
            0
          ),
      };

      const totalSales =
        roundMoney(
          toNumber(
            session.totalSales
          )
        );

      const salesCount =
        Math.max(
          0,
          Math.trunc(
            toNumber(
              session.salesCount
            )
          )
        );

      /*
       * Solo el efectivo forma
       * parte físicamente de caja.
       */
      const expectedAmount =
        roundMoney(
          toNumber(
            session.openAmount
          ) +
          paymentTotals.efectivo
        );

      const diff =
        roundMoney(
          countedAmount -
          expectedAmount
        );

      const closeTime =
        new Date()
          .toISOString();

      transaction.update(
        sessionRef,
        {
          closeTime,

          closeAmount:
            countedAmount,

          expectedAmount,

          counted:
            countedAmount,

          diff,

          totalSales,

          salesCount,

          paymentTotals,

          status:
            "closed",

          closedByDeviceId:
            deviceId || null,

          updatedAt:
            serverTimestamp(),
        }
      );

      transaction.set(
        configRef,
        {
          openCashSessionId:
            null,

          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return {
        id:
          cleanSessionId,

        ...session,

        closeTime,

        closeAmount:
          countedAmount,

        expectedAmount,

        counted:
          countedAmount,

        diff,

        totalSales,

        salesCount,

        paymentTotals,

        status:
          "closed",

        closedByDeviceId:
          deviceId || null,
      };
    }
  );
}