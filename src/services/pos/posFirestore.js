// src/services/pos/posFirestore.js
// Capa de acceso a Cloud Firestore para el POS.
// No contiene React ni lógica visual.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../firebase/config";

import {
  cajasPath,
  configuracionPosPath,
  cuentasPorCobrarPath,
  productosPath,
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

const SALE_METHODS = Object.freeze([
  ...PAYMENT_METHODS,
  "cuenta",
  "mixto",
]);

const PROMOTION_TYPES = Object.freeze([
  "cantidad",
  "combo",
]);

const MAX_CART_LINES = 100;

const abrirCajaFunction =
  httpsCallable(
    functions,
    "abrirCaja"
  );

const registrarVentaFunction =
  httpsCallable(
    functions,
    "registrarVenta"
  );

const cerrarCajaFunction =
  httpsCallable(
    functions,
    "cerrarCaja"
  );

const reponerStockFunction =
  httpsCallable(
    functions,
    "reponerStock"
  );

const crearProductoFunction =
  httpsCallable(
    functions,
    "crearProducto"
  );

const editarProductoFunction =
  httpsCallable(
    functions,
    "editarProducto"
  );

const eliminarProductoFunction =
  httpsCallable(
    functions,
    "eliminarProducto"
  );

const eliminarCierreCajaFunction =
  httpsCallable(
    functions,
    "eliminarCierreCaja"
  );

const crearCuentaPorCobrarManualFunction =
  httpsCallable(
    functions,
    "crearCuentaPorCobrarManual"
  );

const registrarPagoCuentaPorCobrarFunction =
  httpsCallable(
    functions,
    "registrarPagoCuentaPorCobrar"
  );

const cargarComprasFunction =
  httpsCallable(
    functions,
    "cargarCompras"
  );

const crearItemCompraFunction =
  httpsCallable(
    functions,
    "crearItemCompra"
  );

const marcarItemCompraCompradoFunction =
  httpsCallable(
    functions,
    "marcarItemCompraComprado"
  );

const crearCuentaPorPagarManualFunction =
  httpsCallable(
    functions,
    "crearCuentaPorPagarManual"
  );

const registrarPagoCuentaPorPagarFunction =
  httpsCallable(
    functions,
    "registrarPagoCuentaPorPagar"
  );

const migrarGananciasHistoricasFunction =
  httpsCallable(
    functions,
    "migrarGananciasHistoricas"
  );

const guardarNombreNegocioFunction =
  httpsCallable(
    functions,
    "guardarNombreNegocio"
  );

const listarPromocionesFunction =
  httpsCallable(
    functions,
    "listarPromociones"
  );

const guardarPromocionFunction =
  httpsCallable(
    functions,
    "guardarPromocion"
  );

const eliminarPromocionFunction =
  httpsCallable(
    functions,
    "eliminarPromocion"
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

function normalizeSaleMethod(
  value
) {
  return SALE_METHODS.includes(
    value
  )
    ? value
    : "efectivo";
}

function normalizeMixedPaymentParts(
  parts,
  total
) {
  if (
    !Array.isArray(parts) ||
    parts.length !== 2
  ) {
    fail(
      "invalid-mixed-payment",
      "El pago combinado debe tener exactamente 2 medios"
    );
  }

  const normalized =
    parts.map((part) => {
      const method =
        PAYMENT_METHODS.includes(
          part?.method
        )
          ? part.method
          : null;

      const rawAmount =
        Number(part?.amount);

      if (
        !method ||
        !Number.isFinite(
          rawAmount
        )
      ) {
        fail(
          "invalid-mixed-payment",
          "Revisá los medios e importes del pago combinado"
        );
      }

      const amount =
        roundMoney(
          rawAmount
        );

      const rawReceived =
        method === "efectivo"
          ? Number(
              part?.received ??
                amount
            )
          : amount;

      if (
        !Number.isFinite(
          rawReceived
        )
      ) {
        fail(
          "invalid-mixed-payment",
          "El importe recibido del pago combinado no es válido"
        );
      }

      const received =
        roundMoney(
          rawReceived
        );

      const change =
        method === "efectivo"
          ? roundMoney(
              received -
                amount
            )
          : 0;

      if (
        amount <= 0 ||
        (
          method ===
            "efectivo" &&
          received < amount
        )
      ) {
        fail(
          "invalid-mixed-payment",
          "Revisá los importes del pago combinado"
        );
      }

      return {
        method,
        amount,
        received,
        change,
      };
    });

  if (
    normalized[0].method ===
    normalized[1].method
  ) {
    fail(
      "invalid-mixed-payment",
      "Elegí dos medios de pago diferentes"
    );
  }

  const allocatedTotal =
    roundMoney(
      normalized.reduce(
        (sum, part) =>
          sum +
          part.amount,
        0
      )
    );

  if (
    Math.abs(
      allocatedTotal -
        total
    ) > 0.01
  ) {
    fail(
      "invalid-mixed-payment",
      "Los importes del pago combinado deben completar el total de la venta"
    );
  }

  return normalized;
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
 * Quitamos undefined antes de enviar
 * los datos normalizados al backend.
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

function timestampToIsoString(
  value
) {
  if (!value) {
    return null;
  }

  if (
    typeof value?.toDate ===
    "function"
  ) {
    return value
      .toDate()
      .toISOString();
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date.toISOString();
}

function normalizeDateOnly(
  value,
  {
    required = false,
  } = {}
) {
  const clean =
    String(value ?? "")
      .trim();

  if (!clean) {
    if (required) {
      fail(
        "invalid-date",
        "La fecha es obligatoria"
      );
    }

    return null;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      clean
    )
  ) {
    fail(
      "invalid-date",
      "La fecha no es válida"
    );
  }

  const parsed =
    new Date(
      `${clean}T00:00:00.000Z`
    );

  if (
    Number.isNaN(
      parsed.getTime()
    ) ||
    parsed
      .toISOString()
      .slice(0, 10) !==
      clean
  ) {
    fail(
      "invalid-date",
      "La fecha no es válida"
    );
  }

  return clean;
}

function normalizeReceivableForSale(
  value
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(
      "invalid-receivable",
      "Los datos de la cuenta por cobrar no son válidos"
    );
  }

  const clienteNombre =
    String(
      value.clienteNombre ||
      ""
    )
      .trim()
      .slice(0, 120);

  const clienteTelefono =
    String(
      value.clienteTelefono ||
      ""
    )
      .trim()
      .slice(0, 50);

  const notas =
    String(
      value.notas ||
      ""
    )
      .trim()
      .slice(0, 1000);

  if (!clienteNombre) {
    fail(
      "invalid-receivable",
      "El nombre del cliente es obligatorio"
    );
  }

  const fechaOrigen =
    normalizeDateOnly(
      value.fechaOrigen,
      {
        required: true,
      }
    );

  const vencimiento =
    normalizeDateOnly(
      value.vencimiento
    );

  if (
    vencimiento &&
    vencimiento <
      fechaOrigen
  ) {
    fail(
      "invalid-receivable",
      "El vencimiento no puede ser anterior a la fecha de origen"
    );
  }

  return {
    clienteNombre,
    clienteTelefono,
    fechaOrigen,
    vencimiento,
    notas,
  };
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

  const cost =
    tipoVenta ===
    "precio-libre"
      ? 0
      : roundMoney(
          toNumber(
            product.cost,
            0
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
        cost
      ) ||
      cost < 0
    )
  ) {
    fail(
      "invalid-cost",
      "El costo del producto no es válido"
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
    cost,
    stock,

    expiry:
      product.expiry ||
      null,
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

    cost:
      tipoVenta ===
      "precio-libre"
        ? 0
        : roundMoney(
            Math.max(
              0,
              toNumber(
                data?.cost
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
   NORMALIZAR PROMOCIONES
========================================================= */

function normalizePromotionItem(
  item
) {
  const barcode =
    requireString(
      item?.barcode,
      "barcode"
    );

  const qty =
    Math.trunc(
      toNumber(
        item?.qty,
        NaN
      )
    );

  if (
    !Number.isFinite(qty) ||
    qty <= 0
  ) {
    fail(
      "invalid-promotion",
      "La cantidad de cada producto debe ser mayor a cero"
    );
  }

  return {
    barcode,
    qty,
  };
}

function normalizePromotionForCloud(
  promotion
) {
  if (!promotion) {
    fail(
      "invalid-promotion",
      "Datos de promoción inválidos"
    );
  }

  const id =
    String(
      promotion.id || ""
    ).trim();

  const name =
    requireString(
      promotion.name,
      "name"
    ).slice(0, 120);

  const type =
    PROMOTION_TYPES.includes(
      promotion.type
    )
      ? promotion.type
      : "cantidad";

  const price =
    roundMoney(
      toNumber(
        promotion.price,
        NaN
      )
    );

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    fail(
      "invalid-promotion",
      "El precio promocional debe ser mayor a cero"
    );
  }

  const items =
    (Array.isArray(promotion.items)
      ? promotion.items
      : []
    ).map(
      normalizePromotionItem
    );

  if (
    type === "cantidad" &&
    items.length !== 1
  ) {
    fail(
      "invalid-promotion",
      "Una promoción por cantidad debe tener un solo producto"
    );
  }

  if (
    type === "combo" &&
    items.length < 2
  ) {
    fail(
      "invalid-promotion",
      "Un combo debe tener al menos dos productos"
    );
  }

  if (
    items.length > 12
  ) {
    fail(
      "invalid-promotion",
      "La promoción contiene demasiados productos"
    );
  }

  const seen = new Set();

  for (const item of items) {
    if (seen.has(item.barcode)) {
      fail(
        "invalid-promotion",
        "No repitas el mismo producto dentro de una promoción"
      );
    }

    seen.add(item.barcode);
  }

  const normalizeDateOnly = (value) => {
    const text =
      String(value || "")
        .trim();

    if (!text) {
      return null;
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        text
      )
    ) {
      fail(
        "invalid-promotion",
        "La fecha de vigencia no es válida"
      );
    }

    return text;
  };

  const startDate =
    normalizeDateOnly(
      promotion.startDate
    );

  const endDate =
    normalizeDateOnly(
      promotion.endDate
    );

  if (
    startDate &&
    endDate &&
    endDate < startDate
  ) {
    fail(
      "invalid-promotion",
      "La fecha final no puede ser anterior a la inicial"
    );
  }

  return {
    ...(id ? { id } : {}),
    name,
    type,
    active:
      promotion.active !== false,
    price,
    items,
    startDate,
    endDate,
  };
}

function normalizePromotionFromCloud(
  data,
  documentId
) {
  return {
    id:
      String(
        data?.id ||
        documentId ||
        ""
      ).trim(),

    name:
      String(
        data?.name || ""
      ).trim(),

    type:
      PROMOTION_TYPES.includes(
        data?.type
      )
        ? data.type
        : "cantidad",

    active:
      data?.active !== false,

    price:
      roundMoney(
        Math.max(
          0,
          toNumber(
            data?.price
          )
        )
      ),

    items:
      (Array.isArray(data?.items)
        ? data.items
        : []
      )
        .map((item) => ({
          barcode:
            String(
              item?.barcode || ""
            ).trim(),
          qty:
            Math.max(
              1,
              Math.trunc(
                toNumber(
                  item?.qty,
                  1
                )
              )
            ),
        }))
        .filter(
          (item) =>
            item.barcode
        ),

    startDate:
      String(
        data?.startDate || ""
      ).trim() || null,

    endDate:
      String(
        data?.endDate || ""
      ).trim() || null,
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
   NORMALIZAR CUENTA POR COBRAR
========================================================= */

function normalizeCuentaPorCobrarFromCloud(
  data,
  documentId
) {
  const importeOriginal =
    roundMoney(
      toNumber(
        data?.importeOriginal
      )
    );

  const totalPagado =
    roundMoney(
      toNumber(
        data?.totalPagado
      )
    );

  const saldoPendiente =
    roundMoney(
      toNumber(
        data?.saldoPendiente,
        Math.max(
          0,
          importeOriginal -
            totalPagado
        )
      )
    );

  const estado =
    [
      "pendiente",
      "parcial",
      "pagado",
      "cancelado",
    ].includes(
      data?.estado
    )
      ? data.estado
      : saldoPendiente <= 0
        ? "pagado"
        : totalPagado > 0
          ? "parcial"
          : "pendiente";

  return {
    id: documentId,

    clienteNombre:
      String(
        data?.clienteNombre ||
        "Cliente"
      ).trim(),

    clienteTelefono:
      String(
        data?.clienteTelefono ||
        ""
      ).trim(),

    concepto:
      String(
        data?.concepto ||
        "Deuda"
      ).trim(),

    notas:
      String(
        data?.notas ||
        ""
      ).trim(),

    origen:
      data?.origen ===
      "venta"
        ? "venta"
        : "manual",

    ventaId:
      String(
        data?.ventaId ||
        ""
      ).trim() || null,

    fechaOrigen:
      String(
        data?.fechaOrigen ||
        ""
      ).trim() || null,

    vencimiento:
      String(
        data?.vencimiento ||
        ""
      ).trim() || null,

    importeOriginal,
    totalPagado,
    saldoPendiente,
    estado,

    creadoEn:
      timestampToIsoString(
        data?.creadoEn
      ),

    actualizadoEn:
      timestampToIsoString(
        data?.actualizadoEn
      ),

    creadoPor: {
      operadorId:
        String(
          data?.creadoPor
            ?.operadorId ||
          ""
        ).trim(),

      operadorNombre:
        String(
          data?.creadoPor
            ?.operadorNombre ||
          ""
        ).trim(),

      operadorRol:
        String(
          data?.creadoPor
            ?.operadorRol ||
          ""
        ).trim(),
    },

    pagos:
      Array.isArray(
        data?.pagos
      )
        ? data.pagos
            .map(
              (pago) => ({
                id:
                  String(
                    pago?.id ||
                    ""
                  ).trim(),

                importe:
                  roundMoney(
                    toNumber(
                      pago?.importe
                    )
                  ),

                metodoPago:
                  normalizePaymentMethod(
                    pago?.metodoPago
                  ),

                sessionId:
                  String(
                    pago?.sessionId ||
                    ""
                  ).trim() ||
                  null,

                fecha:
                  timestampToIsoString(
                    pago?.fecha
                  ),

                deviceId:
                  String(
                    pago?.deviceId ||
                    ""
                  ).trim() ||
                  null,

                operador: {
                  operadorId:
                    String(
                      pago?.operador
                        ?.operadorId ||
                      ""
                    ).trim(),

                  operadorNombre:
                    String(
                      pago?.operador
                        ?.operadorNombre ||
                      ""
                    ).trim(),

                  operadorRol:
                    String(
                      pago?.operador
                        ?.operadorRol ||
                      ""
                    ).trim(),
                },
              })
            )
            .filter(
              (pago) =>
                pago.id &&
                pago.importe > 0
            )
            .sort(
              (a, b) =>
                String(
                  a.fecha ||
                  ""
                ).localeCompare(
                  String(
                    b.fecha ||
                    ""
                  )
                )
            )
        : [],
  };
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

function cuentasPorCobrarRef(
  clienteId
) {
  return collection(
    db,
    ...cuentasPorCobrarPath(
      clienteId
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

export function subscribeCuentasPorCobrar(
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
      "subscribeCuentasPorCobrar necesita onData"
    );
  }

  return onSnapshot(
    cuentasPorCobrarRef(
      clienteId
    ),

    (snapshot) => {
      const cuentas =
        snapshot.docs
          .map(
            (snapshotDoc) =>
              normalizeCuentaPorCobrarFromCloud(
                snapshotDoc.data(),
                snapshotDoc.id
              )
          )
          .sort(
            (a, b) => {
              const aDate =
                String(
                  a?.fechaOrigen ||
                  ""
                );

              const bDate =
                String(
                  b?.fechaOrigen ||
                  ""
                );

              if (
                aDate !==
                bDate
              ) {
                return bDate
                  .localeCompare(
                    aDate
                  );
              }

              return String(
                b?.creadoEn ||
                ""
              ).localeCompare(
                String(
                  a?.creadoEn ||
                  ""
                )
              );
            }
          );

      onData(cuentas);
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
   CREAR CUENTA POR COBRAR MANUAL
========================================================= */

export async function createManualReceivableCloud(
  clienteId,
  payload,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  const clienteNombre =
    requireString(
      payload?.clienteNombre,
      "clienteNombre"
    ).slice(0, 120);

  const clienteTelefono =
    String(
      payload?.clienteTelefono ||
      ""
    )
      .trim()
      .slice(0, 50);

  const concepto =
    requireString(
      payload?.concepto,
      "concepto"
    ).slice(0, 180);

  const notas =
    String(
      payload?.notas ||
      ""
    )
      .trim()
      .slice(0, 1000);

  const importeOriginal =
    roundMoney(
      toNumber(
        payload?.importeOriginal,
        NaN
      )
    );

  if (
    !Number.isFinite(
      importeOriginal
    ) ||
    importeOriginal <= 0
  ) {
    fail(
      "invalid-amount",
      "Ingresá un importe válido"
    );
  }

  const fechaOrigen =
    normalizeDateOnly(
      payload?.fechaOrigen,
      { required: true }
    );

  const vencimiento =
    normalizeDateOnly(
      payload?.vencimiento
    );

  try {
    const response =
      await crearCuentaPorCobrarManualFunction({
        clienteId:
          cleanClienteId,

        cuenta: {
          clienteNombre,
          clienteTelefono,
          concepto,
          notas,
          importeOriginal,
          fechaOrigen,
          vencimiento,
        },

        operadorSesion,
        deviceId:
          cleanDeviceId,
      });

    const data =
      response?.data || {};

    if (
      !data.ok ||
      !data.cuenta?.id
    ) {
      fail(
        "create-receivable-failed",
        "No se pudo registrar la deuda"
      );
    }

    return {
      ...data.cuenta,
      id:
        String(
          data.cuenta.id
        ),
    };
  } catch (error) {
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
        serverMessage ||
        "No tenés permisos para registrar esta deuda."
      );
    }

    if (
      code ===
      "invalid-argument"
    ) {
      fail(
        "invalid-receivable",
        serverMessage ||
        "Los datos de la deuda no son válidos"
      );
    }

    fail(
      "create-receivable-failed",
      serverMessage ||
      "No se pudo registrar la deuda"
    );
  }
}

/* =========================================================
   REGISTRAR PAGO DE CUENTA POR COBRAR
========================================================= */

export async function registerReceivablePaymentCloud(
  clienteId,
  cuentaId,
  payload,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanCuentaId =
    requireString(
      cuentaId,
      "cuentaId"
    );

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  const importe =
    roundMoney(
      toNumber(
        payload?.importe,
        NaN
      )
    );

  if (
    !Number.isFinite(
      importe
    ) ||
    importe <= 0
  ) {
    fail(
      "invalid-amount",
      "Ingresá un importe válido"
    );
  }

  const metodoPago =
    normalizePaymentMethod(
      payload?.metodoPago
    );

  try {
    const response =
      await registrarPagoCuentaPorCobrarFunction({
        clienteId:
          cleanClienteId,

        cuentaId:
          cleanCuentaId,

        pago: {
          importe,
          metodoPago,
        },

        operadorSesion,
        deviceId:
          cleanDeviceId,
      });

    const data =
      response?.data || {};

    if (
      !data.ok ||
      !data.pago?.id
    ) {
      fail(
        "register-receivable-payment-failed",
        "No se pudo registrar el pago"
      );
    }

    return data;
  } catch (error) {
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

    const motivo =
      String(
        error?.details?.motivo ||
        ""
      ).trim();

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
        serverMessage ||
        "No tenés permisos para registrar este pago."
      );
    }

    if (
      code ===
      "not-found"
    ) {
      fail(
        "receivable-not-found",
        serverMessage ||
        "La cuenta por cobrar ya no existe."
      );
    }

    if (
      code ===
      "failed-precondition"
    ) {
      if (
        motivo ===
        "cash-required"
      ) {
        fail(
          "cash-required",
          "Abrí una caja antes de registrar el cobro."
        );
      }

      if (
        motivo ===
        "receivable-settled"
      ) {
        fail(
          "receivable-settled",
          "Esta cuenta ya está saldada."
        );
      }

      fail(
        "failed-precondition",
        serverMessage ||
        "No se puede registrar el pago en este momento."
      );
    }

    if (
      code ===
      "invalid-argument"
    ) {
      fail(
        "invalid-receivable-payment",
        serverMessage ||
        "Los datos del pago no son válidos."
      );
    }

    fail(
      "register-receivable-payment-failed",
      serverMessage ||
      "No se pudo registrar el pago"
    );
  }
}

/* =========================================================
   COMPRAS + CUENTAS POR PAGAR
========================================================= */

function normalizePurchasingContext(
  clienteId,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  return {
    cleanClienteId,
    cleanDeviceId,
    operadorSesion,
  };
}

async function invokePurchasingCallable(
  callable,
  data,
  {
    code,
    message,
  }
) {
  try {
    const response =
      await callable(data);

    const result =
      response?.data || {};

    if (!result.ok) {
      fail(
        code,
        message
      );
    }

    return result;
  } catch (error) {
    if (
      error instanceof
      PosFirestoreError
    ) {
      throw error;
    }

    const firebaseCode =
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

    const motivo =
      String(
        error?.details?.motivo ||
        ""
      ).trim();

    if (
      firebaseCode ===
      "unauthenticated"
    ) {
      fail(
        "unauthenticated",
        "Tu sesión dejó de ser válida. Iniciá sesión nuevamente."
      );
    }

    if (
      firebaseCode ===
      "permission-denied"
    ) {
      fail(
        "permission-denied",
        serverMessage ||
        "No tenés permisos para realizar esta operación."
      );
    }

    if (
      firebaseCode ===
      "failed-precondition" &&
      motivo === "cash-required"
    ) {
      fail(
        "cash-required",
        "Abrí una caja antes de registrar el pago."
      );
    }

    if (
      firebaseCode ===
      "not-found"
    ) {
      fail(
        "not-found",
        serverMessage ||
        "El registro ya no existe."
      );
    }

    if (
      firebaseCode ===
      "invalid-argument" ||
      firebaseCode ===
      "failed-precondition"
    ) {
      fail(
        firebaseCode,
        serverMessage ||
        message
      );
    }

    fail(
      code,
      serverMessage ||
      message
    );
  }
}

export async function loadPurchasingDataCloud(
  clienteId,
  options = {}
) {
  const context =
    normalizePurchasingContext(
      clienteId,
      options
    );

  const result =
    await invokePurchasingCallable(
      cargarComprasFunction,
      {
        clienteId:
          context.cleanClienteId,
        operadorSesion:
          context.operadorSesion,
        deviceId:
          context.cleanDeviceId,
      },
      {
        code:
          "load-purchasing-failed",
        message:
          "No se pudieron cargar las compras",
      }
    );

  return {
    shoppingList:
      Array.isArray(
        result.shoppingList
      )
        ? result.shoppingList
        : [],

    accountsPayable:
      Array.isArray(
        result.accountsPayable
      )
        ? result.accountsPayable
        : [],
  };
}

export async function createShoppingItemCloud(
  clienteId,
  item,
  options = {}
) {
  const context =
    normalizePurchasingContext(
      clienteId,
      options
    );

  const concepto =
    requireString(
      item?.concepto,
      "concepto"
    ).slice(0, 180);

  const proveedor =
    String(
      item?.proveedor ||
      ""
    )
      .trim()
      .slice(0, 120);

  const conceptoCosto =
    String(
      item?.conceptoCosto ||
      ""
    )
      .trim()
      .slice(0, 180);

  const cantidad =
    roundQuantity(
      Math.max(
        0.001,
        toNumber(
          item?.cantidad,
          1
        )
      )
    );

  const costoEstimadoRaw =
    toNumber(
      item?.costoEstimado,
      0
    );

  const costoEstimado =
    roundMoney(
      Math.max(
        0,
        costoEstimadoRaw
      )
    );

  return invokePurchasingCallable(
    crearItemCompraFunction,
    {
      clienteId:
        context.cleanClienteId,
      item: {
        concepto,
        proveedor,
        cantidad,
        costoEstimado,
        conceptoCosto,
        notas:
          String(
            item?.notas ||
            ""
          )
            .trim()
            .slice(0, 1000),
      },
      operadorSesion:
        context.operadorSesion,
      deviceId:
        context.cleanDeviceId,
    },
    {
      code:
        "create-shopping-item-failed",
      message:
        "No se pudo agregar a la lista de compras",
    }
  );
}

export async function completeShoppingItemCloud(
  clienteId,
  compraId,
  payload,
  options = {}
) {
  const context =
    normalizePurchasingContext(
      clienteId,
      options
    );

  const cleanCompraId =
    requireString(
      compraId,
      "compraId"
    );

  const costoReal =
    roundMoney(
      Math.max(
        0,
        toNumber(
          payload?.costoReal,
          0
        )
      )
    );

  const cantidadStock =
    payload?.sumarStock
      ? roundQuantity(
          toNumber(
            payload?.cantidadStock,
            NaN
          )
        )
      : 0;

  if (
    payload?.sumarStock &&
    (
      !Number.isFinite(
        cantidadStock
      ) ||
      cantidadStock <= 0
    )
  ) {
    fail(
      "invalid-restock",
      "Ingresá la cantidad que debe ingresar al stock"
    );
  }

  const costoUnitario =
    payload?.sumarStock &&
    costoReal > 0 &&
    cantidadStock > 0
      ? roundMoney(
          costoReal /
          cantidadStock
        )
      : null;

  return invokePurchasingCallable(
    marcarItemCompraCompradoFunction,
    {
      clienteId:
        context.cleanClienteId,
      compraId:
        cleanCompraId,
      compra: {
        costoReal,
        conceptoCosto:
          String(
            payload?.conceptoCosto ||
            ""
          )
            .trim()
            .slice(0, 180),
        sumarStock:
          Boolean(
            payload?.sumarStock
          ),
        productoBarcode:
          payload?.sumarStock
            ? requireString(
                payload?.productoBarcode,
                "productoBarcode"
              )
            : null,
        cantidadStock,
        costoUnitario,
        generarCuentaPorPagar:
          Boolean(
            payload?.generarCuentaPorPagar
          ),
        vencimiento:
          normalizeDateOnly(
            payload?.vencimiento
          ),
      },
      operadorSesion:
        context.operadorSesion,
      deviceId:
        context.cleanDeviceId,
    },
    {
      code:
        "complete-shopping-item-failed",
      message:
        "No se pudo completar la compra",
    }
  );
}

export async function createManualPayableCloud(
  clienteId,
  payload,
  options = {}
) {
  const context =
    normalizePurchasingContext(
      clienteId,
      options
    );

  const importeOriginal =
    roundMoney(
      toNumber(
        payload?.importeOriginal,
        NaN
      )
    );

  if (
    !Number.isFinite(
      importeOriginal
    ) ||
    importeOriginal <= 0
  ) {
    fail(
      "invalid-amount",
      "Ingresá un importe válido"
    );
  }

  return invokePurchasingCallable(
    crearCuentaPorPagarManualFunction,
    {
      clienteId:
        context.cleanClienteId,
      cuenta: {
        proveedorNombre:
          requireString(
            payload?.proveedorNombre,
            "proveedorNombre"
          ).slice(0, 120),
        concepto:
          requireString(
            payload?.concepto,
            "concepto"
          ).slice(0, 180),
        importeOriginal,
        fechaOrigen:
          normalizeDateOnly(
            payload?.fechaOrigen,
            { required: true }
          ),
        vencimiento:
          normalizeDateOnly(
            payload?.vencimiento
          ),
        notas:
          String(
            payload?.notas ||
            ""
          )
            .trim()
            .slice(0, 1000),
      },
      operadorSesion:
        context.operadorSesion,
      deviceId:
        context.cleanDeviceId,
    },
    {
      code:
        "create-payable-failed",
      message:
        "No se pudo registrar la cuenta por pagar",
    }
  );
}

export async function registerPayablePaymentCloud(
  clienteId,
  cuentaId,
  payload,
  options = {}
) {
  const context =
    normalizePurchasingContext(
      clienteId,
      options
    );

  const importe =
    roundMoney(
      toNumber(
        payload?.importe,
        NaN
      )
    );

  if (
    !Number.isFinite(
      importe
    ) ||
    importe <= 0
  ) {
    fail(
      "invalid-amount",
      "Ingresá un importe válido"
    );
  }

  return invokePurchasingCallable(
    registrarPagoCuentaPorPagarFunction,
    {
      clienteId:
        context.cleanClienteId,
      cuentaId:
        requireString(
          cuentaId,
          "cuentaId"
        ),
      pago: {
        importe,
        metodoPago:
          normalizePaymentMethod(
            payload?.metodoPago
          ),
      },
      operadorSesion:
        context.operadorSesion,
      deviceId:
        context.cleanDeviceId,
    },
    {
      code:
        "register-payable-payment-failed",
      message:
        "No se pudo registrar el pago",
    }
  );
}

/* =========================================================
   GANANCIAS HISTÓRICAS
========================================================= */

export async function migrateHistoricalProfitsCloud(
  clienteId,
  rules,
  options = {}
) {
  const context =
    normalizePurchasingContext(
      clienteId,
      options
    );

  if (!Array.isArray(rules)) {
    fail(
      "invalid-argument",
      "La configuración de costos históricos es inválida"
    );
  }

  const normalizedRules =
    rules.map((rule) => ({
      productKey:
        requireString(
          rule?.productKey,
          "productKey"
        ).slice(0, 220),

      productName:
        String(
          rule?.productName ||
          rule?.productKey ||
          "Producto"
        )
          .trim()
          .slice(0, 180),

      source:
        rule?.source ===
        "estimated"
          ? "estimated"
          : "migrated",

      periods:
        (Array.isArray(
          rule?.periods
        )
          ? rule.periods
          : []
        ).map((period) => ({
          fromMs:
            period?.fromMs === null ||
            period?.fromMs === undefined
              ? null
              : Number(
                  period.fromMs
                ),

          toMs:
            period?.toMs === null ||
            period?.toMs === undefined
              ? null
              : Number(
                  period.toMs
                ),

          cost:
            roundMoney(
              toNumber(
                period?.cost,
                NaN
              )
            ),
        })),
    }));

  return invokePurchasingCallable(
    migrarGananciasHistoricasFunction,
    {
      clienteId:
        context.cleanClienteId,
      rules:
        normalizedRules,
      operadorSesion:
        context.operadorSesion,
      deviceId:
        context.cleanDeviceId,
    },
    {
      code:
        "historical-profit-migration-failed",
      message:
        "No se pudieron completar las ganancias históricas",
    }
  );
}

/* =========================================================
   CONFIGURACIÓN
========================================================= */

export async function saveShopNameCloud(
  clienteId,
  shopName,
  {
    operadorSesion = null,
    deviceId = null,
    sessionId = null,
  } = {}
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

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  const cleanSessionId =
    requireString(
      sessionId,
      "sessionId"
    );

  try {
    const response =
      await guardarNombreNegocioFunction({
        clienteId:
          cleanClienteId,

        shopName:
          cleanShopName,

        operadorSesion,

        deviceId:
          cleanDeviceId,

        sessionId:
          cleanSessionId,
      });

    const data =
      response?.data || {};

    if (
      !data.ok ||
      !data.shopName
    ) {
      fail(
        "save-shop-name-failed",
        "No se pudo guardar el nombre del negocio"
      );
    }

    return data.shopName;
  } catch (error) {
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
        serverMessage ||
        "No tenés permisos para cambiar el nombre del negocio."
      );
    }

    if (
      code ===
      "invalid-argument"
    ) {
      fail(
        "invalid-shop-name",
        serverMessage ||
        "El nombre del negocio no es válido."
      );
    }

    fail(
      "save-shop-name-failed",
      serverMessage ||
      "No se pudo guardar el nombre del negocio"
    );
  }
}


/* =========================================================
   PROMOCIONES
========================================================= */

export async function loadPromotionsCloud(
  clienteId,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  try {
    const response =
      await listarPromocionesFunction({
        clienteId:
          cleanClienteId,
        operadorSesion,
        deviceId:
          requireString(
            deviceId,
            "deviceId"
          ),
      });

    return (Array.isArray(
      response?.data?.promotions
    )
      ? response.data.promotions
      : []
    )
      .map((promotion) =>
        normalizePromotionFromCloud(
          promotion,
          promotion?.id
        )
      )
      .filter(Boolean);
  } catch (error) {
    const code =
      String(
        error?.code ||
        "unknown"
      )
        .split("/")
        .pop();

    fail(
      code || "load-promotions-failed",
      String(
        error?.details?.message ||
        error?.message ||
        "No se pudieron cargar las promociones"
      )
    );
  }
}

export async function upsertPromotionCloud(
  clienteId,
  promotion,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const normalized =
    normalizePromotionForCloud(
      promotion
    );

  try {
    const response =
      await guardarPromocionFunction({
        clienteId:
          cleanClienteId,
        promotion:
          normalized,
        operadorSesion,
        deviceId:
          requireString(
            deviceId,
            "deviceId"
          ),
      });

    const saved =
      response?.data?.promotion;

    if (!saved) {
      fail(
        "save-promotion-failed",
        "No se pudo guardar la promoción"
      );
    }

    return normalizePromotionFromCloud(
      saved,
      saved.id
    );
  } catch (error) {
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

    fail(
      code || "save-promotion-failed",
      String(
        error?.details?.message ||
        error?.message ||
        "No se pudo guardar la promoción"
      )
    );
  }
}

export async function deletePromotionCloud(
  clienteId,
  promotionId,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanPromotionId =
    requireString(
      promotionId,
      "promotionId"
    );

  try {
    const response =
      await eliminarPromocionFunction({
        clienteId:
          cleanClienteId,
        promotionId:
          cleanPromotionId,
        operadorSesion,
        deviceId:
          requireString(
            deviceId,
            "deviceId"
          ),
      });

    return response?.data?.ok === true;
  } catch (error) {
    const code =
      String(
        error?.code ||
        "unknown"
      )
        .split("/")
        .pop();

    fail(
      code || "delete-promotion-failed",
      String(
        error?.details?.message ||
        error?.message ||
        "No se pudo eliminar la promoción"
      )
    );
  }
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

  /*
   * EDICIÓN:
   *
   * pasa por backend para validar al operador y guardar
   * producto + auditoría en la misma transacción.
   */
  if (previousBarcode) {
    if (
      !options.operadorSesion?.id ||
      !options.operadorSesion?.token
    ) {
      fail(
        "unauthenticated",
        "Falta la sesión interna del operador"
      );
    }

    const cleanDeviceId =
      requireString(
        options.deviceId,
        "deviceId"
      );

    try {
      const response =
        await editarProductoFunction({
          clienteId:
            cleanClienteId,

          previousBarcode,

          product:
            normalized,

          operadorSesion:
            options.operadorSesion,

          deviceId:
            cleanDeviceId,
        });

      const data =
        response?.data || {};

      if (
        !data.ok ||
        !data.product
      ) {
        fail(
          "edit-product-failed",
          "No se pudo editar el producto"
        );
      }

      return {
        ...normalized,
        ...data.product,
      };
    } catch (error) {
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

      const motivo =
        String(
          error?.details?.motivo ||
          ""
        );

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
          serverMessage ||
          "No tenés permisos para editar este producto."
        );
      }

      if (
        code ===
        "not-found" ||
        motivo ===
        "product-not-found"
      ) {
        fail(
          "product-not-found",
          "Producto no encontrado"
        );
      }

      if (
        code ===
        "already-exists" ||
        motivo ===
        "product-barcode-conflict"
      ) {
        fail(
          "product-barcode-conflict",
          "Ya existe otro producto con ese código"
        );
      }

      if (
        code ===
        "invalid-argument"
      ) {
        fail(
          "invalid-product",
          serverMessage ||
          "Datos del producto inválidos"
        );
      }

      fail(
        "edit-product-failed",
        serverMessage ||
        "No se pudo editar el producto"
      );
    }
  }

  /*
   * ALTA:
   *
   * pasa por backend para validar al operador y guardar
   * producto + auditoría en la misma transacción.
   */
  {
    if (
      !options.operadorSesion?.id ||
      !options.operadorSesion?.token
    ) {
      fail(
        "unauthenticated",
        "Falta la sesión interna del operador"
      );
    }

    const cleanDeviceId =
      requireString(
        options.deviceId,
        "deviceId"
      );

    try {
      const response =
        await crearProductoFunction({
          clienteId:
            cleanClienteId,

          product:
            normalized,

          operadorSesion:
            options.operadorSesion,

          deviceId:
            cleanDeviceId,
        });

      const data =
        response?.data || {};

      if (
        !data.ok ||
        !data.product
      ) {
        fail(
          "create-product-failed",
          "No se pudo crear el producto"
        );
      }

      return {
        ...normalized,
        ...data.product,
      };
    } catch (error) {
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

      const motivo =
        String(
          error?.details?.motivo ||
          ""
        );

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
          serverMessage ||
          "No tenés permisos para crear este producto."
        );
      }

      if (
        code ===
        "already-exists" ||
        motivo ===
        "product-barcode-conflict"
      ) {
        fail(
          "product-barcode-conflict",
          "Ya existe un producto con ese código"
        );
      }

      if (
        code ===
        "invalid-argument"
      ) {
        fail(
          "invalid-product",
          serverMessage ||
          "Datos del producto inválidos"
        );
      }

      fail(
        "create-product-failed",
        serverMessage ||
        "No se pudo crear el producto"
      );
    }
  }
}

export async function deleteProductCloud(
  clienteId,
  barcode,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
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

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  try {
    const response =
      await eliminarProductoFunction({
        clienteId:
          cleanClienteId,

        barcode:
          cleanBarcode,

        operadorSesion,

        deviceId:
          cleanDeviceId,
      });

    const data =
      response?.data || {};

    if (!data.ok) {
      fail(
        "delete-product-failed",
        "No se pudo eliminar el producto"
      );
    }

    return true;
  } catch (error) {
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
        serverMessage ||
        "No tenés permisos para eliminar este producto."
      );
    }

    if (
      code ===
      "invalid-argument"
    ) {
      fail(
        "invalid-product",
        serverMessage ||
        "El producto no es válido"
      );
    }

    fail(
      "delete-product-failed",
      serverMessage ||
      "No se pudo eliminar el producto"
    );
  }
}

/* =========================================================
   SUMAR STOCK
========================================================= */

export async function restockProductCloud(
  clienteId,
  barcode,
  add,
  {
    operadorSesion = null,
    deviceId = null,
    unitCost = null,
  } = {}
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

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

  const amount =
    toNumber(
      add,
      NaN
    );

  const normalizedUnitCost =
    unitCost === null ||
    unitCost === undefined ||
    unitCost === ""
      ? null
      : roundMoney(
          toNumber(
            unitCost,
            NaN
          )
        );

  if (
    normalizedUnitCost !== null &&
    (
      !Number.isFinite(
        normalizedUnitCost
      ) ||
      normalizedUnitCost < 0
    )
  ) {
    fail(
      "invalid-cost",
      "Ingresá un costo unitario válido"
    );
  }

  if (
    !Number.isFinite(
      amount
    ) ||
    amount <= 0
  ) {
    fail(
      "invalid-restock",
      "Ingresá una cantidad válida"
    );
  }

  try {
    const response =
      await reponerStockFunction({
        clienteId:
          cleanClienteId,

        barcode:
          cleanBarcode,

        add:
          amount,

        costoUnitario:
          normalizedUnitCost,

        operadorSesion,

        deviceId:
          cleanDeviceId,
      });

    const data =
      response?.data || {};

    if (
      !data.ok ||
      !Number.isFinite(
        Number(
          data.stockNuevo
        )
      )
    ) {
      fail(
        "restock-failed",
        "No se pudo actualizar el stock"
      );
    }

    return {
      stockNuevo:
        Number(
          data.stockNuevo
        ),

      costoNuevo:
        roundMoney(
          toNumber(
            data.costoNuevo
          )
        ),
    };
  } catch (error) {
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

    const motivo =
      String(
        error?.details?.motivo ||
        ""
      );

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
        serverMessage ||
        "No tenés permisos para reponer stock."
      );
    }

    if (
      code ===
      "not-found" ||
      motivo ===
      "product-not-found"
    ) {
      fail(
        "product-not-found",
        "Producto no encontrado"
      );
    }

    if (
      code ===
      "failed-precondition" &&
      motivo ===
      "product-without-stock"
    ) {
      fail(
        "product-without-stock",
        "Este producto no utiliza stock"
      );
    }

    if (
      code ===
      "invalid-argument"
    ) {
      fail(
        "invalid-restock",
        serverMessage ||
        "Ingresá una cantidad válida"
      );
    }

    fail(
      "restock-failed",
      serverMessage ||
      "No se pudo actualizar el stock"
    );
  }
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
    operadorSesion = null,
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

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

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

  try {
    const response =
      await abrirCajaFunction({
        clienteId:
          cleanClienteId,

        sessionId:
          cleanSessionId,

        openAmount:
          amount,

        deviceId:
          cleanDeviceId,

        operadorSesion,
      });

    const data =
      response?.data || {};

    if (
      !data.ok ||
      !data.session
    ) {
      fail(
        "open-cash-session-failed",
        "No se pudo abrir la caja"
      );
    }

    return data.session;
  } catch (error) {
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
      "already-exists"
    ) {
      const motivo =
        String(
          error?.details?.motivo ||
          ""
        );

      if (
        motivo ===
        "cash-session-id-used"
      ) {
        fail(
          "cash-session-id-used",
          serverMessage ||
          "El identificador de caja ya fue utilizado"
        );
      }

      fail(
        "cash-already-open",
        serverMessage ||
        "Ya hay una caja abierta"
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
        serverMessage ||
        "No tenés permisos para abrir la caja."
      );
    }

    if (
      code ===
      "invalid-argument"
    ) {
      fail(
        "invalid-open-amount",
        serverMessage ||
        "Ingresá un monto inicial válido"
      );
    }

    fail(
      "open-cash-session-failed",
      serverMessage ||
      "No se pudo abrir la caja"
    );
  }
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
    operadorSesion = null,
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

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

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
    normalizeSaleMethod(
      payment?.method
    );

  const receivable =
    method ===
    "cuenta"
      ? normalizeReceivableForSale(
          payment?.receivable
        )
      : null;

  const paymentParts =
    method === "mixto"
      ? normalizeMixedPaymentParts(
          payment?.parts,
          total
        )
      : [];

  const received =
    method === "mixto"
      ? roundMoney(
          paymentParts.reduce(
            (sum, part) =>
              sum +
              part.received,
            0
          )
        )
      : method ===
          "efectivo"
        ? roundMoney(
            toNumber(
              payment?.received,
              total
            )
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
    fail(
      "insufficient-received",
      "El monto recibido es menor al total"
    );
  }

  const change =
    method === "mixto"
      ? roundMoney(
          paymentParts.reduce(
            (sum, part) =>
              sum +
              part.change,
            0
          )
        )
      : method ===
          "efectivo"
        ? roundMoney(
            received -
            total
          )
        : 0;

  try {
    const response =
      await registrarVentaFunction({
        clienteId:
          cleanClienteId,

        saleId:
          cleanSaleId,

        items:
          normalizedItems,

        expectedTotal:
          total,

        payment: {
          method,
          received,
          change,

          ...(method ===
            "mixto"
            ? {
                parts:
                  paymentParts,
              }
            : {}),
        },

        ...(method ===
          "cuenta"
          ? {
              receivable,
            }
          : {}),

        deviceId:
          cleanDeviceId,

        timestamp:
          safeIsoDate(
            timestamp
          ),

        operadorSesion,
      });

    const data =
      response?.data || {};

    if (
      !data.ok ||
      !data.sale
    ) {
      fail(
        "checkout-failed",
        "No se pudo registrar la venta"
      );
    }

    return {
      alreadyExists:
        Boolean(
          data.alreadyExists
        ),

      sale:
        data.sale,
    };
  } catch (error) {
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

    const motivo =
      String(
        error?.details?.motivo ||
        ""
      );

    const serverMessage =
      String(
        error?.details?.mensaje ||
        error?.details?.message ||
        error?.message ||
        ""
      ).trim();

    if (
      code ===
      "unauthenticated"
    ) {
      fail(
        "unauthenticated",
        serverMessage ||
        "Tu sesión dejó de ser válida. Iniciá sesión nuevamente."
      );
    }

    if (
      code ===
      "permission-denied"
    ) {
      fail(
        "permission-denied",
        serverMessage ||
        "No tenés permisos para registrar la venta."
      );
    }

    if (
      code ===
      "failed-precondition"
    ) {
      if (
        motivo ===
        "cash-not-open"
      ) {
        fail(
          "cash-not-open",
          serverMessage ||
          "La caja ya no se encuentra abierta"
        );
      }

      if (
        motivo ===
        "product-changed"
      ) {
        fail(
          "product-changed",
          serverMessage ||
          "El producto cambió. Volvé a agregarlo al ticket"
        );
      }

      if (
        motivo ===
        "insufficient-stock"
      ) {
        fail(
          "insufficient-stock",
          serverMessage ||
          "Stock insuficiente"
        );
      }

      if (
        motivo ===
        "promotion-changed"
      ) {
        fail(
          "promotion-changed",
          serverMessage ||
          "El precio o una promoción cambió. Revisá el ticket antes de cobrar."
        );
      }

      fail(
        "checkout-failed",
        serverMessage ||
        "No se pudo registrar la venta"
      );
    }

    if (
      code ===
      "not-found" &&
      motivo ===
      "product-not-found"
    ) {
      fail(
        "product-not-found",
        serverMessage ||
        "No encontramos uno de los productos de la venta"
      );
    }

    if (
      code ===
      "already-exists"
    ) {
      fail(
        "sale-id-used",
        serverMessage ||
        "El identificador de venta ya fue utilizado"
      );
    }

    if (
      code ===
      "invalid-argument"
    ) {
      fail(
        "invalid-sale",
        serverMessage ||
        "Los datos de la venta no son válidos"
      );
    }

    fail(
      "checkout-failed",
      serverMessage ||
      "No se pudo registrar la venta"
    );
  }
}

/* =========================================================
   ELIMINAR CIERRE DE CAJA
========================================================= */

export async function deleteCashSessionCloud(
  clienteId,
  cajaId,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
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

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  try {
    const response =
      await eliminarCierreCajaFunction({
        clienteId:
          cleanClienteId,

        cajaId:
          cleanCajaId,

        operadorSesion,

        deviceId:
          cleanDeviceId,
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
    operadorSesion = null,
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

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

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

  try {
    const response =
      await cerrarCajaFunction({
        clienteId:
          cleanClienteId,

        sessionId:
          cleanSessionId,

        counted:
          countedAmount,

        deviceId:
          cleanDeviceId,

        operadorSesion,
      });

    const data =
      response?.data || {};

    if (
      !data.ok ||
      !data.session
    ) {
      fail(
        "close-cash-session-failed",
        "No se pudo cerrar la caja"
      );
    }

    return data.session;
  } catch (error) {
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

    const motivo =
      String(
        error?.details?.motivo ||
        ""
      );

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
        serverMessage ||
        "No tenés permisos para cerrar la caja."
      );
    }

    if (
      code ===
      "not-found" ||
      motivo ===
      "cash-session-not-found"
    ) {
      fail(
        "cash-session-not-found",
        serverMessage ||
        "No encontramos la caja"
      );
    }

    if (
      code ===
      "failed-precondition"
    ) {
      if (
        motivo ===
        "cash-already-closed"
      ) {
        fail(
          "cash-already-closed",
          serverMessage ||
          "La caja ya está cerrada"
        );
      }

      if (
        motivo ===
        "cash-session-mismatch"
      ) {
        fail(
          "cash-session-mismatch",
          serverMessage ||
          "Esta caja ya no es la caja activa"
        );
      }
    }

    if (
      code ===
      "invalid-argument"
    ) {
      fail(
        "invalid-counted-amount",
        serverMessage ||
        "Ingresá un efectivo contado válido"
      );
    }

    fail(
      "close-cash-session-failed",
      serverMessage ||
      "No se pudo cerrar la caja"
    );
  }
}
