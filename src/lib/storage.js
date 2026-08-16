// src/lib/storage.js
// Persistencia local del POS.
//
// Los datos se guardan en localStorage y pertenecen únicamente
// a este navegador/dispositivo.
//
// Mantiene compatibilidad con las claves actuales:
// pos:catalog
// pos:sales
// pos:cashSessions
// pos:shopName

const PREFIX = "pos:";

/* =========================================================
   HELPERS
========================================================= */

/**
 * Genera la clave final utilizada en localStorage.
 */
function getStorageKey(key) {
  const cleanKey = String(key ?? "").trim();

  if (!cleanKey) {
    return null;
  }

  return `${PREFIX}${cleanKey}`;
}

/**
 * Comprueba que localStorage esté disponible.
 *
 * Puede fallar, por ejemplo, por:
 * - políticas de privacidad del navegador
 * - almacenamiento deshabilitado
 * - algunos modos privados
 * - restricciones del entorno
 */
function getStorage() {
  try {
    if (
      typeof window === "undefined" ||
      !window.localStorage
    ) {
      return null;
    }

    return window.localStorage;
  } catch (error) {
    console.error(
      "localStorage no está disponible:",
      error
    );

    return null;
  }
}

/* =========================================================
   LEER
========================================================= */

export function storeGet(key, fallback) {
  const storageKey =
    getStorageKey(key);

  if (!storageKey) {
    console.error(
      "storeGet: clave inválida"
    );

    return fallback;
  }

  const storage =
    getStorage();

  if (!storage) {
    return fallback;
  }

  try {
    const raw =
      storage.getItem(
        storageKey
      );

    /*
     * Si nunca se guardó esta clave,
     * devolvemos el valor por defecto.
     */
    if (raw === null) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error(
      `Error leyendo "${storageKey}" desde localStorage:`,
      error
    );

    /*
     * Si el JSON quedó corrupto, no dejamos que rompa
     * toda la aplicación.
     *
     * Conservamos el dato original para no destruir
     * información automáticamente.
     */
    return fallback;
  }
}

/* =========================================================
   GUARDAR
========================================================= */

export function storeSet(key, value) {
  const storageKey =
    getStorageKey(key);

  if (!storageKey) {
    console.error(
      "storeSet: clave inválida"
    );

    return false;
  }

  const storage =
    getStorage();

  if (!storage) {
    return false;
  }

  try {
    /*
     * JSON.stringify(undefined) devuelve undefined
     * en lugar de una cadena válida.
     */
    const serialized =
      JSON.stringify(value);

    if (
      serialized === undefined
    ) {
      console.error(
        `No se pudo serializar "${storageKey}"`
      );

      return false;
    }

    storage.setItem(
      storageKey,
      serialized
    );

    return true;
  } catch (error) {
    /*
     * También captura:
     * - QuotaExceededError
     * - objetos circulares
     * - BigInt no serializable
     * - errores de permisos
     */
    console.error(
      `Error guardando "${storageKey}" en localStorage:`,
      error
    );

    return false;
  }
}

/* =========================================================
   ELIMINAR
========================================================= */

/**
 * No lo usa actualmente usePosData, pero queda disponible
 * para futuras funciones como restablecer datos o logout.
 */
export function storeRemove(key) {
  const storageKey =
    getStorageKey(key);

  if (!storageKey) {
    return false;
  }

  const storage =
    getStorage();

  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(
      storageKey
    );

    return true;
  } catch (error) {
    console.error(
      `Error eliminando "${storageKey}" de localStorage:`,
      error
    );

    return false;
  }
}

/* =========================================================
   COMPROBAR EXISTENCIA
========================================================= */

/**
 * Útil para comprobar una clave sin tener que parsear su contenido.
 */
export function storeHas(key) {
  const storageKey =
    getStorageKey(key);

  if (!storageKey) {
    return false;
  }

  const storage =
    getStorage();

  if (!storage) {
    return false;
  }

  try {
    return (
      storage.getItem(
        storageKey
      ) !== null
    );
  } catch (error) {
    console.error(
      `Error comprobando "${storageKey}" en localStorage:`,
      error
    );

    return false;
  }
}