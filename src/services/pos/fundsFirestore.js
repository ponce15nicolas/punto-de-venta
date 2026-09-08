// src/services/pos/fundsFirestore.js
// Operaciones financieras internas de la actividad.

import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/config";

const convertirFondosFunction = httpsCallable(
  functions,
  "convertirFondos"
);

const obtenerFondosActividadFunction = httpsCallable(
  functions,
  "obtenerFondosActividad"
);

function requireString(value, fieldName) {
  const clean = String(value ?? "").trim();

  if (!clean) {
    const error = new Error(`${fieldName} es obligatorio`);
    error.code = "invalid-argument";
    throw error;
  }

  return clean;
}

function roundMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return NaN;
  }

  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function normalizeCallableError(
  error,
  fallbackMessage
) {
  const code = String(error?.code || "unknown")
    .split("/")
    .pop();

  const serverMessage = String(
    error?.details?.mensaje ||
    error?.details?.message ||
    error?.message ||
    ""
  ).trim();

  const normalized = new Error(
    serverMessage || fallbackMessage
  );

  normalized.code = code;
  normalized.details = error?.details || null;

  return normalized;
}

export async function getActivityFundsCloud(
  clienteId,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
) {
  const cleanClienteId = requireString(
    clienteId,
    "clienteId"
  );
  const cleanDeviceId = requireString(
    deviceId,
    "deviceId"
  );

  if (!operadorSesion?.id || !operadorSesion?.token) {
    const error = new Error(
      "Falta la sesión interna del operador"
    );
    error.code = "unauthenticated";
    throw error;
  }

  try {
    const response =
      await obtenerFondosActividadFunction({
        clienteId: cleanClienteId,
        operadorSesion,
        deviceId: cleanDeviceId,
      });

    const data = response?.data || {};

    if (!data.ok || !data.activity?.id) {
      const error = new Error(
        "No se pudieron cargar los fondos de la actividad"
      );
      error.code = "activity-funds-load-failed";
      throw error;
    }

    return data;
  } catch (error) {
    throw normalizeCallableError(
      error,
      "No se pudieron cargar los fondos de la actividad"
    );
  }
}

export async function convertFundsCloud(
  clienteId,
  payload,
  {
    operadorSesion = null,
    deviceId = null,
  } = {}
) {
  const cleanClienteId = requireString(
    clienteId,
    "clienteId"
  );
  const cleanDeviceId = requireString(
    deviceId,
    "deviceId"
  );
  const conversionId = requireString(
    payload?.conversionId,
    "conversionId"
  );

  if (!operadorSesion?.id || !operadorSesion?.token) {
    const error = new Error(
      "Falta la sesión interna del operador"
    );
    error.code = "unauthenticated";
    throw error;
  }

  const origen = String(payload?.origen || "").trim();
  const destino = String(payload?.destino || "").trim();
  const importe = roundMoney(payload?.importe);
  const motivo = requireString(
    payload?.motivo,
    "motivo"
  ).slice(0, 180);

  if (
    !["efectivo", "transferencia"].includes(origen) ||
    !["efectivo", "transferencia"].includes(destino) ||
    origen === destino
  ) {
    const error = new Error(
      "Elegí un origen y destino válidos"
    );
    error.code = "invalid-argument";
    throw error;
  }

  if (!Number.isFinite(importe) || importe <= 0) {
    const error = new Error(
      "Ingresá un importe válido"
    );
    error.code = "invalid-argument";
    throw error;
  }

  try {
    const response = await convertirFondosFunction({
      clienteId: cleanClienteId,
      conversionId,
      origen,
      destino,
      importe,
      motivo,
      operadorSesion,
      deviceId: cleanDeviceId,
    });

    const data = response?.data || {};

    if (!data.ok || !data.conversion?.id) {
      const error = new Error(
        "No se pudo registrar la conversión de fondos"
      );
      error.code = "fund-conversion-failed";
      throw error;
    }

    return data;
  } catch (error) {
    throw normalizeCallableError(
      error,
      "No se pudo registrar la conversión de fondos"
    );
  }
}
