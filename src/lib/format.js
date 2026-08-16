// src/lib/format.js
// Utilidades globales de formato para el POS.
//
// Incluye:
// - generación de IDs
// - formato de dinero
// - fechas
// - fecha + hora
// - hora
// - cálculo de días hasta vencimiento
//
// Diseñado para tolerar null, undefined, fechas inválidas y números inválidos.

const LOCALE = "es-AR";
const MS_PER_DAY = 86_400_000;

/* =========================================================
   FORMATTERS
   Se crean una sola vez para no reinstanciar Intl en cada uso.
========================================================= */

const moneyFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
});

/* =========================================================
   UID
========================================================= */

export function uid() {
  /*
   * crypto.randomUUID() genera IDs mucho más seguros
   * y con menor riesgo de colisiones.
   */
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto?.randomUUID
  ) {
    return globalThis.crypto.randomUUID();
  }

  /*
   * Fallback para navegadores antiguos.
   */
  const timestamp = Date.now().toString(36);

  let randomPart = "";

  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto?.getRandomValues
  ) {
    const values = new Uint32Array(2);

    globalThis.crypto.getRandomValues(values);

    randomPart = Array.from(values)
      .map((value) => value.toString(36))
      .join("");
  } else {
    randomPart =
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);
  }

  return `${timestamp}-${randomPart.slice(0, 12)}`;
}

/* =========================================================
   DINERO
========================================================= */

export function money(value) {
  const number = Number(value);

  /*
   * Evita mostrar:
   * $NaN
   * $Infinity
   * $undefined
   */
  const safeValue = Number.isFinite(number)
    ? number
    : 0;

  return `$${moneyFormatter.format(safeValue)}`;
}

/* =========================================================
   PARSEO SEGURO DE FECHAS
========================================================= */

function parseDate(value) {
  if (!value) {
    return null;
  }

  /* ---------------------------------------------------------
     Ya es Date
  --------------------------------------------------------- */

  if (value instanceof Date) {
    const copy = new Date(value.getTime());

    return isValidDate(copy)
      ? copy
      : null;
  }

  /* ---------------------------------------------------------
     Firestore Timestamp
     Permite usar las funciones también con Timestamp si
     alguna vez se pasa directamente.
  --------------------------------------------------------- */

  if (
    typeof value === "object" &&
    typeof value.toDate === "function"
  ) {
    try {
      const converted = value.toDate();

      return isValidDate(converted)
        ? converted
        : null;
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------
     Fecha pura YYYY-MM-DD
     
     IMPORTANTE:
     new Date("2026-08-16") se interpreta como UTC.
     En Argentina puede terminar representando el día anterior.
     
     Por eso construimos la fecha en horario LOCAL.
  --------------------------------------------------------- */

  if (
    typeof value === "string"
  ) {
    const cleanValue = value.trim();

    if (!cleanValue) {
      return null;
    }

    const dateOnlyMatch =
      cleanValue.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]);
      const day = Number(dateOnlyMatch[3]);

      const date = new Date(
        year,
        month - 1,
        day
      );

      /*
       * Validamos nuevamente porque JavaScript permite cosas
       * como 31/02 y automáticamente las pasa a marzo.
       */
      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        return null;
      }

      return date;
    }

    const date =
      new Date(cleanValue);

    return isValidDate(date)
      ? date
      : null;
  }

  /* ---------------------------------------------------------
     Timestamp numérico
  --------------------------------------------------------- */

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    const date = new Date(value);

    return isValidDate(date)
      ? date
      : null;
  }

  return null;
}

/* =========================================================
   VALIDAR DATE
========================================================= */

function isValidDate(date) {
  return (
    date instanceof Date &&
    !Number.isNaN(date.getTime())
  );
}

/* =========================================================
   FECHA
========================================================= */

export function fmtDate(value) {
  const date =
    parseDate(value);

  if (!date) {
    return "—";
  }

  return dateFormatter.format(date);
}

/* =========================================================
   FECHA + HORA
========================================================= */

export function fmtDateTime(value) {
  const date =
    parseDate(value);

  if (!date) {
    return "—";
  }

  return `${shortDateFormatter.format(date)} ${timeFormatter.format(date)}`;
}

/* =========================================================
   HORA
========================================================= */

export function fmtTime(value) {
  const date =
    parseDate(value);

  if (!date) {
    return "—";
  }

  return timeFormatter.format(date);
}

/* =========================================================
   DÍAS HASTA VENCIMIENTO
========================================================= */

export function daysUntil(value) {
  const target =
    parseDate(value);

  if (!target) {
    return null;
  }

  const today =
    new Date();

  /*
   * Convertimos únicamente año/mes/día a UTC para calcular
   * días completos.
   *
   * Esto evita errores de ±1 día provocados por:
   * - horario de verano
   * - cambios de zona horaria
   * - horas diferentes dentro del mismo día
   */
  const todayDay = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const targetDay = Date.UTC(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  );

  return Math.round(
    (targetDay - todayDay) /
    MS_PER_DAY
  );
}