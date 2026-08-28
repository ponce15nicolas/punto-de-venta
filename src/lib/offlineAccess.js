import {
  storeGet,
  storeRemove,
  storeSet,
} from "./storage";

const LICENSE_SNAPSHOT_KEY = "offlineLicenseSnapshotV1";
const DEVICE_ACCESS_KEY = "offlineDeviceAccessV1";
const OPERATOR_ACCESS_KEY = "offlineOperatorAccessV1";

export const OFFLINE_ACCESS_GRACE_MS =
  24 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function clean(value) {
  return String(value || "").trim();
}

function validTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

export function timestampToMillis(value) {
  if (!value) return null;

  if (typeof value?.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    const millis = date instanceof Date ? date.getTime() : Number.NaN;
    return Number.isFinite(millis) ? millis : null;
  }

  const direct = validTimestamp(value);
  if (direct) return direct;

  const seconds = Number(value?.seconds ?? value?._seconds);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  return null;
}

export function saveOfflineLicenseSnapshot({
  user,
  clienteId,
  estado,
  fechaVencimiento,
  dispositivosActivos,
  maxDispositivos,
}) {
  const uid = clean(user?.uid);
  const owner = clean(clienteId);

  if (!uid || !owner || estado !== "activo") {
    return false;
  }

  return storeSet(LICENSE_SNAPSHOT_KEY, {
    uid,
    email: clean(user?.email),
    clienteId: owner,
    estado: "activo",
    licenseExpiresAt: timestampToMillis(fechaVencimiento),
    dispositivosActivos: Number(dispositivosActivos) || 0,
    maxDispositivos: Math.max(1, Math.trunc(Number(maxDispositivos) || 1)),
    savedAt: now(),
  });
}

export function saveOfflineDeviceAccess({
  user,
  clienteId,
  deviceId,
  sessionId,
}) {
  const uid = clean(user?.uid);
  const owner = clean(clienteId);
  const device = clean(deviceId);
  const session = clean(sessionId);

  if (!uid || !owner || !device || !session) {
    return false;
  }

  return storeSet(DEVICE_ACCESS_KEY, {
    uid,
    clienteId: owner,
    deviceId: device,
    sessionId: session,
    validatedAt: now(),
  });
}

export function readOfflineLicenseAccess({
  user,
  deviceId,
  sessionId,
}) {
  const uid = clean(user?.uid);
  const device = clean(deviceId);
  const session = clean(sessionId);
  const license = storeGet(LICENSE_SNAPSHOT_KEY, null);
  const access = storeGet(DEVICE_ACCESS_KEY, null);

  if (!uid || !device || !session || !license || !access) {
    return null;
  }

  if (
    clean(license.uid) !== uid ||
    clean(access.uid) !== uid ||
    clean(access.deviceId) !== device ||
    clean(access.sessionId) !== session ||
    clean(license.clienteId) !== clean(access.clienteId) ||
    license.estado !== "activo"
  ) {
    return null;
  }

  const validatedAt = validTimestamp(access.validatedAt);
  if (!validatedAt || now() - validatedAt > OFFLINE_ACCESS_GRACE_MS) {
    return null;
  }

  const licenseExpiresAt = validTimestamp(license.licenseExpiresAt);
  if (licenseExpiresAt && licenseExpiresAt < now()) {
    return null;
  }

  return {
    clienteId: clean(license.clienteId),
    dispositivosActivos: Number(license.dispositivosActivos) || 0,
    maxDispositivos: Math.max(1, Math.trunc(Number(license.maxDispositivos) || 1)),
    validatedAt,
    expiresAt: validatedAt + OFFLINE_ACCESS_GRACE_MS,
  };
}

export function clearOfflineLicenseAccess() {
  storeRemove(LICENSE_SNAPSHOT_KEY);
  storeRemove(DEVICE_ACCESS_KEY);
}

export function saveOfflineOperatorAccess({
  session,
  operator,
  deviceId,
}) {
  const id = clean(session?.id);
  const token = clean(session?.token);
  const operatorId = clean(operator?.id);
  const device = clean(deviceId);

  if (!id || !token || !operatorId || !device) {
    return false;
  }

  return storeSet(OPERATOR_ACCESS_KEY, {
    session: {
      id,
      token,
    },
    operator: {
      id: operatorId,
      nombre: clean(operator?.nombre) || "Operador",
      rol: operator?.rol === "administrador"
        ? "administrador"
        : "encargado",
      activo: true,
    },
    deviceId: device,
    validatedAt: now(),
  });
}

export function readOfflineOperatorAccess(deviceId) {
  const device = clean(deviceId);
  const cached = storeGet(OPERATOR_ACCESS_KEY, null);

  if (!device || !cached) return null;

  const validatedAt = validTimestamp(cached.validatedAt);
  const session = cached.session;
  const operator = cached.operator;

  if (
    clean(cached.deviceId) !== device ||
    !validatedAt ||
    now() - validatedAt > OFFLINE_ACCESS_GRACE_MS ||
    !clean(session?.id) ||
    !clean(session?.token) ||
    !clean(operator?.id)
  ) {
    return null;
  }

  return {
    session: {
      id: clean(session.id),
      token: clean(session.token),
    },
    operator: {
      id: clean(operator.id),
      nombre: clean(operator.nombre) || "Operador",
      rol: operator.rol === "administrador"
        ? "administrador"
        : "encargado",
      activo: true,
    },
    validatedAt,
    expiresAt: validatedAt + OFFLINE_ACCESS_GRACE_MS,
  };
}

export function clearOfflineOperatorAccess() {
  storeRemove(OPERATOR_ACCESS_KEY);
}
