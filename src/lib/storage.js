// Persistencia local del negocio.
// Esta app corre de forma independiente (Vite build), así que los datos se
// guardan en localStorage: quedan en ESTE navegador / dispositivo.
// Si necesitás que varias cajas o dispositivos compartan el mismo stock y
// ventas en tiempo real, esa parte hay que reemplazarla por un backend
// (Firebase, Supabase, etc). Avisame si querés que lo armemos.

const PREFIX = "pos:";

export function storeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.error("storage get error", e);
    return fallback;
  }
}

export function storeSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("storage set error", e);
    return false;
  }
}
