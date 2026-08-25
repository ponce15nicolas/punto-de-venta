// src/pages/Ganancias.jsx
//
// Rentabilidad basada en ventas registradas.
// La ganancia usa el costo guardado dentro de cada venta para evitar
// que una edición futura del costo cambie resultados históricos.

import {
  useMemo,
  useState,
} from "react";

import { motion } from "motion/react";

import { money } from "../lib/format";
import Modal from "../components/Modal";
import { useOperator } from "../components/OperatorGate";

const PERIODS = [
  { id: "today", label: "Hoy" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
  { id: "all", label: "Todo" },
];

const SORTS = [
  { id: "profit", label: "Mayor ganancia" },
  { id: "sales", label: "Mayor venta" },
  { id: "quantity", label: "Mayor cantidad" },
  { id: "name", label: "Nombre" },
];

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

function getTipoVenta(item) {
  const tipo = item?.tipoVenta;

  if (
    tipo === "peso" ||
    tipo === "precio-libre"
  ) {
    return tipo;
  }

  return "unidad";
}

function getItemRevenue(item) {
  const subtotal = Number(item?.subtotal);

  if (Number.isFinite(subtotal)) {
    return roundMoney(subtotal);
  }

  return roundMoney(
    toNumber(item?.qty) *
      toNumber(item?.price)
  );
}

function getItemCostSnapshot(item) {
  const rawSubtotal =
    item?.costSubtotal;

  const storedSubtotal =
    rawSubtotal === null ||
    rawSubtotal === undefined ||
    rawSubtotal === ""
      ? Number.NaN
      : Number(rawSubtotal);

  if (Number.isFinite(storedSubtotal)) {
    return {
      known: true,
      value: roundMoney(
        Math.max(0, storedSubtotal)
      ),
    };
  }

  const rawCost = item?.cost;

  const storedCost =
    rawCost === null ||
    rawCost === undefined ||
    rawCost === ""
      ? Number.NaN
      : Number(rawCost);

  if (Number.isFinite(storedCost)) {
    return {
      known: true,
      value: roundMoney(
        Math.max(0, storedCost) *
          Math.max(0, toNumber(item?.qty))
      ),
    };
  }

  return {
    known: false,
    value: 0,
  };
}

function getSaleRevenue(sale) {
  const total = Number(sale?.total);

  if (Number.isFinite(total)) {
    return roundMoney(total);
  }

  return roundMoney(
    (Array.isArray(sale?.items)
      ? sale.items
      : []
    ).reduce(
      (sum, item) =>
        sum + getItemRevenue(item),
      0
    )
  );
}

function getSaleProfitSnapshot(sale) {
  const revenue = getSaleRevenue(sale);
  const rawStoredCost =
    sale?.totalCost;

  const storedCost =
    rawStoredCost === null ||
    rawStoredCost === undefined ||
    rawStoredCost === ""
      ? Number.NaN
      : Number(rawStoredCost);

  if (Number.isFinite(storedCost)) {
    const cost = roundMoney(
      Math.max(0, storedCost)
    );

    return {
      known: true,
      revenue,
      cost,
      profit: roundMoney(
        revenue - cost
      ),
    };
  }

  const rawStoredProfit =
    sale?.grossProfit;

  const storedProfit =
    rawStoredProfit === null ||
    rawStoredProfit === undefined ||
    rawStoredProfit === ""
      ? Number.NaN
      : Number(rawStoredProfit);

  if (Number.isFinite(storedProfit)) {
    const profit = roundMoney(
      storedProfit
    );

    return {
      known: true,
      revenue,
      cost: roundMoney(
        revenue - profit
      ),
      profit,
    };
  }

  const items = Array.isArray(
    sale?.items
  )
    ? sale.items
    : [];

  if (items.length === 0) {
    return {
      known: false,
      revenue,
      cost: 0,
      profit: 0,
    };
  }

  let cost = 0;

  for (const item of items) {
    const snapshot =
      getItemCostSnapshot(item);

    if (!snapshot.known) {
      return {
        known: false,
        revenue,
        cost: 0,
        profit: 0,
      };
    }

    cost += snapshot.value;
  }

  cost = roundMoney(cost);

  return {
    known: true,
    revenue,
    cost,
    profit: roundMoney(
      revenue - cost
    ),
  };
}

function getSaleDate(sale) {
  const value =
    sale?.timestamp ||
    sale?.createdAt ||
    null;

  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function startOfToday() {
  const date = new Date();

  date.setHours(0, 0, 0, 0);

  return date;
}

function getPeriodStart(period) {
  if (period === "all") {
    return null;
  }

  const today = startOfToday();

  if (period === "today") {
    return today;
  }

  const days =
    period === "7d"
      ? 6
      : 29;

  const start = new Date(today);
  start.setDate(start.getDate() - days);

  return start;
}

function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0%";
  }

  return `${number.toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }
  )}%`;
}

function formatQuantity(value, tipoVenta, lines) {
  if (tipoVenta === "precio-libre") {
    return `${lines} ${
      lines === 1
        ? "venta"
        : "ventas"
    }`;
  }

  const formatted = roundQuantity(
    value
  ).toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }
  );

  return tipoVenta === "peso"
    ? `${formatted} kg`
    : `${formatted} u.`;
}

function makeProductKey(item) {
  const barcode = String(
    item?.barcode || ""
  ).trim();

  if (barcode) {
    return barcode;
  }

  return `name:${String(
    item?.name || "Producto"
  )
    .trim()
    .toLowerCase()}`;
}


function getSaleCostStatus(
  sale,
  snapshot = null
) {
  const safeSnapshot =
    snapshot ||
    getSaleProfitSnapshot(sale);

  if (!safeSnapshot.known) {
    return "pending";
  }

  const stored = String(
    sale?.profitCostStatus ||
    ""
  )
    .trim()
    .toLowerCase();

  if (
    stored === "estimated" ||
    stored === "migrated" ||
    stored === "exact"
  ) {
    return stored;
  }

  const items = Array.isArray(
    sale?.items
  )
    ? sale.items
    : [];

  if (
    items.some(
      (item) =>
        item?.costSource ===
        "estimated"
    )
  ) {
    return "estimated";
  }

  if (
    items.some(
      (item) =>
        item?.costSource ===
        "migrated"
    )
  ) {
    return "migrated";
  }

  return "exact";
}

function getCatalogProduct(
  catalog,
  item
) {
  const barcode = String(
    item?.barcode || ""
  ).trim();

  if (
    barcode &&
    catalog?.[barcode]
  ) {
    return catalog[barcode];
  }

  return null;
}

function buildHistoricalData(
  sales,
  catalog
) {
  const groups = new Map();
  const affectedSales = new Set();
  let autoFreePriceLines = 0;

  for (const sale of sales) {
    const saleSnapshot =
      getSaleProfitSnapshot(sale);

    if (saleSnapshot.known) {
      continue;
    }

    const items = Array.isArray(
      sale?.items
    )
      ? sale.items
      : [];

    let saleAffected = false;

    for (const item of items) {
      const snapshot =
        getItemCostSnapshot(item);

      if (snapshot.known) {
        continue;
      }

      saleAffected = true;

      if (
        getTipoVenta(item) ===
        "precio-libre"
      ) {
        autoFreePriceLines += 1;
        continue;
      }

      const key = makeProductKey(
        item
      );

      const current =
        groups.get(key) || {
          key,
          barcode:
            String(
              item?.barcode || ""
            ).trim() || null,
          name:
            String(
              item?.name ||
                "Producto"
            ).trim() ||
            "Producto",
          tipoVenta:
            getTipoVenta(item),
          lines: 0,
          quantity: 0,
          revenue: 0,
          sales: new Set(),
          currentCost: null,
        };

      current.lines += 1;
      current.quantity =
        roundQuantity(
          current.quantity +
            Math.max(
              0,
              toNumber(
                item?.qty
              )
            )
        );
      current.revenue =
        roundMoney(
          current.revenue +
          getItemRevenue(item)
        );

      if (sale?.id) {
        current.sales.add(
          sale.id
        );
      }

      const catalogProduct =
        getCatalogProduct(
          catalog,
          item
        );

      if (catalogProduct) {
        const rawCost =
          catalogProduct?.cost;

        const cost =
          rawCost === null ||
          rawCost === undefined ||
          rawCost === ""
            ? Number.NaN
            : Number(rawCost);

        if (
          Number.isFinite(cost) &&
          cost >= 0
        ) {
          current.currentCost =
            roundMoney(cost);
        }
      }

      groups.set(key, current);
    }

    if (saleAffected) {
      affectedSales.add(
        sale?.id ||
        sale?.timestamp ||
        `sale-${affectedSales.size}`
      );
    }
  }

  return {
    salesCount:
      affectedSales.size,
    autoFreePriceLines,
    groups:
      [...groups.values()]
        .map((group) => ({
          ...group,
          salesCount:
            group.sales.size,
          sales: undefined,
        }))
        .sort((a, b) =>
          b.revenue - a.revenue
        ),
  };
}

function createMigrationDraft(groups) {
  const draft = {};

  for (const group of groups) {
    draft[group.key] = {
      source: "migrated",
      periods: [
        {
          from: "",
          to: "",
          cost: "",
        },
      ],
    };
  }

  return draft;
}

function dateOnlyToStartMs(value) {
  const clean = String(
    value || ""
  ).trim();

  if (!clean) {
    return null;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      clean
    );

  if (!match) {
    return Number.NaN;
  }

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0,
    0,
    0,
    0
  );

  return date.getTime();
}

function dateOnlyToEndMs(value) {
  const start =
    dateOnlyToStartMs(value);

  if (start === null) {
    return null;
  }

  if (!Number.isFinite(start)) {
    return Number.NaN;
  }

  const date = new Date(start);
  date.setHours(
    23,
    59,
    59,
    999
  );

  return date.getTime();
}

function normalizeMigrationRules(
  historicalData,
  draft
) {
  const rules = [];
  const errors = [];

  for (
    const group of
    historicalData.groups
  ) {
    const config =
      draft?.[group.key];

    if (!config) {
      continue;
    }

    if (
      config.source ===
      "estimated"
    ) {
      if (
        !Number.isFinite(
          group.currentCost
        ) ||
        group.currentCost < 0
      ) {
        errors.push(
          `${group.name}: no tiene un costo actual válido.`
        );
        continue;
      }

      rules.push({
        productKey:
          group.key,
        productName:
          group.name,
        source:
          "estimated",
        periods: [
          {
            fromMs: null,
            toMs: null,
            cost:
              group.currentCost,
          },
        ],
      });

      continue;
    }

    const rows =
      Array.isArray(
        config.periods
      )
        ? config.periods
        : [];

    const hasAnyInput =
      rows.some(
        (row) =>
          String(
            row?.cost || ""
          ).trim() ||
          String(
            row?.from || ""
          ).trim() ||
          String(
            row?.to || ""
          ).trim()
      );

    if (!hasAnyInput) {
      continue;
    }

    const periods = [];
    let invalid = false;

    rows.forEach(
      (row, index) => {
        const costText =
          String(
            row?.cost ?? ""
          )
            .trim()
            .replace(",", ".");

        const cost =
          Number(costText);

        if (
          !costText ||
          !Number.isFinite(cost) ||
          cost < 0
        ) {
          errors.push(
            `${group.name}: costo inválido en el período ${index + 1}.`
          );
          invalid = true;
          return;
        }

        const fromMs =
          dateOnlyToStartMs(
            row?.from
          );

        const toMs =
          dateOnlyToEndMs(
            row?.to
          );

        if (
          Number.isNaN(fromMs) ||
          Number.isNaN(toMs) ||
          (
            fromMs !== null &&
            toMs !== null &&
            fromMs > toMs
          )
        ) {
          errors.push(
            `${group.name}: revisá las fechas del período ${index + 1}.`
          );
          invalid = true;
          return;
        }

        periods.push({
          fromMs,
          toMs,
          cost:
            roundMoney(cost),
        });
      }
    );

    if (invalid) {
      continue;
    }

    const ordered = periods
      .slice()
      .sort(
        (a, b) =>
          (a.fromMs ??
            Number.NEGATIVE_INFINITY) -
          (b.fromMs ??
            Number.NEGATIVE_INFINITY)
      );

    for (
      let index = 1;
      index < ordered.length;
      index += 1
    ) {
      const previousEnd =
        ordered[index - 1]
          .toMs ??
        Number.POSITIVE_INFINITY;

      const currentStart =
        ordered[index]
          .fromMs ??
        Number.NEGATIVE_INFINITY;

      if (
        previousEnd >=
        currentStart
      ) {
        errors.push(
          `${group.name}: los períodos se superponen.`
        );
        invalid = true;
        break;
      }
    }

    if (
      !invalid &&
      ordered.length > 0
    ) {
      rules.push({
        productKey:
          group.key,
        productName:
          group.name,
        source:
          "migrated",
        periods:
          ordered,
      });
    }
  }

  return {
    rules,
    errors,
  };
}

function findMigrationPeriod(
  rule,
  saleTime
) {
  const time =
    saleTime?.getTime?.();

  for (const period of rule.periods) {
    const hasFrom =
      period.fromMs !== null;
    const hasTo =
      period.toMs !== null;

    if (
      (hasFrom || hasTo) &&
      !Number.isFinite(time)
    ) {
      continue;
    }

    if (
      hasFrom &&
      time < period.fromMs
    ) {
      continue;
    }

    if (
      hasTo &&
      time > period.toMs
    ) {
      continue;
    }

    return period;
  }

  return null;
}

function buildMigrationPreview(
  sales,
  rules
) {
  const ruleMap = new Map(
    rules.map((rule) => [
      rule.productKey,
      rule,
    ])
  );

  let candidateSales = 0;
  let updatedSales = 0;
  let completedSales = 0;
  let remainingSales = 0;
  let updatedLines = 0;
  let migratedLines = 0;
  let estimatedLines = 0;
  let addedCost = 0;
  let completedProfit = 0;

  for (const sale of sales) {
    const snapshot =
      getSaleProfitSnapshot(sale);

    if (snapshot.known) {
      continue;
    }

    const items = Array.isArray(
      sale?.items
    )
      ? sale.items
      : [];

    if (items.length === 0) {
      continue;
    }

    candidateSales += 1;

    const saleDate =
      getSaleDate(sale);

    let changed = false;
    let complete = true;
    let saleCost = 0;

    for (const item of items) {
      const existing =
        getItemCostSnapshot(item);

      if (existing.known) {
        saleCost +=
          existing.value;
        continue;
      }

      if (
        getTipoVenta(item) ===
        "precio-libre"
      ) {
        changed = true;
        updatedLines += 1;
        continue;
      }

      const rule =
        ruleMap.get(
          makeProductKey(item)
        );

      const period =
        rule
          ? findMigrationPeriod(
              rule,
              saleDate
            )
          : null;

      if (!period) {
        complete = false;
        continue;
      }

      const subtotal =
        roundMoney(
          Math.max(
            0,
            toNumber(item?.qty)
          ) *
          period.cost
        );

      saleCost += subtotal;
      addedCost =
        roundMoney(
          addedCost + subtotal
        );
      updatedLines += 1;
      changed = true;

      if (
        rule.source ===
        "estimated"
      ) {
        estimatedLines += 1;
      } else {
        migratedLines += 1;
      }
    }

    if (changed) {
      updatedSales += 1;
    }

    if (complete) {
      completedSales += 1;
      completedProfit =
        roundMoney(
          completedProfit +
          getSaleRevenue(sale) -
          saleCost
        );
    } else {
      remainingSales += 1;
    }
  }

  return {
    candidateSales,
    updatedSales,
    completedSales,
    remainingSales,
    updatedLines,
    migratedLines,
    estimatedLines,
    addedCost,
    completedProfit,
  };
}

export default function Ganancias({ pos }) {
  const { esAdministrador } =
    useOperator();

  const [period, setPeriod] =
    useState("today");

  const [search, setSearch] =
    useState("");

  const [sort, setSort] =
    useState("profit");

  const [migrationOpen, setMigrationOpen] =
    useState(false);

  const [migrationDraft, setMigrationDraft] =
    useState({});

  const [migrationSaving, setMigrationSaving] =
    useState(false);

  const sales = Array.isArray(
    pos?.sales
  )
    ? pos.sales
    : [];

  const catalog =
    pos?.catalog || {};

  const historicalData =
    useMemo(
      () =>
        buildHistoricalData(
          sales,
          catalog
        ),
      [sales, catalog]
    );

  const migrationConfig =
    useMemo(
      () =>
        normalizeMigrationRules(
          historicalData,
          migrationDraft
        ),
      [
        historicalData,
        migrationDraft,
      ]
    );

  const migrationPreview =
    useMemo(
      () =>
        buildMigrationPreview(
          sales,
          migrationConfig.rules
        ),
      [
        sales,
        migrationConfig.rules,
      ]
    );

  function openHistoricalMigration() {
    setMigrationDraft(
      createMigrationDraft(
        historicalData.groups
      )
    );
    setMigrationOpen(true);
  }

  function updateMigrationSource(
    key,
    source
  ) {
    setMigrationDraft((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {
          periods: [
            {
              from: "",
              to: "",
              cost: "",
            },
          ],
        }),
        source,
      },
    }));
  }

  function updateMigrationPeriod(
    key,
    index,
    field,
    value
  ) {
    setMigrationDraft((current) => {
      const config =
        current[key] || {
          source: "migrated",
          periods: [],
        };

      const periods = [
        ...(config.periods || []),
      ];

      periods[index] = {
        ...(periods[index] || {
          from: "",
          to: "",
          cost: "",
        }),
        [field]: value,
      };

      return {
        ...current,
        [key]: {
          ...config,
          periods,
        },
      };
    });
  }

  function addMigrationPeriod(key) {
    setMigrationDraft((current) => {
      const config =
        current[key] || {
          source: "migrated",
          periods: [],
        };

      return {
        ...current,
        [key]: {
          ...config,
          periods: [
            ...(config.periods || []),
            {
              from: "",
              to: "",
              cost: "",
            },
          ],
        },
      };
    });
  }

  function removeMigrationPeriod(
    key,
    index
  ) {
    setMigrationDraft((current) => {
      const config =
        current[key];

      if (!config) {
        return current;
      }

      const periods =
        (config.periods || [])
          .filter(
            (_, rowIndex) =>
              rowIndex !== index
          );

      return {
        ...current,
        [key]: {
          ...config,
          periods:
            periods.length > 0
              ? periods
              : [
                  {
                    from: "",
                    to: "",
                    cost: "",
                  },
                ],
        },
      };
    });
  }

  function estimateAllWithCurrentCost() {
    setMigrationDraft((current) => {
      const next = {
        ...current,
      };

      for (
        const group of
        historicalData.groups
      ) {
        if (
          !Number.isFinite(
            group.currentCost
          ) ||
          group.currentCost <= 0
        ) {
          continue;
        }

        next[group.key] = {
          ...(next[group.key] || {}),
          source: "estimated",
          periods: [
            {
              from: "",
              to: "",
              cost:
                String(
                  group.currentCost
                ),
            },
          ],
        };
      }

      return next;
    });
  }

  async function applyHistoricalMigration() {
    if (migrationSaving) {
      return;
    }

    if (migrationConfig.errors.length > 0) {
      pos?.showToast?.(
        migrationConfig.errors[0],
        true
      );
      return;
    }

    if (
      migrationConfig.rules.length === 0 &&
      historicalData.autoFreePriceLines === 0
    ) {
      pos?.showToast?.(
        "Configurá al menos un costo histórico",
        true
      );
      return;
    }

    const confirmMessage =
      `Se actualizarán hasta ${migrationPreview.updatedSales} ${migrationPreview.updatedSales === 1 ? "venta histórica" : "ventas históricas"}. Los costos ya registrados no se modificarán. ¿Continuar?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    if (
      typeof pos?.migrateHistoricalProfits !==
      "function"
    ) {
      pos?.showToast?.(
        "La migración histórica no está disponible",
        true
      );
      return;
    }

    setMigrationSaving(true);

    try {
      const result =
        await pos.migrateHistoricalProfits(
          migrationConfig.rules
        );

      if (result) {
        setMigrationOpen(false);
      }
    } finally {
      setMigrationSaving(false);
    }
  }

  const periodSales = useMemo(() => {
    const start = getPeriodStart(
      period
    );

    if (!start) {
      return [...sales];
    }

    return sales.filter((sale) => {
      const date = getSaleDate(sale);

      return date && date >= start;
    });
  }, [
    sales,
    period,
  ]);

  const summary = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let profit = 0;
    let knownRevenue = 0;
    let unknownRevenue = 0;
    let unknownSales = 0;
    let exactSales = 0;
    let migratedSales = 0;
    let estimatedSales = 0;
    let productLines = 0;
    const zeroCostProducts =
      new Set();

    for (const sale of periodSales) {
      const snapshot =
        getSaleProfitSnapshot(sale);

      revenue += snapshot.revenue;

      if (snapshot.known) {
        cost += snapshot.cost;
        profit += snapshot.profit;
        knownRevenue += snapshot.revenue;

        const costStatus =
          getSaleCostStatus(
            sale,
            snapshot
          );

        if (
          costStatus ===
          "estimated"
        ) {
          estimatedSales += 1;
        } else if (
          costStatus ===
          "migrated"
        ) {
          migratedSales += 1;
        } else {
          exactSales += 1;
        }
      } else {
        unknownSales += 1;
        unknownRevenue += snapshot.revenue;
      }

      const saleItems = Array.isArray(
        sale?.items
      )
        ? sale.items
        : [];

      productLines +=
        saleItems.length;

      for (const item of saleItems) {
        const costSnapshot =
          getItemCostSnapshot(item);

        if (
          getTipoVenta(item) !==
            "precio-libre" &&
          costSnapshot.known &&
          costSnapshot.value === 0 &&
          getItemRevenue(item) > 0
        ) {
          zeroCostProducts.add(
            makeProductKey(item)
          );
        }
      }
    }

    revenue = roundMoney(revenue);
    cost = roundMoney(cost);
    profit = roundMoney(profit);
    knownRevenue = roundMoney(
      knownRevenue
    );
    unknownRevenue = roundMoney(
      unknownRevenue
    );

    const margin =
      knownRevenue > 0
        ? (
            profit /
            knownRevenue
          ) * 100
        : 0;

    const coverage =
      revenue > 0
        ? (
            knownRevenue /
            revenue
          ) * 100
        : 100;

    return {
      revenue,
      cost,
      profit,
      knownRevenue,
      unknownRevenue,
      unknownSales,
      exactSales,
      migratedSales,
      estimatedSales,
      margin,
      coverage,
      tickets: periodSales.length,
      productLines,
      zeroCostProducts:
        zeroCostProducts.size,
      averageTicket:
        periodSales.length > 0
          ? roundMoney(
              revenue /
                periodSales.length
            )
          : 0,
    };
  }, [periodSales]);

  const products = useMemo(() => {
    const map = new Map();

    for (const sale of periodSales) {
      const items = Array.isArray(
        sale?.items
      )
        ? sale.items
        : [];

      for (const item of items) {
        const key = makeProductKey(
          item
        );

        const tipoVenta =
          getTipoVenta(item);

        const revenue =
          getItemRevenue(item);

        const costSnapshot =
          getItemCostSnapshot(item);

        const current =
          map.get(key) || {
            key,
            barcode:
              String(
                item?.barcode || ""
              ).trim() || null,
            name:
              String(
                item?.name ||
                  "Producto"
              ).trim() ||
              "Producto",
            tipoVenta,
            quantity: 0,
            lines: 0,
            revenue: 0,
            knownRevenue: 0,
            unknownRevenue: 0,
            cost: 0,
            profit: 0,
            unknownLines: 0,
          };

        current.lines += 1;
        current.quantity =
          roundQuantity(
            current.quantity +
              Math.max(
                0,
                toNumber(item?.qty)
              )
          );

        current.revenue =
          roundMoney(
            current.revenue +
              revenue
          );

        if (costSnapshot.known) {
          current.knownRevenue =
            roundMoney(
              current.knownRevenue +
                revenue
            );

          current.cost =
            roundMoney(
              current.cost +
                costSnapshot.value
            );

          current.profit =
            roundMoney(
              current.profit +
                revenue -
                costSnapshot.value
            );
        } else {
          current.unknownLines += 1;
          current.unknownRevenue =
            roundMoney(
              current.unknownRevenue +
                revenue
            );
        }

        map.set(key, current);
      }
    }

    const query = String(
      search || ""
    )
      .trim()
      .toLowerCase();

    const result = [...map.values()]
      .filter((product) => {
        if (!query) {
          return true;
        }

        return (
          product.name
            .toLowerCase()
            .includes(query) ||
          String(
            product.barcode || ""
          )
            .toLowerCase()
            .includes(query)
        );
      })
      .map((product) => ({
        ...product,
        margin:
          product.knownRevenue > 0
            ? (
                product.profit /
                product.knownRevenue
              ) * 100
            : 0,
      }));

    result.sort((a, b) => {
      if (sort === "sales") {
        return b.revenue - a.revenue;
      }

      if (sort === "quantity") {
        return b.quantity - a.quantity;
      }

      if (sort === "name") {
        return a.name.localeCompare(
          b.name,
          "es",
          {
            sensitivity: "base",
          }
        );
      }

      return b.profit - a.profit;
    });

    return result;
  }, [
    periodSales,
    search,
    sort,
  ]);

  const topProduct =
    products.length > 0
      ? products
          .filter(
            (product) =>
              product.knownRevenue > 0
          )
          .slice()
          .sort(
            (a, b) =>
              b.profit - a.profit
          )[0] || null
      : null;

  return (
    <div className="pb-3">
      <section
        className="
          mb-5 overflow-hidden rounded-[28px]
          bg-white text-[#111318]
          shadow-[0_18px_50px_rgba(0,0,0,0.18)]
        "
      >
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className="
                  text-[10px] font-extrabold uppercase
                  tracking-[0.16em] text-[#B98700]
                "
              >
                Rentabilidad
              </p>

              <h2
                className="
                  mt-1 text-xl font-black
                  tracking-[-0.02em] text-[#111318]
                "
              >
                Ganancias
              </h2>

              <p className="mt-1 text-sm leading-relaxed text-black/45">
                Medí ventas, costo de mercadería y ganancia bruta usando el costo histórico de cada venta.
              </p>
            </div>

            <div
              className="
                grid h-11 w-11 shrink-0 place-items-center
                rounded-2xl bg-[#FFF5CC] text-[#9A7100]
              "
            >
              <ProfitIcon className="h-5 w-5" />
            </div>
          </div>

          <div className="my-5 h-[3px] rounded-full bg-[#FFC61A]" />

          <div className="grid grid-cols-2 gap-2.5">
            <SummaryStat
              label="Ventas"
              value={money(summary.revenue)}
              icon={<SalesIcon className="h-4 w-4" />}
            />

            <SummaryStat
              label="Costo mercadería"
              value={money(summary.cost)}
              icon={<BoxIcon className="h-4 w-4" />}
            />

            <SummaryStat
              label={
                summary.unknownSales > 0
                  ? "Ganancia calculada"
                  : "Ganancia bruta"
              }
              value={money(summary.profit)}
              icon={<ProfitIcon className="h-4 w-4" />}
              highlight
            />

            <SummaryStat
              label="Margen bruto"
              value={formatPercent(summary.margin)}
              icon={<PercentIcon className="h-4 w-4" />}
              highlight
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniStat
              label="Tickets"
              value={summary.tickets}
            />
            <MiniStat
              label="Ítems"
              value={summary.productLines}
            />
            <MiniStat
              label="Ticket prom."
              value={money(
                summary.averageTicket
              )}
            />
          </div>

          {(summary.exactSales > 0 ||
            summary.migratedSales > 0 ||
            summary.estimatedSales > 0) && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <MiniStat
                label="Exactas"
                value={summary.exactSales}
              />
              <MiniStat
                label="Migradas"
                value={summary.migratedSales}
              />
              <MiniStat
                label="Estimadas"
                value={summary.estimatedSales}
              />
            </div>
          )}
        </div>
      </section>

      <section
        className="
          mb-4 rounded-[22px] border border-white/10
          bg-[#11151C] p-3.5
        "
      >
        <p
          className="
            mb-2 text-[9px] font-extrabold uppercase
            tracking-[0.14em] text-white/35
          "
        >
          Período
        </p>

        <div
          className="
            flex gap-2 overflow-x-auto pb-1
            [scrollbar-width:none]
            [&::-webkit-scrollbar]:hidden
          "
        >
          {PERIODS.map((item) => {
            const active =
              period === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  setPeriod(item.id)
                }
                className={
                  `
                    shrink-0 rounded-xl border px-3 py-2
                    text-[10px] font-extrabold uppercase
                    tracking-[0.08em] transition
                  ` +
                  (active
                    ? " border-[#FFC61A]/40 bg-[#FFC61A] text-black"
                    : " border-white/10 bg-white/[0.035] text-white/45 hover:border-white/20 hover:text-white/70")
                }
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </section>

      {historicalData.salesCount > 0 && (
        <div
          className="
            mb-4 rounded-[22px] border border-[#FFC61A]/25
            bg-[#FFC61A]/[0.08] p-4
          "
        >
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#FFC61A]/15 text-[#FFC61A]">
              <HistoryProfitIcon className="h-4.5 w-4.5" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#FFC61A]">
                Ganancias históricas
              </p>

              <h3 className="mt-1 text-sm font-black text-white">
                {historicalData.salesCount} {historicalData.salesCount === 1 ? "venta necesita" : "ventas necesitan"} completar su costo
              </h3>

              <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                Podés asignar costos históricos por producto y período o usar el costo actual como estimación. Los costos que ya existen no se sobrescriben.
              </p>
            </div>
          </div>

          {esAdministrador ? (
            <button
              type="button"
              onClick={openHistoricalMigration}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FFC61A] px-4 py-3.5 text-sm font-extrabold text-black transition hover:bg-[#FFD248] active:scale-[0.99]"
            >
              <HistoryProfitIcon className="h-4 w-4" />
              Completar ganancias históricas
            </button>
          ) : (
            <p className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[10px] font-semibold text-white/45">
              Esta migración requiere un Administrador.
            </p>
          )}
        </div>
      )}

      {summary.unknownSales > 0 && (
        <div
          className="
            mb-4 rounded-[20px] border border-amber-300/20
            bg-amber-300/[0.07] p-3.5
          "
        >
          <div className="flex items-start gap-3">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC61A]" />

            <div>
              <p className="text-xs font-extrabold text-white/80">
                Hay ventas anteriores sin costo histórico
              </p>

              <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                {summary.unknownSales} {summary.unknownSales === 1 ? "venta no puede" : "ventas no pueden"} calcular ganancia con precisión. La cobertura actual es de {formatPercent(summary.coverage)} del importe vendido. No se usa el costo actual para alterar resultados anteriores.
              </p>
            </div>
          </div>
        </div>
      )}

      {summary.zeroCostProducts > 0 && (
        <div
          className="
            mb-4 rounded-[20px] border border-amber-300/20
            bg-amber-300/[0.07] p-3.5
          "
        >
          <div className="flex items-start gap-3">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC61A]" />

            <div>
              <p className="text-xs font-extrabold text-white/80">
                Revisá productos con costo $0
              </p>

              <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                {summary.zeroCostProducts} {summary.zeroCostProducts === 1 ? "producto vendido tiene" : "productos vendidos tienen"} costo $0. Si no es intencional, cargá el costo en Stock. El cambio se aplicará a ventas futuras y no modificará ganancias históricas.
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        className="
          mb-4 rounded-[20px] border border-[#FFC61A]/15
          bg-[#FFC61A]/[0.06] p-3.5
        "
      >
        <div className="flex items-start gap-3">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC61A]" />

          <p className="text-[11px] leading-relaxed text-white/45">
            La ganancia bruta se calcula como <strong className="text-white/70">venta − costo de mercadería</strong>. Incluye ventas a cuenta porque se basa en lo vendido, no en cuándo se cobra. No descuenta alquiler, servicios u otros gastos generales.
          </p>
        </div>
      </div>

      {topProduct && (
        <section
          className="
            mb-4 overflow-hidden rounded-[22px]
            border border-[#FFC61A]/20
            bg-[#11151C]
          "
        >
          <div className="p-3.5">
            <p
              className="
                text-[9px] font-extrabold uppercase
                tracking-[0.14em] text-[#FFC61A]
              "
            >
              Producto más rentable
            </p>

            <div className="mt-2 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-black text-white">
                  {topProduct.name}
                </h3>
                <p className="mt-1 text-[10px] font-semibold text-white/35">
                  {formatQuantity(
                    topProduct.quantity,
                    topProduct.tipoVenta,
                    topProduct.lines
                  )} · {formatPercent(topProduct.margin)} de margen
                </p>
              </div>

              <strong className="shrink-0 text-lg font-black text-[#FFC61A]">
                {money(topProduct.profit)}
              </strong>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p
              className="
                text-[10px] font-extrabold uppercase
                tracking-[0.16em] text-[#FFC61A]
              "
            >
              Por producto
            </p>

            <h3 className="mt-1 text-lg font-black text-white">
              Rentabilidad detallada
            </h3>
          </div>

          <span
            className="
              shrink-0 rounded-full border border-white/10
              bg-white/5 px-2.5 py-1.5
              text-[10px] font-bold text-white/45
            "
          >
            {products.length} productos
          </span>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_170px]">
          <div className="relative">
            <SearchIcon
              className="
                pointer-events-none absolute left-3.5 top-1/2
                h-4 w-4 -translate-y-1/2 text-white/25
              "
            />

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Buscar producto"
              className="
                w-full rounded-2xl border border-white/10
                bg-[#151A22] py-3 pl-10 pr-3.5
                text-sm font-semibold text-white outline-none
                placeholder:text-white/25
                focus:border-[#FFC61A]/45
              "
            />
          </div>

          <select
            value={sort}
            onChange={(event) =>
              setSort(event.target.value)
            }
            className="
              w-full rounded-2xl border border-white/10
              bg-[#151A22] px-3.5 py-3
              text-xs font-extrabold text-white outline-none
              focus:border-[#FFC61A]/45
            "
          >
            {SORTS.map((item) => (
              <option
                key={item.id}
                value={item.id}
              >
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {products.length === 0 ? (
          <EmptyState
            hasSales={
              periodSales.length > 0
            }
            hasSearch={Boolean(
              search.trim()
            )}
          />
        ) : (
          <div className="space-y-2.5">
            {products.map((product, index) => (
              <ProductProfitCard
                key={product.key}
                product={product}
                index={index}
              />
            ))}
          </div>
        )}
      </section>

      <Modal
        open={migrationOpen}
        onClose={() => {
          if (!migrationSaving) {
            setMigrationOpen(false);
          }
        }}
        title="Ganancias históricas"
      >
        <HistoricalMigrationModal
          historicalData={historicalData}
          draft={migrationDraft}
          config={migrationConfig}
          preview={migrationPreview}
          saving={migrationSaving}
          onSourceChange={updateMigrationSource}
          onPeriodChange={updateMigrationPeriod}
          onAddPeriod={addMigrationPeriod}
          onRemovePeriod={removeMigrationPeriod}
          onEstimateAll={estimateAllWithCurrentCost}
          onApply={applyHistoricalMigration}
        />
      </Modal>
    </div>
  );
}

function HistoricalMigrationModal({
  historicalData,
  draft,
  config,
  preview,
  saving,
  onSourceChange,
  onPeriodChange,
  onAddPeriod,
  onRemovePeriod,
  onEstimateAll,
  onApply,
}) {
  const canEstimate =
    historicalData.groups.some(
      (group) =>
        Number.isFinite(
          group.currentCost
        ) &&
        group.currentCost > 0
    );

  return (
    <div>
      <div className="mb-4 overflow-hidden rounded-[22px] bg-white text-[#111318]">
        <div className="p-4">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#B98700]">
            Migración segura
          </p>

          <h3 className="mt-1 text-lg font-black text-[#111318]">
            Completar costos anteriores
          </h3>

          <p className="mt-1 text-xs leading-relaxed text-black/45">
            Sólo se completan líneas que todavía no tienen costo guardado. Una venta que ya tiene costo histórico no se modifica.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniStat
              label="Ventas"
              value={
                historicalData.salesCount
              }
            />
            <MiniStat
              label="Productos"
              value={
                historicalData.groups.length
              }
            />
            <MiniStat
              label="Config."
              value={
                config.rules.length
              }
            />
          </div>
        </div>
      </div>

      {canEstimate && (
        <button
          type="button"
          onClick={onEstimateAll}
          disabled={saving}
          className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#FFC61A]/25 bg-[#FFC61A]/10 px-4 py-3 text-xs font-extrabold text-[#FFC61A] transition hover:bg-[#FFC61A]/15 disabled:opacity-50"
        >
          <EstimateIcon className="h-4 w-4" />
          Usar costos actuales como estimación
        </button>
      )}

      {historicalData.autoFreePriceLines > 0 && (
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3">
          <p className="text-[10px] font-extrabold text-white/70">
            Importe libre
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-white/35">
            {historicalData.autoFreePriceLines} {historicalData.autoFreePriceLines === 1 ? "línea antigua se completará" : "líneas antiguas se completarán"} automáticamente con costo $0, igual que las ventas nuevas de importe libre.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {historicalData.groups.map(
          (group) => {
            const current =
              draft?.[group.key] || {
                source: "migrated",
                periods: [
                  {
                    from: "",
                    to: "",
                    cost: "",
                  },
                ],
              };

            const estimated =
              current.source ===
              "estimated";

            const hasCurrentCost =
              Number.isFinite(
                group.currentCost
              );

            return (
              <div
                key={group.key}
                className="rounded-[20px] border border-white/10 bg-[#11151C] p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-black text-white">
                      {group.name}
                    </h4>

                    <p className="mt-1 text-[10px] font-semibold text-white/35">
                      {group.lines} {group.lines === 1 ? "venta sin costo" : "ventas sin costo"} · {formatQuantity(
                        group.quantity,
                        group.tipoVenta,
                        group.lines
                      )}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="block text-[8px] font-bold uppercase tracking-[0.08em] text-white/30">
                      Costo actual
                    </span>
                    <strong className="mt-0.5 block text-xs font-black text-[#FFC61A]">
                      {hasCurrentCost
                        ? money(
                            group.currentCost
                          )
                        : "Sin dato"}
                    </strong>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      onSourceChange(
                        group.key,
                        "migrated"
                      )
                    }
                    className={
                      "rounded-xl border px-2.5 py-2 text-[9px] font-extrabold uppercase tracking-[0.06em] transition " +
                      (!estimated
                        ? "border-[#FFC61A]/35 bg-[#FFC61A] text-black"
                        : "border-white/10 bg-white/5 text-white/40")
                    }
                  >
                    Costo histórico
                  </button>

                  <button
                    type="button"
                    disabled={
                      saving ||
                      !hasCurrentCost
                    }
                    onClick={() =>
                      onSourceChange(
                        group.key,
                        "estimated"
                      )
                    }
                    className={
                      "rounded-xl border px-2.5 py-2 text-[9px] font-extrabold uppercase tracking-[0.06em] transition disabled:cursor-not-allowed disabled:opacity-35 " +
                      (estimated
                        ? "border-[#FFC61A]/35 bg-[#FFC61A] text-black"
                        : "border-white/10 bg-white/5 text-white/40")
                    }
                  >
                    Estimar actual
                  </button>
                </div>

                {estimated ? (
                  <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2.5">
                    <p className="text-[10px] leading-relaxed text-amber-100/60">
                      Se aplicará {money(group.currentCost)} a todas las ventas históricas pendientes de este producto y quedarán marcadas como <strong className="text-amber-100/80">Estimadas</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2.5">
                    {(current.periods || []).map(
                      (row, index) => (
                        <div
                          key={`${group.key}-${index}`}
                          className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5"
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.08em] text-white/30">
                                Desde
                              </span>
                              <input
                                type="date"
                                value={row.from || ""}
                                disabled={saving}
                                onChange={(event) =>
                                  onPeriodChange(
                                    group.key,
                                    index,
                                    "from",
                                    event.target.value
                                  )
                                }
                                className="w-full rounded-xl border border-white/10 bg-[#171B23] px-2.5 py-2 text-[11px] font-bold text-white outline-none focus:border-[#FFC61A]"
                              />
                            </label>

                            <label className="block">
                              <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.08em] text-white/30">
                                Hasta
                              </span>
                              <input
                                type="date"
                                value={row.to || ""}
                                disabled={saving}
                                onChange={(event) =>
                                  onPeriodChange(
                                    group.key,
                                    index,
                                    "to",
                                    event.target.value
                                  )
                                }
                                className="w-full rounded-xl border border-white/10 bg-[#171B23] px-2.5 py-2 text-[11px] font-bold text-white outline-none focus:border-[#FFC61A]"
                              />
                            </label>
                          </div>

                          <div className="mt-2 flex items-end gap-2">
                            <label className="min-w-0 flex-1">
                              <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.08em] text-white/30">
                                Costo {group.tipoVenta === "peso" ? "por kg" : "por unidad"}
                              </span>
                              <div className="relative">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-[#FFC61A]">
                                  $
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  value={row.cost ?? ""}
                                  disabled={saving}
                                  onChange={(event) =>
                                    onPeriodChange(
                                      group.key,
                                      index,
                                      "cost",
                                      event.target.value
                                    )
                                  }
                                  placeholder="0.00"
                                  className="w-full rounded-xl border border-white/10 bg-[#171B23] py-2.5 pl-7 pr-3 text-sm font-black text-white outline-none placeholder:text-white/20 focus:border-[#FFC61A]"
                                />
                              </div>
                            </label>

                            {(current.periods || []).length > 1 && (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  onRemovePeriod(
                                    group.key,
                                    index
                                  )
                                }
                                className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-red-400/15 bg-red-500/10 text-red-300 transition hover:bg-red-500/15 disabled:opacity-40"
                                aria-label="Eliminar período"
                              >
                                <TrashSmallIcon className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          {!row.from && !row.to && (
                            <p className="mt-1.5 text-[8px] font-semibold text-white/25">
                              Sin fechas = se aplica a todo el historial pendiente.
                            </p>
                          )}
                        </div>
                      )
                    )}

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        onAddPeriod(
                          group.key
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-extrabold text-white/50 transition hover:border-white/20 hover:text-white/75 disabled:opacity-40"
                    >
                      <PlusSmallIcon className="h-3.5 w-3.5" />
                      Agregar período
                    </button>
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>

      {config.errors.length > 0 && (
        <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-3.5 py-3">
          <p className="text-[10px] font-extrabold text-red-200">
            Revisá la configuración
          </p>
          {config.errors.slice(0, 3).map(
            (error) => (
              <p
                key={error}
                className="mt-1 text-[9px] leading-relaxed text-red-200/65"
              >
                {error}
              </p>
            )
          )}
        </div>
      )}

      <div className="mt-4 rounded-[20px] border border-[#FFC61A]/20 bg-[#FFC61A]/[0.06] p-3.5">
        <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#FFC61A]">
          Vista previa
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <MigrationPreviewStat
            label="Ventas a actualizar"
            value={preview.updatedSales}
          />
          <MigrationPreviewStat
            label="Ventas completas"
            value={preview.completedSales}
          />
          <MigrationPreviewStat
            label="Líneas migradas"
            value={preview.migratedLines}
          />
          <MigrationPreviewStat
            label="Líneas estimadas"
            value={preview.estimatedLines}
          />
          <MigrationPreviewStat
            label="Costo a incorporar"
            value={money(
              preview.addedCost
            )}
          />
          <MigrationPreviewStat
            label="Quedarán pendientes"
            value={preview.remainingSales}
            warning={
              preview.remainingSales > 0
            }
          />
        </div>

        {preview.completedSales > 0 && (
          <p className="mt-2 text-[9px] leading-relaxed text-white/35">
            Ganancia calculable de las ventas que quedarán completas: <strong className="text-white/65">{money(preview.completedProfit)}</strong>.
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={
          saving ||
          config.errors.length > 0 ||
          preview.updatedSales === 0
        }
        onClick={onApply}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FFC61A] px-4 py-4 text-sm font-extrabold text-black shadow-[0_12px_30px_rgba(255,198,26,0.18)] transition hover:bg-[#FFD248] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <HistoryProfitIcon className="h-4 w-4" />
        {saving
          ? "Aplicando migración..."
          : "Aplicar ganancias históricas"}
      </button>

      <p className="mt-2 text-center text-[9px] leading-relaxed text-white/25">
        La operación queda registrada en Actividad con el Administrador que la realizó.
      </p>
    </div>
  );
}

function MigrationPreviewStat({
  label,
  value,
  warning = false,
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-2.5 py-2">
      <span className="block text-[8px] font-bold uppercase tracking-[0.07em] text-white/30">
        {label}
      </span>
      <strong
        className={
          "mt-0.5 block truncate text-xs font-black " +
          (warning
            ? "text-amber-300"
            : "text-white/80")
        }
      >
        {value}
      </strong>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  icon,
  highlight = false,
}) {
  return (
    <div className="rounded-2xl bg-[#F4F5F7] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.09em] text-black/35">
          {label}
        </span>
        <span className={highlight ? "text-[#9A7100]" : "text-black/30"}>
          {icon}
        </span>
      </div>

      <strong
        className={
          "mt-1.5 block truncate text-base font-black " +
          (highlight
            ? "text-[#9A7100]"
            : "text-[#111318]")
        }
      >
        {value}
      </strong>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl bg-[#F4F5F7] px-2.5 py-2">
      <span className="block truncate text-[8px] font-bold uppercase tracking-[0.08em] text-black/30">
        {label}
      </span>
      <strong className="mt-0.5 block truncate text-[11px] font-black text-[#111318]">
        {value}
      </strong>
    </div>
  );
}

function ProductProfitCard({
  product,
  index,
}) {
  const partial =
    product.unknownLines > 0;

  const zeroCost =
    product.tipoVenta !==
      "precio-libre" &&
    product.knownRevenue > 0 &&
    product.cost === 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.16,
        delay: Math.min(
          index * 0.02,
          0.14
        ),
      }}
      className="
        overflow-hidden rounded-[20px]
        border border-white/10 bg-[#11151C]
        shadow-[0_12px_30px_rgba(0,0,0,0.14)]
      "
    >
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="
                grid h-10 w-10 shrink-0 place-items-center
                rounded-2xl border border-[#FFC61A]/15
                bg-[#FFC61A]/10 text-[#FFC61A]
              "
            >
              {product.tipoVenta === "peso" ? (
                <ScaleIcon className="h-4.5 w-4.5" />
              ) : product.tipoVenta === "precio-libre" ? (
                <MoneyIcon className="h-4.5 w-4.5" />
              ) : (
                <BoxIcon className="h-4.5 w-4.5" />
              )}
            </div>

            <div className="min-w-0">
              <h4 className="truncate text-sm font-black text-white">
                {product.name}
              </h4>

              <p className="mt-1 truncate text-[10px] font-semibold text-white/35">
                {formatQuantity(
                  product.quantity,
                  product.tipoVenta,
                  product.lines
                )}
                {product.barcode
                  ? ` · ${product.barcode}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <span className="block text-[8px] font-extrabold uppercase tracking-[0.1em] text-white/30">
              Ganancia
            </span>
            <strong className="mt-0.5 block text-sm font-black text-[#FFC61A]">
              {money(product.profit)}
            </strong>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <ProductMiniStat
            label="Vendido"
            value={money(product.revenue)}
          />
          <ProductMiniStat
            label="Costo"
            value={
              partial
                ? `${money(product.cost)}*`
                : money(product.cost)
            }
          />
          <ProductMiniStat
            label="Margen"
            value={formatPercent(
              product.margin
            )}
            highlight
          />
        </div>

        {partial && (
          <p className="mt-2 text-[9px] leading-relaxed text-amber-200/55">
            * Resultado parcial: {product.unknownLines} {product.unknownLines === 1 ? "venta" : "ventas"} de este producto no tiene costo histórico.
          </p>
        )}

        {zeroCost && (
          <p className="mt-2 text-[9px] leading-relaxed text-amber-200/55">
            Costo registrado: $0. Verificá el costo del producto si esto no es intencional.
          </p>
        )}
      </div>
    </motion.article>
  );
}

function ProductMiniStat({
  label,
  value,
  highlight = false,
}) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.035] px-2.5 py-2">
      <span className="block truncate text-[8px] font-bold uppercase tracking-[0.08em] text-white/30">
        {label}
      </span>
      <strong
        className={
          "mt-0.5 block truncate text-[11px] font-black " +
          (highlight
            ? "text-[#FFC61A]"
            : "text-white/75")
        }
      >
        {value}
      </strong>
    </div>
  );
}

function EmptyState({
  hasSales,
  hasSearch,
}) {
  return (
    <div
      className="
        rounded-[22px] border border-dashed border-white/10
        bg-[#11151C] px-5 py-9 text-center
      "
    >
      <ProfitIcon className="mx-auto h-6 w-6 text-white/20" />
      <h4 className="mt-3 text-sm font-black text-white/75">
        {hasSearch
          ? "Sin coincidencias"
          : hasSales
            ? "Sin detalle de productos"
            : "Todavía no hay ventas"}
      </h4>
      <p className="mx-auto mt-1 max-w-[310px] text-xs leading-relaxed text-white/35">
        {hasSearch
          ? "No encontramos productos para esa búsqueda."
          : hasSales
            ? "Las ventas del período no tienen productos detallados para agrupar."
            : "Cuando registres ventas, la rentabilidad aparecerá automáticamente acá."}
      </p>
    </div>
  );
}

function ProfitIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 4-4 3 2 5-6" />
      <path d="M16 7h3v3" />
    </svg>
  );
}

function SalesIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16v12H4z" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </svg>
  );
}

function BoxIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function PercentIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m19 5-14 14" />
      <circle cx="7" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

function SearchIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ScaleIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4" />
      <path d="M5 7h14" />
      <path d="m7 7-4 7h8L7 7Z" />
      <path d="m17 7-4 7h8l-4-7Z" />
      <path d="M12 7v13" />
      <path d="M8 20h8" />
    </svg>
  );
}

function MoneyIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7 9h.01" />
      <path d="M17 15h.01" />
    </svg>
  );
}

function HistoryProfitIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function EstimateIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 4-4 3 2 5-6" />
      <path d="M17 5h3v3" />
    </svg>
  );
}

function TrashSmallIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function PlusSmallIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function AlertIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function InfoIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}
