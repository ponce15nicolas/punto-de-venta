// functions/index.js
// Cloud Functions del sistema POS.
//
// Incluye:
// - administración de clientes
// - pagos y vencimientos
// - control de licencias
// - control de dispositivos
// - límite de dispositivos simultáneos
// - heartbeat de sesiones
// - cierre remoto de dispositivos
//
// Deploy:
// firebase deploy --only functions
//
// Sintaxis:
// firebase-functions v2 + firebase-admin

const {
    onCall,
    HttpsError,
} = require("firebase-functions/v2/https");

const {
    onSchedule,
} = require("firebase-functions/v2/scheduler");

const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const db = admin.firestore();

/* =========================================================
   CONFIGURACIÓN GENERAL
========================================================= */

const REGION = "southamerica-east1";

/*
 * Un dispositivo debe enviar actividad periódicamente.
 *
 * Si pasan más de 10 minutos sin heartbeat,
 * deja de contarse como dispositivo activo.
 */
const DEVICE_ACTIVE_TIMEOUT_MS =
    10 * 60 * 1000;

/*
 * Por seguridad limitamos cuántos dispositivos puede
 * permitir el administrador a una sola licencia.
 */
const MIN_DEVICES = 1;
const MAX_DEVICES = 10;

const CALLABLE_OPTIONS = {
    region: REGION,

    /*
     * Más adelante podemos activar:
     *
     * enforceAppCheck: true
     *
     * pero NO lo activamos todavía porque primero debemos
     * configurar App Check en el frontend.
     */
};

/* =========================================================
   HELPERS GENERALES
========================================================= */

function normalizarEmail(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function textoSeguro(
    value,
    maxLength = 200
) {
    return String(value || "")
        .trim()
        .slice(0, maxLength);
}

function esObjetoPlano(value) {
    return Boolean(
        value &&
        typeof value ===
            "object" &&
        !Array.isArray(value)
    );
}

/*
 * Normaliza la información del dispositivo sin convertir
 * objetos a texto. De esta forma evitamos guardar
 * literalmente "[object Object]" en Firestore.
 *
 * Acepta:
 * - metadata estructurada del frontend actual
 * - nombres legacy guardados como texto
 */
function normalizarDispositivo(
    value,
    {
        allowEmpty = false,
    } = {}
) {
    if (esObjetoPlano(value)) {
        const navegador =
            textoSeguro(
                value.navegador,
                80
            );

        const plataforma =
            textoSeguro(
                value.plataforma,
                80
            );

        const tipo =
            textoSeguro(
                value.tipo,
                40
            );

        const userAgent =
            textoSeguro(
                value.userAgent,
                300
            );

        const info = {};

        if (navegador) {
            info.navegador =
                navegador;
        }

        if (plataforma) {
            info.plataforma =
                plataforma;
        }

        if (tipo) {
            info.tipo = tipo;
        }

        if (userAgent) {
            info.userAgent =
                userAgent;
        }

        if (
            Object.keys(info)
                .length > 0
        ) {
            return info;
        }

        return allowEmpty
            ? null
            : "Dispositivo desconocido";
    }

    if (
        typeof value ===
        "string"
    ) {
        const clean =
            textoSeguro(
                value,
                180
            );

        /*
         * Compatibilidad con registros creados por la
         * versión anterior del backend.
         */
        if (
            !clean ||
            /^\[object [^\]]+\]$/i.test(
                clean
            )
        ) {
            return allowEmpty
                ? null
                : "Dispositivo desconocido";
        }

        return clean;
    }

    return allowEmpty
        ? null
        : "Dispositivo desconocido";
}

function numeroSeguro(
    value,
    fallback = 0
) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function enteroSeguro(
    value,
    fallback = 0
) {
    const number = Number.parseInt(
        value,
        10
    );

    return Number.isFinite(number)
        ? number
        : fallback;
}

function timestampToIso(value) {
    try {
        if (
            value &&
            typeof value.toDate ===
            "function"
        ) {
            return value
                .toDate()
                .toISOString();
        }

        if (value instanceof Date) {
            return value.toISOString();
        }
    } catch (error) {
        console.error(
            "Error convirtiendo Timestamp:",
            error
        );
    }

    return null;
}

/* =========================================================
   VALIDACIÓN DE IDs
========================================================= */

function validarId(
    value,
    fieldName
) {
    const id =
        String(value || "").trim();

    if (
        id.length < 8 ||
        id.length > 180
    ) {
        throw new HttpsError(
            "invalid-argument",
            `${fieldName} inválido.`
        );
    }

    /*
     * Evitamos caracteres problemáticos para usarlo
     * como ID de documento de Firestore.
     */
    if (
        !/^[a-zA-Z0-9._:-]+$/.test(
            id
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            `${fieldName} contiene caracteres inválidos.`
        );
    }

    return id;
}

/* =========================================================
   ADMIN
========================================================= */

async function verificarAdmin(
    auth
) {
    if (!auth) {
        throw new HttpsError(
            "unauthenticated",
            "Debés iniciar sesión."
        );
    }

    const adminDoc =
        await db
            .collection("admins")
            .doc(auth.uid)
            .get();

    if (!adminDoc.exists) {
        throw new HttpsError(
            "permission-denied",
            "No tenés permisos de administrador."
        );
    }

    return adminDoc.data();
}

/* =========================================================
   RESOLVER CLIENTE AUTENTICADO
========================================================= */

/*
 * Permite:
 *
 * 1. Documento cuyo ID coincide con el UID.
 * 2. Login de Google con otro UID pero mismo email.
 *
 * Esto mantiene compatibilidad con tu LicenseGate.
 */
async function resolverClienteAutenticado(
    auth
) {
    if (!auth) {
        throw new HttpsError(
            "unauthenticated",
            "Debés iniciar sesión."
        );
    }

    /* -------------------------------------------------------
       Buscar por UID
    ------------------------------------------------------- */

    const directRef =
        db
            .collection("clientes")
            .doc(auth.uid);

    const directSnap =
        await directRef.get();

    if (directSnap.exists) {
        return {
            ref: directRef,
            snap: directSnap,
        };
    }

    /* -------------------------------------------------------
       Buscar por email
    ------------------------------------------------------- */

    const email =
        normalizarEmail(
            auth.token?.email
        );

    if (!email) {
        throw new HttpsError(
            "not-found",
            "No se encontró una licencia asociada a esta cuenta."
        );
    }

    /*
     * Primero usamos emailNormalizado para clientes nuevos.
     */
    const normalizadoSnap =
        await db
            .collection("clientes")
            .where(
                "emailNormalizado",
                "==",
                email
            )
            .limit(1)
            .get();

    if (!normalizadoSnap.empty) {
        const doc =
            normalizadoSnap.docs[0];

        return {
            ref: doc.ref,
            snap: doc,
        };
    }

    /*
     * Compatibilidad con clientes creados antes de agregar
     * emailNormalizado.
     */
    const legacySnap =
        await db
            .collection("clientes")
            .where(
                "email",
                "==",
                email
            )
            .limit(1)
            .get();

    if (!legacySnap.empty) {
        const doc =
            legacySnap.docs[0];

        return {
            ref: doc.ref,
            snap: doc,
        };
    }

    throw new HttpsError(
        "not-found",
        "No se encontró una licencia asociada a esta cuenta."
    );
}

/* =========================================================
   VALIDAR LICENCIA
========================================================= */

function validarLicencia(
    clienteData
) {
    if (!clienteData) {
        throw new HttpsError(
            "failed-precondition",
            "Licencia inválida."
        );
    }

    if (
        clienteData.estado !==
        "activo"
    ) {
        throw new HttpsError(
            "failed-precondition",
            "La licencia no está activa.",
            {
                motivo:
                    clienteData.estado ||
                    "inactivo",
            }
        );
    }

    const vencimiento =
        clienteData.fechaVencimiento;

    if (
        vencimiento &&
        typeof vencimiento.toMillis ===
        "function"
    ) {
        if (
            vencimiento.toMillis() <
            Date.now()
        ) {
            throw new HttpsError(
                "failed-precondition",
                "La licencia está vencida.",
                {
                    motivo: "vencido",
                }
            );
        }
    }
}

/* =========================================================
   REVOCACIÓN DE SESIONES
========================================================= */

function validarSesionNoRevocada(
    auth,
    clienteData
) {
    const revocadoEn =
        numeroSeguro(
            clienteData
                ?.sesionesRevocadasEnSec,
            0
        );

    if (!revocadoEn) {
        return;
    }

    const authTime =
        numeroSeguro(
            auth?.token?.auth_time,
            0
        );

    /*
     * El usuario deberá volver a autenticarse
     * después de un "cerrar todas las sesiones".
     */
    if (
        authTime &&
        authTime <= revocadoEn
    ) {
        throw new HttpsError(
            "unauthenticated",
            "La sesión fue cerrada por el administrador. Iniciá sesión nuevamente.",
            {
                motivo:
                    "sesion-revocada",
            }
        );
    }
}

/* =========================================================
   CONTROL DE DISPOSITIVOS
========================================================= */

function obtenerMaxDispositivos(
    clienteData
) {
    const configured =
        enteroSeguro(
            clienteData
                ?.maxDispositivos,
            1
        );

    return Math.min(
        MAX_DEVICES,
        Math.max(
            MIN_DEVICES,
            configured
        )
    );
}

/*
 * Elimina del control lógico las sesiones que llevan
 * demasiado tiempo sin heartbeat.
 */
function limpiarSesionesActivas(
    rawSessions,
    nowMs = Date.now()
) {
    if (
        !rawSessions ||
        typeof rawSessions !==
        "object" ||
        Array.isArray(rawSessions)
    ) {
        return {};
    }

    const result = {};

    const cutoff =
        nowMs -
        DEVICE_ACTIVE_TIMEOUT_MS;

    for (
        const [
            deviceId,
            session,
        ] of Object.entries(
            rawSessions
        )
    ) {
        if (
            !session ||
            typeof session !==
            "object"
        ) {
            continue;
        }

        const lastSeenMs =
            numeroSeguro(
                session.lastSeenMs,
                0
            );

        if (
            lastSeenMs >= cutoff
        ) {
            result[deviceId] =
                session;
        }
    }

    return result;
}

function contarSesiones(
    sessions
) {
    return Object.keys(
        sessions || {}
    ).length;
}

/* =========================================================
   REFERENCIAS DE SEGURIDAD
========================================================= */

function getControlRef(
    clienteRef
) {
    return clienteRef
        .collection("seguridad")
        .doc("sesiones");
}

function getDeviceRef(
    clienteRef,
    deviceId
) {
    return clienteRef
        .collection("dispositivos")
        .doc(deviceId);
}

/* =========================================================
   REVOCAR TOKENS AUTH
========================================================= */

async function revocarAuthUids(
    clienteId,
    clienteData
) {
    const ids = new Set([
        clienteId,
        ...(Array.isArray(
            clienteData?.authUids
        )
            ? clienteData.authUids
            : []),
    ]);

    const promises =
        [...ids]
            .filter(Boolean)
            .map(async (uid) => {
                try {
                    await admin
                        .auth()
                        .revokeRefreshTokens(
                            uid
                        );
                } catch (error) {
                    /*
                     * Si un UID alternativo ya no existe,
                     * no hacemos fallar toda la operación.
                     */
                    if (
                        error.code !==
                        "auth/user-not-found"
                    ) {
                        console.error(
                            `Error revocando tokens de ${uid}:`,
                            error
                        );
                    }
                }
            });

    await Promise.all(
        promises
    );
}

/* =========================================================
   LISTAR CLIENTES
========================================================= */

exports.listarClientes =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const snapshot =
                await db
                    .collection(
                        "clientes"
                    )
                    .orderBy(
                        "fechaRegistro",
                        "desc"
                    )
                    .get();

            /*
             * Leemos también el control de sesiones para mostrar
             * en Admin cuántos dispositivos están activos.
             */
            const controlRefs =
                snapshot.docs.map(
                    (doc) =>
                        getControlRef(
                            doc.ref
                        )
                );

            let controlSnaps = [];

            if (
                controlRefs.length > 0
            ) {
                controlSnaps =
                    await db.getAll(
                        ...controlRefs
                    );
            }

            const now =
                Date.now();

            const clientes =
                snapshot.docs.map(
                    (doc, index) => {
                        const data =
                            doc.data();

                        const control =
                            controlSnaps[
                                index
                            ]?.data?.() ||
                            {};

                        const activeSessions =
                            limpiarSesionesActivas(
                                control.sessions,
                                now
                            );

                        return {
                            id: doc.id,

                            ...data,

                            fechaRegistro:
                                timestampToIso(
                                    data.fechaRegistro
                                ),

                            fechaUltimoPago:
                                timestampToIso(
                                    data.fechaUltimoPago
                                ),

                            fechaVencimiento:
                                timestampToIso(
                                    data.fechaVencimiento
                                ),

                            actualizadoEn:
                                timestampToIso(
                                    data.actualizadoEn
                                ),

                            maxDispositivos:
                                obtenerMaxDispositivos(
                                    data
                                ),

                            dispositivosActivos:
                                contarSesiones(
                                    activeSessions
                                ),
                        };
                    }
                );

            return {
                clientes,
            };
        }
    );

/* =========================================================
   CREAR CLIENTE
========================================================= */

exports.crearCliente =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const {
                nombreNegocio,
                email,
                password,
                plan,
                diasCubiertos,
                maxDispositivos,
            } = request.data || {};

            const cleanNombre =
                textoSeguro(
                    nombreNegocio,
                    120
                );

            const cleanEmail =
                normalizarEmail(
                    email
                );

            const cleanPassword =
                String(
                    password || ""
                );

            if (
                !cleanNombre ||
                !cleanEmail ||
                !cleanPassword
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "Faltan datos: nombreNegocio, email o password."
                );
            }

            if (
                cleanPassword.length <
                6
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "La contraseña debe tener al menos 6 caracteres."
                );
            }

            const dias =
                Math.max(
                    1,
                    enteroSeguro(
                        diasCubiertos,
                        30
                    )
                );

            const limite =
                Math.min(
                    MAX_DEVICES,
                    Math.max(
                        MIN_DEVICES,
                        enteroSeguro(
                            maxDispositivos,
                            1
                        )
                    )
                );

            let userRecord = null;

            try {
                userRecord =
                    await admin
                        .auth()
                        .createUser({
                            email:
                                cleanEmail,

                            password:
                                cleanPassword,

                            displayName:
                                cleanNombre,
                        });
            } catch (error) {
                if (
                    error.code ===
                    "auth/email-already-exists"
                ) {
                    throw new HttpsError(
                        "already-exists",
                        "Ya existe un cliente con ese email."
                    );
                }

                console.error(
                    "Error creando usuario:",
                    error
                );

                throw new HttpsError(
                    "internal",
                    "No se pudo crear el usuario."
                );
            }

            try {
                const ahora =
                    new Date();

                const vencimiento =
                    new Date(
                        ahora.getTime()
                    );

                vencimiento.setDate(
                    vencimiento.getDate() +
                    dias
                );

                await db
                    .collection(
                        "clientes"
                    )
                    .doc(
                        userRecord.uid
                    )
                    .set({
                        nombreNegocio:
                            cleanNombre,

                        email:
                            cleanEmail,

                        emailNormalizado:
                            cleanEmail,

                        estado:
                            "activo",

                        plan:
                            textoSeguro(
                                plan,
                                40
                            ) ||
                            "basico",

                        maxDispositivos:
                            limite,

                        dispositivosActivos:
                            0,

                        authUids: [
                            userRecord.uid,
                        ],

                        fechaRegistro:
                            admin.firestore.FieldValue.serverTimestamp(),

                        fechaUltimoPago:
                            admin.firestore.FieldValue.serverTimestamp(),

                        fechaVencimiento:
                            admin.firestore.Timestamp.fromDate(
                                vencimiento
                            ),

                        creadoPor:
                            request.auth.uid,
                    });

                return {
                    ok: true,
                    uid: userRecord.uid,
                };
            } catch (error) {
                /*
                 * Rollback:
                 * si Firestore falla no dejamos un usuario Auth huérfano.
                 */
                try {
                    await admin
                        .auth()
                        .deleteUser(
                            userRecord.uid
                        );
                } catch (
                rollbackError
                ) {
                    console.error(
                        "Error haciendo rollback de usuario Auth:",
                        rollbackError
                    );
                }

                console.error(
                    "Error creando documento del cliente:",
                    error
                );

                throw new HttpsError(
                    "internal",
                    "No se pudo completar la creación del cliente."
                );
            }
        }
    );

/* =========================================================
   ACTIVAR CLIENTE
========================================================= */

exports.activarCliente =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const clienteId =
                textoSeguro(
                    request.data
                        ?.clienteId,
                    180
                );

            if (!clienteId) {
                throw new HttpsError(
                    "invalid-argument",
                    "Falta clienteId."
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const snap =
                await clienteRef.get();

            if (!snap.exists) {
                throw new HttpsError(
                    "not-found",
                    "Cliente no encontrado."
                );
            }

            await clienteRef.update({
                estado: "activo",

                motivoDesactivacion:
                    admin.firestore.FieldValue.delete(),

                actualizadoPor:
                    request.auth.uid,

                actualizadoEn:
                    admin.firestore.FieldValue.serverTimestamp(),
            });

            return {
                ok: true,
            };
        }
    );

/* =========================================================
   DESACTIVAR CLIENTE
========================================================= */

exports.desactivarCliente =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const clienteId =
                textoSeguro(
                    request.data
                        ?.clienteId,
                    180
                );

            const motivo =
                textoSeguro(
                    request.data?.motivo,
                    300
                ) ||
                "No especificado";

            if (!clienteId) {
                throw new HttpsError(
                    "invalid-argument",
                    "Falta clienteId."
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const clienteSnap =
                await clienteRef.get();

            if (!clienteSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "Cliente no encontrado."
                );
            }

            const clienteData =
                clienteSnap.data();

            const controlRef =
                getControlRef(
                    clienteRef
                );

            const nowSec =
                Math.floor(
                    Date.now() / 1000
                );

            const batch =
                db.batch();

            batch.update(
                clienteRef,
                {
                    estado:
                        "inactivo",

                    motivoDesactivacion:
                        motivo,

                    dispositivosActivos:
                        0,

                    sesionesRevocadasEnSec:
                        nowSec,

                    actualizadoPor:
                        request.auth.uid,

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                }
            );

            batch.set(
                controlRef,
                {
                    sessions: {},

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                },
                {
                    merge: true,
                }
            );

            await batch.commit();

            await revocarAuthUids(
                clienteId,
                clienteData
            );

            return {
                ok: true,
            };
        }
    );

/* =========================================================
   REGISTRAR PAGO
========================================================= */

exports.registrarPago =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const {
                clienteId,
                monto,
                metodoPago,
                diasCubiertos,
            } = request.data || {};

            const amount =
                numeroSeguro(
                    monto,
                    NaN
                );

            const dias =
                enteroSeguro(
                    diasCubiertos,
                    NaN
                );

            if (
                !clienteId ||
                !Number.isFinite(
                    amount
                ) ||
                amount <= 0 ||
                !Number.isFinite(
                    dias
                ) ||
                dias <= 0
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "Ingresá clienteId, monto y días válidos."
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const clienteSnap =
                await clienteRef.get();

            if (
                !clienteSnap.exists
            ) {
                throw new HttpsError(
                    "not-found",
                    "Cliente no encontrado."
                );
            }

            const ahora =
                new Date();

            const currentData =
                clienteSnap.data();

            const vencimientoActual =
                currentData
                    .fechaVencimiento
                    ?.toDate?.() ||
                ahora;

            const baseFecha =
                vencimientoActual >
                    ahora
                    ? vencimientoActual
                    : ahora;

            const nuevoVencimiento =
                new Date(
                    baseFecha.getTime()
                );

            nuevoVencimiento.setDate(
                nuevoVencimiento.getDate() +
                dias
            );

            const batch =
                db.batch();

            const pagoRef =
                db
                    .collection(
                        "pagos"
                    )
                    .doc();

            batch.set(
                pagoRef,
                {
                    clienteId,

                    monto: amount,

                    metodoPago:
                        textoSeguro(
                            metodoPago,
                            80
                        ) ||
                        "No especificado",

                    fechaPago:
                        admin.firestore.FieldValue.serverTimestamp(),

                    diasCubiertos:
                        dias,

                    registradoPor:
                        request.auth.uid,
                }
            );

            batch.update(
                clienteRef,
                {
                    fechaUltimoPago:
                        admin.firestore.FieldValue.serverTimestamp(),

                    fechaVencimiento:
                        admin.firestore.Timestamp.fromDate(
                            nuevoVencimiento
                        ),

                    estado:
                        "activo",

                    actualizadoPor:
                        request.auth.uid,

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                }
            );

            await batch.commit();

            return {
                ok: true,

                nuevoVencimiento:
                    nuevoVencimiento.toISOString(),
            };
        }
    );

/* =========================================================
   REGISTRAR DISPOSITIVO / SESIÓN
========================================================= */

/*
 * Esta función reemplaza el sistema anterior de una única
 * "sesionActiva".
 *
 * Cada navegador tendrá:
 *
 * deviceId:
 * identifica la instalación del navegador.
 *
 * sessionId:
 * identifica el login actual.
 *
 * Ejemplo:
 *
 * clientes/{clienteId}/dispositivos/{deviceId}
 *
 * y
 *
 * clientes/{clienteId}/seguridad/sesiones
 */
exports.registrarSesion =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            if (!request.auth) {
                throw new HttpsError(
                    "unauthenticated",
                    "Debés iniciar sesión."
                );
            }

            const rawSessionId =
                request.data
                    ?.sessionId;

            /*
             * Compatibilidad temporal:
             *
             * si el frontend viejo todavía no manda deviceId,
             * usamos sessionId.
             *
             * Después actualizaremos useLicenseCheck para mandar
             * un deviceId permanente.
             */
            const rawDeviceId =
                request.data
                    ?.deviceId ||
                rawSessionId;

            const deviceId =
                validarId(
                    rawDeviceId,
                    "deviceId"
                );

            const sessionId =
                validarId(
                    rawSessionId,
                    "sessionId"
                );

            const dispositivo =
                normalizarDispositivo(
                    request.data
                        ?.dispositivo
                );

            const {
                ref: clienteRef,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const controlRef =
                getControlRef(
                    clienteRef
                );

            const deviceRef =
                getDeviceRef(
                    clienteRef,
                    deviceId
                );

            const nowMs =
                Date.now();

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        /*
                         * Todas las lecturas antes de las escrituras.
                         */
                        const clienteSnap =
                            await transaction.get(
                                clienteRef
                            );

                        const controlSnap =
                            await transaction.get(
                                controlRef
                            );

                        if (
                            !clienteSnap.exists
                        ) {
                            throw new HttpsError(
                                "not-found",
                                "Cliente no encontrado."
                            );
                        }

                        const clienteData =
                            clienteSnap.data();

                        validarLicencia(
                            clienteData
                        );

                        validarSesionNoRevocada(
                            request.auth,
                            clienteData
                        );

                        const maxDispositivos =
                            obtenerMaxDispositivos(
                                clienteData
                            );

                        const currentControl =
                            controlSnap.exists
                                ? controlSnap.data()
                                : {};

                        const sessions =
                            limpiarSesionesActivas(
                                currentControl.sessions,
                                nowMs
                            );

                        const existing =
                            sessions[
                            deviceId
                            ];

                        /*
                         * Si el dispositivo ya estaba registrado,
                         * puede renovar/reemplazar su propia sesión.
                         */
                        if (
                            !existing &&
                            contarSesiones(
                                sessions
                            ) >=
                            maxDispositivos
                        ) {
                            throw new HttpsError(
                                "resource-exhausted",
                                "Se alcanzó el límite de dispositivos de esta licencia.",
                                {
                                    motivo:
                                        "limite-dispositivos",

                                    maxDispositivos,

                                    dispositivosActivos:
                                        contarSesiones(
                                            sessions
                                        ),
                                }
                            );
                        }

                        sessions[
                            deviceId
                        ] = {
                            sessionId,

                            dispositivo,

                            iniciadoEnMs:
                                existing
                                    ?.sessionId ===
                                    sessionId
                                    ? numeroSeguro(
                                        existing.iniciadoEnMs,
                                        nowMs
                                    )
                                    : nowMs,

                            lastSeenMs:
                                nowMs,

                            authUid:
                                request.auth.uid,
                        };

                        const activeCount =
                            contarSesiones(
                                sessions
                            );

                        transaction.set(
                            controlRef,
                            {
                                sessions,

                                actualizadoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge: true,
                            }
                        );

                        transaction.update(
                            clienteRef,
                            {
                                maxDispositivos,

                                dispositivosActivos:
                                    activeCount,

                                ultimaActividadDispositivo:
                                    admin.firestore.FieldValue.serverTimestamp(),

                                authUids:
                                    admin.firestore.FieldValue.arrayUnion(
                                        request.auth.uid
                                    ),
                            }
                        );

                        transaction.set(
                            deviceRef,
                            {
                                deviceId,

                                sessionId,

                                dispositivo,

                                authUid:
                                    request.auth.uid,

                                email:
                                    normalizarEmail(
                                        request.auth
                                            .token
                                            ?.email
                                    ) ||
                                    null,

                                estado:
                                    "activo",

                                iniciadoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),

                                lastSeen:
                                    admin.firestore.FieldValue.serverTimestamp(),

                                lastSeenMs:
                                    nowMs,
                            },
                            {
                                merge: true,
                            }
                        );

                        return {
                            activeCount,
                            maxDispositivos,
                        };
                    }
                );

            return {
                ok: true,

                clienteId:
                    clienteRef.id,

                deviceId,

                sessionId,

                dispositivosActivos:
                    result.activeCount,

                maxDispositivos:
                    result.maxDispositivos,

                heartbeatCadaMs:
                    2 * 60 * 1000,
            };
        }
    );

/* =========================================================
   HEARTBEAT DE DISPOSITIVO
========================================================= */

/*
 * El POS llamará esta función aproximadamente cada 2 minutos.
 *
 * Sirve para:
 * - mantener el dispositivo activo
 * - detectar si Admin cerró la sesión
 * - detectar si cambió la licencia
 */
exports.actualizarSesion =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            if (!request.auth) {
                throw new HttpsError(
                    "unauthenticated",
                    "Debés iniciar sesión."
                );
            }

            const deviceId =
                validarId(
                    request.data
                        ?.deviceId,
                    "deviceId"
                );

            const sessionId =
                validarId(
                    request.data
                        ?.sessionId,
                    "sessionId"
                );

            const dispositivo =
                normalizarDispositivo(
                    request.data
                        ?.dispositivo,
                    {
                        allowEmpty:
                            true,
                    }
                );

            const {
                ref: clienteRef,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const controlRef =
                getControlRef(
                    clienteRef
                );

            const deviceRef =
                getDeviceRef(
                    clienteRef,
                    deviceId
                );

            const nowMs =
                Date.now();

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const clienteSnap =
                            await transaction.get(
                                clienteRef
                            );

                        const controlSnap =
                            await transaction.get(
                                controlRef
                            );

                        if (
                            !clienteSnap.exists
                        ) {
                            throw new HttpsError(
                                "not-found",
                                "Cliente no encontrado."
                            );
                        }

                        const clienteData =
                            clienteSnap.data();

                        validarLicencia(
                            clienteData
                        );

                        validarSesionNoRevocada(
                            request.auth,
                            clienteData
                        );

                        const sessions =
                            limpiarSesionesActivas(
                                controlSnap.exists
                                    ? controlSnap.data()
                                        .sessions
                                    : {},
                                nowMs
                            );

                        const current =
                            sessions[
                            deviceId
                            ];

                        /*
                         * Si desapareció del control significa:
                         *
                         * - Admin cerró la sesión
                         * - venció por inactividad
                         * - otra sesión reemplazó la sesión actual
                         */
                        if (
                            !current ||
                            current.sessionId !==
                            sessionId
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "Este dispositivo ya no tiene una sesión autorizada.",
                                {
                                    motivo:
                                        "sesion-cerrada",
                                }
                            );
                        }

                        sessions[
                            deviceId
                        ] = {
                            ...current,

                            dispositivo:
                                dispositivo ||
                                current.dispositivo,

                            lastSeenMs:
                                nowMs,
                        };

                        const activeCount =
                            contarSesiones(
                                sessions
                            );

                        transaction.set(
                            controlRef,
                            {
                                sessions,

                                actualizadoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge: true,
                            }
                        );

                        transaction.update(
                            clienteRef,
                            {
                                dispositivosActivos:
                                    activeCount,

                                ultimaActividadDispositivo:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            }
                        );

                        transaction.set(
                            deviceRef,
                            {
                                estado:
                                    "activo",

                                sessionId,

                                dispositivo:
                                    dispositivo ||
                                    current.dispositivo,

                                lastSeen:
                                    admin.firestore.FieldValue.serverTimestamp(),

                                lastSeenMs:
                                    nowMs,
                            },
                            {
                                merge: true,
                            }
                        );

                        return {
                            activeCount,

                            maxDispositivos:
                                obtenerMaxDispositivos(
                                    clienteData
                                ),
                        };
                    }
                );

            return {
                ok: true,

                dispositivosActivos:
                    result.activeCount,

                maxDispositivos:
                    result.maxDispositivos,
            };
        }
    );

/* =========================================================
   LOGOUT NORMAL DEL CLIENTE
========================================================= */

exports.cerrarSesionCliente =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            if (!request.auth) {
                throw new HttpsError(
                    "unauthenticated",
                    "Debés iniciar sesión."
                );
            }

            const deviceId =
                validarId(
                    request.data
                        ?.deviceId,
                    "deviceId"
                );

            const sessionId =
                validarId(
                    request.data
                        ?.sessionId,
                    "sessionId"
                );

            const {
                ref: clienteRef,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const controlRef =
                getControlRef(
                    clienteRef
                );

            const deviceRef =
                getDeviceRef(
                    clienteRef,
                    deviceId
                );

            const nowMs =
                Date.now();

            await db.runTransaction(
                async (
                    transaction
                ) => {
                    const controlSnap =
                        await transaction.get(
                            controlRef
                        );

                    const sessions =
                        limpiarSesionesActivas(
                            controlSnap.exists
                                ? controlSnap.data()
                                    .sessions
                                : {},
                            nowMs
                        );

                    const current =
                        sessions[
                        deviceId
                        ];

                    /*
                     * Solo puede cerrar la sesión si coincide
                     * con su sessionId actual.
                     */
                    if (
                        current?.sessionId ===
                        sessionId
                    ) {
                        delete sessions[
                            deviceId
                        ];
                    }

                    const activeCount =
                        contarSesiones(
                            sessions
                        );

                    transaction.set(
                        controlRef,
                        {
                            sessions,

                            actualizadoEn:
                                admin.firestore.FieldValue.serverTimestamp(),
                        },
                        {
                            merge: true,
                        }
                    );

                    transaction.update(
                        clienteRef,
                        {
                            dispositivosActivos:
                                activeCount,
                        }
                    );

                    transaction.set(
                        deviceRef,
                        {
                            estado:
                                "inactivo",

                            cerradoEn:
                                admin.firestore.FieldValue.serverTimestamp(),

                            lastSeenMs:
                                nowMs,
                        },
                        {
                            merge: true,
                        }
                    );
                }
            );

            return {
                ok: true,
            };
        }
    );

/* =========================================================
   ADMIN — LISTAR DISPOSITIVOS
========================================================= */

exports.listarDispositivos =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const clienteId =
                textoSeguro(
                    request.data
                        ?.clienteId,
                    180
                );

            if (!clienteId) {
                throw new HttpsError(
                    "invalid-argument",
                    "Falta clienteId."
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const clienteSnap =
                await clienteRef.get();

            if (
                !clienteSnap.exists
            ) {
                throw new HttpsError(
                    "not-found",
                    "Cliente no encontrado."
                );
            }

            const [
                controlSnap,
                devicesSnap,
            ] =
                await Promise.all([
                    getControlRef(
                        clienteRef
                    ).get(),

                    clienteRef
                        .collection(
                            "dispositivos"
                        )
                        .orderBy(
                            "lastSeenMs",
                            "desc"
                        )
                        .limit(50)
                        .get(),
                ]);

            const activeSessions =
                limpiarSesionesActivas(
                    controlSnap.exists
                        ? controlSnap.data()
                            .sessions
                        : {}
                );

            const dispositivos =
                devicesSnap.docs.map(
                    (doc) => {
                        const data =
                            doc.data();

                        const activeSession =
                            activeSessions[
                            doc.id
                            ];

                        const activo =
                            !!activeSession &&
                            activeSession.sessionId ===
                            data.sessionId;

                        const dispositivoGuardado =
                            normalizarDispositivo(
                                data.dispositivo,
                                {
                                    allowEmpty:
                                        true,
                                }
                            );

                        const dispositivoSesion =
                            normalizarDispositivo(
                                activeSession
                                    ?.dispositivo,
                                {
                                    allowEmpty:
                                        true,
                                }
                            );

                        return {
                            id: doc.id,

                            deviceId:
                                doc.id,

                            dispositivo:
                                dispositivoGuardado ||
                                dispositivoSesion ||
                                "Dispositivo desconocido",

                            email:
                                data.email ||
                                null,

                            authUid:
                                data.authUid ||
                                null,

                            activo,

                            estado:
                                activo
                                    ? "activo"
                                    : data.estado ||
                                    "inactivo",

                            iniciadoEn:
                                timestampToIso(
                                    data.iniciadoEn
                                ),

                            lastSeen:
                                timestampToIso(
                                    data.lastSeen
                                ),

                            cerradoEn:
                                timestampToIso(
                                    data.cerradoEn
                                ),

                            cerradoPorAdminEn:
                                timestampToIso(
                                    data
                                        .cerradoPorAdminEn
                                ),
                        };
                    }
                );

            return {
                dispositivos,

                dispositivosActivos:
                    contarSesiones(
                        activeSessions
                    ),

                maxDispositivos:
                    obtenerMaxDispositivos(
                        clienteSnap.data()
                    ),

                timeoutMinutos:
                    DEVICE_ACTIVE_TIMEOUT_MS /
                    60000,
            };
        }
    );

/* =========================================================
   ADMIN — CAMBIAR LÍMITE DE DISPOSITIVOS
========================================================= */

exports.actualizarLimiteDispositivos =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const clienteId =
                textoSeguro(
                    request.data
                        ?.clienteId,
                    180
                );

            const nuevoLimite =
                enteroSeguro(
                    request.data
                        ?.maxDispositivos,
                    NaN
                );

            if (!clienteId) {
                throw new HttpsError(
                    "invalid-argument",
                    "Falta clienteId."
                );
            }

            if (
                !Number.isFinite(
                    nuevoLimite
                ) ||
                nuevoLimite <
                MIN_DEVICES ||
                nuevoLimite >
                MAX_DEVICES
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    `El límite debe estar entre ${MIN_DEVICES} y ${MAX_DEVICES}.`
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const controlRef =
                getControlRef(
                    clienteRef
                );

            const nowMs =
                Date.now();

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const clienteSnap =
                            await transaction.get(
                                clienteRef
                            );

                        const controlSnap =
                            await transaction.get(
                                controlRef
                            );

                        if (
                            !clienteSnap.exists
                        ) {
                            throw new HttpsError(
                                "not-found",
                                "Cliente no encontrado."
                            );
                        }

                        let sessions =
                            limpiarSesionesActivas(
                                controlSnap.exists
                                    ? controlSnap.data()
                                        .sessions
                                    : {},
                                nowMs
                            );

                        /*
                         * Si bajamos el límite y hay demasiados activos,
                         * conservamos los dispositivos de actividad más reciente.
                         */
                        const sorted =
                            Object.entries(
                                sessions
                            ).sort(
                                (
                                    [, a],
                                    [, b]
                                ) =>
                                    numeroSeguro(
                                        b.lastSeenMs
                                    ) -
                                    numeroSeguro(
                                        a.lastSeenMs
                                    )
                            );

                        const keep =
                            sorted.slice(
                                0,
                                nuevoLimite
                            );

                        const removed =
                            sorted.slice(
                                nuevoLimite
                            );

                        sessions =
                            Object.fromEntries(
                                keep
                            );

                        transaction.update(
                            clienteRef,
                            {
                                maxDispositivos:
                                    nuevoLimite,

                                dispositivosActivos:
                                    contarSesiones(
                                        sessions
                                    ),

                                actualizadoPor:
                                    request.auth.uid,

                                actualizadoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            }
                        );

                        transaction.set(
                            controlRef,
                            {
                                sessions,

                                actualizadoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge: true,
                            }
                        );

                        for (
                            const [
                                deviceId,
                            ] of removed
                        ) {
                            transaction.set(
                                getDeviceRef(
                                    clienteRef,
                                    deviceId
                                ),
                                {
                                    estado:
                                        "cerrado-admin",

                                    cerradoPorAdminEn:
                                        admin.firestore.FieldValue.serverTimestamp(),

                                    cerradoPor:
                                        request.auth.uid,
                                },
                                {
                                    merge: true,
                                }
                            );
                        }

                        return {
                            active:
                                contarSesiones(
                                    sessions
                                ),

                            removed:
                                removed.map(
                                    ([
                                        deviceId,
                                    ]) =>
                                        deviceId
                                ),
                        };
                    }
                );

            return {
                ok: true,

                maxDispositivos:
                    nuevoLimite,

                dispositivosActivos:
                    result.active,

                dispositivosCerrados:
                    result.removed,
            };
        }
    );

/* =========================================================
   ADMIN — CERRAR UN DISPOSITIVO
========================================================= */

exports.cerrarSesionDispositivo =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const clienteId =
                textoSeguro(
                    request.data
                        ?.clienteId,
                    180
                );

            const deviceId =
                validarId(
                    request.data
                        ?.deviceId,
                    "deviceId"
                );

            if (!clienteId) {
                throw new HttpsError(
                    "invalid-argument",
                    "Falta clienteId."
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const controlRef =
                getControlRef(
                    clienteRef
                );

            const deviceRef =
                getDeviceRef(
                    clienteRef,
                    deviceId
                );

            const nowMs =
                Date.now();

            await db.runTransaction(
                async (
                    transaction
                ) => {
                    const clienteSnap =
                        await transaction.get(
                            clienteRef
                        );

                    const controlSnap =
                        await transaction.get(
                            controlRef
                        );

                    if (
                        !clienteSnap.exists
                    ) {
                        throw new HttpsError(
                            "not-found",
                            "Cliente no encontrado."
                        );
                    }

                    const sessions =
                        limpiarSesionesActivas(
                            controlSnap.exists
                                ? controlSnap.data()
                                    .sessions
                                : {},
                            nowMs
                        );

                    delete sessions[
                        deviceId
                    ];

                    transaction.set(
                        controlRef,
                        {
                            sessions,

                            actualizadoEn:
                                admin.firestore.FieldValue.serverTimestamp(),
                        },
                        {
                            merge: true,
                        }
                    );

                    transaction.update(
                        clienteRef,
                        {
                            dispositivosActivos:
                                contarSesiones(
                                    sessions
                                ),

                            actualizadoPor:
                                request.auth.uid,

                            actualizadoEn:
                                admin.firestore.FieldValue.serverTimestamp(),
                        }
                    );

                    transaction.set(
                        deviceRef,
                        {
                            estado:
                                "cerrado-admin",

                            cerradoPor:
                                request.auth.uid,

                            cerradoPorAdminEn:
                                admin.firestore.FieldValue.serverTimestamp(),
                        },
                        {
                            merge: true,
                        }
                    );
                }
            );

            return {
                ok: true,
            };
        }
    );

/* =========================================================
   ADMIN — CERRAR TODAS LAS SESIONES
========================================================= */

exports.cerrarTodasLasSesiones =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const clienteId =
                textoSeguro(
                    request.data
                        ?.clienteId,
                    180
                );

            if (!clienteId) {
                throw new HttpsError(
                    "invalid-argument",
                    "Falta clienteId."
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const clienteSnap =
                await clienteRef.get();

            if (
                !clienteSnap.exists
            ) {
                throw new HttpsError(
                    "not-found",
                    "Cliente no encontrado."
                );
            }

            const clienteData =
                clienteSnap.data();

            const controlRef =
                getControlRef(
                    clienteRef
                );

            const nowSec =
                Math.floor(
                    Date.now() / 1000
                );

            const batch =
                db.batch();

            batch.set(
                controlRef,
                {
                    sessions: {},

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                },
                {
                    merge: true,
                }
            );

            batch.update(
                clienteRef,
                {
                    dispositivosActivos:
                        0,

                    sesionesRevocadasEnSec:
                        nowSec,

                    actualizadoPor:
                        request.auth.uid,

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                }
            );

            await batch.commit();

            /*
             * También revocamos los refresh tokens de Firebase Auth.
             */
            await revocarAuthUids(
                clienteId,
                clienteData
            );

            return {
                ok: true,
            };
        }
    );

/* =========================================================
   ELIMINAR SUBCOLECCIÓN
========================================================= */

async function borrarColeccion(
    collectionRef,
    batchSize = 400
) {
    while (true) {
        const snapshot =
            await collectionRef
                .limit(batchSize)
                .get();

        if (snapshot.empty) {
            return;
        }

        const batch =
            db.batch();

        snapshot.docs.forEach(
            (doc) => {
                batch.delete(
                    doc.ref
                );
            }
        );

        await batch.commit();

        if (
            snapshot.size <
            batchSize
        ) {
            return;
        }
    }
}

/* =========================================================
   ELIMINAR CLIENTE
========================================================= */

exports.eliminarCliente =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const clienteId =
                textoSeguro(
                    request.data
                        ?.clienteId,
                    180
                );

            if (!clienteId) {
                throw new HttpsError(
                    "invalid-argument",
                    "Falta clienteId."
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const clienteSnap =
                await clienteRef.get();

            if (
                !clienteSnap.exists
            ) {
                throw new HttpsError(
                    "not-found",
                    "Cliente no encontrado."
                );
            }

            /*
             * Primero eliminamos las subcolecciones conocidas.
             *
             * Firestore no elimina subcolecciones automáticamente
             * cuando se elimina el documento padre.
             */
            await Promise.all([
                borrarColeccion(
                    clienteRef.collection(
                        "dispositivos"
                    )
                ),

                borrarColeccion(
                    clienteRef.collection(
                        "seguridad"
                    )
                ),
            ]);

            try {
                await admin
                    .auth()
                    .deleteUser(
                        clienteId
                    );
            } catch (error) {
                if (
                    error.code !==
                    "auth/user-not-found"
                ) {
                    console.error(
                        "Error eliminando usuario Auth:",
                        error
                    );

                    throw new HttpsError(
                        "internal",
                        "No se pudo eliminar el usuario de Auth."
                    );
                }
            }

            await clienteRef.delete();

            /*
             * El historial de pagos se conserva intencionalmente.
             */
            return {
                ok: true,
            };
        }
    );

/* =========================================================
   RESTABLECER PASSWORD
========================================================= */

exports.restablecerPassword =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            await verificarAdmin(
                request.auth
            );

            const clienteId =
                textoSeguro(
                    request.data
                        ?.clienteId,
                    180
                );

            if (!clienteId) {
                throw new HttpsError(
                    "invalid-argument",
                    "Falta clienteId."
                );
            }

            const clienteRef =
                db
                    .collection(
                        "clientes"
                    )
                    .doc(clienteId);

            const clienteSnap =
                await clienteRef.get();

            if (
                !clienteSnap.exists
            ) {
                throw new HttpsError(
                    "not-found",
                    "Cliente no encontrado."
                );
            }

            /*
             * crypto es preferible a Math.random para generar credenciales.
             */
            const nuevaPassword =
                `${crypto
                    .randomBytes(9)
                    .toString(
                        "base64url"
                    )}A1!`;

            try {
                await admin
                    .auth()
                    .updateUser(
                        clienteId,
                        {
                            password:
                                nuevaPassword,
                        }
                    );
            } catch (error) {
                console.error(
                    "Error restableciendo contraseña:",
                    error
                );

                throw new HttpsError(
                    "internal",
                    "No se pudo actualizar la contraseña."
                );
            }

            const nowSec =
                Math.floor(
                    Date.now() / 1000
                );

            const batch =
                db.batch();

            batch.update(
                clienteRef,
                {
                    dispositivosActivos:
                        0,

                    sesionesRevocadasEnSec:
                        nowSec,

                    actualizadoPor:
                        request.auth.uid,

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                }
            );

            batch.set(
                getControlRef(
                    clienteRef
                ),
                {
                    sessions: {},

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                },
                {
                    merge: true,
                }
            );

            await batch.commit();

            await revocarAuthUids(
                clienteId,
                clienteSnap.data()
            );

            return {
                ok: true,

                nuevaPassword,
            };
        }
    );

/* =========================================================
   REVISAR VENCIMIENTOS
========================================================= */

exports.revisarVencimientos =
    onSchedule(
        "every 24 hours",
        async () => {
            const ahora =
                admin.firestore.Timestamp.now();

            const snapshot =
                await db
                    .collection(
                        "clientes"
                    )
                    .where(
                        "estado",
                        "==",
                        "activo"
                    )
                    .where(
                        "fechaVencimiento",
                        "<",
                        ahora
                    )
                    .get();

            if (
                snapshot.empty
            ) {
                console.log(
                    "No hay clientes vencidos."
                );

                return;
            }

            const nowSec =
                Math.floor(
                    Date.now() / 1000
                );

            /*
             * Dos escrituras por cliente:
             * cliente + control de sesiones.
             *
             * Usamos grupos pequeños para permanecer lejos
             * del límite máximo de operaciones por batch.
             */
            const chunkSize = 200;

            for (
                let i = 0;
                i <
                snapshot.docs.length;
                i += chunkSize
            ) {
                const chunk =
                    snapshot.docs.slice(
                        i,
                        i + chunkSize
                    );

                const batch =
                    db.batch();

                chunk.forEach(
                    (doc) => {
                        batch.update(
                            doc.ref,
                            {
                                estado:
                                    "vencido",

                                dispositivosActivos:
                                    0,

                                sesionesRevocadasEnSec:
                                    nowSec,

                                vencidoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            }
                        );

                        batch.set(
                            getControlRef(
                                doc.ref
                            ),
                            {
                                sessions: {},

                                actualizadoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge: true,
                            }
                        );
                    }
                );

                await batch.commit();
            }

            /*
             * Revocamos refresh tokens después de actualizar Firestore.
             */
            await Promise.all(
                snapshot.docs.map(
                    (doc) =>
                        revocarAuthUids(
                            doc.id,
                            doc.data()
                        )
                )
            );

            console.log(
                `Clientes marcados como vencidos: ${snapshot.size}`
            );
        }
    );