const DB_NAME = "mi-negocio-pos-offline";
const DB_VERSION = 2;
const OPERATIONS_STORE = "operations";
const HISTORY_STORE = "syncHistory";
const CHANGE_EVENT = "pos:offline-queue-change";
const HISTORY_LIMIT = 30;

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

      if (!db.objectStoreNames.contains(OPERATIONS_STORE)) {
        const operations = db.createObjectStore(OPERATIONS_STORE, {
          keyPath: "id",
        });
        operations.createIndex("owner", "owner", { unique: false });
        operations.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const history = db.createObjectStore(HISTORY_STORE, {
          keyPath: "id",
        });
        history.createIndex("owner", "owner", { unique: false });
        history.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

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

async function runStore(storeName, mode, runner) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
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
    const transaction = db.transaction(OPERATIONS_STORE, "readonly");
    const store = transaction.objectStore(OPERATIONS_STORE);
    const request = store.index("owner").getAll(cleanOwner);

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

  await runStore(OPERATIONS_STORE, "readwrite", (store) => {
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
    const transaction = db.transaction(OPERATIONS_STORE, "readwrite");
    const store = transaction.objectStore(OPERATIONS_STORE);
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

  await runStore(OPERATIONS_STORE, "readwrite", (store) => {
    store.delete(cleanId);
  });

  emitChange();
}

export async function listOfflineSyncHistory(owner, limit = HISTORY_LIMIT) {
  const cleanOwner = String(owner || "").trim();
  const cleanLimit = Math.max(1, Math.min(HISTORY_LIMIT, Math.trunc(Number(limit) || HISTORY_LIMIT)));

  if (!cleanOwner) {
    return [];
  }

  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_STORE, "readonly");
    const store = transaction.objectStore(HISTORY_STORE);
    const request = store.index("owner").getAll(cleanOwner);

    request.onsuccess = () => {
      const history = Array.isArray(request.result)
        ? request.result.filter(Boolean)
        : [];

      history.sort((a, b) =>
        String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""))
      );

      resolve(history.slice(0, cleanLimit));
    };

    request.onerror = () => reject(
      request.error || new Error("No se pudo leer el historial de sincronización")
    );
  });
}

export async function recordOfflineSyncHistory(owner, event) {
  const cleanOwner = String(owner || "").trim();
  const saleId = String(event?.saleId || "").trim();

  if (!cleanOwner || !saleId) {
    return null;
  }

  const now = new Date().toISOString();
  const record = {
    id: `sync:${cleanOwner}:${saleId}:${String(event?.status || "synced")}`,
    owner: cleanOwner,
    saleId,
    status: String(event?.status || "synced"),
    createdAt: event?.createdAt || now,
    queuedAt: event?.queuedAt || null,
    total: Number.isFinite(Number(event?.total)) ? Number(event.total) : 0,
    itemCount: Math.max(0, Math.trunc(Number(event?.itemCount) || 0)),
    paymentMethod: String(event?.paymentMethod || "").trim() || null,
  };

  const db = await openDb();

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_STORE, "readwrite");
    const store = transaction.objectStore(HISTORY_STORE);
    const ownerIndex = store.index("owner");
    const request = ownerIndex.getAll(cleanOwner);

    request.onsuccess = () => {
      const existing = Array.isArray(request.result)
        ? request.result.filter(Boolean)
        : [];

      store.put(record);

      existing
        .sort((a, b) =>
          String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""))
        )
        .slice(HISTORY_LIMIT - 1)
        .forEach((item) => store.delete(item.id));
    };

    request.onerror = () => reject(
      request.error || new Error("No se pudo actualizar el historial de sincronización")
    );
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(
      transaction.error || new Error("No se pudo guardar el historial de sincronización")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("Se canceló el historial de sincronización")
    );
  });

  emitChange();
  return record;
}

export async function clearOfflineSyncHistory(owner) {
  const cleanOwner = String(owner || "").trim();

  if (!cleanOwner) {
    return;
  }

  const db = await openDb();

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_STORE, "readwrite");
    const store = transaction.objectStore(HISTORY_STORE);
    const request = store.index("owner").openCursor(IDBKeyRange.only(cleanOwner));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }
      cursor.delete();
      cursor.continue();
    };

    request.onerror = () => reject(
      request.error || new Error("No se pudo limpiar el historial de sincronización")
    );
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(
      transaction.error || new Error("No se pudo limpiar el historial de sincronización")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("Se canceló la limpieza del historial")
    );
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
