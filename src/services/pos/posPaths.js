// src/services/pos/posPaths.js
//
// Rutas centralizadas del POS en Cloud Firestore.
//
// Objetivos:
// - evitar repetir strings de colecciones por todo el proyecto;
// - reducir errores de escritura en las rutas;
// - mantener los datos completamente separados por cliente;
// - generar IDs seguros para documentos basados en códigos de producto;
// - facilitar futuros cambios de estructura.
//
// Estructura:
//
// clientes/{clienteId}/productos/{productoId}
// clientes/{clienteId}/ventas/{ventaId}
// clientes/{clienteId}/cajas/{cajaId}
// clientes/{clienteId}/auditoria/{eventoId}
// clientes/{clienteId}/configuracion/pos
// clientes/{clienteId}/configuracion/migracion-pos-v1

/* =========================================================
   CONSTANTES
========================================================= */

export const POS_COLLECTIONS = Object.freeze({
  CLIENTES: "clientes",
  PRODUCTOS: "productos",
  VENTAS: "ventas",
  CAJAS: "cajas",
  AUDITORIA: "auditoria",
  CONFIGURACION: "configuracion",
});

export const POS_DOCUMENTS = Object.freeze({
  CONFIGURACION: "pos",
  MIGRACION: "migracion-pos-v1",
});

/* =========================================================
   VALIDACIÓN
========================================================= */

/**
 * Normaliza y valida un segmento de ruta.
 *
 * No permitimos valores vacíos porque podrían generar
 * referencias incorrectas o escribir datos fuera del lugar
 * esperado.
 */
function requireSegment(
  value,
  fieldName
) {
  const normalized =
    String(value ?? "").trim();

  if (!normalized) {
    throw new Error(
      `posPaths: "${fieldName}" es obligatorio`
    );
  }

  return normalized;
}

/* =========================================================
   ID DE PRODUCTO
========================================================= */

/**
 * Firestore interpreta "/" como separador de rutas.
 *
 * Aunque la mayoría de los códigos de barras serán EAN/UPC
 * numéricos, también permitimos códigos internos/manuales.
 *
 * encodeURIComponent genera un ID determinístico y seguro,
 * por lo que:
 *
 *   "7791234567890"
 *      -> "7791234567890"
 *
 *   "CODIGO/123"
 *      -> "CODIGO%2F123"
 *
 * Siempre guardaremos además el barcode original dentro
 * del documento del producto.
 */
export function getProductDocumentId(
  barcode
) {
  const normalized =
    requireSegment(
      barcode,
      "barcode"
    );

  return encodeURIComponent(
    normalized
  );
}

/* =========================================================
   CLIENTE
========================================================= */

export function clientePath(
  clienteId
) {
  const id =
    requireSegment(
      clienteId,
      "clienteId"
    );

  return [
    POS_COLLECTIONS.CLIENTES,
    id,
  ];
}

/* =========================================================
   PRODUCTOS
========================================================= */

export function productosPath(
  clienteId
) {
  return [
    ...clientePath(clienteId),
    POS_COLLECTIONS.PRODUCTOS,
  ];
}

export function productoPath(
  clienteId,
  barcode
) {
  return [
    ...productosPath(clienteId),
    getProductDocumentId(
      barcode
    ),
  ];
}

/* =========================================================
   VENTAS
========================================================= */

export function ventasPath(
  clienteId
) {
  return [
    ...clientePath(clienteId),
    POS_COLLECTIONS.VENTAS,
  ];
}

export function ventaPath(
  clienteId,
  ventaId
) {
  const id =
    requireSegment(
      ventaId,
      "ventaId"
    );

  return [
    ...ventasPath(clienteId),
    id,
  ];
}

/* =========================================================
   CAJAS
========================================================= */

export function cajasPath(
  clienteId
) {
  return [
    ...clientePath(clienteId),
    POS_COLLECTIONS.CAJAS,
  ];
}

export function cajaPath(
  clienteId,
  cajaId
) {
  const id =
    requireSegment(
      cajaId,
      "cajaId"
    );

  return [
    ...cajasPath(clienteId),
    id,
  ];
}

/* =========================================================
   AUDITORÍA
========================================================= */

export function auditoriaPath(
  clienteId
) {
  return [
    ...clientePath(clienteId),
    POS_COLLECTIONS.AUDITORIA,
  ];
}

/* =========================================================
   CONFIGURACIÓN
========================================================= */

export function configuracionPath(
  clienteId
) {
  return [
    ...clientePath(clienteId),
    POS_COLLECTIONS.CONFIGURACION,
  ];
}

export function configuracionPosPath(
  clienteId
) {
  return [
    ...configuracionPath(
      clienteId
    ),
    POS_DOCUMENTS.CONFIGURACION,
  ];
}

/* =========================================================
   MIGRACIÓN
========================================================= */

/**
 * Documento utilizado para registrar que los datos históricos
 * de localStorage ya fueron migrados a Firestore.
 *
 * Esto evita que otro inicio de sesión vuelva a importar
 * accidentalmente el mismo catálogo, ventas o cajas.
 */
export function migracionPosPath(
  clienteId
) {
  return [
    ...configuracionPath(
      clienteId
    ),
    POS_DOCUMENTS.MIGRACION,
  ];
}