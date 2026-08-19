// src/services/pos/auditoriaFirestore.js
// Lectura en tiempo real del registro de actividad del POS.

import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../firebase/config";
import { auditoriaPath } from "./posPaths";

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
    sessionId:
      String(data.sessionId || "").trim() || null,
    detalle:
      data.detalle &&
      typeof data.detalle === "object" &&
      !Array.isArray(data.detalle)
        ? data.detalle
        : {},
    deviceId: String(data.deviceId || "").trim() || null,
  };
}

function getAuditCollection(clienteId) {
  const cleanClienteId =
    requireString(clienteId, "clienteId");

  return collection(
    db,
    ...auditoriaPath(cleanClienteId)
  );
}

export function subscribeAuditEvents(
  clienteId,
  onData,
  onError = console.error
) {
  if (typeof onData !== "function") {
    throw new Error(
      "subscribeAuditEvents necesita onData"
    );
  }

  const auditRef =
    getAuditCollection(clienteId);

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

/* =========================================================
   AUDITORÍA COMPLETA DE UN TURNO
========================================================= */

export function subscribeSessionAuditEvents(
  clienteId,
  sessionId,
  onData,
  onError = console.error
) {
  const cleanSessionId =
    requireString(sessionId, "sessionId");

  if (typeof onData !== "function") {
    throw new Error(
      "subscribeSessionAuditEvents necesita onData"
    );
  }

  const auditRef =
    getAuditCollection(clienteId);

  const auditQuery =
    query(
      auditRef,
      where(
        "sessionId",
        "==",
        cleanSessionId
      ),
      orderBy("fecha", "asc")
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
