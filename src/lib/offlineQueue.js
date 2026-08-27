// src/lib/offlineQueue.js
// Cola durable de operaciones del POS. IndexedDB evita depender de localStorage
// para ventas que todavía no fueron confirmadas por Firebase.

const DB_NAME = "mi-negocio-pos-offline";
const DB_VERSION = 1;
const STORE_NAME = "operations";
const CHANGE_EVENT = "pos:offline-queue-change";

let dbPromise = null;

function requireIndexedDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB no está disponible en este navegador");
  }
}

function openDb() {
  requireIndexedDb();

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });

        store.createIndex("owner", "owner", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("No se pudo abrir IndexedDB"));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("IndexedDB está bloqueada por otra pestaña"));
    };
  });

  return dbPromise;
}

function emitChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

async function runStore(mode, runner) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;

    try {
      result = runner(store, transaction);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(
      transaction.error || new Error("Falló una operación de IndexedDB")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("Se canceló una operación de IndexedDB")
    );
  });
}

export async function listOfflineOperations(owner) {
  const cleanOwner = String(owner || "").trim();

  if (!cleanOwner) {
    return [];
  }

  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("owner");
    const request = index.getAll(cleanOwner);

    request.onsuccess = () => {
      const operations = Array.isArray(request.result)
        ? request.result.filter(Boolean)
        : [];

      operations.sort((a, b) =>
        String(a?.createdAt || "").localeCompare(String(b?.createdAt || ""))
      );

      resolve(operations);
    };

    request.onerror = () => reject(
      request.error || new Error("No se pudo leer la cola offline")
    );
  });
}

export async function enqueueOfflineSale(owner, operation) {
  const cleanOwner = String(owner || "").trim();
  const saleId = String(operation?.saleId || "").trim();

  if (!cleanOwner || !saleId) {
    throw new Error("La operación offline no tiene propietario o venta válida");
  }

  const now = new Date().toISOString();
  const record = {
    id: `sale:${cleanOwner}:${saleId}`,
    type: "sale",
    owner: cleanOwner,
    saleId,
    status: "pending",
    attempts: 0,
    createdAt: operation?.createdAt || now,
    updatedAt: now,
    payload: operation?.payload || null,
    stockNeeded: operation?.stockNeeded || {},
    localSale: operation?.localSale || null,
    sessionId: String(operation?.sessionId || "").trim() || null,
    lastError: null,
  };

  await runStore("readwrite", (store) => {
    store.put(record);
  });

  emitChange();
  return record;
}

export async function patchOfflineOperation(id, patch) {
  const cleanId = String(id || "").trim();

  if (!cleanId) {
    return null;
  }

  const db = await openDb();

  const result = await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(cleanId);
    let next = null;

    request.onsuccess = () => {
      const current = request.result;

      if (!current) {
        return;
      }

      next = {
        ...current,
        ...patch,
        id: current.id,
        owner: current.owner,
        saleId: current.saleId,
        updatedAt: new Date().toISOString(),
      };

      store.put(next);
    };

    request.onerror = () => reject(
      request.error || new Error("No se pudo actualizar la cola offline")
    );

    transaction.oncomplete = () => resolve(next);
    transaction.onerror = () => reject(
      transaction.error || new Error("No se pudo actualizar la cola offline")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("Se canceló la actualización de la cola offline")
    );
  });

  emitChange();
  return result;
}

export async function removeOfflineOperation(id) {
  const cleanId = String(id || "").trim();

  if (!cleanId) {
    return;
  }

  await runStore("readwrite", (store) => {
    store.delete(cleanId);
  });

  emitChange();
}

export function subscribeOfflineQueue(listener) {
  if (typeof window === "undefined" || typeof listener !== "function") {
    return () => {};
  }

  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
