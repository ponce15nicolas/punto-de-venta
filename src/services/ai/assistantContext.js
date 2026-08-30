// src/services/ai/assistantContext.js
// Construye un resumen analítico y acotado del negocio para el asistente.
// No envía tickets completos ni datos personales de clientes/proveedores.

const DAY_MS = 24 * 60 * 60 * 1000;
const RESTOCK_TARGET_DAYS = 10;
const RESTOCK_WARNING_DAYS = 7;
const CASH_DIFF_TOLERANCE = 1;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number
    : fallback;
}

function optionalNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number)
    ? number
    : null;
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

function roundPercentage(value) {
  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * 10
    ) / 10
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

  if (
    typeof value === "object" &&
    Number.isFinite(
      Number(value?._seconds)
    )
  ) {
    return (
      Number(value._seconds) *
      1000
    );
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

function getSalesBetween(
  sales,
  startMs,
  endMs = Number.POSITIVE_INFINITY
) {
  return sales.filter(
    (sale) => {
      const ms =
        saleTimestampMs(
          sale
        );

      return (
        ms !== null &&
        ms >= startMs &&
        ms < endMs
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

  const count =
    sales.length;

  let grossProfit = 0;
  let profitRevenue = 0;
  let salesWithProfit = 0;

  for (const sale of sales) {
    const registeredProfit =
      optionalNumber(
        sale?.grossProfit
      );

    if (
      registeredProfit ===
        null ||
      sale?.profitCostStatus ===
        "missing"
    ) {
      continue;
    }

    grossProfit =
      roundMoney(
        grossProfit +
          registeredProfit
      );

    profitRevenue =
      roundMoney(
        profitRevenue +
          toNumber(
            sale?.total
          )
      );

    salesWithProfit += 1;
  }

  return {
    operaciones: count,
    facturacion: total,
    gananciaBrutaRegistrada:
      grossProfit,
    ventasConGananciaRegistrada:
      salesWithProfit,
    coberturaGananciaPct:
      count > 0
        ? roundPercentage(
            (
              salesWithProfit /
              count
            ) * 100
          )
        : 0,
    margenBrutoRegistradoPct:
      profitRevenue > 0
        ? roundPercentage(
            (
              grossProfit /
              profitRevenue
            ) * 100
          )
        : null,
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

function percentageChange(
  current,
  previous
) {
  const currentNumber =
    toNumber(current);

  const previousNumber =
    toNumber(previous);

  if (previousNumber === 0) {
    return currentNumber === 0
      ? 0
      : null;
  }

  return roundPercentage(
    (
      (
        currentNumber -
        previousNumber
      ) /
      Math.abs(
        previousNumber
      )
    ) * 100
  );
}

function compareSales(
  current,
  previous
) {
  return {
    facturacionDiferencia:
      roundMoney(
        current.facturacion -
          previous.facturacion
      ),
    facturacionVariacionPct:
      percentageChange(
        current.facturacion,
        previous.facturacion
      ),
    operacionesDiferencia:
      current.operaciones -
      previous.operaciones,
    operacionesVariacionPct:
      percentageChange(
        current.operaciones,
        previous.operaciones
      ),
    ticketPromedioDiferencia:
      roundMoney(
        current.ticketPromedio -
          previous.ticketPromedio
      ),
    ticketPromedioVariacionPct:
      percentageChange(
        current.ticketPromedio,
        previous.ticketPromedio
      ),
    gananciaBrutaDiferencia:
      roundMoney(
        current.gananciaBrutaRegistrada -
          previous.gananciaBrutaRegistrada
      ),
    gananciaBrutaVariacionPct:
      percentageChange(
        current.gananciaBrutaRegistrada,
        previous.gananciaBrutaRegistrada
      ),
  };
}

function productKey(item) {
  const barcode =
    String(
      item?.barcode ||
        ""
    ).trim();

  if (barcode) {
    return `barcode:${barcode}`;
  }

  const name =
    String(
      item?.name ||
        ""
    )
      .trim()
      .toLowerCase();

  if (name) {
    return `name:${name}`;
  }

  const id =
    String(
      item?.id ||
        ""
    ).trim();

  if (id) {
    return `id:${id}`;
  }

  return "name:producto";
}

function summarizeTopProducts(
  sales,
  limit = 8
) {
  const map =
    new Map();

  const periodRevenue =
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

  for (const sale of sales) {
    const seen =
      new Set();

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
        productKey(item);

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

      const cost =
        optionalNumber(
          item?.costSubtotal
        );

      const current =
        map.get(key) || {
          nombre: name,
          cantidad: 0,
          facturacion: 0,
          operaciones: 0,
          gananciaBrutaRegistrada:
            0,
          facturacionConCosto:
            0,
          lineasConCosto: 0,
        };

      current.cantidad =
        roundQuantity(
          current.cantidad +
            qty
        );

      current.facturacion =
        roundMoney(
          current.facturacion +
            revenue
        );

      if (
        !seen.has(key)
      ) {
        current.operaciones += 1;
        seen.add(key);
      }

      if (cost !== null) {
        current.gananciaBrutaRegistrada =
          roundMoney(
            current.gananciaBrutaRegistrada +
              revenue -
              cost
          );

        current.facturacionConCosto =
          roundMoney(
            current.facturacionConCosto +
              revenue
          );

        current.lineasConCosto += 1;
      }

      map.set(
        key,
        current
      );
    }
  }

  return Array.from(
    map.values()
  )
    .map(
      (item) => ({
        nombre:
          item.nombre,
        cantidad:
          item.cantidad,
        operaciones:
          item.operaciones,
        facturacion:
          item.facturacion,
        participacionFacturacionPct:
          periodRevenue > 0
            ? roundPercentage(
                (
                  item.facturacion /
                  periodRevenue
                ) * 100
              )
            : 0,
        gananciaBrutaRegistrada:
          item.lineasConCosto > 0
            ? item.gananciaBrutaRegistrada
            : null,
        margenBrutoRegistradoPct:
          item.facturacionConCosto > 0
            ? roundPercentage(
                (
                  item.gananciaBrutaRegistrada /
                  item.facturacionConCosto
                ) * 100
              )
            : null,
      })
    )
    .sort(
      (a, b) =>
        b.facturacion -
        a.facturacion
    )
    .slice(0, limit);
}

function summarizePeakHours(
  sales,
  limit = 3
) {
  const hours =
    new Map();

  for (const sale of sales) {
    const ms =
      saleTimestampMs(
        sale
      );

    if (ms === null) {
      continue;
    }

    const hour =
      new Date(ms)
        .getHours();

    const current =
      hours.get(hour) || {
        hour,
        operaciones: 0,
        facturacion: 0,
      };

    current.operaciones += 1;
    current.facturacion =
      roundMoney(
        current.facturacion +
          toNumber(
            sale?.total
          )
      );

    hours.set(
      hour,
      current
    );
  }

  return Array.from(
    hours.values()
  )
    .sort(
      (a, b) =>
        b.facturacion -
        a.facturacion
    )
    .slice(0, limit)
    .map(
      (item) => ({
        franja:
          `${String(
            item.hour
          ).padStart(
            2,
            "0"
          )}:00–${String(
            item.hour
          ).padStart(
            2,
            "0"
          )}:59`,
        operaciones:
          item.operaciones,
        facturacion:
          item.facturacion,
      })
    );
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

function summarizeDemand(
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
      const key =
        productKey(item);

      const current =
        map.get(key) || {
          cantidad: 0,
          facturacion: 0,
        };

      const qty =
        Math.max(
          0,
          toNumber(
            item?.qty,
            1
          )
        );

      current.cantidad =
        roundQuantity(
          current.cantidad +
            qty
        );

      current.facturacion =
        roundMoney(
          current.facturacion +
            toNumber(
              item?.subtotal,
              toNumber(
                item?.price
              ) * qty
            )
        );

      map.set(
        key,
        current
      );
    }
  }

  return map;
}

function inventoryPriority(
  stock,
  coverageDays,
  staticThreshold
) {
  if (stock <= 0) {
    return {
      score: 4,
      label: "crítica",
      motivo: "Sin stock",
    };
  }

  if (
    coverageDays !== null &&
    coverageDays <= 2
  ) {
    return {
      score: 4,
      label: "crítica",
      motivo:
        `Cobertura estimada ${roundPercentage(coverageDays)} días`,
    };
  }

  if (
    coverageDays !== null &&
    coverageDays <= 4
  ) {
    return {
      score: 3,
      label: "alta",
      motivo:
        `Cobertura estimada ${roundPercentage(coverageDays)} días`,
    };
  }

  if (
    coverageDays !== null &&
    coverageDays <=
      RESTOCK_WARNING_DAYS
  ) {
    return {
      score: 2,
      label: "media",
      motivo:
        `Cobertura estimada ${roundPercentage(coverageDays)} días`,
    };
  }

  if (
    stock <=
    staticThreshold
  ) {
    return {
      score: 1,
      label: "media",
      motivo: "Stock bajo",
    };
  }

  return null;
}

function suggestedRestockQuantity(
  type,
  stock,
  dailyRate
) {
  if (dailyRate <= 0) {
    return null;
  }

  const targetStock =
    dailyRate *
    RESTOCK_TARGET_DAYS;

  const missing =
    Math.max(
      0,
      targetStock - stock
    );

  if (missing <= 0) {
    return 0;
  }

  return type === "peso"
    ? roundQuantity(missing)
    : Math.ceil(missing);
}

function summarizeInventory(
  catalog,
  weekSales,
  monthSales
) {
  const products =
    normalizeCatalog(
      catalog
    );

  const demand7 =
    summarizeDemand(
      weekSales
    );

  const demand30 =
    summarizeDemand(
      monthSales
    );

  const lowStock = [];
  const restock = [];
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

    const staticThreshold =
      type === "peso"
        ? 1
        : 3;

    const name =
      String(
        product?.name ||
          "Producto"
      )
        .trim()
        .slice(0, 90);

    if (
      stock <=
      staticThreshold
    ) {
      lowStock.push({
        nombre: name,
        stock:
          roundQuantity(
            stock
          ),
        unidad:
          type === "peso"
            ? String(
                product?.unidadMedida ||
                  "kg"
              )
            : "unidades",
      });
    }

    const key =
      productKey(product);

    const sold7 =
      demand7.get(key)
        ?.cantidad || 0;

    const sold30 =
      demand30.get(key)
        ?.cantidad || 0;

    const daily7 =
      sold7 / 7;

    const daily30 =
      sold30 / 30;

    const dailyRate =
      daily7 > 0 &&
      daily30 > 0
        ? (
            daily7 * 0.7 +
            daily30 * 0.3
          )
        : Math.max(
            daily7,
            daily30
          );

    const coverageDays =
      dailyRate > 0
        ? stock /
          dailyRate
        : null;

    const priority =
      inventoryPriority(
        stock,
        coverageDays,
        staticThreshold
      );

    if (!priority) {
      continue;
    }

    restock.push({
      nombre: name,
      stockActual:
        roundQuantity(
          stock
        ),
      unidad:
        type === "peso"
          ? String(
              product?.unidadMedida ||
                "kg"
            )
          : "unidades",
      vendido7Dias:
        roundQuantity(
          sold7
        ),
      vendido30Dias:
        roundQuantity(
          sold30
        ),
      ritmoDiarioEstimado:
        dailyRate > 0
          ? roundQuantity(
              dailyRate
            )
          : 0,
      diasCobertura:
        coverageDays !== null
          ? roundPercentage(
              coverageDays
            )
          : null,
      sugeridoComprar:
        suggestedRestockQuantity(
          type,
          stock,
          dailyRate
        ),
      prioridad:
        priority.label,
      motivo:
        priority.motivo,
      _score:
        priority.score,
    });
  }

  lowStock.sort(
    (a, b) =>
      a.stock - b.stock
  );

  restock.sort(
    (a, b) => {
      if (
        b._score !==
        a._score
      ) {
        return (
          b._score -
          a._score
        );
      }

      const aCoverage =
        a.diasCobertura ??
        Number.POSITIVE_INFINITY;

      const bCoverage =
        b.diasCobertura ??
        Number.POSITIVE_INFINITY;

      return (
        aCoverage -
        bCoverage
      );
    }
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
        12
      ),
    reposicionSugerida:
      restock
        .slice(0, 12)
        .map(
          ({
            _score,
            ...item
          }) => item
        ),
    criterioReposicion:
      "Estimación orientativa: 70% del ritmo de los últimos 7 días + 30% del ritmo de los últimos 30 días cuando ambos existen, con objetivo de 10 días de cobertura. No reemplaza una decisión de compra.",
  };
}

function dayKeyFromDate(
  date
) {
  return [
    date.getFullYear(),
    String(
      date.getMonth() + 1
    ).padStart(2, "0"),
    String(
      date.getDate()
    ).padStart(2, "0"),
  ].join("-");
}

function normalizeDayKey(
  value
) {
  const text =
    String(
      value ||
        ""
    ).trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {
    return text;
  }

  const ms =
    toDateMs(value);

  if (ms === null) {
    return null;
  }

  return dayKeyFromDate(
    new Date(ms)
  );
}

function summarizeAccounts(
  accounts,
  now
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

  const todayKey =
    dayKeyFromDate(now);

  const inSevenDays =
    dayKeyFromDate(
      new Date(
        now.getTime() +
          7 * DAY_MS
      )
    );

  let overdueCount = 0;
  let overdueBalance = 0;
  let dueSoonCount = 0;
  let dueSoonBalance = 0;

  for (const row of pending) {
    const balance =
      Math.max(
        0,
        toNumber(
          row?.saldoPendiente ??
            row?.importePendiente
        )
      );

    const dueKey =
      normalizeDayKey(
        row?.vencimiento
      );

    if (!dueKey) {
      continue;
    }

    if (dueKey < todayKey) {
      overdueCount += 1;
      overdueBalance =
        roundMoney(
          overdueBalance +
            balance
        );
      continue;
    }

    if (
      dueKey >= todayKey &&
      dueKey <= inSevenDays
    ) {
      dueSoonCount += 1;
      dueSoonBalance =
        roundMoney(
          dueSoonBalance +
            balance
        );
    }
  }

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
    vencidas:
      overdueCount,
    saldoVencido:
      overdueBalance,
    vencenEn7Dias:
      dueSoonCount,
    saldoVenceEn7Dias:
      dueSoonBalance,
  };
}

function emptyPaymentTotals() {
  return {
    efectivo: 0,
    transferencia: 0,
    qr: 0,
    tarjeta: 0,
  };
}

function safePaymentTotals(
  value
) {
  const raw =
    value || {};

  return {
    efectivo:
      roundMoney(
        raw.efectivo
      ),
    transferencia:
      roundMoney(
        raw.transferencia
      ),
    qr:
      roundMoney(
        raw.qr
      ),
    tarjeta:
      roundMoney(
        raw.tarjeta
      ),
  };
}

function summarizeCurrentCash(
  pos
) {
  const openSession =
    pos?.openSession;

  if (!openSession) {
    return {
      abierta: false,
    };
  }

  let breakdown =
    null;

  try {
    if (
      typeof pos?.paymentBreakdown ===
      "function"
    ) {
      breakdown =
        pos.paymentBreakdown(
          openSession.id
        );
    }
  } catch {
    breakdown = null;
  }

  const saleTotals =
    safePaymentTotals(
      breakdown?.saleTotals ||
        openSession?.paymentTotals ||
        emptyPaymentTotals()
    );

  const receivableTotals =
    safePaymentTotals(
      breakdown
        ?.receivableTotals ||
        emptyPaymentTotals()
    );

  const payableTotals =
    safePaymentTotals(
      breakdown
        ?.payableTotals ||
        emptyPaymentTotals()
    );

  const combinedIncomeTotals =
    safePaymentTotals(
      breakdown?.totals ||
        openSession?.paymentTotals ||
        emptyPaymentTotals()
    );

  const opening =
    roundMoney(
      openSession.openAmount
    );

  const expectedCash =
    roundMoney(
      opening +
        saleTotals.efectivo +
        receivableTotals.efectivo -
        payableTotals.efectivo
    );

  const openMs =
    toDateMs(
      openSession.openTime
    );

  const durationHours =
    openMs !== null
      ? roundPercentage(
          Math.max(
            0,
            (
              Date.now() -
              openMs
            ) /
              (
                60 *
                60 *
                1000
              )
          )
        )
      : null;

  return {
    abierta: true,
    apertura:
      openSession.openTime ||
      null,
    duracionHoras:
      durationHours,
    fondoInicial:
      opening,
    ventasTurno:
      roundMoney(
        breakdown?.totalSales ??
          openSession.totalSales
      ),
    operacionesTurno:
      Array.isArray(
        breakdown?.sessSales
      )
        ? breakdown.sessSales.length
        : Math.max(
            0,
            Math.trunc(
              toNumber(
                openSession.salesCount
              )
            )
          ),
    ventasACuentaTurno:
      roundMoney(
        breakdown
          ?.totalCreditSales
      ),
    ingresosPorMedio:
      combinedIncomeTotals,
    egresosCuentasPorPagarPorMedio:
      payableTotals,
    efectivoEsperado:
      expectedCash,
    formulaEfectivoEsperado: {
      fondoInicial:
        opening,
      ventasEfectivo:
        saleTotals.efectivo,
      cobrosCuentasEfectivo:
        receivableTotals.efectivo,
      pagosProveedoresEfectivo:
        payableTotals.efectivo,
      resultado:
        expectedCash,
      descripcion:
        "fondo inicial + ventas en efectivo + cobros de cuentas en efectivo - pagos a proveedores en efectivo",
    },
    efectivoContadoActual:
      null,
    diferenciaActual:
      null,
    notaDiferenciaActual:
      "El POS todavía no conoce el efectivo contado mientras la caja permanece abierta; no se puede afirmar una diferencia actual hasta realizar el conteo.",
  };
}

function summarizeCashHistory(
  cashSessions
) {
  const rows =
    Array.isArray(
      cashSessions
    )
      ? cashSessions
      : [];

  const closed =
    rows
      .filter(
        (session) =>
          session?.status ===
            "closed" ||
          Boolean(
            session?.closeTime
          )
      )
      .map(
        (session) => {
          const expected =
            optionalNumber(
              session?.expectedAmount
            );

          const counted =
            optionalNumber(
              session?.counted ??
                session?.closeAmount
            );

          const explicitDiff =
            optionalNumber(
              session?.diff
            );

          const diff =
            explicitDiff !== null
              ? roundMoney(
                  explicitDiff
                )
              : expected !== null &&
                  counted !== null
                ? roundMoney(
                    counted -
                      expected
                  )
                : null;

          return {
            cierre:
              session?.closeTime ||
              null,
            esperado:
              expected !== null
                ? roundMoney(
                    expected
                  )
                : null,
            contado:
              counted !== null
                ? roundMoney(
                    counted
                  )
                : null,
            diferencia:
              diff,
            ventas:
              roundMoney(
                session?.totalSales
              ),
            operaciones:
              Math.max(
                0,
                Math.trunc(
                  toNumber(
                    session?.salesCount
                  )
                )
              ),
            _closeMs:
              toDateMs(
                session?.closeTime
              ) || 0,
          };
        }
      )
      .sort(
        (a, b) =>
          b._closeMs -
          a._closeMs
      );

  const sample =
    closed.slice(0, 10);

  let differenceCount = 0;
  let shortages = 0;
  let overages = 0;
  let net = 0;
  let absolute = 0;

  for (const row of sample) {
    const diff =
      row.diferencia;

    if (
      diff === null ||
      Math.abs(diff) <
        CASH_DIFF_TOLERANCE
    ) {
      continue;
    }

    differenceCount += 1;
    net =
      roundMoney(
        net + diff
      );
    absolute =
      roundMoney(
        absolute +
          Math.abs(diff)
      );

    if (diff < 0) {
      shortages =
        roundMoney(
          shortages +
            Math.abs(diff)
        );
    } else {
      overages =
        roundMoney(
          overages + diff
        );
    }
  }

  return {
    muestraUltimosCierres:
      sample.length,
    cierresConDiferencia:
      differenceCount,
    faltantesAcumulados:
      shortages,
    sobrantesAcumulados:
      overages,
    diferenciaNeta:
      net,
    diferenciaAbsoluta:
      absolute,
    diferenciaAbsolutaPromedio:
      differenceCount > 0
        ? roundMoney(
            absolute /
              differenceCount
          )
        : 0,
    ultimosCierres:
      closed
        .slice(0, 5)
        .map(
          ({
            _closeMs,
            ...row
          }) => row
        ),
  };
}

function buildAlerts({
  sync,
  inventory,
  salesComparison7,
  sales30,
  receivables,
  payables,
  currentCash,
  cashHistory,
}) {
  const alerts = [];

  if (
    sync.pendientesOffline > 0
  ) {
    alerts.push({
      id: "offline-pending",
      severidad: "alta",
      titulo:
        `${sync.pendientesOffline} ${sync.pendientesOffline === 1 ? "venta pendiente" : "ventas pendientes"} de sincronización`,
      detalle:
        "Los totales pueden cambiar cuando esas ventas se confirmen en la nube.",
      preguntaSugerida:
        "Analizá el estado de sincronización y decime qué datos del negocio pueden estar incompletos.",
    });
  }

  if (
    inventory.sinStock > 0
  ) {
    const names =
      inventory.reposicionSugerida
        .filter(
          (item) =>
            item.stockActual <= 0
        )
        .slice(0, 3)
        .map(
          (item) =>
            item.nombre
        )
        .join(", ");

    alerts.push({
      id: "out-of-stock",
      severidad: "alta",
      titulo:
        `${inventory.sinStock} ${inventory.sinStock === 1 ? "producto sin stock" : "productos sin stock"}`,
      detalle:
        names
          ? `Prioridad visible: ${names}.`
          : "Hay productos agotados en el inventario.",
      preguntaSugerida:
        "Ordená mis reposiciones por prioridad y decime cuánto conviene comprar según el ritmo reciente.",
    });
  } else {
    const urgentRestock =
      inventory.reposicionSugerida.filter(
        (item) =>
          item.prioridad ===
            "crítica" ||
          item.prioridad ===
            "alta"
      );

    if (
      urgentRestock.length > 0
    ) {
      alerts.push({
        id: "restock-priority",
        severidad: "media",
        titulo:
          `${urgentRestock.length} ${urgentRestock.length === 1 ? "producto necesita" : "productos necesitan"} reposición prioritaria`,
        detalle:
          urgentRestock
            .slice(0, 3)
            .map(
              (item) =>
                item.nombre
            )
            .join(", "),
        preguntaSugerida:
          "Revisá la reposición sugerida y armame una lista de compra priorizada.",
      });
    }
  }

  if (
    receivables.vencidas > 0
  ) {
    alerts.push({
      id: "receivables-overdue",
      severidad: "media",
      titulo:
        `${receivables.vencidas} ${receivables.vencidas === 1 ? "cuenta por cobrar vencida" : "cuentas por cobrar vencidas"}`,
      detalle:
        `Saldo vencido registrado: $${Math.round(receivables.saldoVencido).toLocaleString("es-AR")}.`,
      preguntaSugerida:
        "Analizá mis cuentas por cobrar vencidas y decime qué debería priorizar, sin inventar clientes que no estén en el resumen.",
    });
  }

  if (
    payables.vencidas > 0
  ) {
    alerts.push({
      id: "payables-overdue",
      severidad: "media",
      titulo:
        `${payables.vencidas} ${payables.vencidas === 1 ? "cuenta por pagar vencida" : "cuentas por pagar vencidas"}`,
      detalle:
        `Saldo vencido registrado: $${Math.round(payables.saldoVencido).toLocaleString("es-AR")}.`,
      preguntaSugerida:
        "Analizá mis cuentas por pagar vencidas y sugerime un orden de prioridad usando solamente los importes disponibles.",
    });
  }

  if (
    salesComparison7.facturacionVariacionPct !==
      null &&
    salesComparison7.facturacionVariacionPct <=
      -20
  ) {
    alerts.push({
      id: "sales-down",
      severidad: "media",
      titulo:
        `Facturación 7 días ${Math.abs(salesComparison7.facturacionVariacionPct)}% abajo`,
      detalle:
        "La comparación es contra los 7 días inmediatamente anteriores.",
      preguntaSugerida:
        "Explicame qué cambió en ventas durante los últimos 7 días frente a los 7 anteriores y qué debería observar.",
    });
  } else if (
    salesComparison7.facturacionVariacionPct !==
      null &&
    salesComparison7.facturacionVariacionPct >=
      20
  ) {
    alerts.push({
      id: "sales-up",
      severidad: "info",
      titulo:
        `Facturación 7 días +${salesComparison7.facturacionVariacionPct}%`,
      detalle:
        "Hay una mejora relevante frente a los 7 días anteriores.",
      preguntaSugerida:
        "Analizá qué productos y métricas explican el crecimiento de los últimos 7 días.",
    });
  }

  if (
    cashHistory.muestraUltimosCierres >=
      3 &&
    cashHistory.cierresConDiferencia >=
      2
  ) {
    alerts.push({
      id: "cash-differences",
      severidad: "media",
      titulo:
        `Diferencias en ${cashHistory.cierresConDiferencia} de los últimos ${cashHistory.muestraUltimosCierres} cierres`,
      detalle:
        `Diferencia absoluta acumulada: $${Math.round(cashHistory.diferenciaAbsoluta).toLocaleString("es-AR")}.`,
      preguntaSugerida:
        "Explicame las diferencias recientes de caja, separando los hechos registrados de las causas posibles.",
    });
  }

  if (
    currentCash.abierta &&
    currentCash.duracionHoras !==
      null &&
    currentCash.duracionHoras >=
      14
  ) {
    alerts.push({
      id: "long-open-cash",
      severidad: "info",
      titulo:
        `Caja abierta hace ${currentCash.duracionHoras} horas`,
      detalle:
        "Conviene revisar que el turno siga siendo el correcto antes de continuar acumulando operaciones.",
      preguntaSugerida:
        "Revisá el estado de mi caja abierta y resumime qué debería controlar antes del cierre.",
    });
  }

  if (
    sales30.margenBrutoRegistradoPct !==
      null &&
    sales30.margenBrutoRegistradoPct <
      0
  ) {
    alerts.push({
      id: "negative-margin",
      severidad: "alta",
      titulo:
        "Margen bruto registrado negativo en 30 días",
      detalle:
        "Revisá costos y precios de las ventas con costo registrado.",
      preguntaSugerida:
        "Analizá el margen bruto registrado de los últimos 30 días y señalame dónde debería revisar costos o precios.",
    });
  }

  const severityOrder = {
    alta: 3,
    media: 2,
    info: 1,
  };

  return alerts
    .sort(
      (a, b) =>
        toNumber(
          severityOrder[
            b.severidad
          ]
        ) -
        toNumber(
          severityOrder[
            a.severidad
          ]
        )
    )
    .slice(0, 8);
}

export function buildAssistantBusinessContext(
  pos
) {
  const now =
    new Date();

  const nowMs =
    now.getTime();

  const startToday =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

  const elapsedToday =
    Math.max(
      0,
      nowMs -
        startToday
    );

  const yesterdayStart =
    startToday - DAY_MS;

  const yesterdaySameTimeEnd =
    Math.min(
      startToday,
      yesterdayStart +
        elapsedToday
    );

  const sales =
    Array.isArray(
      pos?.sales
    )
      ? pos.sales
      : [];

  const todaySales =
    getSalesBetween(
      sales,
      startToday,
      nowMs + 1
    );

  const yesterdaySameTimeSales =
    getSalesBetween(
      sales,
      yesterdayStart,
      yesterdaySameTimeEnd +
        1
    );

  const weekStart =
    nowMs -
    7 * DAY_MS;

  const previousWeekStart =
    nowMs -
    14 * DAY_MS;

  const monthStart =
    nowMs -
    30 * DAY_MS;

  const previousMonthStart =
    nowMs -
    60 * DAY_MS;

  const weekSales =
    getSalesBetween(
      sales,
      weekStart,
      nowMs + 1
    );

  const previousWeekSales =
    getSalesBetween(
      sales,
      previousWeekStart,
      weekStart
    );

  const monthSales =
    getSalesBetween(
      sales,
      monthStart,
      nowMs + 1
    );

  const previousMonthSales =
    getSalesBetween(
      sales,
      previousMonthStart,
      monthStart
    );

  const todaySummary =
    summarizeSales(
      todaySales
    );

  const yesterdaySameTimeSummary =
    summarizeSales(
      yesterdaySameTimeSales
    );

  const weekSummary =
    summarizeSales(
      weekSales
    );

  const previousWeekSummary =
    summarizeSales(
      previousWeekSales
    );

  const monthSummary =
    summarizeSales(
      monthSales
    );

  const previousMonthSummary =
    summarizeSales(
      previousMonthSales
    );

  const inventory =
    summarizeInventory(
      pos?.catalog,
      weekSales,
      monthSales
    );

  const currentCash =
    summarizeCurrentCash(
      pos
    );

  const cashHistory =
    summarizeCashHistory(
      pos?.cashSessions
    );

  const receivables =
    summarizeAccounts(
      pos?.accountsReceivable,
      now
    );

  const payables =
    summarizeAccounts(
      pos?.accountsPayable,
      now
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

  const sync = {
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
  };

  const todayComparison =
    compareSales(
      todaySummary,
      yesterdaySameTimeSummary
    );

  const weekComparison =
    compareSales(
      weekSummary,
      previousWeekSummary
    );

  const monthComparison =
    compareSales(
      monthSummary,
      previousMonthSummary
    );

  const alerts =
    buildAlerts({
      sync,
      inventory,
      salesComparison7:
        weekComparison,
      sales30:
        monthSummary,
      receivables,
      payables,
      currentCash,
      cashHistory,
    });

  return {
    version: 2,
    generadoEn:
      now.toISOString(),
    zonaHoraria:
      Intl.DateTimeFormat()
        .resolvedOptions()
        .timeZone || null,
    negocio:
      String(
        pos?.shopName ||
          "Mi Negocio"
      )
        .trim()
        .slice(0, 120),
    sincronizacion:
      sync,
    periodos: {
      hoy: {
        desde:
          new Date(
            startToday
          ).toISOString(),
        hasta:
          now.toISOString(),
      },
      ayerMismaHora: {
        desde:
          new Date(
            yesterdayStart
          ).toISOString(),
        hasta:
          new Date(
            yesterdaySameTimeEnd
          ).toISOString(),
        nota:
          "Se compara el avance de hoy contra ayer hasta la misma hora aproximada para evitar comparar un día parcial con un día completo.",
      },
      ultimos7Dias: {
        desde:
          new Date(
            weekStart
          ).toISOString(),
        hasta:
          now.toISOString(),
      },
      sieteDiasAnteriores: {
        desde:
          new Date(
            previousWeekStart
          ).toISOString(),
        hasta:
          new Date(
            weekStart
          ).toISOString(),
      },
      ultimos30Dias: {
        desde:
          new Date(
            monthStart
          ).toISOString(),
        hasta:
          now.toISOString(),
      },
      treintaDiasAnteriores: {
        desde:
          new Date(
            previousMonthStart
          ).toISOString(),
        hasta:
          new Date(
            monthStart
          ).toISOString(),
      },
    },
    ventas: {
      hoy:
        todaySummary,
      ayerMismaHora:
        yesterdaySameTimeSummary,
      ultimos7Dias:
        weekSummary,
      sieteDiasAnteriores:
        previousWeekSummary,
      ultimos30Dias:
        monthSummary,
      treintaDiasAnteriores:
        previousMonthSummary,
      comparaciones: {
        hoyVsAyerMismaHora:
          todayComparison,
        ultimos7Vs7Anteriores:
          weekComparison,
        ultimos30Vs30Anteriores:
          monthComparison,
        notaVariaciones:
          "Una variación porcentual null significa que el período anterior fue 0 y no existe una base porcentual válida.",
      },
      productosDestacados7Dias:
        summarizeTopProducts(
          weekSales
        ),
      productosDestacados30Dias:
        summarizeTopProducts(
          monthSales
        ),
      horasPico7Dias:
        summarizePeakHours(
          weekSales
        ),
    },
    inventario:
      inventory,
    caja: {
      actual:
        currentCash,
      historial:
        cashHistory,
    },
    cuentasPorCobrar:
      receivables,
    cuentasPorPagar:
      payables,
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
    alertas:
      alerts,
  };
}
