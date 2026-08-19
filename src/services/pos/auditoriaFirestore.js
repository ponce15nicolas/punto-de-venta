// src/services/pos/auditoriaFirestore.js
// Lectura en tiempo real del registro de actividad del POS.

import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { db } from "../../firebase/config";

const MAX_AUDIT_EVENTS = 100;

function requireString(value, fieldName) {
  const clean = String(value ?? "").trim();

  if (!clean) {
    throw new Error(`${fieldName} es obligatorio`);
  }

  return clean;
}

function normalizeDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed;
}

function normalizeEvent(snapshotDoc) {
  const data = snapshotDoc.data() || {};

  return {
    id: snapshotDoc.id,
    accion: String(data.accion || "").trim(),
    operadorId: String(data.operadorId || "").trim(),
    operadorNombre: String(data.operadorNombre || "Operador").trim(),
    operadorRol: String(data.operadorRol || "").trim(),
    fecha: normalizeDate(data.fecha),
    detalle:
      data.detalle &&
      typeof data.detalle === "object" &&
      !Array.isArray(data.detalle)
        ? data.detalle
        : {},
    deviceId: String(data.deviceId || "").trim() || null,
  };
}

export function subscribeAuditEvents(
  clienteId,
  onData,
  onError = console.error
) {
  const cleanClienteId =
    requireString(clienteId, "clienteId");

  if (typeof onData !== "function") {
    throw new Error(
      "subscribeAuditEvents necesita onData"
    );
  }

  const auditRef =
    collection(
      db,
      "clientes",
      cleanClienteId,
      "auditoria"
    );

  const auditQuery =
    query(
      auditRef,
      orderBy("fecha", "desc"),
      limit(MAX_AUDIT_EVENTS)
    );

  return onSnapshot(
    auditQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map(
          normalizeEvent
        )
      );
    },
    onError
  );
}
