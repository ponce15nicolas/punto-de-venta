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
// - las inserciones de datos históricos se hacen con transacciones
//   para no sobrescribir datos creados simultáneamente;
// - una caja abierta legacy sólo se recupera si Cloud no tiene
//   otra caja activa;
// - las cajas legacy se enriquecen con sus ventas cuando es posible.

import {
  arrayUnion,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../firebase/config";
import { storeGet } from "../../lib/storage";

import {
  cajaPath,
  configuracionPosPath,
  migracionPosPath,
  productoPath,
  ventaPath,
} from "./posPaths";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

export const POS_MIGRATION_VERSION = 1;

const MIGRATION_LOCK_MS =
  10 * 60 * 1000;

/*
 * Cada transacción procesa pocos documentos para mantener
 * margen frente a límites de Firestore y reducir reintentos.
 */
const TRANSACTION_CHUNK_SIZE = 80;

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
  value
) {
  const clean =
    String(
      value ?? ""
    ).trim();

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

function chunkArray(
  items,
  size
) {
  const chunks = [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    chunks.push(
      items.slice(
        index,
        index + size
      )
    );
  }

  return chunks;
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
    ).trim();

  const name =
    String(
      product.name ||
      ""
    ).trim();

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
    ...product,

    barcode,
    name,
    tipoVenta,

    unidadMedida:
      tipoVenta ===
      "peso"
        ? product.unidadMedida ||
          "kg"
        : null,

    price,
    stock,

    expiry:
      product.expiry ||
      null,
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
    ).trim();

  if (!name) {
    return null;
  }

  const barcode =
    String(
      item.barcode ||
      ""
    ).trim() ||
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

  const storedSubtotal =
    item.subtotal !==
      null &&
    item.subtotal !==
      "" &&
    Number.isFinite(
      Number(
        item.subtotal
      )
    )
      ? roundMoney(
          item.subtotal
        )
      : null;

  const subtotal =
    storedSubtotal !==
      null
      ? storedSubtotal
      : roundMoney(
          qty * price
        );

  return removeUndefined({
    ...item,

    barcode,
    name,
    tipoVenta,

    unidadMedida:
      tipoVenta ===
      "peso"
        ? item.unidadMedida ||
          "kg"
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
    sale.total !== null &&
    sale.total !== "" &&
    Number.isFinite(
      Number(
        sale.total
      )
    )
      ? roundMoney(
          sale.total
        )
      : calculatedTotal;

  const method =
    normalizePaymentMethod(
      sale.payment?.method
    );

  const received =
    method ===
    "efectivo"
      ? roundMoney(
          toNumber(
            sale.payment
              ?.received,
            total
          )
        )
      : total;

  const change =
    method ===
    "efectivo"
      ? roundMoney(
          toNumber(
            sale.payment
              ?.change,
            Math.max(
              0,
              received -
                total
            )
          )
        )
      : 0;

  return removeUndefined({
    ...sale,

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

  return removeUndefined({
    ...session,

    id,

    openTime:
      safeIsoDate(
        session.openTime,
        new Date(0)
          .toISOString()
      ),

    openAmount:
      roundMoney(
        Math.max(
          0,
          toNumber(
            session.openAmount
          )
        )
      ),

    closeTime:
      status ===
      "closed"
        ? safeIsoDate(
            session.closeTime,
            null
          )
        : null,

    closeAmount:
      status ===
        "closed" &&
      session.closeAmount !=
        null
        ? roundMoney(
            Math.max(
              0,
              toNumber(
                session.closeAmount
              )
            )
          )
        : null,

    expectedAmount:
      status ===
        "closed" &&
      session.expectedAmount !=
        null
        ? roundMoney(
            toNumber(
              session.expectedAmount
            )
          )
        : null,

    counted:
      status ===
        "closed" &&
      session.counted != null
        ? roundMoney(
            toNumber(
              session.counted
            )
          )
        : null,

    diff:
      status ===
        "closed" &&
      session.diff != null
        ? roundMoney(
            toNumber(
              session.diff
            )
          )
        : null,

    totalSales:
      roundMoney(
        Math.max(
          0,
          toNumber(
            session.totalSales
          )
        )
      ),

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
      normalizePaymentTotals(
        session.paymentTotals
      ),

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
    ).trim() ||
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
   REFERENCIAS
========================================================= */

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

function migracionRef(
  clienteId
) {
  return doc(
    db,
    ...migracionPosPath(
      clienteId
    )
  );
}

/* =========================================================
   ESTADO DE MIGRACIÓN
========================================================= */

export async function getPosMigrationStatus(
  clienteId
) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  const snapshot =
    await getDoc(
      migracionRef(
        cleanClienteId
      )
    );

  if (
    !snapshot.exists()
  ) {
    return {
      exists: false,
      status: "pending",
      version:
        POS_MIGRATION_VERSION,
      completedDeviceIds: [],
    };
  }

  return {
    exists: true,
    ...snapshot.data(),
  };
}

/* =========================================================
   TOMAR BLOQUEO
========================================================= */

async function claimMigration(
  clienteId,
  deviceId,
  localCounts
) {
  const ref =
    migracionRef(
      clienteId
    );

  const now =
    Date.now();

  return runTransaction(
    db,
    async (
      transaction
    ) => {
      const snapshot =
        await transaction.get(
          ref
        );

      const data =
        snapshot.exists()
          ? snapshot.data()
          : {};

      const completedDeviceIds =
        Array.isArray(
          data.completedDeviceIds
        )
          ? data.completedDeviceIds
          : [];

      /*
       * IMPORTANTE:
       * La migración es por dispositivo.
       *
       * Un primer dispositivo no debe impedir que otro
       * navegador migre datos locales históricos distintos.
       */
      if (
        toNumber(
          data.version
        ) >=
          POS_MIGRATION_VERSION &&
        completedDeviceIds.includes(
          deviceId
        )
      ) {
        return {
          claimed: false,
          reason:
            "already-completed",
          data,
        };
      }

      const activeMigration =
        isPlainObject(
          data.activeMigration
        )
          ? data.activeMigration
          : null;

      const activeDeviceId =
        optionalString(
          activeMigration
            ?.deviceId
        );

      const startedAtMs =
        toNumber(
          activeMigration
            ?.startedAtMs
        );

      const lockIsFresh =
        activeDeviceId &&
        startedAtMs > 0 &&
        now -
          startedAtMs <
          MIGRATION_LOCK_MS;

      if (
        lockIsFresh &&
        activeDeviceId !==
          deviceId
      ) {
        return {
          claimed: false,
          reason:
            "locked",
          data,
        };
      }

      transaction.set(
        ref,
        {
          version:
            POS_MIGRATION_VERSION,

          status:
            "migrating",

          activeMigration: {
            deviceId,
            startedAtMs:
              now,
          },

          startedAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          localCounts,
        },
        {
          merge: true,
        }
      );

      return {
        claimed: true,
        reason: "claimed",
      };
    }
  );
}

/* =========================================================
   CREAR DOCUMENTOS SIN SOBRESCRIBIR CLOUD
========================================================= */

/*
 * A diferencia de:
 *
 *   getDocs() -> writeBatch.set()
 *
 * cada bloque usa una transacción.
 *
 * Si otro dispositivo crea o modifica un documento entre
 * lectura y escritura, Firestore reintenta la transacción.
 * De este modo Cloud conserva prioridad y no sobrescribimos
 * accidentalmente datos recientes.
 */
async function insertMissingDocuments(
  operations
) {
  const chunks =
    chunkArray(
      operations,
      TRANSACTION_CHUNK_SIZE
    );

  let migrated = 0;
  let skipped = 0;

  for (
    const chunk of
    chunks
  ) {
    const result =
      await runTransaction(
        db,
        async (
          transaction
        ) => {
          const pending = [];

          /*
           * Todas las lecturas ocurren antes
           * de cualquier escritura.
           */
          for (
            const operation of
            chunk
          ) {
            const snapshot =
              await transaction.get(
                operation.ref
              );

            pending.push({
              operation,
              exists:
                snapshot.exists(),
            });
          }

          let chunkMigrated =
            0;

          let chunkSkipped =
            0;

          for (
            const item of
            pending
          ) {
            if (
              item.exists
            ) {
              chunkSkipped +=
                1;

              continue;
            }

            transaction.set(
              item.operation.ref,
              item.operation.data
            );

            chunkMigrated +=
              1;
          }

          return {
            migrated:
              chunkMigrated,

            skipped:
              chunkSkipped,
          };
        }
      );

    migrated +=
      result.migrated;

    skipped +=
      result.skipped;
  }

  return {
    migrated,
    skipped,
  };
}

/* =========================================================
   NOMBRE DEL NEGOCIO
========================================================= */

async function migrateShopName(
  clienteId,
  shopName,
  deviceId
) {
  if (!shopName) {
    return {
      migrated: false,
      skipped: true,
    };
  }

  const ref =
    configuracionRef(
      clienteId
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

      const existingName =
        optionalString(
          snapshot.data()
            ?.shopName
        );

      if (
        existingName
      ) {
        return {
          migrated: false,
          skipped: true,
        };
      }

      transaction.set(
        ref,
        {
          shopName,

          migrationVersion:
            POS_MIGRATION_VERSION,

          migratedFromLocal:
            true,

          migratedByDeviceId:
            deviceId,

          updatedAt:
            serverTimestamp(),

          migratedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return {
        migrated: true,
        skipped: false,
      };
    }
  );
}

/* =========================================================
   RECUPERAR CAJA ABIERTA LEGACY
========================================================= */

async function recoverLegacyOpenCashSession(
  clienteId,
  localOpenSession
) {
  if (
    !localOpenSession
  ) {
    return false;
  }

  const configRef =
    configuracionRef(
      clienteId
    );

  const sessionRef =
    cajaRef(
      clienteId,
      localOpenSession.id
    );

  return runTransaction(
    db,
    async (
      transaction
    ) => {
      const configSnapshot =
        await transaction.get(
          configRef
        );

      const sessionSnapshot =
        await transaction.get(
          sessionRef
        );

      const activeSessionId =
        optionalString(
          configSnapshot.data()
            ?.openCashSessionId
        );

      /*
       * Si Cloud ya tiene una caja activa,
       * nunca la reemplazamos con la local.
       */
      if (
        activeSessionId
      ) {
        return false;
      }

      /*
       * La sesión legacy debe existir realmente
       * en Cloud y continuar abierta.
       */
      if (
        !sessionSnapshot.exists() ||
        sessionSnapshot.data()
          ?.status !== "open"
      ) {
        return false;
      }

      transaction.set(
        configRef,
        {
          openCashSessionId:
            localOpenSession.id,

          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return true;
    }
  );
}

/* =========================================================
   COMPLETAR MIGRACIÓN
========================================================= */

async function completeMigration(
  clienteId,
  deviceId,
  localCounts,
  stats
) {
  const ref =
    migracionRef(
      clienteId
    );

  await runTransaction(
    db,
    async (
      transaction
    ) => {
      const snapshot =
        await transaction.get(
          ref
        );

      const data =
        snapshot.exists()
          ? snapshot.data()
          : {};

      const activeDeviceId =
        optionalString(
          data.activeMigration
            ?.deviceId
        );

      /*
       * No permitimos que un dispositivo marque como
       * completada la migración que actualmente pertenece
       * a otro dispositivo.
       */
      if (
        activeDeviceId &&
        activeDeviceId !==
          deviceId
      ) {
        fail(
          "migration-lock-lost",
          "La migración fue tomada por otro dispositivo"
        );
      }

      transaction.set(
        ref,
        {
          version:
            POS_MIGRATION_VERSION,

          status:
            "completed",

          activeMigration:
            null,

          completedDeviceIds:
            arrayUnion(
              deviceId
            ),

          completedAtMs:
            Date.now(),

          completedAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          localCounts,

          lastResult:
            stats,
        },
        {
          merge: true,
        }
      );
    }
  );
}

/* =========================================================
   REGISTRAR ERROR
========================================================= */

async function markMigrationError(
  clienteId,
  deviceId,
  error
) {
  const ref =
    migracionRef(
      clienteId
    );

  try {
    await runTransaction(
      db,
      async (
        transaction
      ) => {
        const snapshot =
          await transaction.get(
            ref
          );

        const data =
          snapshot.exists()
            ? snapshot.data()
            : {};

        const activeDeviceId =
          optionalString(
            data.activeMigration
              ?.deviceId
          );

        /*
         * Si otro dispositivo ya tomó el lock,
         * no tocamos su estado.
         */
        if (
          activeDeviceId &&
          activeDeviceId !==
            deviceId
        ) {
          return;
        }

        transaction.set(
          ref,
          {
            version:
              POS_MIGRATION_VERSION,

            status:
              "error",

            activeMigration:
              null,

            lastError: {
              deviceId,

              code:
                String(
                  error?.code ||
                  "unknown"
                ).slice(
                  0,
                  100
                ),

              message:
                String(
                  error?.message ||
                  "Error desconocido"
                ).slice(
                  0,
                  500
                ),
            },

            failedAtMs:
              Date.now(),

            failedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );
      }
    );
  } catch (
    markerError
  ) {
    console.error(
      "No se pudo registrar el fallo de migración:",
      markerError
    );
  }
}

/* =========================================================
   MIGRAR
========================================================= */

export async function migrateLocalPosToFirestore({
  clienteId,
  deviceId,
} = {}) {
  const cleanClienteId =
    requireString(
      clienteId,
      "clienteId"
    );

  /*
   * El deviceId es obligatorio.
   *
   * Permite distinguir migraciones de distintos navegadores
   * y hace seguro el bloqueo temporal multidispositivo.
   */
  const cleanDeviceId =
    requireString(
      deviceId,
      "deviceId"
    );

  const local =
    getLocalPosSnapshot();

  const claim =
    await claimMigration(
      cleanClienteId,
      cleanDeviceId,
      local.counts
    );

  if (
    !claim.claimed
  ) {
    if (
      claim.reason ===
      "already-completed"
    ) {
      return {
        ok: true,
        migrated: false,
        reason:
          "already-completed",

        result:
          claim.data
            ?.lastResult ||
          null,
      };
    }

    if (
      claim.reason ===
      "locked"
    ) {
      return {
        ok: false,
        migrated: false,
        reason:
          "migration-in-progress",
      };
    }
  }

  try {
    /* =====================================================
       PREPARAR OPERACIONES
    ===================================================== */

    const productOperations =
      local.products.map(
        (product) => ({
          ref:
            productoRef(
              cleanClienteId,
              product.barcode
            ),

          data:
            removeUndefined({
              ...product,

              migratedFromLocal:
                true,

              migrationVersion:
                POS_MIGRATION_VERSION,

              migratedByDeviceId:
                cleanDeviceId,

              createdAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),

              migratedAt:
                serverTimestamp(),
            }),
        })
      );

    const saleOperations =
      local.sales.map(
        (sale) => ({
          ref:
            ventaRef(
              cleanClienteId,
              sale.id
            ),

          data:
            removeUndefined({
              ...sale,

              migratedFromLocal:
                true,

              migrationVersion:
                POS_MIGRATION_VERSION,

              migratedByDeviceId:
                cleanDeviceId,

              createdAt:
                serverTimestamp(),

              migratedAt:
                serverTimestamp(),
            }),
        })
      );

    const cashOperations =
      local.cashSessions.map(
        (session) => ({
          ref:
            cajaRef(
              cleanClienteId,
              session.id
            ),

          data:
            removeUndefined({
              ...session,

              migratedFromLocal:
                true,

              migrationVersion:
                POS_MIGRATION_VERSION,

              migratedByDeviceId:
                cleanDeviceId,

              createdAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),

              migratedAt:
                serverTimestamp(),
            }),
        })
      );

    /* =====================================================
       ESCRIBIR SIN SOBRESCRIBIR
    ===================================================== */

    const productsResult =
      await insertMissingDocuments(
        productOperations
      );

    const salesResult =
      await insertMissingDocuments(
        saleOperations
      );

    const cashResult =
      await insertMissingDocuments(
        cashOperations
      );

    const shopNameResult =
      await migrateShopName(
        cleanClienteId,
        local.shopName,
        cleanDeviceId
      );

    /* =====================================================
       CAJA ABIERTA LEGACY
    ===================================================== */

    const localOpenSession =
      local.cashSessions.find(
        (session) =>
          session.status ===
          "open"
      ) || null;

    const openCashRecovered =
      await recoverLegacyOpenCashSession(
        cleanClienteId,
        localOpenSession
      );

    /* =====================================================
       RESULTADO
    ===================================================== */

    const stats = {
      products:
        productsResult,

      sales:
        salesResult,

      cashSessions:
        cashResult,

      shopName:
        shopNameResult,

      openCashRecovered,
    };

    await completeMigration(
      cleanClienteId,
      cleanDeviceId,
      local.counts,
      stats
    );

    return {
      ok: true,
      migrated: true,
      reason: "completed",
      result: stats,
    };
  } catch (error) {
    console.error(
      "Error migrando datos locales del POS:",
      error
    );

    await markMigrationError(
      cleanClienteId,
      cleanDeviceId,
      error
    );

    throw error;
  }
}