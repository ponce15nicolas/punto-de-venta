// src/lib/network.js
// Utilidades pequeñas para distinguir una caída de red de un rechazo lógico del backend.

export function browserIsOnline() {
  if (typeof navigator === "undefined") {
    return true;
  }

  return navigator.onLine !== false;
}

export function cloudErrorCode(error) {
  return String(error?.code || "")
    .toLowerCase()
    .split("/")
    .pop();
}

export function isNetworkError(error) {
  const code = cloudErrorCode(error);

  if (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "network-request-failed" ||
    code === "cancelled"
  ) {
    return true;
  }

  const message = String(
    error?.message || error?.details?.message || ""
  ).toLowerCase();

  return [
    "failed to fetch",
    "network",
    "offline",
    "internet",
    "conexión",
    "conexion",
  ].some((fragment) => message.includes(fragment));
}
