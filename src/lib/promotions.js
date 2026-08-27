// src/lib/promotions.js
// Reglas de precios promocionales del POS.
// Las promociones nunca reemplazan productos reales: sólo ajustan el precio
// final mientras el stock continúa descontándose por cada componente.

export const PROMOTION_TYPES = Object.freeze([
  "cantidad",
  "combo",
]);

function toNumber(value, fallback = 0) {
  const normalized =
    typeof value === "string"
      ? value.replace(",", ".")
      : value;

  const number = Number(normalized);

  return Number.isFinite(number)
    ? number
    : fallback;
}

export function roundPromotionMoney(value) {
  return (
    Math.round(
      (toNumber(value) + Number.EPSILON) * 100
    ) / 100
  );
}

function normalizeDateOnly(value) {
  const text = String(value || "").trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : null;
}

function localDateOnly(date = new Date()) {
  const safeDate =
    date instanceof Date
      ? date
      : new Date(date);

  if (Number.isNaN(safeDate.getTime())) {
    return localDateOnly(new Date());
  }

  const offset = safeDate.getTimezoneOffset() * 60 * 1000;

  return new Date(safeDate.getTime() - offset)
    .toISOString()
    .slice(0, 10);
}

export function normalizePromotion(promotion) {
  if (!promotion || typeof promotion !== "object") {
    return null;
  }

  const id = String(promotion.id || "").trim();
  const name = String(promotion.name || "").trim();
  const type = PROMOTION_TYPES.includes(promotion.type)
    ? promotion.type
    : "cantidad";

  const items = (Array.isArray(promotion.items)
    ? promotion.items
    : [])
    .map((item) => ({
      barcode: String(item?.barcode || "").trim(),
      qty: Math.max(1, Math.trunc(toNumber(item?.qty, 1))),
    }))
    .filter((item) => item.barcode);

  return {
    ...promotion,
    id,
    name,
    type,
    active: promotion.active !== false,
    price: roundPromotionMoney(
      Math.max(0, toNumber(promotion.price))
    ),
    items,
    startDate: normalizeDateOnly(promotion.startDate),
    endDate: normalizeDateOnly(promotion.endDate),
  };
}

export function normalizePromotions(promotions) {
  return (Array.isArray(promotions) ? promotions : [])
    .map(normalizePromotion)
    .filter(Boolean);
}

export function isPromotionCurrentlyActive(
  promotion,
  now = new Date()
) {
  const normalized = normalizePromotion(promotion);

  if (
    !normalized ||
    !normalized.active ||
    normalized.price <= 0 ||
    normalized.items.length === 0
  ) {
    return false;
  }

  const today = localDateOnly(now);

  if (
    normalized.startDate &&
    today < normalized.startDate
  ) {
    return false;
  }

  if (
    normalized.endDate &&
    today > normalized.endDate
  ) {
    return false;
  }

  return true;
}

function getBaseSubtotal(item) {
  const storedSubtotal = Number(item?.subtotal);

  if (Number.isFinite(storedSubtotal)) {
    return roundPromotionMoney(storedSubtotal);
  }

  return roundPromotionMoney(
    toNumber(item?.qty) * toNumber(item?.price)
  );
}

function buildUnitCartMaps(cart) {
  const availableByBarcode = {};
  const unitPriceByBarcode = {};

  for (const item of Array.isArray(cart) ? cart : []) {
    if (item?.tipoVenta !== "unidad") {
      continue;
    }

    const barcode = String(item?.barcode || "").trim();
    const qty = Math.max(0, Math.trunc(toNumber(item?.qty)));
    const price = roundPromotionMoney(
      Math.max(0, toNumber(item?.price))
    );

    if (!barcode || qty <= 0) {
      continue;
    }

    availableByBarcode[barcode] =
      (availableByBarcode[barcode] || 0) + qty;

    if (!(barcode in unitPriceByBarcode)) {
      unitPriceByBarcode[barcode] = price;
    }
  }

  return {
    availableByBarcode,
    unitPriceByBarcode,
  };
}

function getMaxApplications(promotion, availableByBarcode) {
  if (!promotion.items.length) {
    return 0;
  }

  let max = Number.POSITIVE_INFINITY;

  for (const item of promotion.items) {
    const available = Math.max(
      0,
      Math.trunc(toNumber(availableByBarcode[item.barcode]))
    );

    max = Math.min(
      max,
      Math.floor(available / item.qty)
    );
  }

  return Number.isFinite(max)
    ? Math.max(0, Math.trunc(max))
    : 0;
}

function getRegularPerApplication(promotion, unitPriceByBarcode) {
  let total = 0;

  for (const item of promotion.items) {
    const price = Number(unitPriceByBarcode[item.barcode]);

    if (!Number.isFinite(price) || price < 0) {
      return null;
    }

    total += price * item.qty;
  }

  return roundPromotionMoney(total);
}

/**
 * Calcula las promociones automáticamente sobre las unidades reales del carrito.
 *
 * Reglas:
 * - sólo participan productos tipo "unidad";
 * - una unidad no puede pertenecer simultáneamente a dos promociones;
 * - primero se aplican las promociones que ahorran más por aplicación;
 * - una promoción que ya no sea más barata que el precio normal no se aplica;
 * - el descuento se reparte por código para conservar subtotales y ganancias.
 */
export function calculateCartPromotions(
  cart,
  promotions,
  now = new Date()
) {
  const safeCart = Array.isArray(cart) ? cart : [];
  const baseTotal = roundPromotionMoney(
    safeCart.reduce(
      (sum, item) => sum + getBaseSubtotal(item),
      0
    )
  );

  const {
    availableByBarcode,
    unitPriceByBarcode,
  } = buildUnitCartMaps(safeCart);

  const candidates = normalizePromotions(promotions)
    .filter((promotion) =>
      isPromotionCurrentlyActive(promotion, now)
    )
    .map((promotion) => {
      const maxApplications = getMaxApplications(
        promotion,
        availableByBarcode
      );
      const regularPerApplication = getRegularPerApplication(
        promotion,
        unitPriceByBarcode
      );
      const savingPerApplication =
        regularPerApplication === null
          ? 0
          : roundPromotionMoney(
              regularPerApplication - promotion.price
            );

      return {
        promotion,
        maxApplications,
        regularPerApplication,
        savingPerApplication,
      };
    })
    .filter(
      (candidate) =>
        candidate.maxApplications > 0 &&
        candidate.regularPerApplication !== null &&
        candidate.savingPerApplication > 0
    )
    .sort((a, b) => {
      if (b.savingPerApplication !== a.savingPerApplication) {
        return b.savingPerApplication - a.savingPerApplication;
      }

      const bUnits = b.promotion.items.reduce(
        (sum, item) => sum + item.qty,
        0
      );
      const aUnits = a.promotion.items.reduce(
        (sum, item) => sum + item.qty,
        0
      );

      if (bUnits !== aUnits) {
        return bUnits - aUnits;
      }

      return String(a.promotion.name || a.promotion.id)
        .localeCompare(
          String(b.promotion.name || b.promotion.id),
          "es"
        );
    });

  const remaining = {
    ...availableByBarcode,
  };

  const discountByBarcode = {};
  const applications = [];

  for (const candidate of candidates) {
    const promotion = candidate.promotion;
    const count = getMaxApplications(
      promotion,
      remaining
    );

    if (count <= 0) {
      continue;
    }

    const regularTotal = roundPromotionMoney(
      candidate.regularPerApplication * count
    );
    const promotionalTotal = roundPromotionMoney(
      promotion.price * count
    );
    const discount = roundPromotionMoney(
      regularTotal - promotionalTotal
    );

    if (discount <= 0) {
      continue;
    }

    for (const item of promotion.items) {
      remaining[item.barcode] = Math.max(
        0,
        Math.trunc(
          toNumber(remaining[item.barcode]) - item.qty * count
        )
      );
    }

    let remainingDiscount = discount;

    promotion.items.forEach((item, index) => {
      const itemRegular = roundPromotionMoney(
        toNumber(unitPriceByBarcode[item.barcode]) *
          item.qty *
          count
      );

      const allocated =
        index === promotion.items.length - 1
          ? remainingDiscount
          : roundPromotionMoney(
              discount * (itemRegular / regularTotal)
            );

      discountByBarcode[item.barcode] = roundPromotionMoney(
        toNumber(discountByBarcode[item.barcode]) + allocated
      );

      remainingDiscount = roundPromotionMoney(
        remainingDiscount - allocated
      );
    });

    applications.push({
      id: promotion.id,
      name: promotion.name,
      type: promotion.type,
      count,
      price: promotion.price,
      regularPerApplication: candidate.regularPerApplication,
      regularTotal,
      promotionalTotal,
      discount,
      items: promotion.items.map((item) => ({
        ...item,
        totalQty: item.qty * count,
      })),
    });
  }

  const discountTotal = roundPromotionMoney(
    applications.reduce(
      (sum, application) => sum + application.discount,
      0
    )
  );

  return {
    baseTotal,
    discountTotal,
    total: roundPromotionMoney(
      Math.max(0, baseTotal - discountTotal)
    ),
    discountByBarcode,
    applications,
  };
}

export function getPromotionRegularTotal(
  promotion,
  catalog
) {
  const normalized = normalizePromotion(promotion);

  if (!normalized) {
    return 0;
  }

  let total = 0;

  for (const item of normalized.items) {
    const product = catalog?.[item.barcode];

    if (!product || product.tipoVenta !== "unidad") {
      return 0;
    }

    total +=
      Math.max(0, toNumber(product.price)) * item.qty;
  }

  return roundPromotionMoney(total);
}
