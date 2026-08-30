// src/services/ai/assistantContext.js
// Construye un resumen acotado del negocio para el asistente.
// No envía tickets completos ni datos personales de clientes.

const DAY_MS = 24 * 60 * 60 * 1000;

function toNumber(value, fallback = 0) {
  const number = Number(value);
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

function toDateMs(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value?.toMillis ===
    "function"
  ) {
    const ms = value.toMillis();
    return Number.isFinite(ms)
      ? ms
      : null;
  }

  if (
    typeof value?.toDate ===
    "function"
  ) {
    const ms =
      value.toDate()?.getTime?.();

    return Number.isFinite(ms)
      ? ms
      : null;
  }

  const ms =
    value instanceof Date
      ? value.getTime()
      : Date.parse(
          String(value)
        );

  return Number.isFinite(ms)
    ? ms
    : null;
}

function saleTimestampMs(sale) {
  return (
    toDateMs(
      sale?.timestamp
    ) ??
    toDateMs(
      sale?.createdAt
    )
  );
}

function getSalesSince(
  sales,
  startMs
) {
  return sales.filter(
    (sale) => {
      const ms =
        saleTimestampMs(
          sale
        );

      return (
        ms !== null &&
        ms >= startMs
      );
    }
  );
}

function summarizePayments(
  sales
) {
  const totals = {
    efectivo: 0,
    transferencia: 0,
    qr: 0,
    tarjeta: 0,
    cuenta: 0,
  };

  for (const sale of sales) {
    const total =
      roundMoney(
        sale?.total
      );

    const payment =
      sale?.payment || {};

    if (
      payment.method ===
        "mixto" &&
      Array.isArray(
        payment.parts
      )
    ) {
      for (
        const part of
        payment.parts
      ) {
        const method =
          String(
            part?.method ||
              ""
          );

        if (
          Object.prototype.hasOwnProperty.call(
            totals,
            method
          )
        ) {
          totals[method] =
            roundMoney(
              totals[method] +
                toNumber(
                  part?.amount
                )
            );
        }
      }

      continue;
    }

    const method =
      String(
        payment.method ||
          "efectivo"
      );

    if (
      Object.prototype.hasOwnProperty.call(
        totals,
        method
      )
    ) {
      totals[method] =
        roundMoney(
          totals[method] +
            total
        );
    }
  }

  return totals;
}

function summarizeSales(
  sales
) {
  const total =
    roundMoney(
      sales.reduce(
        (
          sum,
          sale
        ) =>
          sum +
          toNumber(
            sale?.total
          ),
        0
      )
    );

  const grossProfit =
    roundMoney(
      sales.reduce(
        (
          sum,
          sale
        ) =>
          sum +
          toNumber(
            sale?.grossProfit
          ),
        0
      )
    );

  const count =
    sales.length;

  return {
    operaciones: count,
    facturacion: total,
    gananciaBrutaRegistrada:
      grossProfit,
    ticketPromedio:
      count > 0
        ? roundMoney(
            total / count
          )
        : 0,
    mediosPago:
      summarizePayments(
        sales
      ),
  };
}

function summarizeTopProducts(
  sales
) {
  const map =
    new Map();

  for (const sale of sales) {
    for (
      const item of
      Array.isArray(
        sale?.items
      )
        ? sale.items
        : []
    ) {
      const name =
        String(
          item?.name ||
            "Producto"
        )
          .trim()
          .slice(0, 90);

      const key =
        String(
          item?.barcode ||
            name
        );

      const qty =
        Math.max(
          0,
          toNumber(
            item?.qty,
            1
          )
        );

      const revenue =
        roundMoney(
          item?.subtotal ??
            toNumber(
              item?.price
            ) * qty
        );

      const current =
        map.get(key) || {
          nombre: name,
          cantidad: 0,
          facturacion: 0,
        };

      current.cantidad =
        Math.round(
          (
            current.cantidad +
            qty
          ) * 1000
        ) / 1000;

      current.facturacion =
        roundMoney(
          current.facturacion +
            revenue
        );

      map.set(
        key,
        current
      );
    }
  }

  return Array.from(
    map.values()
  )
    .sort(
      (a, b) =>
        b.facturacion -
        a.facturacion
    )
    .slice(0, 10);
}

function normalizeCatalog(
  catalog
) {
  if (
    Array.isArray(catalog)
  ) {
    return catalog;
  }

  if (
    catalog &&
    typeof catalog ===
      "object"
  ) {
    return Object.values(
      catalog
    );
  }

  return [];
}

function summarizeInventory(
  catalog
) {
  const products =
    normalizeCatalog(
      catalog
    );

  const lowStock = [];
  let outOfStock = 0;
  let stockTracked = 0;

  for (
    const product of
    products
  ) {
    const type =
      String(
        product?.tipoVenta ||
          "unidad"
      );

    if (
      type ===
      "precio-libre"
    ) {
      continue;
    }

    stockTracked += 1;

    const stock =
      Math.max(
        0,
        toNumber(
          product?.stock
        )
      );

    if (stock <= 0) {
      outOfStock += 1;
    }

    const threshold =
      type === "peso"
        ? 1
        : 3;

    if (
      stock <=
      threshold
    ) {
      lowStock.push({
        nombre:
          String(
            product?.name ||
              "Producto"
          )
            .trim()
            .slice(0, 90),
        stock:
          Math.round(
            stock * 1000
          ) / 1000,
        unidad:
          type === "peso"
            ? String(
                product?.unidadMedida ||
                  "kg"
              )
            : "unidades",
      });
    }
  }

  lowStock.sort(
    (a, b) =>
      a.stock - b.stock
  );

  return {
    productosTotales:
      products.length,
    productosConStock:
      stockTracked,
    sinStock:
      outOfStock,
    stockBajo:
      lowStock.slice(
        0,
        15
      ),
  };
}

function summarizeReceivables(
  accounts
) {
  const rows =
    Array.isArray(accounts)
      ? accounts
      : [];

  const pending =
    rows.filter(
      (row) =>
        row?.estado !==
        "pagado"
    );

  return {
    cuentasPendientes:
      pending.length,
    saldoPendiente:
      roundMoney(
        pending.reduce(
          (
            sum,
            row
          ) =>
            sum +
            Math.max(
              0,
              toNumber(
                row?.saldoPendiente ??
                  row?.importePendiente
              )
            ),
          0
        )
      ),
  };
}

function summarizePayables(
  accounts
) {
  const rows =
    Array.isArray(accounts)
      ? accounts
      : [];

  const pending =
    rows.filter(
      (row) =>
        row?.estado !==
        "pagado"
    );

  return {
    cuentasPendientes:
      pending.length,
    saldoPendiente:
      roundMoney(
        pending.reduce(
          (
            sum,
            row
          ) =>
            sum +
            Math.max(
              0,
              toNumber(
                row?.saldoPendiente ??
                  row?.importePendiente
              )
            ),
          0
        )
      ),
  };
}

function summarizeCash(
  openSession
) {
  if (!openSession) {
    return {
      abierta: false,
    };
  }

  const paymentTotals =
    openSession
      ?.paymentTotals ||
    {};

  return {
    abierta: true,
    apertura:
      openSession.openTime ||
      null,
    fondoInicial:
      roundMoney(
        openSession.openAmount
      ),
    ventasTurno:
      roundMoney(
        openSession.totalSales
      ),
    operacionesTurno:
      Math.max(
        0,
        Math.trunc(
          toNumber(
            openSession.salesCount
          )
        )
      ),
    cobrosTurno: {
      efectivo:
        roundMoney(
          paymentTotals.efectivo
        ),
      transferencia:
        roundMoney(
          paymentTotals.transferencia
        ),
      qr:
        roundMoney(
          paymentTotals.qr
        ),
      tarjeta:
        roundMoney(
          paymentTotals.tarjeta
        ),
    },
  };
}

export function buildAssistantBusinessContext(
  pos
) {
  const now =
    new Date();

  const startToday =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

  const sales =
    Array.isArray(
      pos?.sales
    )
      ? pos.sales
      : [];

  const todaySales =
    getSalesSince(
      sales,
      startToday
    );

  const weekSales =
    getSalesSince(
      sales,
      now.getTime() -
        7 * DAY_MS
    );

  const monthSales =
    getSalesSince(
      sales,
      now.getTime() -
        30 * DAY_MS
    );

  const shoppingList =
    Array.isArray(
      pos?.shoppingList
    )
      ? pos.shoppingList
      : [];

  const promotions =
    Array.isArray(
      pos?.promotions
    )
      ? pos.promotions
      : [];

  return {
    version: 1,
    generadoEn:
      now.toISOString(),
    negocio:
      String(
        pos?.shopName ||
          "Mi Negocio"
      )
        .trim()
        .slice(0, 120),
    sincronizacion: {
      online:
        pos?.isOnline !==
        false,
      pendientesOffline:
        Math.max(
          0,
          Math.trunc(
            toNumber(
              pos?.pendingOfflineCount
            )
          )
        ),
    },
    ventas: {
      hoy:
        summarizeSales(
          todaySales
        ),
      ultimos7Dias:
        summarizeSales(
          weekSales
        ),
      ultimos30Dias:
        summarizeSales(
          monthSales
        ),
      productosDestacados30Dias:
        summarizeTopProducts(
          monthSales
        ),
    },
    inventario:
      summarizeInventory(
        pos?.catalog
      ),
    caja:
      summarizeCash(
        pos?.openSession
      ),
    cuentasPorCobrar:
      summarizeReceivables(
        pos?.accountsReceivable
      ),
    cuentasPorPagar:
      summarizePayables(
        pos?.accountsPayable
      ),
    compras: {
      pendientes:
        shoppingList.filter(
          (item) =>
            item?.estado !==
              "comprado" &&
            item?.completado !==
              true
        ).length,
    },
    promociones: {
      activas:
        promotions.filter(
          (promotion) =>
            promotion?.active !==
              false &&
            promotion?.activa !==
              false
        ).length,
    },
  };
}
