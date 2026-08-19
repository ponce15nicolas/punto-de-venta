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
   OPERADORES INTERNOS DEL CLIENTE
========================================================= */

/*
 * Estos roles pertenecen únicamente al comercio que utiliza
 * el POS. No tienen relación con la colección global "admins",
 * que continúa reservada para el proveedor del sistema.
 */
const OPERATOR_ROLES = Object.freeze([
    "administrador",
    "encargado",
]);

const OPERATOR_SESSION_TTL_MS =
    12 * 60 * 60 * 1000;

const OPERATOR_PASSWORD_MIN_LENGTH = 6;
const OPERATOR_PASSWORD_MAX_LENGTH = 72;

const OPERATOR_PASSWORD_ITERATIONS = 210000;
const OPERATOR_PASSWORD_KEY_LENGTH = 32;
const OPERATOR_PASSWORD_DIGEST = "sha256";


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


const MAX_CIERRES_DISPOSITIVOS = 50;

/*
 * Guarda marcadores de cierre remoto por deviceId.
 *
 * El cliente ya escucha clientes/{clienteId} en tiempo real,
 * así que este mapa permite avisarle inmediatamente que su
 * sessionId fue cerrado desde Admin, sin esperar al heartbeat.
 */
function normalizarCierresDispositivos(
    value
) {
    if (!esObjetoPlano(value)) {
        return {};
    }

    const entries =
        Object.entries(value)
            .filter(
                ([
                    deviceId,
                    info,
                ]) =>
                    Boolean(
                        textoSeguro(
                            deviceId,
                            180
                        )
                    ) &&
                    esObjetoPlano(
                        info
                    ) &&
                    Boolean(
                        textoSeguro(
                            info.sessionId,
                            180
                        )
                    )
            )
            .sort(
                (
                    [, a],
                    [, b]
                ) =>
                    numeroSeguro(
                        b.cerradoEnMs,
                        0
                    ) -
                    numeroSeguro(
                        a.cerradoEnMs,
                        0
                    )
            )
            .slice(
                0,
                MAX_CIERRES_DISPOSITIVOS
            );

    return Object.fromEntries(
        entries
    );
}

function marcarCierreDispositivo(
    current,
    deviceId,
    session,
    nowMs,
    motivo = "cerrado-admin"
) {
    const cleanDeviceId =
        textoSeguro(
            deviceId,
            180
        );

    const sessionId =
        textoSeguro(
            session?.sessionId,
            180
        );

    const next =
        normalizarCierresDispositivos(
            current
        );

    if (
        !cleanDeviceId ||
        !sessionId
    ) {
        return next;
    }

    next[
        cleanDeviceId
    ] = {
        sessionId,

        cerradoEnMs:
            numeroSeguro(
                nowMs,
                Date.now()
            ),

        motivo:
            textoSeguro(
                motivo,
                80
            ) ||
            "cerrado-admin",
    };

    return normalizarCierresDispositivos(
        next
    );
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
   OPERADORES — HELPERS
========================================================= */

function normalizarNombreOperador(
    value
) {
    return textoSeguro(
        value,
        80
    );
}

function normalizarNombreOperadorKey(
    value
) {
    return normalizarNombreOperador(
        value
    )
        .normalize("NFD")
        .replace(
            /[\u0300-\u036f]/g,
            ""
        )
        .toLowerCase()
        .replace(
            /\s+/g,
            " "
        )
        .trim();
}

function validarRolOperador(
    value
) {
    const rol =
        textoSeguro(
            value,
            40
        ).toLowerCase();

    if (
        !OPERATOR_ROLES.includes(
            rol
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Rol de operador inválido."
        );
    }

    return rol;
}

function validarClaveOperador(
    value
) {
    const clave =
        String(
            value || ""
        );

    if (
        clave.length <
            OPERATOR_PASSWORD_MIN_LENGTH ||
        clave.length >
            OPERATOR_PASSWORD_MAX_LENGTH
    ) {
        throw new HttpsError(
            "invalid-argument",
            `La clave debe tener entre ${OPERATOR_PASSWORD_MIN_LENGTH} y ${OPERATOR_PASSWORD_MAX_LENGTH} caracteres.`
        );
    }

    return clave;
}

function pbkdf2Async(
    password,
    salt
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
            crypto.pbkdf2(
                password,
                salt,
                OPERATOR_PASSWORD_ITERATIONS,
                OPERATOR_PASSWORD_KEY_LENGTH,
                OPERATOR_PASSWORD_DIGEST,
                (
                    error,
                    derivedKey
                ) => {
                    if (error) {
                        reject(error);

                        return;
                    }

                    resolve(
                        derivedKey
                    );
                }
            );
        }
    );
}

async function generarHashClaveOperador(
    clave
) {
    const salt =
        crypto
            .randomBytes(16)
            .toString("hex");

    const derivedKey =
        await pbkdf2Async(
            clave,
            salt
        );

    return {
        salt,
        hash:
            derivedKey.toString(
                "hex"
            ),
        iterations:
            OPERATOR_PASSWORD_ITERATIONS,
        keyLength:
            OPERATOR_PASSWORD_KEY_LENGTH,
        digest:
            OPERATOR_PASSWORD_DIGEST,
        version: 1,
    };
}

async function verificarClaveOperador(
    clave,
    passwordData
) {
    try {
        if (
            !passwordData ||
            typeof passwordData !==
                "object"
        ) {
            return false;
        }

        const salt =
            String(
                passwordData.salt ||
                ""
            );

        const storedHash =
            String(
                passwordData.hash ||
                ""
            );

        const iterations =
            enteroSeguro(
                passwordData.iterations,
                OPERATOR_PASSWORD_ITERATIONS
            );

        const keyLength =
            enteroSeguro(
                passwordData.keyLength,
                OPERATOR_PASSWORD_KEY_LENGTH
            );

        const digest =
            textoSeguro(
                passwordData.digest,
                30
            ) ||
            OPERATOR_PASSWORD_DIGEST;

        if (
            !salt ||
            !storedHash ||
            iterations < 100000 ||
            keyLength < 16
        ) {
            return false;
        }

        const derivedKey =
            await new Promise(
                (
                    resolve,
                    reject
                ) => {
                    crypto.pbkdf2(
                        clave,
                        salt,
                        iterations,
                        keyLength,
                        digest,
                        (
                            error,
                            key
                        ) => {
                            if (error) {
                                reject(
                                    error
                                );

                                return;
                            }

                            resolve(
                                key
                            );
                        }
                    );
                }
            );

        const expected =
            Buffer.from(
                storedHash,
                "hex"
            );

        if (
            expected.length !==
            derivedKey.length
        ) {
            return false;
        }

        return crypto.timingSafeEqual(
            expected,
            derivedKey
        );
    } catch (error) {
        console.error(
            "Error verificando clave de operador:",
            error
        );

        return false;
    }
}


/* =========================================================
   OPERADORES — SEMILLA DE RECUPERACIÓN
========================================================= */

/*
 * La semilla se genera con 128 bits aleatorios.
 * Se muestra una sola vez al crear/recuperar un Administrador.
 *
 * Firestore guarda únicamente SHA-256 de la semilla normalizada.
 * La semilla no sirve para iniciar sesión: sólo para recuperar
 * la clave de ese Administrador específico.
 */
function normalizarSemillaRecuperacion(
    value
) {
    return String(
        value || ""
    )
        .toUpperCase()
        .replace(
            /[^A-Z0-9]/g,
            ""
        );
}

function generarSemillaRecuperacion() {
    const raw =
        crypto
            .randomBytes(16)
            .toString("hex")
            .toUpperCase();

    return raw
        .match(/.{1,4}/g)
        .join("-");
}

function hashSemillaRecuperacion(
    semilla
) {
    const normalized =
        normalizarSemillaRecuperacion(
            semilla
        );

    return crypto
        .createHash("sha256")
        .update(normalized)
        .digest("hex");
}

function crearDatosSemillaRecuperacion() {
    const semilla =
        generarSemillaRecuperacion();

    return {
        semilla,

        data: {
            hash:
                hashSemillaRecuperacion(
                    semilla
                ),

            version: 1,

            creadaEn:
                admin.firestore.FieldValue.serverTimestamp(),
        },
    };
}

function verificarSemillaRecuperacion(
    semilla,
    stored
) {
    const normalized =
        normalizarSemillaRecuperacion(
            semilla
        );

    const expectedHash =
        String(
            stored?.hash ||
            ""
        );

    if (
        normalized.length !== 32 ||
        !/^[A-F0-9]{32}$/.test(
            normalized
        ) ||
        !/^[a-f0-9]{64}$/i.test(
            expectedHash
        )
    ) {
        return false;
    }

    const receivedHash =
        hashSemillaRecuperacion(
            normalized
        );

    const expectedBuffer =
        Buffer.from(
            expectedHash,
            "hex"
        );

    const receivedBuffer =
        Buffer.from(
            receivedHash,
            "hex"
        );

    return (
        expectedBuffer.length ===
            receivedBuffer.length &&
        crypto.timingSafeEqual(
            expectedBuffer,
            receivedBuffer
        )
    );
}


function getOperatorsConfigRef(
    clienteRef
) {
    return clienteRef
        .collection(
            "seguridad"
        )
        .doc(
            "operadores"
        );
}

function getOperatorRef(
    clienteRef,
    operadorId
) {
    return clienteRef
        .collection(
            "operadores"
        )
        .doc(
            operadorId
        );
}

function getOperatorSessionRef(
    clienteRef,
    sesionId
) {
    return clienteRef
        .collection(
            "sesionesOperador"
        )
        .doc(
            sesionId
        );
}

function hashOperatorSessionToken(
    token
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            String(
                token || ""
            )
        )
        .digest(
            "hex"
        );
}

function operadorPublico(
    operadorId,
    data
) {
    return {
        id:
            operadorId,

        nombre:
            textoSeguro(
                data?.nombre,
                80
            ),

        rol:
            OPERATOR_ROLES.includes(
                data?.rol
            )
                ? data.rol
                : "encargado",

        activo:
            data?.activo !==
            false,
    };
}

async function crearSesionOperador(
    clienteRef,
    operadorId,
    rol,
    deviceId = null
) {
    const sesionId =
        crypto.randomUUID();

    const token =
        crypto
            .randomBytes(32)
            .toString(
                "base64url"
            );

    const ahora =
        Date.now();

    const expiresAt =
        admin.firestore.Timestamp.fromMillis(
            ahora +
            OPERATOR_SESSION_TTL_MS
        );

    await getOperatorSessionRef(
        clienteRef,
        sesionId
    ).set({
        operadorId,

        rol,

        deviceId:
            textoSeguro(
                deviceId,
                180
            ) ||
            null,

        tokenHash:
            hashOperatorSessionToken(
                token
            ),

        activo: true,

        creadaEn:
            admin.firestore.FieldValue.serverTimestamp(),

        ultimaActividadEn:
            admin.firestore.FieldValue.serverTimestamp(),

        expiraEn:
            expiresAt,
    });

    return {
        id:
            sesionId,

        token,

        expiraEn:
            expiresAt
                .toDate()
                .toISOString(),
    };
}

async function validarSesionOperadorInterna(
    clienteRef,
    sessionData,
    {
        requireRole = null,
        deviceId = null,
    } = {}
) {
    const sesionId =
        validarId(
            sessionData?.id,
            "operadorSesion.id"
        );

    const token =
        String(
            sessionData?.token ||
            ""
        );

    if (!token) {
        throw new HttpsError(
            "unauthenticated",
            "Ingresá nuevamente con tu usuario interno."
        );
    }

    const sessionRef =
        getOperatorSessionRef(
            clienteRef,
            sesionId
        );

    const sessionSnap =
        await sessionRef.get();

    if (!sessionSnap.exists) {
        throw new HttpsError(
            "unauthenticated",
            "La sesión interna ya no es válida."
        );
    }

    const session =
        sessionSnap.data() ||
        {};

    if (
        session.activo ===
        false
    ) {
        throw new HttpsError(
            "unauthenticated",
            "La sesión interna fue cerrada."
        );
    }

    const expiraEnMs =
        session.expiraEn
            ?.toMillis?.() ||
        0;

    if (
        !expiraEnMs ||
        expiraEnMs <
            Date.now()
    ) {
        await sessionRef.set(
            {
                activo: false,

                cerradaEn:
                    admin.firestore.FieldValue.serverTimestamp(),

                motivoCierre:
                    "expirada",
            },
            {
                merge: true,
            }
        );

        throw new HttpsError(
            "unauthenticated",
            "La sesión interna venció. Ingresá nuevamente."
        );
    }

    const expectedHash =
        String(
            session.tokenHash ||
            ""
        );

    const receivedHash =
        hashOperatorSessionToken(
            token
        );

    const expectedBuffer =
        Buffer.from(
            expectedHash,
            "hex"
        );

    const receivedBuffer =
        Buffer.from(
            receivedHash,
            "hex"
        );

    if (
        expectedBuffer.length === 0 ||
        expectedBuffer.length !==
            receivedBuffer.length ||
        !crypto.timingSafeEqual(
            expectedBuffer,
            receivedBuffer
        )
    ) {
        throw new HttpsError(
            "unauthenticated",
            "La sesión interna no es válida."
        );
    }

    const expectedDeviceId =
        textoSeguro(
            session.deviceId,
            180
        );

    const receivedDeviceId =
        textoSeguro(
            deviceId,
            180
        );

    if (
        expectedDeviceId &&
        receivedDeviceId &&
        expectedDeviceId !==
            receivedDeviceId
    ) {
        throw new HttpsError(
            "permission-denied",
            "Esta sesión interna pertenece a otro dispositivo."
        );
    }

    const operadorId =
        validarId(
            session.operadorId,
            "operadorId"
        );

    const operadorSnap =
        await getOperatorRef(
            clienteRef,
            operadorId
        ).get();

    if (!operadorSnap.exists) {
        throw new HttpsError(
            "unauthenticated",
            "El operador ya no existe."
        );
    }

    const operador =
        operadorSnap.data() ||
        {};

    if (
        operador.activo ===
        false
    ) {
        throw new HttpsError(
            "permission-denied",
            "El operador está desactivado."
        );
    }

    const rol =
        validarRolOperador(
            operador.rol
        );

    if (
        requireRole &&
        rol !==
            requireRole
    ) {
        throw new HttpsError(
            "permission-denied",
            "Esta operación requiere un administrador del negocio."
        );
    }

    await sessionRef.set(
        {
            ultimaActividadEn:
                admin.firestore.FieldValue.serverTimestamp(),

            rol,
        },
        {
            merge: true,
        }
    );

    return {
        ref:
            operadorSnap.ref,

        id:
            operadorId,

        data:
            operador,

        rol,

        sessionRef,

        session:
            session,
    };
}



/* =========================================================
   AUDITORÍA OPERATIVA — HELPERS
========================================================= */

/*
 * La auditoría pertenece exclusivamente al cliente del POS.
 *
 * Colección:
 * clientes/{clienteId}/auditoria/{eventoId}
 *
 * En esta primera etapa sólo dejamos la infraestructura común.
 * Las acciones concretas se conectarán una por una para evitar
 * regresiones en caja, inventario e historial.
 */
const AUDIT_ACTIONS = Object.freeze({
    APERTURA_CAJA:
        "apertura-caja",

    CIERRE_CAJA:
        "cierre-caja",

    REPOSICION_STOCK:
        "reposicion-stock",

    EDICION_PRODUCTO:
        "edicion-producto",

    ELIMINACION_CIERRE_HISTORICO:
        "eliminacion-cierre-historico",
});

const AUDIT_ACTION_VALUES =
    Object.freeze(
        Object.values(
            AUDIT_ACTIONS
        )
    );

const AUDIT_DETAIL_MAX_KEYS = 20;
const AUDIT_DETAIL_MAX_TEXT_LENGTH = 300;

function validarAccionAuditoria(
    value
) {
    const accion =
        textoSeguro(
            value,
            80
        );

    if (
        !AUDIT_ACTION_VALUES.includes(
            accion
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Acción de auditoría inválida."
        );
    }

    return accion;
}

/*
 * Acepta sólo datos simples y acotados.
 *
 * Esto evita guardar objetos arbitrarios, credenciales,
 * sesiones completas o estructuras demasiado grandes dentro
 * de los eventos de auditoría.
 */
function normalizarDetalleAuditoria(
    value
) {
    if (
        !esObjetoPlano(
            value
        )
    ) {
        return {};
    }

    const result = {};

    const entries =
        Object.entries(
            value
        ).slice(
            0,
            AUDIT_DETAIL_MAX_KEYS
        );

    for (
        const [
            rawKey,
            rawValue,
        ] of entries
    ) {
        const key =
            textoSeguro(
                rawKey,
                80
            );

        if (!key) {
            continue;
        }

        if (
            typeof rawValue ===
                "string"
        ) {
            result[key] =
                textoSeguro(
                    rawValue,
                    AUDIT_DETAIL_MAX_TEXT_LENGTH
                );

            continue;
        }

        if (
            typeof rawValue ===
                "number" &&
            Number.isFinite(
                rawValue
            )
        ) {
            result[key] =
                rawValue;

            continue;
        }

        if (
            typeof rawValue ===
                "boolean"
        ) {
            result[key] =
                rawValue;

            continue;
        }

        if (
            rawValue ===
            null
        ) {
            result[key] =
                null;
        }
    }

    return result;
}

function crearEventoAuditoria(
    {
        clienteRef,
        operador,
        accion,
        detalle = {},
        deviceId = null,
    }
) {
    if (
        !clienteRef ||
        !operador?.id
    ) {
        throw new HttpsError(
            "failed-precondition",
            "No se pudo determinar el contexto de auditoría."
        );
    }

    const accionValidada =
        validarAccionAuditoria(
            accion
        );

    const eventoRef =
        clienteRef
            .collection(
                "auditoria"
            )
            .doc();

    const operadorNombre =
        textoSeguro(
            operador
                ?.data
                ?.nombre,
            80
        );

    const operadorRol =
        validarRolOperador(
            operador.rol
        );

    return {
        ref:
            eventoRef,

        data: {
            accion:
                accionValidada,

            operadorId:
                operador.id,

            operadorNombre,

            operadorRol,

            fecha:
                admin.firestore.FieldValue.serverTimestamp(),

            detalle:
                normalizarDetalleAuditoria(
                    detalle
                ),

            deviceId:
                textoSeguro(
                    deviceId,
                    180
                ) ||
                null,
        },
    };
}

/*
 * Para operaciones simples.
 *
 * En las operaciones sensibles que ya utilizan batch o
 * transaction se usará crearEventoAuditoria() y el evento
 * se escribirá dentro del MISMO commit que la mutación real.
 * Así evitamos registrar una acción que finalmente haya fallado.
 */
async function registrarAuditoria(
    options
) {
    const evento =
        crearEventoAuditoria(
            options
        );

    await evento
        .ref
        .set(
            evento.data
        );

    return evento.ref.id;
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
   OPERADORES — ESTADO
========================================================= */

exports.obtenerEstadoOperadores =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const configSnap =
                await getOperatorsConfigRef(
                    clienteRef
                ).get();

            const config =
                configSnap.data() ||
                {};

            return {
                configurado:
                    config.configurado ===
                    true,
            };
        }
    );


/* =========================================================
   OPERADORES — CONFIGURAR ADMINISTRADOR INICIAL
========================================================= */

exports.configurarAdministradorInicial =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const nombre =
                normalizarNombreOperador(
                    request.data?.nombre
                );

            const nombreKey =
                normalizarNombreOperadorKey(
                    nombre
                );

            const clave =
                validarClaveOperador(
                    request.data?.clave
                );

            const deviceId =
                textoSeguro(
                    request.data?.deviceId,
                    180
                );

            if (
                !nombre ||
                !nombreKey
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "Ingresá el nombre del administrador."
                );
            }

            const password =
                await generarHashClaveOperador(
                    clave
                );

            const recoverySeed =
                crearDatosSemillaRecuperacion();

            const operadorId =
                crypto.randomUUID();

            const operadorRef =
                getOperatorRef(
                    clienteRef,
                    operadorId
                );

            const configRef =
                getOperatorsConfigRef(
                    clienteRef
                );

            await db.runTransaction(
                async (
                    transaction
                ) => {
                    const configSnap =
                        await transaction.get(
                            configRef
                        );

                    if (
                        configSnap.exists &&
                        configSnap.data()
                            ?.configurado ===
                            true
                    ) {
                        throw new HttpsError(
                            "already-exists",
                            "El acceso interno ya fue configurado para este negocio."
                        );
                    }

                    transaction.set(
                        operadorRef,
                        {
                            nombre,

                            nombreKey,

                            rol:
                                "administrador",

                            activo:
                                true,

                            password,

                            recoverySeed:
                                recoverySeed.data,

                            creadoEn:
                                admin.firestore.FieldValue.serverTimestamp(),

                            actualizadoEn:
                                admin.firestore.FieldValue.serverTimestamp(),

                            creadoPor:
                                "configuracion-inicial",
                        }
                    );

                    transaction.set(
                        configRef,
                        {
                            configurado:
                                true,

                            administradorInicialId:
                                operadorId,

                            configuradoEn:
                                admin.firestore.FieldValue.serverTimestamp(),

                            actualizadoEn:
                                admin.firestore.FieldValue.serverTimestamp(),
                        },
                        {
                            merge: true,
                        }
                    );
                }
            );

            const sesion =
                await crearSesionOperador(
                    clienteRef,
                    operadorId,
                    "administrador",
                    deviceId
                );

            return {
                ok: true,

                operador:
                    operadorPublico(
                        operadorId,
                        {
                            nombre,
                            rol:
                                "administrador",
                            activo:
                                true,
                        }
                    ),

                sesion,

                semillaRecuperacion:
                    recoverySeed.semilla,
            };
        }
    );


/* =========================================================
   OPERADORES — LISTAR PARA ACCESO
========================================================= */

exports.listarOperadoresInternos =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const snapshot =
                await clienteRef
                    .collection(
                        "operadores"
                    )
                    .where(
                        "activo",
                        "==",
                        true
                    )
                    .get();

            const operadores =
                snapshot.docs
                    .map(
                        (doc) =>
                            operadorPublico(
                                doc.id,
                                doc.data()
                            )
                    )
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            a.nombre.localeCompare(
                                b.nombre,
                                "es",
                                {
                                    sensitivity:
                                        "base",
                                }
                            )
                    );

            return {
                operadores,
            };
        }
    );


/* =========================================================
   OPERADORES — INICIAR SESIÓN
========================================================= */

exports.iniciarSesionOperador =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const operadorId =
                validarId(
                    request.data?.operadorId,
                    "operadorId"
                );

            const clave =
                validarClaveOperador(
                    request.data?.clave
                );

            const deviceId =
                textoSeguro(
                    request.data?.deviceId,
                    180
                );

            const operadorSnap =
                await getOperatorRef(
                    clienteRef,
                    operadorId
                ).get();

            if (!operadorSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "Operador no encontrado."
                );
            }

            const operador =
                operadorSnap.data() ||
                {};

            if (
                operador.activo ===
                false
            ) {
                throw new HttpsError(
                    "permission-denied",
                    "Este operador está desactivado."
                );
            }

            const claveCorrecta =
                await verificarClaveOperador(
                    clave,
                    operador.password
                );

            if (!claveCorrecta) {
                throw new HttpsError(
                    "permission-denied",
                    "Clave incorrecta."
                );
            }

            const rol =
                validarRolOperador(
                    operador.rol
                );

            const sesion =
                await crearSesionOperador(
                    clienteRef,
                    operadorId,
                    rol,
                    deviceId
                );

            return {
                ok: true,

                operador:
                    operadorPublico(
                        operadorId,
                        operador
                    ),

                sesion,
            };
        }
    );


/* =========================================================
   OPERADORES — VALIDAR SESIÓN
========================================================= */

exports.validarSesionOperador =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const result =
                await validarSesionOperadorInterna(
                    clienteRef,
                    request.data
                        ?.operadorSesion,
                    {
                        deviceId:
                            request.data
                                ?.deviceId,
                    }
                );

            return {
                ok: true,

                operador:
                    operadorPublico(
                        result.id,
                        result.data
                    ),
            };
        }
    );


/* =========================================================
   OPERADORES — CERRAR SESIÓN
========================================================= */

exports.cerrarSesionOperador =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const result =
                await validarSesionOperadorInterna(
                    clienteRef,
                    request.data
                        ?.operadorSesion,
                    {
                        deviceId:
                            request.data
                                ?.deviceId,
                    }
                );

            await result
                .sessionRef
                .set(
                    {
                        activo:
                            false,

                        cerradaEn:
                            admin.firestore.FieldValue.serverTimestamp(),

                        motivoCierre:
                            "logout",
                    },
                    {
                        merge: true,
                    }
                );

            return {
                ok: true,
            };
        }
    );


/* =========================================================
   OPERADORES — CREAR OPERADOR
========================================================= */

exports.crearOperadorInterno =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            await validarSesionOperadorInterna(
                clienteRef,
                request.data
                    ?.operadorSesion,
                {
                    requireRole:
                        "administrador",

                    deviceId:
                        request.data
                            ?.deviceId,
                }
            );

            const nombre =
                normalizarNombreOperador(
                    request.data?.nombre
                );

            const nombreKey =
                normalizarNombreOperadorKey(
                    nombre
                );

            const rol =
                validarRolOperador(
                    request.data?.rol
                );

            const clave =
                validarClaveOperador(
                    request.data?.clave
                );

            if (
                !nombre ||
                !nombreKey
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "Ingresá el nombre del operador."
                );
            }

            const existentes =
                await clienteRef
                    .collection(
                        "operadores"
                    )
                    .where(
                        "nombreKey",
                        "==",
                        nombreKey
                    )
                    .limit(1)
                    .get();

            if (!existentes.empty) {
                throw new HttpsError(
                    "already-exists",
                    "Ya existe un operador con ese nombre."
                );
            }

            const password =
                await generarHashClaveOperador(
                    clave
                );

            const recoverySeed =
                rol ===
                "administrador"
                    ? crearDatosSemillaRecuperacion()
                    : null;

            const operadorRef =
                clienteRef
                    .collection(
                        "operadores"
                    )
                    .doc();

            const operadorData = {
                nombre,

                nombreKey,

                rol,

                activo:
                    true,

                password,

                creadoEn:
                    admin.firestore.FieldValue.serverTimestamp(),

                actualizadoEn:
                    admin.firestore.FieldValue.serverTimestamp(),
            };

            if (recoverySeed) {
                operadorData.recoverySeed =
                    recoverySeed.data;
            }

            await operadorRef.set(
                operadorData
            );

            return {
                ok: true,

                operador:
                    operadorPublico(
                        operadorRef.id,
                        {
                            nombre,
                            rol,
                            activo:
                                true,
                        }
                    ),

                semillaRecuperacion:
                    recoverySeed
                        ?.semilla ||
                    null,
            };
        }
    );



/* =========================================================
   OPERADORES — RESTABLECER CLAVE
========================================================= */

exports.restablecerClaveOperadorInterno =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            /*
             * Esta operación sólo puede realizarla un
             * Administrador interno autenticado.
             *
             * El rol nunca se toma del navegador: se resuelve
             * nuevamente desde Firestore mediante la sesión interna.
             */
            const deviceId =
                validarId(
                    request.data?.deviceId,
                    "deviceId"
                );

            const administrador =
                await validarSesionOperadorInterna(
                    clienteRef,
                    request.data
                        ?.operadorSesion,
                    {
                        requireRole:
                            "administrador",

                        deviceId,
                    }
                );

            const operadorId =
                validarId(
                    request.data?.operadorId,
                    "operadorId"
                );

            const nuevaClave =
                validarClaveOperador(
                    request.data?.nuevaClave
                );

            const operadorRef =
                getOperatorRef(
                    clienteRef,
                    operadorId
                );

            const operadorSnap =
                await operadorRef.get();

            if (!operadorSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "Operador no encontrado."
                );
            }

            const operadorData =
                operadorSnap.data() ||
                {};

            if (
                operadorData.rol ===
                "administrador"
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "La clave de un Administrador sólo puede recuperarse con su clave semilla."
                );
            }

            /*
             * La clave anterior nunca se lee ni se devuelve.
             * Generamos un hash completamente nuevo con salt aleatorio.
             */
            const password =
                await generarHashClaveOperador(
                    nuevaClave
                );

            /*
             * Revocamos todas las sesiones internas del operador.
             *
             * Esto evita que una sesión ya abierta continúe siendo
             * válida después de cambiar la clave.
             */
            const sesionesSnap =
                await clienteRef
                    .collection(
                        "sesionesOperador"
                    )
                    .where(
                        "operadorId",
                        "==",
                        operadorId
                    )
                    .get();

            /*
             * Firestore limita los batch writes a 500 operaciones.
             * Dejamos margen para la actualización del operador.
             *
             * En una instalación normal, con sesiones de 12 horas,
             * este límite no debería alcanzarse; si ocurriera,
             * preferimos fallar de forma segura antes que dejar
             * sesiones antiguas activas.
             */
            if (
                sesionesSnap.size >
                450
            ) {
                throw new HttpsError(
                    "resource-exhausted",
                    "Hay demasiadas sesiones internas para restablecer la clave de forma segura."
                );
            }

            const batch =
                db.batch();

            batch.update(
                operadorRef,
                {
                    password,

                    claveActualizadaEn:
                        admin.firestore.FieldValue.serverTimestamp(),

                    claveActualizadaPor:
                        administrador.id,

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                }
            );

            sesionesSnap.docs.forEach(
                (sesionDoc) => {
                    batch.set(
                        sesionDoc.ref,
                        {
                            activo:
                                false,

                            cerradaEn:
                                admin.firestore.FieldValue.serverTimestamp(),

                            motivoCierre:
                                "clave-restablecida",
                        },
                        {
                            merge: true,
                        }
                    );
                }
            );

            await batch.commit();

            const sesionActualRevocada =
                administrador.id ===
                operadorId;

            return {
                ok: true,

                operador:
                    operadorPublico(
                        operadorId,
                        operadorData
                    ),

                sesionActualRevocada,
            };
        }
    );



/* =========================================================
   OPERADORES — RECUPERAR ADMINISTRADOR CON SEMILLA
========================================================= */

/*
 * Recuperación de clave de un Administrador interno.
 *
 * La autorización especial de esta operación es la semilla de
 * recuperación generada para ESE Administrador.
 *
 * Además mantenemos la validación de la cuenta principal,
 * licencia y sesión activa del dispositivo para que el endpoint
 * sólo sea utilizable desde una instalación válida del POS.
 *
 * Al recuperarse la clave:
 * - se reemplaza el password;
 * - se invalidan todas las sesiones internas del Administrador;
 * - la semilla usada queda invalidada;
 * - se genera y devuelve UNA NUEVA SEMILLA para guardar.
 */
exports.recuperarAdministradorPrincipal =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const deviceId =
                validarId(
                    request.data?.deviceId,
                    "deviceId"
                );

            const sessionId =
                validarId(
                    request.data?.sessionId,
                    "sessionId"
                );

            const operadorId =
                validarId(
                    request.data?.operadorId,
                    "operadorId"
                );

            const nuevaClave =
                validarClaveOperador(
                    request.data?.nuevaClave
                );

            const semillaRecuperacion =
                String(
                    request.data
                        ?.semillaRecuperacion ||
                    ""
                );

            const controlSnap =
                await getControlRef(
                    clienteRef
                ).get();

            const nowMs =
                Date.now();

            const sesionesDispositivo =
                limpiarSesionesActivas(
                    controlSnap.exists
                        ? controlSnap.data()
                            ?.sessions
                        : {},
                    nowMs
                );

            const sesionDispositivo =
                sesionesDispositivo[
                    deviceId
                ];

            if (
                !sesionDispositivo ||
                sesionDispositivo.sessionId !==
                    sessionId ||
                sesionDispositivo.authUid !==
                    request.auth.uid
            ) {
                throw new HttpsError(
                    "permission-denied",
                    "Este dispositivo no tiene una sesión principal válida para recuperar el acceso administrativo."
                );
            }

            const administradorRef =
                getOperatorRef(
                    clienteRef,
                    operadorId
                );

            const administradorSnap =
                await administradorRef.get();

            if (!administradorSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "Administrador no encontrado."
                );
            }

            const administradorData =
                administradorSnap.data() ||
                {};

            if (
                administradorData.activo ===
                    false ||
                administradorData.rol !==
                    "administrador"
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "El usuario seleccionado no es un Administrador activo."
                );
            }

            if (
                !verificarSemillaRecuperacion(
                    semillaRecuperacion,
                    administradorData
                        .recoverySeed
                )
            ) {
                throw new HttpsError(
                    "permission-denied",
                    "La clave semilla no es válida."
                );
            }

            const password =
                await generarHashClaveOperador(
                    nuevaClave
                );

            const nuevaRecoverySeed =
                crearDatosSemillaRecuperacion();

            const sesionesOperadorSnap =
                await clienteRef
                    .collection(
                        "sesionesOperador"
                    )
                    .where(
                        "operadorId",
                        "==",
                        operadorId
                    )
                    .get();

            if (
                sesionesOperadorSnap.size >
                450
            ) {
                throw new HttpsError(
                    "resource-exhausted",
                    "Hay demasiadas sesiones internas para recuperar la cuenta de forma segura."
                );
            }

            const batch =
                db.batch();

            batch.update(
                administradorRef,
                {
                    password,

                    recoverySeed:
                        nuevaRecoverySeed.data,

                    claveActualizadaEn:
                        admin.firestore.FieldValue.serverTimestamp(),

                    claveActualizadaPor:
                        "semilla-recuperacion",

                    semillaRotadaEn:
                        admin.firestore.FieldValue.serverTimestamp(),

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                }
            );

            sesionesOperadorSnap.docs.forEach(
                (sesionDoc) => {
                    batch.set(
                        sesionDoc.ref,
                        {
                            activo:
                                false,

                            cerradaEn:
                                admin.firestore.FieldValue.serverTimestamp(),

                            motivoCierre:
                                "recuperacion-con-semilla",
                        },
                        {
                            merge: true,
                        }
                    );
                }
            );

            batch.set(
                getOperatorsConfigRef(
                    clienteRef
                ),
                {
                    ultimaRecuperacionAdminEn:
                        admin.firestore.FieldValue.serverTimestamp(),

                    ultimaRecuperacionAdminId:
                        operadorId,

                    ultimaRecuperacionDeviceId:
                        deviceId,

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                },
                {
                    merge: true,
                }
            );

            await batch.commit();

            return {
                ok: true,

                operador:
                    operadorPublico(
                        operadorId,
                        administradorData
                    ),

                nuevaSemillaRecuperacion:
                    nuevaRecoverySeed.semilla,
            };
        }
    );


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

                        const cierresDispositivos =
                            normalizarCierresDispositivos(
                                clienteData
                                    .cierresDispositivos
                            );

                        /*
                         * Un nuevo login usa un sessionId nuevo.
                         * Eliminamos el marcador viejo de este deviceId
                         * para mantener el documento acotado y limpio.
                         */
                        if (
                            cierresDispositivos[
                                deviceId
                            ]
                        ) {
                            delete cierresDispositivos[
                                deviceId
                            ];
                        }

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

                                cierresDispositivos,
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

                        const clienteData =
                            clienteSnap.data();

                        let sessions =
                            limpiarSesionesActivas(
                                controlSnap.exists
                                    ? controlSnap.data()
                                        .sessions
                                    : {},
                                nowMs
                            );

                        let cierresDispositivos =
                            normalizarCierresDispositivos(
                                clienteData
                                    .cierresDispositivos
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

                        for (
                            const [
                                removedDeviceId,
                                removedSession,
                            ] of removed
                        ) {
                            cierresDispositivos =
                                marcarCierreDispositivo(
                                    cierresDispositivos,
                                    removedDeviceId,
                                    removedSession,
                                    nowMs,
                                    "limite-reducido"
                                );
                        }

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

                                cierresDispositivos,
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

                    const clienteData =
                        clienteSnap.data();

                    const sessions =
                        limpiarSesionesActivas(
                            controlSnap.exists
                                ? controlSnap.data()
                                    .sessions
                                : {},
                            nowMs
                        );

                    const currentSession =
                        sessions[
                            deviceId
                        ];

                    const cierresDispositivos =
                        marcarCierreDispositivo(
                            clienteData
                                .cierresDispositivos,
                            deviceId,
                            currentSession,
                            nowMs,
                            "cerrado-admin"
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

                            cierresDispositivos,
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

            const controlRef =
                getControlRef(
                    clienteRef
                );

            const [
                clienteSnap,
                controlSnap,
            ] =
                await Promise.all([
                    clienteRef.get(),
                    controlRef.get(),
                ]);

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

            const nowMs =
                Date.now();

            const nowSec =
                Math.floor(
                    nowMs / 1000
                );

            const sessions =
                limpiarSesionesActivas(
                    controlSnap.exists
                        ? controlSnap.data()
                            .sessions
                        : {},
                    nowMs
                );

            let cierresDispositivos =
                normalizarCierresDispositivos(
                    clienteData
                        .cierresDispositivos
                );

            for (
                const [
                    deviceId,
                    session,
                ] of Object.entries(
                    sessions
                )
            ) {
                cierresDispositivos =
                    marcarCierreDispositivo(
                        cierresDispositivos,
                        deviceId,
                        session,
                        nowMs,
                        "cerrar-todas"
                    );
            }

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

                    cierresDispositivos,

                    actualizadoPor:
                        request.auth.uid,

                    actualizadoEn:
                        admin.firestore.FieldValue.serverTimestamp(),
                }
            );

            for (
                const deviceId of
                Object.keys(
                    sessions
                )
            ) {
                batch.set(
                    getDeviceRef(
                        clienteRef,
                        deviceId
                    ),
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
   POS — ELIMINAR CIERRE DE CAJA
========================================================= */

/*
 * Elimina de forma controlada un cierre histórico del POS.
 *
 * Reglas:
 * - requiere un usuario autenticado asociado al cliente
 * - la licencia debe seguir activa
 * - sólo permite cajas con status "closed"
 * - elimina primero todas las ventas ligadas al cierre
 * - elimina el documento de caja al final
 *
 * El borrado de ventas se realiza por lotes para no superar
 * el límite de escrituras de Firestore. Si una ejecución se
 * interrumpe antes de terminar, el documento de caja permanece
 * y la operación puede reintentarse de forma segura.
 */

/* =========================================================
   ABRIR CAJA + AUDITORÍA
========================================================= */

/*
 * La apertura pasa por backend para que:
 *
 * - la licencia sea validada;
 * - la sesión interna sea validada;
 * - Administrador y Encargado puedan abrir caja;
 * - la identidad del operador se resuelva desde Firestore;
 * - la caja, la configuración y la auditoría se escriban
 *   dentro de la misma transacción.
 */

/* =========================================================
   REPONER STOCK + AUDITORÍA
========================================================= */

/*
 * La reposición pasa por backend para que:
 *
 * - la licencia sea validada;
 * - la sesión interna sea validada;
 * - Administrador y Encargado puedan reponer;
 * - la identidad del operador se resuelva desde Firestore;
 * - el cambio de stock y la auditoría se escriban
 *   dentro de la misma transacción.
 */

/* =========================================================
   EDITAR PRODUCTO + AUDITORÍA
========================================================= */

/*
 * Sólo la EDICIÓN pasa por esta callable.
 *
 * El alta de un producto sigue fuera de esta auditoría porque
 * la acción definida es "edicion-producto".
 *
 * La edición y el evento de auditoría se escriben en la misma
 * transacción. Administrador y Encargado pueden editar.
 */
exports.editarProducto =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const deviceId =
                validarId(
                    request.data?.deviceId,
                    "deviceId"
                );

            const operadorAutorizado =
                await validarSesionOperadorInterna(
                    clienteRef,
                    request.data
                        ?.operadorSesion,
                    {
                        deviceId,
                    }
                );

            const productoEntrada =
                request.data?.product;

            if (
                !productoEntrada ||
                typeof productoEntrada !==
                    "object" ||
                Array.isArray(
                    productoEntrada
                )
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "Datos del producto inválidos."
                );
            }

            const previousBarcode =
                textoSeguro(
                    request.data
                        ?.previousBarcode,
                    180
                );

            const barcode =
                textoSeguro(
                    productoEntrada
                        ?.barcode,
                    180
                );

            const name =
                textoSeguro(
                    productoEntrada
                        ?.name,
                    180
                );

            if (
                !previousBarcode ||
                !barcode ||
                !name
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "El producto, su código anterior y su nombre son obligatorios."
                );
            }

            const tiposPermitidos =
                new Set([
                    "unidad",
                    "peso",
                    "precio-libre",
                ]);

            const tipoVenta =
                tiposPermitidos.has(
                    productoEntrada
                        ?.tipoVenta
                )
                    ? productoEntrada
                        .tipoVenta
                    : "unidad";

            const roundMoney =
                (value) =>
                    Math.round(
                        (
                            Number(value) +
                            Number.EPSILON
                        ) *
                        100
                    ) /
                    100;

            const roundQuantity =
                (value) =>
                    Math.round(
                        (
                            Number(value) +
                            Number.EPSILON
                        ) *
                        1000
                    ) /
                    1000;

            const price =
                tipoVenta ===
                    "precio-libre"
                    ? 0
                    : roundMoney(
                        productoEntrada
                            ?.price
                    );

            let stock = 0;

            if (
                tipoVenta ===
                "peso"
            ) {
                stock =
                    roundQuantity(
                        productoEntrada
                            ?.stock
                    );
            } else if (
                tipoVenta ===
                "unidad"
            ) {
                stock =
                    Math.trunc(
                        Number(
                            productoEntrada
                                ?.stock
                        )
                    );
            }

            if (
                tipoVenta !==
                    "precio-libre" &&
                (
                    !Number.isFinite(
                        price
                    ) ||
                    price < 0
                )
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "El precio del producto no es válido."
                );
            }

            if (
                tipoVenta !==
                    "precio-libre" &&
                (
                    !Number.isFinite(
                        stock
                    ) ||
                    stock < 0
                )
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "El stock del producto no es válido."
                );
            }

            const expiry =
                textoSeguro(
                    productoEntrada
                        ?.expiry,
                    120
                ) ||
                null;

            const unidadMedida =
                tipoVenta ===
                    "peso"
                    ? (
                        textoSeguro(
                            productoEntrada
                                ?.unidadMedida,
                            40
                        ) ||
                        "kg"
                    )
                    : null;

            const previousRef =
                clienteRef
                    .collection(
                        "productos"
                    )
                    .doc(
                        previousBarcode
                    );

            const nextRef =
                clienteRef
                    .collection(
                        "productos"
                    )
                    .doc(
                        barcode
                    );

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const previousSnap =
                            await transaction.get(
                                previousRef
                            );

                        if (
                            !previousSnap.exists
                        ) {
                            throw new HttpsError(
                                "not-found",
                                "Producto no encontrado.",
                                {
                                    motivo:
                                        "product-not-found",
                                }
                            );
                        }

                        let nextSnap =
                            null;

                        if (
                            previousBarcode !==
                            barcode
                        ) {
                            nextSnap =
                                await transaction.get(
                                    nextRef
                                );

                            if (
                                nextSnap.exists
                            ) {
                                throw new HttpsError(
                                    "already-exists",
                                    "Ya existe otro producto con ese código.",
                                    {
                                        motivo:
                                            "product-barcode-conflict",
                                    }
                                );
                            }
                        }

                        const anterior =
                            previousSnap.data() ||
                            {};

                        const productoActualizado = {
                            ...anterior,

                            barcode,

                            name,

                            tipoVenta,

                            unidadMedida,

                            price,

                            stock,

                            expiry,

                            updatedAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        };

                        if (
                            previousBarcode !==
                            barcode
                        ) {
                            /*
                             * Conservamos el comportamiento previo:
                             * cuando cambia el código se crea un
                             * documento nuevo y se elimina el anterior.
                             */
                            productoActualizado
                                .createdAt =
                                admin.firestore.FieldValue.serverTimestamp();

                            transaction.set(
                                nextRef,
                                productoActualizado,
                                {
                                    merge:
                                        true,
                                }
                            );

                            transaction.delete(
                                previousRef
                            );
                        } else {
                            transaction.set(
                                previousRef,
                                productoActualizado,
                                {
                                    merge:
                                        true,
                                }
                            );
                        }

                        const eventoAuditoria =
                            crearEventoAuditoria({
                                clienteRef,

                                operador:
                                    operadorAutorizado,

                                accion:
                                    AUDIT_ACTIONS
                                        .EDICION_PRODUCTO,

                                deviceId,

                                detalle: {
                                    barcodeAnterior:
                                        previousBarcode,

                                    barcodeNuevo:
                                        barcode,

                                    nombreAnterior:
                                        textoSeguro(
                                            anterior.name,
                                            180
                                        ),

                                    nombreNuevo:
                                        name,

                                    tipoVentaAnterior:
                                        textoSeguro(
                                            anterior.tipoVenta,
                                            40
                                        ) ||
                                        "unidad",

                                    tipoVentaNuevo:
                                        tipoVenta,

                                    precioAnterior:
                                        Number(
                                            anterior.price ||
                                            0
                                        ),

                                    precioNuevo:
                                        price,

                                    stockAnterior:
                                        Number(
                                            anterior.stock ||
                                            0
                                        ),

                                    stockNuevo:
                                        stock,
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            barcode,

                            name,

                            tipoVenta,

                            unidadMedida,

                            price,

                            stock,

                            expiry,
                        };
                    }
                );

            return {
                ok:
                    true,

                product:
                    result,
            };
        }
    );


exports.reponerStock =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const deviceId =
                validarId(
                    request.data?.deviceId,
                    "deviceId"
                );

            const operadorAutorizado =
                await validarSesionOperadorInterna(
                    clienteRef,
                    request.data
                        ?.operadorSesion,
                    {
                        deviceId,
                    }
                );

            const barcode =
                textoSeguro(
                    request.data?.barcode,
                    180
                );

            if (!barcode) {
                throw new HttpsError(
                    "invalid-argument",
                    "barcode es obligatorio."
                );
            }

            const addRaw =
                Number(
                    request.data?.add
                );

            if (
                !Number.isFinite(
                    addRaw
                ) ||
                addRaw <= 0
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "Ingresá una cantidad válida."
                );
            }

            const productoRef =
                clienteRef
                    .collection(
                        "productos"
                    )
                    .doc(
                        barcode
                    );

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const productoSnap =
                            await transaction.get(
                                productoRef
                            );

                        if (
                            !productoSnap.exists
                        ) {
                            throw new HttpsError(
                                "not-found",
                                "Producto no encontrado.",
                                {
                                    motivo:
                                        "product-not-found",
                                }
                            );
                        }

                        const producto =
                            productoSnap.data() ||
                            {};

                        const tipoVenta =
                            textoSeguro(
                                producto.tipoVenta,
                                40
                            ) ||
                            "unidad";

                        if (
                            tipoVenta ===
                            "precio-libre"
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "Este producto no utiliza stock.",
                                {
                                    motivo:
                                        "product-without-stock",
                                }
                            );
                        }

                        let cantidadAgregada;

                        if (
                            tipoVenta ===
                            "peso"
                        ) {
                            cantidadAgregada =
                                Math.round(
                                    (
                                        addRaw +
                                        Number.EPSILON
                                    ) *
                                    1000
                                ) /
                                1000;
                        } else {
                            cantidadAgregada =
                                Math.trunc(
                                    addRaw
                                );
                        }

                        if (
                            !Number.isFinite(
                                cantidadAgregada
                            ) ||
                            cantidadAgregada <= 0
                        ) {
                            throw new HttpsError(
                                "invalid-argument",
                                tipoVenta ===
                                    "peso"
                                    ? "Ingresá un peso válido."
                                    : "Ingresá una cantidad válida."
                            );
                        }

                        const stockAnteriorRaw =
                            Number(
                                producto.stock ||
                                0
                            );

                        const stockAnterior =
                            Number.isFinite(
                                stockAnteriorRaw
                            )
                                ? stockAnteriorRaw
                                : 0;

                        const stockNuevo =
                            tipoVenta ===
                            "peso"
                                ? Math.round(
                                    (
                                        stockAnterior +
                                        cantidadAgregada +
                                        Number.EPSILON
                                    ) *
                                    1000
                                ) /
                                1000
                                : Math.trunc(
                                    stockAnterior +
                                    cantidadAgregada
                                );

                        transaction.update(
                            productoRef,
                            {
                                stock:
                                    stockNuevo,

                                updatedAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            }
                        );

                        const eventoAuditoria =
                            crearEventoAuditoria({
                                clienteRef,

                                operador:
                                    operadorAutorizado,

                                accion:
                                    AUDIT_ACTIONS
                                        .REPOSICION_STOCK,

                                deviceId,

                                detalle: {
                                    barcode,

                                    productoNombre:
                                        textoSeguro(
                                            producto.name,
                                            120
                                        ),

                                    tipoVenta,

                                    cantidadAgregada,

                                    stockAnterior,

                                    stockNuevo,
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            barcode,

                            tipoVenta,

                            cantidadAgregada,

                            stockAnterior,

                            stockNuevo,
                        };
                    }
                );

            return {
                ok:
                    true,

                ...result,
            };
        }
    );


exports.abrirCaja =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const deviceId =
                validarId(
                    request.data?.deviceId,
                    "deviceId"
                );

            const operadorAutorizado =
                await validarSesionOperadorInterna(
                    clienteRef,
                    request.data
                        ?.operadorSesion,
                    {
                        deviceId,
                    }
                );

            const sessionId =
                validarId(
                    request.data?.sessionId,
                    "sessionId"
                );

            const openAmountRaw =
                Number(
                    request.data?.openAmount
                );

            if (
                !Number.isFinite(
                    openAmountRaw
                ) ||
                openAmountRaw < 0
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "Ingresá un monto inicial válido."
                );
            }

            const openAmount =
                Math.round(
                    (
                        openAmountRaw +
                        Number.EPSILON
                    ) *
                    100
                ) /
                100;

            const configRef =
                clienteRef
                    .collection(
                        "configuracion"
                    )
                    .doc(
                        "pos"
                    );

            const sessionRef =
                clienteRef
                    .collection(
                        "cajas"
                    )
                    .doc(
                        sessionId
                    );

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const configSnap =
                            await transaction.get(
                                configRef
                            );

                        const existingOpenId =
                            textoSeguro(
                                configSnap.data()
                                    ?.openCashSessionId,
                                180
                            );

                        if (
                            existingOpenId
                        ) {
                            const existingRef =
                                clienteRef
                                    .collection(
                                        "cajas"
                                    )
                                    .doc(
                                        existingOpenId
                                    );

                            const existingSnap =
                                await transaction.get(
                                    existingRef
                                );

                            if (
                                existingSnap.exists &&
                                existingSnap.data()
                                    ?.status ===
                                    "open"
                            ) {
                                if (
                                    existingOpenId ===
                                    sessionId
                                ) {
                                    return {
                                        created:
                                            false,

                                        session: {
                                            id:
                                                existingSnap.id,

                                            ...existingSnap.data(),
                                        },
                                    };
                                }

                                throw new HttpsError(
                                    "already-exists",
                                    "Ya hay una caja abierta.",
                                    {
                                        motivo:
                                            "cash-already-open",

                                        sessionId:
                                            existingOpenId,
                                    }
                                );
                            }
                        }

                        const targetSnap =
                            await transaction.get(
                                sessionRef
                            );

                        if (
                            targetSnap.exists
                        ) {
                            const existing = {
                                id:
                                    targetSnap.id,

                                ...targetSnap.data(),
                            };

                            if (
                                existing.status ===
                                "open"
                            ) {
                                transaction.set(
                                    configRef,
                                    {
                                        openCashSessionId:
                                            sessionId,

                                        updatedAt:
                                            admin.firestore.FieldValue.serverTimestamp(),
                                    },
                                    {
                                        merge:
                                            true,
                                    }
                                );

                                return {
                                    created:
                                        false,

                                    session:
                                        existing,
                                };
                            }

                            throw new HttpsError(
                                "already-exists",
                                "El identificador de caja ya fue utilizado.",
                                {
                                    motivo:
                                        "cash-session-id-used",
                                }
                            );
                        }

                        const openTime =
                            new Date()
                                .toISOString();

                        const session = {
                            id:
                                sessionId,

                            openTime,

                            openAmount,

                            closeTime:
                                null,

                            closeAmount:
                                null,

                            expectedAmount:
                                null,

                            counted:
                                null,

                            diff:
                                null,

                            totalSales:
                                0,

                            salesCount:
                                0,

                            paymentTotals: {
                                efectivo:
                                    0,

                                transferencia:
                                    0,

                                qr:
                                    0,

                                tarjeta:
                                    0,
                            },

                            status:
                                "open",

                            openedByDeviceId:
                                deviceId,

                            createdAt:
                                admin.firestore.FieldValue.serverTimestamp(),

                            updatedAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        };

                        transaction.set(
                            sessionRef,
                            session
                        );

                        transaction.set(
                            configRef,
                            {
                                openCashSessionId:
                                    sessionId,

                                updatedAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge:
                                    true,
                            }
                        );

                        const eventoAuditoria =
                            crearEventoAuditoria({
                                clienteRef,

                                operador:
                                    operadorAutorizado,

                                accion:
                                    AUDIT_ACTIONS
                                        .APERTURA_CAJA,

                                deviceId,

                                detalle: {
                                    cajaId:
                                        sessionId,

                                    montoInicial:
                                        openAmount,
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            created:
                                true,

                            session,
                        };
                    }
                );

            return {
                ok:
                    true,

                created:
                    result.created,

                session: {
                    ...result.session,

                    createdAt:
                        null,

                    updatedAt:
                        null,
                },
            };
        }
    );



/* =========================================================
   CERRAR CAJA + AUDITORÍA
========================================================= */

/*
 * El cierre pasa por backend para que:
 *
 * - la licencia sea validada;
 * - la sesión interna sea validada;
 * - Administrador y Encargado puedan cerrar caja;
 * - la identidad del operador se resuelva desde Firestore;
 * - el cierre, la configuración y la auditoría se escriban
 *   dentro de la misma transacción.
 */
exports.cerrarCaja =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            const deviceId =
                validarId(
                    request.data?.deviceId,
                    "deviceId"
                );

            const operadorAutorizado =
                await validarSesionOperadorInterna(
                    clienteRef,
                    request.data
                        ?.operadorSesion,
                    {
                        deviceId,
                    }
                );

            const sessionId =
                validarId(
                    request.data?.sessionId,
                    "sessionId"
                );

            const countedRaw =
                Number(
                    request.data?.counted
                );

            if (
                !Number.isFinite(
                    countedRaw
                ) ||
                countedRaw < 0
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "Ingresá un efectivo contado válido."
                );
            }

            const roundMoney =
                (value) =>
                    Math.round(
                        (
                            Number(value || 0) +
                            Number.EPSILON
                        ) *
                        100
                    ) /
                    100;

            const counted =
                roundMoney(
                    countedRaw
                );

            const configRef =
                clienteRef
                    .collection(
                        "configuracion"
                    )
                    .doc(
                        "pos"
                    );

            const sessionRef =
                clienteRef
                    .collection(
                        "cajas"
                    )
                    .doc(
                        sessionId
                    );

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const configSnap =
                            await transaction.get(
                                configRef
                            );

                        const sessionSnap =
                            await transaction.get(
                                sessionRef
                            );

                        if (
                            !sessionSnap.exists
                        ) {
                            throw new HttpsError(
                                "not-found",
                                "No encontramos la caja.",
                                {
                                    motivo:
                                        "cash-session-not-found",
                                }
                            );
                        }

                        const session =
                            sessionSnap.data() ||
                            {};

                        if (
                            session.status !==
                            "open"
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "La caja ya está cerrada.",
                                {
                                    motivo:
                                        "cash-already-closed",
                                }
                            );
                        }

                        const activeSessionId =
                            textoSeguro(
                                configSnap.data()
                                    ?.openCashSessionId,
                                180
                            );

                        if (
                            activeSessionId !==
                            sessionId
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "Esta caja ya no es la caja activa.",
                                {
                                    motivo:
                                        "cash-session-mismatch",
                                }
                            );
                        }

                        const paymentTotals = {
                            efectivo:
                                roundMoney(
                                    session
                                        ?.paymentTotals
                                        ?.efectivo
                                ),

                            transferencia:
                                roundMoney(
                                    session
                                        ?.paymentTotals
                                        ?.transferencia
                                ),

                            qr:
                                roundMoney(
                                    session
                                        ?.paymentTotals
                                        ?.qr
                                ),

                            tarjeta:
                                roundMoney(
                                    session
                                        ?.paymentTotals
                                        ?.tarjeta
                                ),
                        };

                        const totalSales =
                            roundMoney(
                                session.totalSales
                            );

                        const salesCount =
                            Math.max(
                                0,
                                Math.trunc(
                                    Number(
                                        session.salesCount ||
                                        0
                                    )
                                )
                            );

                        const expectedAmount =
                            roundMoney(
                                Number(
                                    session.openAmount ||
                                    0
                                ) +
                                paymentTotals.efectivo
                            );

                        const diff =
                            roundMoney(
                                counted -
                                expectedAmount
                            );

                        const closeTime =
                            new Date()
                                .toISOString();

                        transaction.update(
                            sessionRef,
                            {
                                closeTime,

                                closeAmount:
                                    counted,

                                expectedAmount,

                                counted,

                                diff,

                                totalSales,

                                salesCount,

                                paymentTotals,

                                status:
                                    "closed",

                                closedByDeviceId:
                                    deviceId,

                                updatedAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            }
                        );

                        transaction.set(
                            configRef,
                            {
                                openCashSessionId:
                                    null,

                                updatedAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge:
                                    true,
                            }
                        );

                        const eventoAuditoria =
                            crearEventoAuditoria({
                                clienteRef,

                                operador:
                                    operadorAutorizado,

                                accion:
                                    AUDIT_ACTIONS
                                        .CIERRE_CAJA,

                                deviceId,

                                detalle: {
                                    cajaId:
                                        sessionId,

                                    montoInicial:
                                        roundMoney(
                                            session.openAmount
                                        ),

                                    efectivoEsperado:
                                        expectedAmount,

                                    efectivoContado:
                                        counted,

                                    diferencia:
                                        diff,

                                    totalVentas:
                                        totalSales,

                                    cantidadVentas:
                                        salesCount,
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            id:
                                sessionId,

                            ...session,

                            closeTime,

                            closeAmount:
                                counted,

                            expectedAmount,

                            counted,

                            diff,

                            totalSales,

                            salesCount,

                            paymentTotals,

                            status:
                                "closed",

                            closedByDeviceId:
                                deviceId,
                        };
                    }
                );

            return {
                ok:
                    true,

                session:
                    result,
            };
        }
    );


exports.eliminarCierreCaja =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            if (!request.auth) {
                throw new HttpsError(
                    "unauthenticated",
                    "Debés iniciar sesión."
                );
            }

            const cajaId =
                validarId(
                    request.data?.cajaId,
                    "cajaId"
                );

            const {
                ref: clienteRef,
                snap: clienteSnap,
            } =
                await resolverClienteAutenticado(
                    request.auth
                );

            const clienteData =
                clienteSnap.data();

            validarLicencia(
                clienteData
            );

            validarSesionNoRevocada(
                request.auth,
                clienteData
            );

            /*
             * La eliminación de un cierre histórico es una acción
             * sensible y queda reservada al Administrador interno
             * del comercio.
             *
             * No confiamos en un rol enviado por el navegador:
             * validarSesionOperadorInterna resuelve nuevamente el
             * operador real desde Firestore y verifica:
             *
             * - token de sesión interna
             * - vencimiento
             * - operador activo
             * - dispositivo
             * - rol administrador
             */
            const deviceId =
                validarId(
                    request.data?.deviceId,
                    "deviceId"
                );

            const operadorAutorizado =
                await validarSesionOperadorInterna(
                    clienteRef,
                    request.data
                        ?.operadorSesion,
                    {
                        requireRole:
                            "administrador",

                        deviceId,
                    }
                );

            const cajaRef =
                clienteRef
                    .collection("cajas")
                    .doc(cajaId);

            const cajaSnap =
                await cajaRef.get();

            /*
             * Una repetición de la misma solicitud puede ocurrir
             * si el cliente perdió la respuesta después de que el
             * backend ya completó el borrado.
             *
             * En ese caso respondemos OK para que la operación sea
             * idempotente y no muestre un falso error al usuario.
             */
            if (!cajaSnap.exists) {
                return {
                    ok: true,
                    alreadyDeleted: true,
                    cajaId,
                    ventasEliminadas: 0,
                };
            }

            const cajaData =
                cajaSnap.data() || {};

            if (
                cajaData.status !==
                "closed"
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "Sólo se pueden eliminar cierres de caja finalizados.",
                    {
                        motivo:
                            "caja-no-cerrada",
                    }
                );
            }

            const ventasSnap =
                await clienteRef
                    .collection("ventas")
                    .where(
                        "sessionId",
                        "==",
                        cajaId
                    )
                    .get();

            const docsVentas =
                ventasSnap.docs;

            /*
             * Firestore admite hasta 500 escrituras por batch.
             * Usamos 400 para mantener margen y evitar depender
             * del límite exacto en cambios futuros.
             */
            const BATCH_SIZE = 400;

            let ventasEliminadas = 0;

            for (
                let index = 0;
                index < docsVentas.length;
                index += BATCH_SIZE
            ) {
                const batch =
                    db.batch();

                const chunk =
                    docsVentas.slice(
                        index,
                        index + BATCH_SIZE
                    );

                for (
                    const ventaDoc
                    of chunk
                ) {
                    batch.delete(
                        ventaDoc.ref
                    );
                }

                await batch.commit();

                ventasEliminadas +=
                    chunk.length;
            }

            /*
             * La caja se elimina al final.
             *
             * La eliminación del cierre y su evento de auditoría
             * se escriben en el MISMO batch. De esta forma nunca
             * registramos como exitosa una eliminación que no llegó
             * a borrar realmente el cierre.
             *
             * Las ventas asociadas ya fueron eliminadas en lotes.
             * Si alguno de esos lotes falla, este bloque no se ejecuta
             * y el cierre permanece disponible para reintentar.
             */
            const eventoAuditoria =
                crearEventoAuditoria({
                    clienteRef,

                    operador:
                        operadorAutorizado,

                    accion:
                        AUDIT_ACTIONS
                            .ELIMINACION_CIERRE_HISTORICO,

                    deviceId,

                    detalle: {
                        cajaId,

                        ventasEliminadas,

                        statusAnterior:
                            cajaData.status,
                    },
                });

            const finalBatch =
                db.batch();

            finalBatch.delete(
                cajaRef
            );

            finalBatch.set(
                eventoAuditoria.ref,
                eventoAuditoria.data
            );

            await finalBatch.commit();

            console.info(
                "Cierre de caja eliminado:",
                {
                    clienteId:
                        clienteRef.id,
                    cajaId,
                    ventasEliminadas,
                    authUid:
                        request.auth.uid,

                    operadorId:
                        operadorAutorizado.id,

                    operadorRol:
                        operadorAutorizado.rol,

                    deviceId,
                }
            );

            return {
                ok: true,
                alreadyDeleted: false,
                cajaId,
                ventasEliminadas,
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

                borrarColeccion(
                    clienteRef.collection(
                        "operadores"
                    )
                ),

                borrarColeccion(
                    clienteRef.collection(
                        "sesionesOperador"
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
        {
            schedule: "every 24 hours",
            region: REGION,
        },
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