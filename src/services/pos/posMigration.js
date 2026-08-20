// src/services/pos/posMigration.js
//
// Migración segura de datos históricos del POS
// desde localStorage hacia Cloud Firestore.
//
// Principios:
// - nunca borra localStorage automáticamente;
// - Cloud conserva prioridad si ya existe un documento;
// - cada dispositivo migra como máximo una vez por versión;
// - una migración de otro dispositivo no bloquea para siempre;
// - todas las escrituras pasan por Cloud Functions;
// - el backend revalida y reconstruye cada documento por lista blanca;
// - una caja abierta legacy sólo se recupera si Cloud no tiene
//   otra caja activa;
// - las cajas legacy se enriquecen con sus ventas cuando es posible.

import {
  httpsCallable,
} from "firebase/functions";

import {
  functions,
} from "../../firebase/config";
import {
  storeGet,
  storeSet,
} from "../../lib/storage";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

export const POS_MIGRATION_VERSION = 1;

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

/* =========================================================
   ERROR CONTROLADO
========================================================= */

export class PosMigrationError extends Error {
  constructor(
    code,
    message,
    details = {}
  ) {
    super(message);

    this.name =
      "PosMigrationError";

    this.code =
      code;

    this.details =
      details;
  }
}

function fail(
  code,
  message,
  details = {}
) {
  throw new PosMigrationError(
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
    String(
      value ?? ""
    ).trim();

  if (!clean) {
    fail(
      "invalid-argument",
      `${fieldName} es obligatorio`
    );
  }

  return clean;
}

function optionalString(
  value,
  maxLength = 180
) {
  const clean =
    String(
      value ?? ""
    )
      .trim()
      .slice(
        0,
        maxLength
      );

  return clean || null;
}

function toNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
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

function normalizePaymentMethod(
  value
) {
  return PAYMENT_METHODS.includes(
    value
  )
    ? value
    : "efectivo";
}

function isPlainObject(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
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
 * Firestore rechaza undefined.
 *
 * No modificamos Timestamp, FieldValue ni otros objetos
 * especiales de Firebase.
 */
function removeUndefined(
  value
) {
  if (
    value === undefined
  ) {
    return undefined;
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .map(
        removeUndefined
      )
      .filter(
        (item) =>
          item !== undefined
      );
  }

  if (
    isPlainObject(value)
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .map(
          ([key, item]) => [
            key,
            removeUndefined(
              item
            ),
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
  value,
  fallback = null
) {
  if (!value) {
    return fallback;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return fallback;
  }

  return date.toISOString();
}

/* =========================================================
   IDS LEGACY DETERMINÍSTICOS
========================================================= */

function legacySaleId(
  sale,
  index
) {
  const existing =
    optionalString(
      sale?.id
    );

  if (existing) {
    return existing;
  }

  const timestamp =
    safeIsoDate(
      sale?.timestamp,
      ""
    );

  const time =
    timestamp
      ? new Date(
          timestamp
        ).getTime()
      : 0;

  return `legacy-sale-${index}-${time}`;
}

function legacyCashSessionId(
  session,
  index
) {
  const existing =
    optionalString(
      session?.id
    );

  if (existing) {
    return existing;
  }

  const timestamp =
    safeIsoDate(
      session?.openTime,
      ""
    );

  const time =
    timestamp
      ? new Date(
          timestamp
        ).getTime()
      : 0;

  return `legacy-cash-${index}-${time}`;
}

/* =========================================================
   NORMALIZAR PRODUCTO LOCAL
========================================================= */

function normalizeLocalProduct(
  product,
  fallbackBarcode
) {
  if (
    !product ||
    typeof product !==
      "object"
  ) {
    return null;
  }

  const barcode =
    String(
      product.barcode ||
      fallbackBarcode ||
      ""
    )
      .trim()
      .slice(0, 180);

  const name =
    String(
      product.name ||
      ""
    )
      .trim()
      .slice(0, 180);

  if (
    !barcode ||
    !name
  ) {
    return null;
  }

  const tipoVenta =
    normalizeProductType(
      product.tipoVenta
    );

  let price = 0;
  let stock = 0;

  if (
    tipoVenta !==
    "precio-libre"
  ) {
    price =
      roundMoney(
        Math.max(
          0,
          toNumber(
            product.price
          )
        )
      );
  }

  if (
    tipoVenta ===
    "peso"
  ) {
    stock =
      roundQuantity(
        Math.max(
          0,
          toNumber(
            product.stock
          )
        )
      );
  } else if (
    tipoVenta ===
    "unidad"
  ) {
    stock =
      Math.max(
        0,
        Math.trunc(
          toNumber(
            product.stock
          )
        )
      );
  }

  return removeUndefined({
    barcode,
    name,
    tipoVenta,

    unidadMedida:
      tipoVenta ===
      "peso"
        ? optionalString(
            product.unidadMedida,
            20
          ) || "kg"
        : null,

    price,
    stock,

    expiry:
      optionalString(
        product.expiry,
        120
      ),
  });
}

/* =========================================================
   NORMALIZAR ÍTEM HISTÓRICO
========================================================= */

function normalizeLocalSaleItem(
  item,
  itemIndex
) {
  if (
    !item ||
    typeof item !==
      "object"
  ) {
    return null;
  }

  const name =
    String(
      item.name ||
      ""
    )
      .trim()
      .slice(0, 180);

  if (!name) {
    return null;
  }

  const barcode =
    String(
      item.barcode ||
      ""
    )
      .trim()
      .slice(0, 180) ||
    `legacy-item-${itemIndex}`;

  const tipoVenta =
    normalizeProductType(
      item.tipoVenta
    );

  let qty;

  if (
    tipoVenta ===
    "peso"
  ) {
    qty =
      roundQuantity(
        Math.max(
          0,
          toNumber(
            item.qty
          )
        )
      );
  } else if (
    tipoVenta ===
    "precio-libre"
  ) {
    qty = 1;
  } else {
    qty =
      Math.max(
        0,
        Math.trunc(
          toNumber(
            item.qty,
            1
          )
        )
      );
  }

  if (
    qty <= 0
  ) {
    qty =
      tipoVenta ===
      "peso"
        ? 0.001
        : 1;
  }

  const price =
    roundMoney(
      Math.max(
        0,
        toNumber(
          item.price
        )
      )
    );

  const subtotal =
    roundMoney(
      qty * price
    );

  return removeUndefined({
    barcode,
    name,
    tipoVenta,

    unidadMedida:
      tipoVenta ===
      "peso"
        ? optionalString(
            item.unidadMedida,
            20
          ) || "kg"
        : null,

    price,
    qty,
    subtotal,
  });
}

/* =========================================================
   NORMALIZAR VENTA LOCAL
========================================================= */

function normalizeLocalSale(
  sale,
  index
) {
  if (
    !sale ||
    typeof sale !==
      "object"
  ) {
    return null;
  }

  const id =
    legacySaleId(
      sale,
      index
    );

  const items =
    Array.isArray(
      sale.items
    )
      ? sale.items
          .map(
            (
              item,
              itemIndex
            ) =>
              normalizeLocalSaleItem(
                item,
                itemIndex
              )
          )
          .filter(
            Boolean
          )
      : [];

  if (
    items.length === 0
  ) {
    return null;
  }

  const calculatedTotal =
    roundMoney(
      items.reduce(
        (
          total,
          item
        ) =>
          total +
          toNumber(
            item.subtotal
          ),
        0
      )
    );

  const total =
    calculatedTotal;

  const method =
    normalizePaymentMethod(
      sale.payment?.method
    );

  const received =
    method ===
    "efectivo"
      ? roundMoney(
          Math.max(
            total,
            toNumber(
              sale.payment
                ?.received,
              total
            )
          )
        )
      : total;

  const change =
    method ===
    "efectivo"
      ? roundMoney(
          Math.max(
            0,
            received -
              total
          )
        )
      : 0;

  return removeUndefined({
    id,

    timestamp:
      safeIsoDate(
        sale.timestamp,
        new Date(0)
          .toISOString()
      ),

    items,

    total,

    sessionId:
      optionalString(
        sale.sessionId
      ),

    payment: {
      method,
      received,
      change,
    },
  });
}

/* =========================================================
   NORMALIZAR CAJA LOCAL
========================================================= */

function normalizePaymentTotals(
  value
) {
  return {
    efectivo:
      roundMoney(
        Math.max(
          0,
          toNumber(
            value
              ?.efectivo
          )
        )
      ),

    transferencia:
      roundMoney(
        Math.max(
          0,
          toNumber(
            value
              ?.transferencia
          )
        )
      ),

    qr:
      roundMoney(
        Math.max(
          0,
          toNumber(
            value?.qr
          )
        )
      ),

    tarjeta:
      roundMoney(
        Math.max(
          0,
          toNumber(
            value
              ?.tarjeta
          )
        )
      ),
  };
}

function normalizeLocalCashSession(
  session,
  index
) {
  if (
    !session ||
    typeof session !==
      "object"
  ) {
    return null;
  }

  const id =
    legacyCashSessionId(
      session,
      index
    );

  const status =
    session.status ===
    "open"
      ? "open"
      : "closed";

  const openAmount =
    roundMoney(
      Math.max(
        0,
        toNumber(
          session.openAmount
        )
      )
    );

  const paymentTotals =
    normalizePaymentTotals(
      session.paymentTotals
    );

  const paymentTotal =
    roundMoney(
      Object.values(
        paymentTotals
      ).reduce(
        (
          total,
          amount
        ) =>
          total +
          amount,
        0
      )
    );

  const declaredTotal =
    roundMoney(
      Math.max(
        0,
        toNumber(
          session.totalSales
        )
      )
    );

  if (
    paymentTotal === 0 &&
    declaredTotal > 0
  ) {
    paymentTotals.efectivo =
      declaredTotal;
  }

  const totalSales =
    paymentTotal > 0
      ? paymentTotal
      : declaredTotal;

  const counted =
    status ===
    "closed"
      ? session.counted != null
        ? roundMoney(
            Math.max(
              0,
              toNumber(
                session.counted
              )
            )
          )
        : session.closeAmount !=
            null
          ? roundMoney(
              Math.max(
                0,
                toNumber(
                  session.closeAmount
                )
              )
            )
          : null
      : null;

  const expectedAmount =
    status ===
    "closed"
      ? roundMoney(
          openAmount +
          paymentTotals.efectivo
        )
      : null;

  return removeUndefined({
    id,

    openTime:
      safeIsoDate(
        session.openTime,
        new Date(0)
          .toISOString()
      ),

    openAmount:
      openAmount,

    closeTime:
      status ===
      "closed"
        ? safeIsoDate(
            session.closeTime,
            null
          )
        : null,

    closeAmount:
      counted,

    expectedAmount:
      expectedAmount,

    counted:
      counted,

    diff:
      counted !== null
        ? roundMoney(
            counted -
            expectedAmount
          )
        : null,

    totalSales:
      totalSales,

    salesCount:
      Math.max(
        0,
        Math.trunc(
          toNumber(
            session.salesCount
          )
        )
      ),

    paymentTotals:
      paymentTotals,

    status,
  });
}

/* =========================================================
   ENRIQUECER CAJAS CON VENTAS
========================================================= */

function enrichCashSessionsWithSales(
  cashSessions,
  sales
) {
  const salesBySession =
    new Map();

  for (
    const sale of
    sales
  ) {
    const sessionId =
      optionalString(
        sale?.sessionId
      );

    if (!sessionId) {
      continue;
    }

    if (
      !salesBySession.has(
        sessionId
      )
    ) {
      salesBySession.set(
        sessionId,
        []
      );
    }

    salesBySession.get(
      sessionId
    ).push(
      sale
    );
  }

  return cashSessions.map(
    (session) => {
      const sessionSales =
        salesBySession.get(
          session.id
        ) || [];

      /*
       * Si no hay ventas relacionadas conservamos los
       * acumuladores históricos originales.
       */
      if (
        sessionSales.length === 0
      ) {
        return session;
      }

      const paymentTotals = {
        efectivo: 0,
        transferencia: 0,
        qr: 0,
        tarjeta: 0,
      };

      let totalSales = 0;

      for (
        const sale of
        sessionSales
      ) {
        const method =
          normalizePaymentMethod(
            sale?.payment?.method
          );

        const total =
          roundMoney(
            sale?.total
          );

        totalSales =
          roundMoney(
            totalSales +
            total
          );

        paymentTotals[
          method
        ] =
          roundMoney(
            paymentTotals[
              method
            ] +
            total
          );
      }

      const expectedAmount =
        roundMoney(
          toNumber(
            session.openAmount
          ) +
          paymentTotals.efectivo
        );

      const counted =
        session.counted !=
          null
          ? roundMoney(
              session.counted
            )
          : session.closeAmount !=
              null
            ? roundMoney(
                session.closeAmount
              )
            : null;

      const diff =
        counted !== null
          ? roundMoney(
              counted -
              expectedAmount
            )
          : session.diff;

      return {
        ...session,

        totalSales,
        salesCount:
          sessionSales.length,

        paymentTotals,

        expectedAmount:
          session.status ===
          "closed"
            ? expectedAmount
            : session.expectedAmount,

        counted:
          session.status ===
          "closed"
            ? counted
            : session.counted,

        closeAmount:
          session.status ===
          "closed"
            ? counted
            : session.closeAmount,

        diff:
          session.status ===
          "closed"
            ? diff
            : session.diff,
      };
    }
  );
}

/* =========================================================
   LEER DATOS LOCALES
========================================================= */

export function getLocalPosSnapshot() {
  const rawCatalog =
    storeGet(
      "catalog",
      {}
    ) || {};

  const rawSales =
    storeGet(
      "sales",
      []
    ) || [];

  const rawCashSessions =
    storeGet(
      "cashSessions",
      []
    ) || [];

  const rawShopName =
    storeGet(
      "shopName",
      "Mi Negocio"
    );

  const catalogEntries =
    isPlainObject(
      rawCatalog
    )
      ? Object.entries(
          rawCatalog
        )
      : [];

  const products =
    catalogEntries
      .map(
        (
          [
            barcode,
            product,
          ]
        ) =>
          normalizeLocalProduct(
            product,
            barcode
          )
      )
      .filter(
        Boolean
      );

  const sales =
    Array.isArray(
      rawSales
    )
      ? rawSales
          .map(
            normalizeLocalSale
          )
          .filter(
            Boolean
          )
      : [];

  const normalizedCashSessions =
    Array.isArray(
      rawCashSessions
    )
      ? rawCashSessions
          .map(
            normalizeLocalCashSession
          )
          .filter(
            Boolean
          )
      : [];

  const cashSessions =
    enrichCashSessionsWithSales(
      normalizedCashSessions,
      sales
    );

  const shopName =
    String(
      rawShopName ||
      "Mi Negocio"
    )
      .trim()
      .slice(0, 120) ||
    "Mi Negocio";

  return {
    products,
    sales,
    cashSessions,
    shopName,

    counts: {
      products:
        products.length,

      sales:
        sales.length,

      cashSessions:
        cashSessions.length,
    },
  };
}

/* =========================================================
   ¿HAY DATOS LOCALES?
========================================================= */

export function hasLocalPosData() {
  const snapshot =
    getLocalPosSnapshot();

  return (
    snapshot.products
      .length > 0 ||
    snapshot.sales.length >
      0 ||
    snapshot.cashSessions
      .length > 0 ||
    (
      snapshot.shopName &&
      snapshot.shopName !==
        "Mi Negocio"
    )
  );
}

/* =========================================================
   MIGRACIÓN MEDIANTE CLOUD FUNCTIONS
========================================================= */

const MIGRATION_CALL_TIMEOUT_MS =
  3 * 60 * 1000 +
  10 * 1000;

const DEFAULT_BATCH_MAX_ITEMS = 80;
const DEFAULT_BATCH_MAX_BYTES =
  700 * 1024;

const MIGRATION_CLIENT_STATE_KEY =
  "migrationPosLegacyV1";

const migrarPosLegacyFunction =
  httpsCallable(
    functions,
    "migrarPosLegacy",
    {
      timeout:
        MIGRATION_CALL_TIMEOUT_MS,
    }
  );

function getMigrationClientState(
  clienteId,
  deviceId
) {
  const state =
    storeGet(
      MIGRATION_CLIENT_STATE_KEY,
      null
    );

  if (
    !isPlainObject(
      state
    ) ||
    state.version !==
      POS_MIGRATION_VERSION ||
    !isPlainObject(
      state.entries
    )
  ) {
    return null;
  }

  const key =
    clienteId +
    "::" +
    deviceId;

  const entry =
    state.entries[
      key
    ];

  return isPlainObject(
    entry
  )
    ? entry
    : null;
}

function writeMigrationClientState(
  clienteId,
  deviceId,
  entry
) {
  const previous =
    storeGet(
      MIGRATION_CLIENT_STATE_KEY,
      null
    );

  const previousEntries =
    isPlainObject(
      previous
    ) &&
    previous.version ===
      POS_MIGRATION_VERSION &&
    isPlainObject(
      previous.entries
    )
      ? previous.entries
      : {};

  const key =
    clienteId +
    "::" +
    deviceId;

  /*
   * Acotamos el marcador local: sólo evita confundir una caché
   * Cloud con datos legacy y nunca concede permisos de backend.
   */
  const recentEntries =
    Object.fromEntries(
      Object.entries(
        previousEntries
      ).slice(-19)
    );

  storeSet(
    MIGRATION_CLIENT_STATE_KEY,
    {
      version:
        POS_MIGRATION_VERSION,

      entries: {
        ...recentEntries,

        [key]: {
          ...entry,

          updatedAt:
            new Date()
              .toISOString(),
        },
      },
    }
  );
}

function markMigrationHandled(
  clienteId,
  deviceId,
  reason
) {
  writeMigrationClientState(
    clienteId,
    deviceId,
    {
      completed: true,
      pendingLegacy: false,
      reason,
    }
  );
}

function markMigrationPending(
  clienteId,
  deviceId
) {
  writeMigrationClientState(
    clienteId,
    deviceId,
    {
      completed: false,
      pendingLegacy: true,
      reason:
        "legacy-detected",
    }
  );
}

export function markLocalPosMigrationHandled({
  clienteId,
  deviceId,
  reason = "cloud-cache",
} = {}) {
  markMigrationHandled(
    requireString(
      clienteId,
      "clienteId"
    ),
    requireString(
      deviceId,
      "deviceId"
    ),
    String(
      reason ||
      "cloud-cache"
    ).slice(0, 80)
  );
}

function requireOperatorSession(
  operadorSesion
) {
  if (
    !operadorSesion?.id ||
    !operadorSesion?.token
  ) {
    fail(
      "unauthenticated",
      "Falta la sesión interna del operador"
    );
  }

  return {
    id:
      requireString(
        operadorSesion.id,
        "operadorSesion.id"
      ),

    token:
      requireString(
        operadorSesion.token,
        "operadorSesion.token"
      ),
  };
}

function callableErrorCode(
  error
) {
  return String(
    error?.code ||
    "unknown"
  )
    .split("/")
    .pop();
}

async function callMigrationBackend(
  payload
) {
  try {
    const response =
      await migrarPosLegacyFunction(
        payload
      );

    const data =
      response?.data;

    if (
      !data ||
      typeof data !==
        "object"
    ) {
      fail(
        "invalid-response",
        "La migración devolvió una respuesta inválida"
      );
    }

    return data;
  } catch (error) {
    if (
      error instanceof
      PosMigrationError
    ) {
      throw error;
    }

    const details =
      isPlainObject(
        error?.details
      )
        ? error.details
        : {};

    const message =
      optionalString(
        details.message
      ) ||
      optionalString(
        details.mensaje
      ) ||
      optionalString(
        error?.message
      ) ||
      "No se pudo migrar la información local";

    throw new PosMigrationError(
      callableErrorCode(
        error
      ),
      message,
      details
    );
  }
}

function positiveIntegerLimit(
  value,
  fallback,
  maximum
) {
  const parsed =
    Math.trunc(
      toNumber(
        value,
        fallback
      )
    );

  if (
    parsed <= 0
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    maximum
  );
}

function getMigrationBatches(
  items,
  {
    maxItems =
      DEFAULT_BATCH_MAX_ITEMS,

    maxBytes =
      DEFAULT_BATCH_MAX_BYTES,
  } = {}
) {
  const safeMaxItems =
    positiveIntegerLimit(
      maxItems,
      DEFAULT_BATCH_MAX_ITEMS,
      DEFAULT_BATCH_MAX_ITEMS
    );

  /*
   * Dejamos margen para el resto del payload callable.
   */
  const safeMaxBytes =
    positiveIntegerLimit(
      maxBytes,
      DEFAULT_BATCH_MAX_BYTES,
      DEFAULT_BATCH_MAX_BYTES
    );

  const encoder =
    new TextEncoder();

  const batches = [];
  let current = [];
  let currentBytes = 2;

  for (
    let index = 0;
    index < items.length;
    index += 1
  ) {
    const item =
      items[index];

    const serialized =
      JSON.stringify(
        item
      );

    if (
      serialized ===
      undefined
    ) {
      fail(
        "invalid-local-data",
        "Hay un registro local que no se puede serializar",
        {
          index,
        }
      );
    }

    const itemBytes =
      encoder.encode(
        serialized
      ).byteLength;

    if (
      itemBytes + 2 >
      safeMaxBytes
    ) {
      fail(
        "local-document-too-large",
        "Un registro local supera el tamaño permitido para migrar",
        {
          index,
          bytes:
            itemBytes,
        }
      );
    }

    const wouldExceedItems =
      current.length >=
      safeMaxItems;

    const wouldExceedBytes =
      current.length > 0 &&
      currentBytes +
        itemBytes +
        1 >
        safeMaxBytes;

    if (
      wouldExceedItems ||
      wouldExceedBytes
    ) {
      batches.push(
        current
      );

      current = [];
      currentBytes = 2;
    }

    current.push(
      item
    );

    currentBytes +=
      itemBytes +
      (
        current.length > 1
          ? 1
          : 0
      );
  }

  if (
    current.length > 0
  ) {
    batches.push(
      current
    );
  }

  return batches;
}

function localSnapshotHasData(
  snapshot
) {
  return (
    snapshot.products
      .length > 0 ||
    snapshot.sales.length >
      0 ||
    snapshot.cashSessions
      .length > 0 ||
    (
      snapshot.shopName &&
      snapshot.shopName !==
        "Mi Negocio"
    )
  );
}

async function migrateKindBatches({
  clienteId,
  deviceId,
  deviceSessionId,
  operadorSesion,
  attemptId,
  kind,
  items,
  limits,
}) {
  const batches =
    getMigrationBatches(
      items,
      limits
    );

  for (
    let index = 0;
    index < batches.length;
    index += 1
  ) {
    const result =
      await callMigrationBackend({
        action:
          "batch",

        version:
          POS_MIGRATION_VERSION,

        clienteId,

        deviceId,

        sessionId:
          deviceSessionId,

        operadorSesion,

        attemptId,

        kind,

        index,

        items:
          batches[index],
      });

    if (
      !result.ok
    ) {
      fail(
        result.reason ||
        "migration-batch-failed",
        result.message ||
        "No se pudo migrar un lote de datos",
        {
          kind,
          index,
        }
      );
    }
  }
}

/* =========================================================
   MIGRAR
========================================================= */

export async function migrateLocalPosToFirestore({
  clienteId,
  deviceId,
  deviceSessionId,
  operadorSesion,
  cacheWasPreviouslyOwned = false,
  allowOwnedLegacyImport = false,
} = {}) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  const cleanDeviceSessionId =
    requireString(
      deviceSessionId,
      "deviceSessionId"
    );

  const cleanOperatorSession =
    requireOperatorSession(
      operadorSesion
    );

  const handledState =
    getMigrationClientState(
      cleanClienteId,
      cleanDeviceId
    );

  if (
    handledState
      ?.completed ===
    true
  ) {
    return {
      ok: true,
      migrated: false,
      reason:
        "client-already-handled",
      result: null,
    };
  }

  const local =
    getLocalPosSnapshot();

  const localOpenCashSessions =
    local.cashSessions.filter(
      (session) =>
        session.status ===
        "open"
    );

  if (
    localOpenCashSessions.length >
    1
  ) {
    fail(
      "migration-multiple-open-cash-sessions",
      "Hay más de una caja local abierta. Cerrá o corregí las cajas duplicadas antes de migrar.",
      {
        safeToDiscard:
          handledState
            ?.pendingLegacy !==
          true,
      }
    );
  }

  if (
    !localSnapshotHasData(
      local
    )
  ) {
    if (
      handledState
        ?.pendingLegacy ===
      true
    ) {
      fail(
        "migration-pending-data-missing",
        "La migración local quedó pendiente, pero su copia ya no está disponible. La sincronización se mantiene bloqueada para no aceptar una importación parcial."
      );
    }

    markMigrationHandled(
      cleanClienteId,
      cleanDeviceId,
      "no-local-data"
    );

    return {
      ok: true,
      migrated: false,
      reason:
        "no-local-data",
      result: null,
    };
  }

  const pendingLegacy =
    handledState
      ?.pendingLegacy ===
    true;

  if (
    !cacheWasPreviouslyOwned ||
    allowOwnedLegacyImport
  ) {
    markMigrationPending(
      cleanClienteId,
      cleanDeviceId
    );
  }

  const start =
    await callMigrationBackend({
      action:
        "start",

      version:
        POS_MIGRATION_VERSION,

      clienteId:
        cleanClienteId,

      deviceId:
        cleanDeviceId,

      sessionId:
        cleanDeviceSessionId,

      operadorSesion:
        cleanOperatorSession,

      counts:
        local.counts,

      probeOnly:
        cacheWasPreviouslyOwned ===
          true &&
        !pendingLegacy &&
        !allowOwnedLegacyImport,
    });

  if (
    start.reason ===
    "already-completed"
  ) {
    markMigrationHandled(
      cleanClienteId,
      cleanDeviceId,
      "already-completed"
    );
  }

  if (
    start.reason ===
    "migration-review-required"
  ) {
    return {
      ok: false,
      migrated: false,
      reason:
        "migration-review-required",
      message:
        start.message ||
        "La caché anterior necesita revisión antes de migrarse",
      result: null,
    };
  }

  if (
    start.reason ===
      "admin-required" ||
    start.reason ===
      "already-completed"
  ) {
    return {
      ok:
        start.ok !==
        false,

      migrated: false,

      reason:
        start.reason,

      result:
        start.result ||
        null,
    };
  }

  if (
    !start.ok ||
    !start.attemptId
  ) {
    fail(
      start.reason ||
      "migration-start-failed",
      start.message ||
      "No se pudo iniciar la migración local"
    );
  }

  const common = {
    clienteId:
      cleanClienteId,

    deviceId:
      cleanDeviceId,

    deviceSessionId:
      cleanDeviceSessionId,

    operadorSesion:
      cleanOperatorSession,

    attemptId:
      start.attemptId,

    limits:
      start.limits ||
      {},
  };

  await migrateKindBatches({
    ...common,
    kind:
      "products",
    items:
      local.products,
  });

  await migrateKindBatches({
    ...common,
    kind:
      "sales",
    items:
      local.sales,
  });

  await migrateKindBatches({
    ...common,
    kind:
      "cashSessions",
    items:
      local.cashSessions,
  });

  const localOpenSession =
    local.cashSessions.find(
      (session) =>
        session.status ===
        "open"
    ) ||
    null;

  const completed =
    await callMigrationBackend({
      action:
        "complete",

      version:
        POS_MIGRATION_VERSION,

      clienteId:
        cleanClienteId,

      deviceId:
        cleanDeviceId,

      sessionId:
        cleanDeviceSessionId,

      operadorSesion:
        cleanOperatorSession,

      attemptId:
        start.attemptId,

      shopName:
        local.shopName,

      openCashSessionId:
        localOpenSession
          ?.id ||
        null,
    });

  if (
    !completed.ok
  ) {
    fail(
      completed.reason ||
      "migration-complete-failed",
      completed.message ||
      "No se pudo completar la migración local"
    );
  }

  markMigrationHandled(
    cleanClienteId,
    cleanDeviceId,
    completed.reason ||
      "completed"
  );

  return completed;
}
