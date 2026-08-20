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

function normalizarIdDocumentoSeguro(
    value,
    maxLength = 180
) {
    if (
        typeof value !==
        "string"
    ) {
        return null;
    }

    const id = value.trim();

    if (
        !id ||
        id.length > maxLength ||
        id === "." ||
        id === ".." ||
        !/^[a-zA-Z0-9._:-]+$/.test(
            id
        )
    ) {
        return null;
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

    VENTA_REALIZADA:
        "venta-realizada",

    REPOSICION_STOCK:
        "reposicion-stock",

    EDICION_PRODUCTO:
        "edicion-producto",

    ALTA_PRODUCTO:
        "alta-producto",

    ELIMINACION_PRODUCTO:
        "eliminacion-producto",

    ELIMINACION_CIERRE_HISTORICO:
        "eliminacion-cierre-historico",

    ALTA_CUENTA_POR_COBRAR:
        "alta-cuenta-por-cobrar",

    COBRO_CUENTA_POR_COBRAR:
        "cobro-cuenta-por-cobrar",

    CUENTA_POR_COBRAR_SALDADA:
        "cuenta-por-cobrar-saldada",

    CAMBIO_NOMBRE_NEGOCIO:
        "cambio-nombre-negocio",

    MIGRACION_POS_LEGACY:
        "migracion-pos-legacy",
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
        sessionId = null,
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

            /*
             * sessionId es el vínculo canónico entre un evento
             * de auditoría y un turno de caja. Puede ser null
             * para acciones que ocurren fuera de una caja.
             */
            sessionId:
                textoSeguro(
                    sessionId,
                    180
                ) ||
                null,

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

/*
 * Resuelve el turno de caja que está realmente abierto dentro
 * de la misma transacción que modifica inventario.
 *
 * No confiamos en un sessionId enviado por el navegador.
 * Si no hay una caja abierta válida, la operación continúa y
 * la auditoría queda con sessionId null.
 */
async function obtenerSessionIdCajaAbiertaEnTransaccion(
    transaction,
    clienteRef
) {
    const configRef =
        clienteRef
            .collection(
                "configuracion"
            )
            .doc(
                "pos"
            );

    const configSnap =
        await transaction.get(
            configRef
        );

    const sessionId =
        normalizarIdDocumentoSeguro(
            configSnap.data()
                ?.openCashSessionId,
            180
        );

    if (!sessionId) {
        return null;
    }

    const sessionRef =
        clienteRef
            .collection(
                "cajas"
            )
            .doc(
                sessionId
            );

    const sessionSnap =
        await transaction.get(
            sessionRef
        );

    if (
        !sessionSnap.exists ||
        sessionSnap.data()
            ?.status !==
            "open"
    ) {
        return null;
    }

    return sessionId;
}

/* =========================================================
   ESCRITURAS DE CONFIGURACION DEL POS
========================================================= */

function validarClienteIdSolicitado(
    requestData,
    clienteRef
) {
    if (
        requestData?.clienteId == null
    ) {
        return;
    }

    const requestedId =
        String(
            requestData.clienteId
        ).trim();

    if (
        requestedId !==
        clienteRef.id
    ) {
        throw new HttpsError(
            "permission-denied",
            "La licencia indicada no coincide con la cuenta autenticada."
        );
    }
}

function validarTextoEstricto(
    value,
    fieldName,
    {
        minLength = 0,
        maxLength = 180,
        allowNull = false,
    } = {}
) {
    if (
        value == null &&
        allowNull
    ) {
        return null;
    }

    if (
        typeof value !==
        "string"
    ) {
        throw new HttpsError(
            "invalid-argument",
            fieldName +
                " debe ser texto."
        );
    }

    const clean =
        value.trim();

    if (
        clean.length <
            minLength ||
        clean.length >
            maxLength
    ) {
        throw new HttpsError(
            "invalid-argument",
            fieldName +
                " debe tener entre " +
                minLength +
                " y " +
                maxLength +
                " caracteres."
        );
    }

    return clean;
}

async function validarSesionPrincipalPos(
    clienteRef,
    auth,
    deviceId,
    sessionId
) {
    const controlSnap =
        await getControlRef(
            clienteRef
        ).get();

    const sessions =
        limpiarSesionesActivas(
            controlSnap.exists
                ? controlSnap.data()
                    ?.sessions
                : {},
            Date.now()
        );

    const current =
        sessions[
            deviceId
        ];

    if (
        !current ||
        current.sessionId !==
            sessionId ||
        current.authUid !==
            auth.uid
    ) {
        throw new HttpsError(
            "permission-denied",
            "Este dispositivo no tiene una sesión principal activa.",
            {
                motivo:
                    "device-session-invalid",
            }
        );
    }
}

async function resolverContextoEscrituraPos(
    request,
    {
        requireRole = null,
    } = {}
) {
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

    validarClienteIdSolicitado(
        request.data,
        clienteRef
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

    await validarSesionPrincipalPos(
        clienteRef,
        request.auth,
        deviceId,
        sessionId
    );

    const operador =
        await validarSesionOperadorInterna(
            clienteRef,
            request.data
                ?.operadorSesion,
            {
                requireRole,
                deviceId,
            }
        );

    return {
        clienteRef,
        clienteData,
        deviceId,
        sessionId,
        operador,
    };
}

exports.guardarNombreNegocio =
    onCall(
        CALLABLE_OPTIONS,
        async (request) => {
            const {
                clienteRef,
                deviceId,
                operador,
            } =
                await resolverContextoEscrituraPos(
                    request
                );

            const shopName =
                validarTextoEstricto(
                    request.data
                        ?.shopName,
                    "shopName",
                    {
                        minLength: 1,
                        maxLength: 120,
                    }
                );

            const configRef =
                clienteRef
                    .collection(
                        "configuracion"
                    )
                    .doc(
                        "pos"
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

                        const previousName =
                            textoSeguro(
                                configSnap.data()
                                    ?.shopName,
                                120
                            ) ||
                            null;

                        const possibleSessionId =
                            normalizarIdDocumentoSeguro(
                                configSnap.data()
                                    ?.openCashSessionId,
                                180
                            );

                        let sessionId =
                            null;

                        if (
                            possibleSessionId
                        ) {
                            const cashSnap =
                                await transaction.get(
                                    clienteRef
                                        .collection(
                                            "cajas"
                                        )
                                        .doc(
                                            possibleSessionId
                                        )
                                );

                            if (
                                cashSnap.exists &&
                                cashSnap.data()
                                    ?.status ===
                                    "open"
                            ) {
                                sessionId =
                                    possibleSessionId;
                            }
                        }

                        transaction.set(
                            configRef,
                            {
                                shopName,

                                updatedAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge: true,
                            }
                        );

                        const eventoAuditoria =
                            crearEventoAuditoria({
                                clienteRef,
                                operador,

                                accion:
                                    AUDIT_ACTIONS
                                        .CAMBIO_NOMBRE_NEGOCIO,

                                deviceId,
                                sessionId,

                                detalle: {
                                    nombreAnterior:
                                        previousName,

                                    nombreNuevo:
                                        shopName,
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            previousName,
                        };
                    }
                );

            return {
                ok: true,
                shopName,

                changed:
                    result
                        .previousName !==
                    shopName,
            };
        }
    );

/* =========================================================
   MIGRACION POS LEGACY — PROTOCOLO SEGURO POR LOTES
========================================================= */

const POS_LEGACY_MIGRATION_VERSION = 1;
const POS_LEGACY_BATCH_MAX_ITEMS = 80;
const POS_LEGACY_BATCH_MAX_BYTES =
    750 * 1024;
const POS_LEGACY_DOCUMENT_MAX_BYTES =
    200 * 1024;
const POS_LEGACY_DOCUMENT_METADATA_RESERVE_BYTES =
    2 * 1024;
const POS_LEGACY_LOCK_TIMEOUT_MS =
    15 * 60 * 1000;
const POS_LEGACY_MAX_MONEY =
    1e12;
const POS_LEGACY_MAX_QUANTITY =
    1e9;

const POS_LEGACY_KINDS =
    Object.freeze([
        "products",
        "sales",
        "cashSessions",
    ]);

const POS_LEGACY_MAX_COUNTS =
    Object.freeze({
        products: 5000,
        sales: 20000,
        cashSessions: 5000,
    });

const POS_LEGACY_PRODUCT_TYPES =
    new Set([
        "unidad",
        "peso",
        "precio-libre",
    ]);

const POS_LEGACY_PAYMENT_METHODS =
    new Set([
        "efectivo",
        "transferencia",
        "qr",
        "tarjeta",
    ]);

const POS_LEGACY_CALLABLE_OPTIONS = {
    ...CALLABLE_OPTIONS,
    timeoutSeconds: 180,
    memory: "512MiB",
};

function hashPosLegacy(
    value
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            String(value),
            "utf8"
        )
        .digest(
            "hex"
        );
}

function serializarPosLegacyCanonico(
    value
) {
    if (
        value === null ||
        typeof value !==
            "object"
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        Array.isArray(
            value
        )
    ) {
        return (
            "[" +
            value
                .map(
                    (
                        item
                    ) =>
                        serializarPosLegacyCanonico(
                            item
                        )
                )
                .join(
                    ","
                ) +
            "]"
        );
    }

    const keys =
        Object.keys(
            value
        ).sort();

    return (
        "{" +
        keys
            .map(
                (
                    key
                ) =>
                    JSON.stringify(
                        key
                    ) +
                    ":" +
                    serializarPosLegacyCanonico(
                        value[
                            key
                        ]
                    )
            )
            .join(
                ","
            ) +
        "}"
    );
}

function bytesPosLegacy(
    value
) {
    return Buffer.byteLength(
        typeof value ===
            "string"
            ? value
            : serializarPosLegacyCanonico(
                value
            ),
        "utf8"
    );
}

function validarTamanoDocumentoPosLegacy(
    value,
    fieldName
) {
    if (
        bytesPosLegacy(
            value
        ) >
        POS_LEGACY_DOCUMENT_MAX_BYTES -
            POS_LEGACY_DOCUMENT_METADATA_RESERVE_BYTES
    ) {
        throw new HttpsError(
            "invalid-argument",
            fieldName +
                " supera el limite de 200 KB."
        );
    }
}

function redondearPosLegacy(
    value,
    decimals
) {
    const factor =
        10 ** decimals;

    return (
        Math.round(
            (
                Number(value) +
                Number.EPSILON
            ) *
            factor
        ) /
        factor
    );
}

function numeroPosLegacy(
    value,
    fieldName,
    {
        defaultValue = 0,
        min = 0,
        max =
            POS_LEGACY_MAX_MONEY,
        decimals = 2,
        integer = false,
        allowNull = false,
    } = {}
) {
    if (
        value != null &&
        value !==
            "" &&
        typeof value !==
            "number" &&
        typeof value !==
            "string"
    ) {
        throw new HttpsError(
            "invalid-argument",
            fieldName +
                " contiene un numero invalido."
        );
    }

    if (
        (
            value == null ||
            value ===
                ""
        ) &&
        allowNull
    ) {
        return null;
    }

    const raw =
        value == null ||
        value ===
            ""
            ? defaultValue
            : Number(value);

    if (
        !Number.isFinite(
            raw
        ) ||
        raw < min ||
        raw > max
    ) {
        throw new HttpsError(
            "invalid-argument",
            fieldName +
                " contiene un numero invalido."
        );
    }

    return integer
        ? Math.trunc(
            raw
        )
        : redondearPosLegacy(
            raw,
            decimals
        );
}

function textoPosLegacy(
    value,
    fieldName,
    {
        maxLength = 180,
        required = false,
        fallback = "",
    } = {}
) {
    const source =
        value == null
            ? fallback
            : value;

    if (
        typeof source !==
            "string" &&
        typeof source !==
            "number"
    ) {
        throw new HttpsError(
            "invalid-argument",
            fieldName +
                " contiene texto invalido."
        );
    }

    const clean =
        String(
            source
        ).trim();

    if (
        (
            required &&
            !clean
        ) ||
        clean.length >
            maxLength
    ) {
        throw new HttpsError(
            "invalid-argument",
            fieldName +
                " contiene texto invalido."
        );
    }

    return clean;
}

function fechaIsoPosLegacy(
    value,
    fieldName,
    {
        allowNull = false,
        fallback =
            "1970-01-01T00:00:00.000Z",
    } = {}
) {
    if (
        (
            value == null ||
            value ===
                ""
        ) &&
        allowNull
    ) {
        return null;
    }

    const date =
        new Date(
            value ||
            fallback
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            fieldName +
                " contiene una fecha invalida."
        );
    }

    return date.toISOString();
}

function normalizarIdPosLegacy(
    value,
    kind,
    fallbackSeed = ""
) {
    if (
        value != null &&
        typeof value !==
            "string" &&
        typeof value !==
            "number"
    ) {
        throw new HttpsError(
            "invalid-argument",
            "ID legacy invalido."
        );
    }

    const raw =
        value == null
            ? ""
            : String(
                value
            ).trim();

    if (
        raw.length >
        1000
    ) {
        throw new HttpsError(
            "invalid-argument",
            "ID legacy demasiado extenso."
        );
    }

    if (
        raw.length >= 8 &&
        raw.length <= 180 &&
        raw !== "." &&
        raw !== ".." &&
        /^[a-zA-Z0-9._:-]+$/.test(
            raw
        )
    ) {
        return raw;
    }

    const prefixes = {
        products:
            "product",
        sales:
            "sale",
        cashSessions:
            "cash",
    };

    const prefix =
        prefixes[
            kind
        ] ||
        "document";

    return (
        "legacy-" +
        prefix +
        "-" +
        hashPosLegacy(
            kind +
            "\u0000" +
            raw +
            (
                raw
                    ? ""
                    : "\u0000" +
                        fallbackSeed
            )
        ).slice(
            0,
            40
        )
    );
}

function idProductoPosLegacy(
    barcode
) {
    try {
        const encoded =
            encodeURIComponent(
                barcode
            );

        if (
            encoded &&
            encoded.length <=
                1400 &&
            encoded !== "." &&
            encoded !== ".." &&
            !encoded.includes(
                "/"
            )
        ) {
            return encoded;
        }
    } catch (error) {
        console.error(
            "Codigo legacy no codificable:",
            error
        );
    }

    return normalizarIdPosLegacy(
        barcode,
        "products"
    );
}

function normalizarProductoPosLegacy(
    rawProduct
) {
    if (
        !esObjetoPlano(
            rawProduct
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Producto legacy invalido."
        );
    }

    const barcode =
        textoPosLegacy(
            rawProduct.barcode,
            "product.barcode",
            {
                required: true,
            }
        );

    const name =
        textoPosLegacy(
            rawProduct.name,
            "product.name",
            {
                required: true,
            }
        );

    const rawType =
        textoPosLegacy(
            rawProduct.tipoVenta,
            "product.tipoVenta",
            {
                maxLength: 40,
                fallback: "unidad",
            }
        );

    const tipoVenta =
        POS_LEGACY_PRODUCT_TYPES
            .has(
                rawType
            )
            ? rawType
            : "unidad";

    const price =
        tipoVenta ===
            "precio-libre"
            ? 0
            : numeroPosLegacy(
                rawProduct.price,
                "product.price"
            );

    const stock =
        tipoVenta ===
            "precio-libre"
            ? 0
            : numeroPosLegacy(
                rawProduct.stock,
                "product.stock",
                {
                    max:
                        POS_LEGACY_MAX_QUANTITY,
                    decimals:
                        tipoVenta ===
                        "peso"
                            ? 3
                            : 0,
                    integer:
                        tipoVenta ===
                        "unidad",
                }
            );

    const expiry =
        rawProduct.expiry == null ||
        rawProduct.expiry ===
            ""
            ? null
            : textoPosLegacy(
                rawProduct.expiry,
                "product.expiry",
                {
                    maxLength: 120,
                }
            );

    const product = {
        barcode,
        name,
        tipoVenta,

        unidadMedida:
            tipoVenta ===
            "peso"
                ? (
                    textoPosLegacy(
                        rawProduct
                            .unidadMedida,
                        "product.unidadMedida",
                        {
                            maxLength: 40,
                            fallback: "kg",
                        }
                    ) ||
                    "kg"
                )
                : null,

        price,
        stock,
        expiry,
    };

    validarTamanoDocumentoPosLegacy(
        product,
        "product"
    );

    return {
        id:
            idProductoPosLegacy(
                barcode
            ),
        data: product,
    };
}

function normalizarItemVentaPosLegacy(
    rawItem,
    itemIndex
) {
    if (
        !esObjetoPlano(
            rawItem
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Item de venta legacy invalido."
        );
    }

    const name =
        textoPosLegacy(
            rawItem.name,
            "sale.items.name",
            {
                required: true,
            }
        );

    const barcode =
        textoPosLegacy(
            rawItem.barcode,
            "sale.items.barcode",
            {
                fallback:
                    "legacy-item-" +
                    itemIndex,
            }
        ) ||
        (
            "legacy-item-" +
            itemIndex
        );

    const rawType =
        textoPosLegacy(
            rawItem.tipoVenta,
            "sale.items.tipoVenta",
            {
                maxLength: 40,
                fallback: "unidad",
            }
        );

    const tipoVenta =
        POS_LEGACY_PRODUCT_TYPES
            .has(
                rawType
            )
            ? rawType
            : "unidad";

    const qty =
        tipoVenta ===
            "precio-libre"
            ? 1
            : numeroPosLegacy(
                rawItem.qty,
                "sale.items.qty",
                {
                    defaultValue: 1,
                    min:
                        tipoVenta ===
                        "peso"
                            ? 0.001
                            : 1,
                    max:
                        POS_LEGACY_MAX_QUANTITY,
                    decimals:
                        tipoVenta ===
                        "peso"
                            ? 3
                            : 0,
                    integer:
                        tipoVenta ===
                        "unidad",
                }
            );

    const price =
        numeroPosLegacy(
            rawItem.price,
            "sale.items.price"
        );

    const calculatedSubtotal =
        redondearPosLegacy(
            qty * price,
            2
        );

    /*
     * El subtotal histórico se reconstruye en servidor. No se
     * confía en un importe almacenado o manipulado en el browser.
     */
    const subtotal =
        numeroPosLegacy(
            calculatedSubtotal,
            "sale.items.subtotal"
        );

    return {
        barcode,
        name,
        tipoVenta,

        unidadMedida:
            tipoVenta ===
            "peso"
                ? (
                    textoPosLegacy(
                        rawItem
                            .unidadMedida,
                        "sale.items.unidadMedida",
                        {
                            maxLength: 40,
                            fallback: "kg",
                        }
                    ) ||
                    "kg"
                )
                : null,

        price,
        qty,
        subtotal,
    };
}

function normalizarVentaPosLegacy(
    rawSale
) {
    if (
        !esObjetoPlano(
            rawSale
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Venta legacy invalida."
        );
    }

    if (
        !Array.isArray(
            rawSale.items
        ) ||
        rawSale.items.length ===
            0 ||
        rawSale.items.length >
            100
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Una venta legacy debe contener entre 1 y 100 lineas."
        );
    }

    const items =
        rawSale.items.map(
            (
                item,
                index
            ) =>
                normalizarItemVentaPosLegacy(
                    item,
                    index
                )
        );

    const calculatedTotal =
        redondearPosLegacy(
            items.reduce(
                (
                    total,
                    item
                ) =>
                    total +
                    item.subtotal,
                0
            ),
            2
        );

    /*
     * Igual que en una venta normal, el total es la suma de las
     * líneas validadas y nunca un valor aportado por el cliente.
     */
    const total =
        numeroPosLegacy(
            calculatedTotal,
            "sale.total"
        );

    const rawMethod =
        textoPosLegacy(
            rawSale.payment
                ?.method,
            "sale.payment.method",
            {
                maxLength: 40,
                fallback: "efectivo",
            }
        );

    const method =
        POS_LEGACY_PAYMENT_METHODS
            .has(
                rawMethod
            )
            ? rawMethod
            : "efectivo";

    const received =
        method ===
            "efectivo"
            ? numeroPosLegacy(
                rawSale.payment
                    ?.received,
                "sale.payment.received",
                {
                    defaultValue:
                        total,
                    min:
                        total,
                }
            )
            : total;

    const change =
        method ===
            "efectivo"
            ? numeroPosLegacy(
                received -
                    total,
                "sale.payment.change"
            )
            : 0;

    const timestamp =
        fechaIsoPosLegacy(
            rawSale.timestamp,
            "sale.timestamp"
        );

    const rawSessionId =
        textoPosLegacy(
            rawSale.sessionId,
            "sale.sessionId",
            {
                maxLength: 1000,
            }
        );

    const sessionId =
        rawSessionId
            ? normalizarIdPosLegacy(
                rawSessionId,
                "cashSessions"
            )
            : null;

    const id =
        normalizarIdPosLegacy(
            rawSale.id,
            "sales",
            serializarPosLegacyCanonico({
                timestamp,
                items,
                total,
                sessionId,
            })
        );

    const sale = {
        id,
        timestamp,
        items,
        total,
        sessionId,

        payment: {
            method,
            received,
            change,
        },
    };

    validarTamanoDocumentoPosLegacy(
        sale,
        "sale"
    );

    return {
        id,
        data: sale,
    };
}

function normalizarTotalesPagoPosLegacy(
    value,
    fieldName
) {
    const source =
        esObjetoPlano(
            value
        )
            ? value
            : {};

    return {
        efectivo:
            numeroPosLegacy(
                source.efectivo,
                fieldName +
                    ".efectivo"
            ),

        transferencia:
            numeroPosLegacy(
                source
                    .transferencia,
                fieldName +
                    ".transferencia"
            ),

        qr:
            numeroPosLegacy(
                source.qr,
                fieldName +
                    ".qr"
            ),

        tarjeta:
            numeroPosLegacy(
                source.tarjeta,
                fieldName +
                    ".tarjeta"
            ),
    };
}

function normalizarCajaPosLegacy(
    rawCash
) {
    if (
        !esObjetoPlano(
            rawCash
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Caja legacy invalida."
        );
    }

    const status =
        rawCash.status ===
            "open"
            ? "open"
            : "closed";

    const openTime =
        fechaIsoPosLegacy(
            rawCash.openTime,
            "cashSession.openTime"
        );

    const id =
        normalizarIdPosLegacy(
            rawCash.id,
            "cashSessions",
            serializarPosLegacyCanonico({
                openTime,

                openAmount:
                    rawCash
                        .openAmount,
            })
        );

    const openAmount =
        numeroPosLegacy(
            rawCash.openAmount,
            "cashSession.openAmount"
        );

    const declaredTotalSales =
        numeroPosLegacy(
            rawCash.totalSales,
            "cashSession.totalSales"
        );

    const paymentTotals =
        normalizarTotalesPagoPosLegacy(
            rawCash
                .paymentTotals,
            "cashSession.paymentTotals"
        );

    let calculatedTotalSales =
        redondearPosLegacy(
            Object.values(
                paymentTotals
            ).reduce(
                (
                    total,
                    amount
                ) =>
                    total +
                    amount,
                0
            ),
            2
        );

    /*
     * Algunas versiones muy antiguas sólo guardaban totalSales.
     * En ese caso conservamos el total como efectivo. Si ya hay
     * desglose, exigimos que sea consistente y reconstruimos el
     * agregado en servidor.
     */
    if (
        Math.abs(
            calculatedTotalSales -
            declaredTotalSales
        ) >
        0.02
    ) {
        if (
            calculatedTotalSales ===
                0 &&
            declaredTotalSales >
                0
        ) {
            paymentTotals.efectivo =
                declaredTotalSales;

            calculatedTotalSales =
                declaredTotalSales;
        } else {
            throw new HttpsError(
                "invalid-argument",
                "Los totales de la caja legacy no son consistentes."
            );
        }
    }

    const totalSales =
        numeroPosLegacy(
            calculatedTotalSales,
            "cashSession.totalSales"
        );

    let counted =
        null;

    let expectedAmount =
        null;

    if (
        status ===
        "closed"
    ) {
        const declaredCounted =
            numeroPosLegacy(
                rawCash.counted,
                "cashSession.counted",
                {
                    allowNull: true,
                }
            );

        const declaredCloseAmount =
            numeroPosLegacy(
                rawCash.closeAmount,
                "cashSession.closeAmount",
                {
                    allowNull: true,
                }
            );

        if (
            declaredCounted !==
                null &&
            declaredCloseAmount !==
                null &&
            Math.abs(
                declaredCounted -
                declaredCloseAmount
            ) >
                0.01
        ) {
            throw new HttpsError(
                "invalid-argument",
                "El efectivo contado de la caja legacy no es consistente."
            );
        }

        counted =
            declaredCounted ??
            declaredCloseAmount;

        expectedAmount =
            numeroPosLegacy(
                redondearPosLegacy(
                    openAmount +
                    paymentTotals
                        .efectivo,
                    2
                ),
                "cashSession.expectedAmount"
            );
    }

    const diff =
        counted ===
        null
            ? null
            : numeroPosLegacy(
                redondearPosLegacy(
                    counted -
                    expectedAmount,
                    2
                ),
                "cashSession.diff",
                {
                    min:
                        -POS_LEGACY_MAX_MONEY,
                }
            );

    const cash = {
        id,
        openTime,
        openAmount,

        closeTime:
            status ===
            "closed"
                ? fechaIsoPosLegacy(
                    rawCash
                        .closeTime,
                    "cashSession.closeTime",
                    {
                        allowNull: true,
                    }
                )
                : null,

        closeAmount:
            counted,

        expectedAmount,
        counted,
        diff,
        totalSales,

        salesCount:
            numeroPosLegacy(
                rawCash.salesCount,
                "cashSession.salesCount",
                {
                    max:
                        POS_LEGACY_MAX_COUNTS
                            .sales,
                    integer: true,
                }
            ),

        paymentTotals,
        status,
    };

    validarTamanoDocumentoPosLegacy(
        cash,
        "cashSession"
    );

    return {
        id,
        data: cash,
    };
}

function normalizarDocumentoPosLegacy(
    kind,
    value
) {
    if (
        kind ===
        "products"
    ) {
        return normalizarProductoPosLegacy(
            value
        );
    }

    if (
        kind ===
        "sales"
    ) {
        return normalizarVentaPosLegacy(
            value
        );
    }

    if (
        kind ===
        "cashSessions"
    ) {
        return normalizarCajaPosLegacy(
            value
        );
    }

    throw new HttpsError(
        "invalid-argument",
        "Tipo de lote legacy invalido."
    );
}

function validarContadoresPosLegacy(
    value
) {
    if (
        !esObjetoPlano(
            value
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "counts es obligatorio."
        );
    }

    const counts = {};

    for (
        const kind of
        POS_LEGACY_KINDS
    ) {
        const count =
            Number(
                value[
                    kind
                ]
            );

        if (
            !Number.isInteger(
                count
            ) ||
            count < 0 ||
            count >
                POS_LEGACY_MAX_COUNTS[
                    kind
                ]
        ) {
            throw new HttpsError(
                "invalid-argument",
                "Cantidad legacy invalida para " +
                    kind +
                    "."
            );
        }

        counts[
            kind
        ] = count;
    }

    return counts;
}

function contadoresPosLegacyVacios() {
    return {
        products: 0,
        sales: 0,
        cashSessions: 0,
    };
}

function siguienteKindPosLegacy(
    expected,
    received,
    afterKind = null
) {
    const startIndex =
        afterKind
            ? POS_LEGACY_KINDS
                .indexOf(
                    afterKind
                ) +
                1
            : 0;

    for (
        let index =
            Math.max(
                0,
                startIndex
            );
        index <
            POS_LEGACY_KINDS
                .length;
        index += 1
    ) {
        const kind =
            POS_LEGACY_KINDS[
                index
            ];

        if (
            received[
                kind
            ] <
            expected[
                kind
            ]
        ) {
            return kind;
        }
    }

    return null;
}

function mismosContadoresPosLegacy(
    left,
    right
) {
    return POS_LEGACY_KINDS
        .every(
            (
                kind
            ) =>
                Number(
                    left?.[
                        kind
                    ]
                ) ===
                Number(
                    right?.[
                        kind
                    ]
                )
        );
}

function refsEstadoPosLegacy(
    clienteRef
) {
    const root =
        clienteRef
            .collection(
                "configuracion"
            )
            .doc(
                "migracion-pos-v1"
            );

    return {
        root,

        control:
            root
                .collection(
                    "control"
                )
                .doc(
                    "estado"
                ),

        attempts:
            root.collection(
                "intentos"
            ),

        devices:
            root.collection(
                "devices"
            ),

        batches:
            root.collection(
                "lotes"
            ),
    };
}

function respuestaProgresoPosLegacy(
    attempt
) {
    return {
        attemptId:
            attempt.id,

        expected:
            attempt.expected,

        received:
            attempt.received,

        migrated:
            attempt.migrated,

        skipped:
            attempt.skipped,

        nextKind:
            attempt.nextKind ||
            null,

        nextIndex:
            Number(
                attempt.nextIndex ||
                0
            ),
    };
}

async function reconocerMigracionLegacyCompletada(
    context
) {
    const refs =
        refsEstadoPosLegacy(
            context.clienteRef
        );

    const deviceRef =
        refs.devices.doc(
            hashPosLegacy(
                context.deviceId
            )
        );

    return db.runTransaction(
        async (
            transaction
        ) => {
            const deviceSnap =
                await transaction.get(
                    deviceRef
                );

            const deviceData =
                deviceSnap.data() ||
                {};

            if (
                deviceData.status ===
                "completed"
            ) {
                return {
                    completed: true,
                    active: false,
                    result:
                        deviceData.result ||
                        null,
                };
            }

            const legacyRootSnap =
                await transaction.get(
                    refs.root
                );

            const legacyRoot =
                legacyRootSnap.data() ||
                {};

            const completedDeviceIds =
                Array.isArray(
                    legacyRoot
                        .completedDeviceIds
                )
                    ? legacyRoot
                        .completedDeviceIds
                    : [];

            if (
                Number(
                    legacyRoot.version ||
                    0
                ) <
                    POS_LEGACY_MIGRATION_VERSION ||
                !completedDeviceIds.includes(
                    context.deviceId
                )
            ) {
                return {
                    completed: false,
                    active:
                        deviceData.status ===
                        "active",
                    result: null,
                };
            }

            /*
             * El padre pertenecía al protocolo anterior y podía
             * escribirse desde el browser. Sólo lo usamos como un
             * marcador monotónico para DENEGAR una nueva importación;
             * nunca autoriza datos ni se copia su contenido al estado
             * protegido. Un valor falsificado sólo puede omitir la
             * migración del propio dispositivo, no crear documentos.
             */
            transaction.set(
                deviceRef,
                {
                    version:
                        POS_LEGACY_MIGRATION_VERSION,

                    status:
                        "completed",

                    attemptId:
                        null,

                    expected:
                        null,

                    received:
                        null,

                    result:
                        null,

                    importedFromLegacyMarker:
                        true,

                    completedAt:
                        admin.firestore.FieldValue.serverTimestamp(),

                    lastActivityAt:
                        admin.firestore.FieldValue.serverTimestamp(),

                    lastActivityAtMs:
                        Date.now(),
                },
                {
                    merge: true,
                }
            );

            return {
                completed: true,
                active: false,
                result: null,
            };
        }
    );
}

async function iniciarMigracionPosLegacy(
    request,
    context
) {
    const previousCompletion =
        await reconocerMigracionLegacyCompletada(
            context
        );

    if (
        previousCompletion.completed
    ) {
        return {
            ok: true,
            action: "start",
            started: false,
            reason:
                "already-completed",
            result:
                previousCompletion.result,

            limits: {
                maxItems:
                    POS_LEGACY_BATCH_MAX_ITEMS,

                maxBytes:
                    POS_LEGACY_BATCH_MAX_BYTES,
            },
        };
    }

    if (
        request.data
            ?.probeOnly ===
            true &&
        !previousCompletion.active
    ) {
        return {
            ok: false,
            action: "start",
            started: false,
            reason:
                "migration-review-required",
            message:
                "La caché pertenece a una instalación anterior sin una migración completada verificable. Se requiere revisión antes de importarla.",

            limits: {
                maxItems:
                    POS_LEGACY_BATCH_MAX_ITEMS,

                maxBytes:
                    POS_LEGACY_BATCH_MAX_BYTES,
            },
        };
    }

    if (
        context.operador
            .rol !==
        "administrador"
    ) {
        return {
            ok: true,
            action: "start",
            started: false,
            reason:
                "admin-required",
            requiredRole:
                "administrador",

            limits: {
                maxItems:
                    POS_LEGACY_BATCH_MAX_ITEMS,

                maxBytes:
                    POS_LEGACY_BATCH_MAX_BYTES,
            },
        };
    }

    const expected =
        validarContadoresPosLegacy(
            request.data
                ?.counts
        );

    const deviceHash =
        hashPosLegacy(
            context.deviceId
        );

    const refs =
        refsEstadoPosLegacy(
            context.clienteRef
        );

    const deviceRef =
        refs.devices.doc(
            deviceHash
        );

    /*
     * El ID se genera exclusivamente en el servidor. Si la
     * transaccion termina reanudando otro intento, esta
     * referencia simplemente no se utiliza.
     */
    const newAttemptRef =
        refs.attempts.doc();

    const nowMs =
        Date.now();

    const result =
        await db.runTransaction(
            async (
                transaction
            ) => {
                const controlSnap =
                    await transaction.get(
                        refs.control
                    );

                const deviceSnap =
                    await transaction.get(
                        deviceRef
                    );

                const deviceData =
                    deviceSnap.data() ||
                    {};

                if (
                    deviceData.status ===
                    "completed"
                ) {
                    return {
                        completed: true,
                        result:
                            deviceData.result ||
                            null,
                    };
                }

                const control =
                    controlSnap.data() ||
                    {};

                const activeAttemptId =
                    textoSeguro(
                        control
                            .activeAttemptId,
                        180
                    );

                let activeAttemptRef =
                    null;

                let activeAttempt =
                    null;

                if (
                    activeAttemptId &&
                    /^[a-zA-Z0-9._:-]+$/.test(
                        activeAttemptId
                    )
                ) {
                    activeAttemptRef =
                        refs.attempts.doc(
                            activeAttemptId
                        );

                    const activeSnap =
                        await transaction.get(
                            activeAttemptRef
                        );

                    if (
                        activeSnap.exists
                    ) {
                        activeAttempt = {
                            id:
                                activeSnap.id,

                            ...activeSnap.data(),
                        };
                    }
                }

                const lockIsFresh =
                    Boolean(
                        activeAttempt &&
                        activeAttempt
                            .status ===
                            "active" &&
                        nowMs -
                            Number(
                                activeAttempt
                                    .lastActivityAtMs ||
                                0
                            ) <
                            POS_LEGACY_LOCK_TIMEOUT_MS
                    );

                if (
                    lockIsFresh &&
                    activeAttempt
                        .deviceHash ===
                        deviceHash
                ) {
                    if (
                        !mismosContadoresPosLegacy(
                            activeAttempt
                                .expected,
                            expected
                        )
                    ) {
                        throw new HttpsError(
                            "failed-precondition",
                            "La migracion activa fue iniciada con otros contadores.",
                            {
                                motivo:
                                    "migration-counts-mismatch",

                                expected:
                                    activeAttempt
                                        .expected,
                            }
                        );
                    }

                    /*
                     * Reanudar no prolonga el lock por sí solo.
                     * Cada lote confirmado sí lo refresca. Así un
                     * payload cambiado que entra en conflicto puede
                     * recuperarse cuando vence el intento anterior.
                     */

                    return {
                        resumed: true,
                        attempt:
                            activeAttempt,
                    };
                }

                if (
                    lockIsFresh
                ) {
                    throw new HttpsError(
                        "resource-exhausted",
                        "Otro dispositivo esta migrando los datos locales.",
                        {
                            motivo:
                                "migration-in-progress",
                        }
                    );
                }

                /*
                 * Todas las lecturas terminaron. El documento
                 * padre legacy no se consulta ni se considera
                 * una fuente de autoridad.
                 */
                if (
                    activeAttemptRef &&
                    activeAttempt &&
                    activeAttempt
                        .status ===
                        "active"
                ) {
                    transaction.set(
                        activeAttemptRef,
                        {
                            status:
                                "abandoned",

                            abandonedAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        },
                        {
                            merge: true,
                        }
                    );
                }

                const received =
                    contadoresPosLegacyVacios();

                const attempt = {
                    id:
                        newAttemptRef.id,

                    version:
                        POS_LEGACY_MIGRATION_VERSION,

                    status:
                        "active",

                    deviceHash,

                    authUid:
                        textoSeguro(
                            request.auth
                                ?.uid,
                            180
                        ),

                    operadorId:
                        context.operador
                            .id,

                    expected,
                    received,

                    migrated:
                        contadoresPosLegacyVacios(),

                    skipped:
                        contadoresPosLegacyVacios(),

                    openCashSessionCount: 0,

                    nextKind:
                        siguienteKindPosLegacy(
                            expected,
                            received
                        ),

                    nextIndex: 0,

                    createdAt:
                        admin.firestore.FieldValue.serverTimestamp(),

                    lastActivityAt:
                        admin.firestore.FieldValue.serverTimestamp(),

                    lastActivityAtMs:
                        nowMs,
                };

                transaction.set(
                    newAttemptRef,
                    attempt
                );

                transaction.set(
                    refs.control,
                    {
                        version:
                            POS_LEGACY_MIGRATION_VERSION,

                        status:
                            "active",

                        activeAttemptId:
                            newAttemptRef.id,

                        deviceHash,

                        lastActivityAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        lastActivityAtMs:
                            nowMs,
                    }
                );

                transaction.set(
                    deviceRef,
                    {
                        version:
                            POS_LEGACY_MIGRATION_VERSION,

                        status:
                            "active",

                        attemptId:
                            newAttemptRef.id,

                        expected,

                        startedAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        lastActivityAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        lastActivityAtMs:
                            nowMs,
                    },
                    {
                        merge: true,
                    }
                );

                return {
                    started: true,
                    attempt,
                };
            }
        );

    if (
        result.completed
    ) {
        return {
            ok: true,
            action: "start",
            started: false,
            reason:
                "already-completed",
            result:
                result.result,

            limits: {
                maxItems:
                    POS_LEGACY_BATCH_MAX_ITEMS,

                maxBytes:
                    POS_LEGACY_BATCH_MAX_BYTES,
            },
        };
    }

    return {
        ok: true,
        action: "start",
        started: true,
        resumed:
            Boolean(
                result.resumed
            ),
        reason:
            result.resumed
                ? "resumed"
                : "started",

        ...respuestaProgresoPosLegacy(
            result.attempt
        ),

        limits: {
            maxItems:
                POS_LEGACY_BATCH_MAX_ITEMS,

            maxBytes:
                POS_LEGACY_BATCH_MAX_BYTES,
        },
    };
}

function validarLotePosLegacy(
    request
) {
    const attemptId =
        validarId(
            request.data
                ?.attemptId,
            "attemptId"
        );

    const kind =
        textoPosLegacy(
            request.data
                ?.kind,
            "kind",
            {
                maxLength: 40,
                required: true,
            }
        );

    if (
        !POS_LEGACY_KINDS.includes(
            kind
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Tipo de lote legacy invalido."
        );
    }

    const index =
        Number(
            request.data
                ?.index
        );

    if (
        !Number.isInteger(
            index
        ) ||
        index < 0 ||
        index >
            POS_LEGACY_MAX_COUNTS[
                kind
            ]
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Indice de lote legacy invalido."
        );
    }

    const items =
        request.data
            ?.items;

    if (
        !Array.isArray(
            items
        ) ||
        items.length ===
            0 ||
        items.length >
            POS_LEGACY_BATCH_MAX_ITEMS
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Cada lote debe contener entre 1 y 80 documentos."
        );
    }

    if (
        bytesPosLegacy(
            items
        ) >
        POS_LEGACY_BATCH_MAX_BYTES
    ) {
        throw new HttpsError(
            "invalid-argument",
            "El lote supera el limite de 750 KB."
        );
    }

    const normalized =
        items.map(
            (
                item
            ) =>
                normalizarDocumentoPosLegacy(
                    kind,
                    item
                )
        );

    const documentIds =
        normalized.map(
            (
                item
            ) =>
                item.id
        );

    if (
        new Set(
            documentIds
        ).size !==
        documentIds.length
    ) {
        throw new HttpsError(
            "invalid-argument",
            "El lote contiene IDs de documento duplicados."
        );
    }

    const canonical =
        serializarPosLegacyCanonico(
            normalized
        );

    if (
        bytesPosLegacy(
            canonical
        ) >
        POS_LEGACY_BATCH_MAX_BYTES
    ) {
        throw new HttpsError(
            "invalid-argument",
            "El lote normalizado supera el limite de 750 KB."
        );
    }

    return {
        attemptId,
        kind,
        index,
        normalized,

        hash:
            hashPosLegacy(
                canonical
            ),
    };
}

function referenciaDestinoPosLegacy(
    clienteRef,
    kind,
    id
) {
    const collections = {
        products:
            "productos",
        sales:
            "ventas",
        cashSessions:
            "cajas",
    };

    return clienteRef
        .collection(
            collections[
                kind
            ]
        )
        .doc(
            id
        );
}

function datosDestinoPosLegacy(
    item,
    kind,
    deviceId
) {
    const base = {
        ...item.data,

        migratedFromLocal:
            true,

        migrationVersion:
            POS_LEGACY_MIGRATION_VERSION,

        migratedByDeviceId:
            deviceId,

        createdAt:
            admin.firestore.FieldValue.serverTimestamp(),

        migratedAt:
            admin.firestore.FieldValue.serverTimestamp(),
    };

    if (
        kind ===
            "products" ||
        kind ===
            "cashSessions"
    ) {
        base.updatedAt =
            admin.firestore.FieldValue.serverTimestamp();
    }

    return base;
}

function documentoDestinoPosLegacyCoincide(
    kind,
    item,
    existingData
) {
    try {
        const normalizedExisting =
            normalizarDocumentoPosLegacy(
                kind,
                existingData
            );

        let rawComparable =
            normalizedExisting.data;

        if (
            kind ===
            "sales"
        ) {
            if (
                !Array.isArray(
                    existingData
                        ?.items
                )
            ) {
                return false;
            }

            rawComparable = {
                id:
                    existingData.id,

                timestamp:
                    existingData.timestamp,

                items:
                    existingData.items.map(
                        (
                            saleItem
                        ) => ({
                            barcode:
                                saleItem
                                    ?.barcode,

                            name:
                                saleItem
                                    ?.name,

                            tipoVenta:
                                saleItem
                                    ?.tipoVenta,

                            unidadMedida:
                                saleItem
                                    ?.unidadMedida ??
                                null,

                            price:
                                saleItem
                                    ?.price,

                            qty:
                                saleItem
                                    ?.qty,

                            subtotal:
                                saleItem
                                    ?.subtotal,
                        })
                    ),

                total:
                    existingData.total,

                sessionId:
                    existingData
                        .sessionId ??
                    null,

                payment: {
                    method:
                        existingData
                            .payment
                            ?.method,

                    received:
                        existingData
                            .payment
                            ?.received,

                    change:
                        existingData
                            .payment
                            ?.change,
                },
            };
        }

        if (
            kind ===
            "cashSessions"
        ) {
            rawComparable = {
                id:
                    existingData.id,

                openTime:
                    existingData
                        .openTime,

                openAmount:
                    existingData
                        .openAmount,

                closeTime:
                    existingData
                        .closeTime ??
                    null,

                closeAmount:
                    existingData
                        .closeAmount ??
                    null,

                expectedAmount:
                    existingData
                        .expectedAmount ??
                    null,

                counted:
                    existingData
                        .counted ??
                    null,

                diff:
                    existingData
                        .diff ??
                    null,

                totalSales:
                    existingData
                        .totalSales,

                salesCount:
                    existingData
                        .salesCount,

                paymentTotals: {
                    efectivo:
                        existingData
                            .paymentTotals
                            ?.efectivo,

                    transferencia:
                        existingData
                            .paymentTotals
                            ?.transferencia,

                    qr:
                        existingData
                            .paymentTotals
                            ?.qr,

                    tarjeta:
                        existingData
                            .paymentTotals
                            ?.tarjeta,
                },

                status:
                    existingData.status,
            };
        }

        return (
            normalizedExisting.id ===
                item.id &&
            serializarPosLegacyCanonico(
                normalizedExisting.data
            ) ===
                serializarPosLegacyCanonico(
                    item.data
                ) &&
            serializarPosLegacyCanonico(
                rawComparable
            ) ===
                serializarPosLegacyCanonico(
                    item.data
                )
        );
    } catch {
        return false;
    }
}

function cerrarCajaPosLegacyPorConflicto(
    cashData
) {
    return {
        ...cashData,

        status:
            "closed",

        closeTime:
            null,

        closeAmount:
            null,

        expectedAmount:
            redondearPosLegacy(
                Number(
                    cashData
                        .openAmount ||
                    0
                ) +
                Number(
                    cashData
                        .paymentTotals
                        ?.efectivo ||
                    0
                ),
                2
            ),

        counted:
            null,

        diff:
            null,
    };
}

async function guardarLotePosLegacy(
    request,
    context
) {
    const batch =
        validarLotePosLegacy(
            request
        );

    const deviceHash =
        hashPosLegacy(
            context.deviceId
        );

    const refs =
        refsEstadoPosLegacy(
            context.clienteRef
        );

    const attemptRef =
        refs.attempts.doc(
            batch.attemptId
        );

    const deviceRef =
        refs.devices.doc(
            deviceHash
        );

    const lotId =
        hashPosLegacy(
            batch.attemptId +
            "\u0000" +
            batch.kind +
            "\u0000" +
            batch.index
        );

    const lotRef =
        refs.batches.doc(
            lotId
        );

    const destinations =
        batch.normalized.map(
            (
                item
            ) =>
                referenciaDestinoPosLegacy(
                    context.clienteRef,
                    batch.kind,
                    item.id
                )
        );

    const openMarkers =
        batch.kind ===
        "cashSessions"
            ? batch.normalized
                .map(
                    (
                        item,
                        index
                    ) => ({
                        item,
                        index,

                        ref:
                            refs.batches.doc(
                                hashPosLegacy(
                                    "open-cash" +
                                    "\u0000" +
                                    batch.attemptId +
                                    "\u0000" +
                                    item.id
                                )
                            ),
                    }))
                .filter(
                    (
                        marker
                    ) =>
                        marker.item
                            .data
                            .status ===
                        "open"
                )
            : [];

    const openCashSessionsInBatch =
        openMarkers.length;

    const nowMs =
        Date.now();

    const result =
        await db.runTransaction(
            async (
                transaction
            ) => {
                const attemptSnap =
                    await transaction.get(
                        attemptRef
                    );

                const controlSnap =
                    await transaction.get(
                        refs.control
                    );

                const deviceSnap =
                    await transaction.get(
                        deviceRef
                    );

                const lotSnap =
                    await transaction.get(
                        lotRef
                    );

                if (
                    !attemptSnap.exists
                ) {
                    throw new HttpsError(
                        "not-found",
                        "El intento de migracion no existe."
                    );
                }

                const attempt = {
                    id:
                        attemptSnap.id,

                    ...attemptSnap.data(),
                };

                if (
                    attempt.deviceHash !==
                    deviceHash
                ) {
                    throw new HttpsError(
                        "permission-denied",
                        "El intento pertenece a otro dispositivo."
                    );
                }

                if (
                    lotSnap.exists
                ) {
                    const stored =
                        lotSnap.data() ||
                        {};

                    if (
                        stored.hash !==
                        batch.hash
                    ) {
                        throw new HttpsError(
                            "already-exists",
                            "El indice del lote ya fue usado con otros datos.",
                            {
                                motivo:
                                    "migration-batch-conflict",
                            }
                        );
                    }

                    if (
                        attempt.status ===
                        "active"
                    ) {
                        transaction.set(
                            attemptRef,
                            {
                                lastActivityAtMs:
                                    nowMs,

                                lastActivityAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge: true,
                            }
                        );

                        transaction.set(
                            refs.control,
                            {
                                lastActivityAtMs:
                                    nowMs,

                                lastActivityAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge: true,
                            }
                        );

                        transaction.set(
                            deviceRef,
                            {
                                lastActivityAtMs:
                                    nowMs,

                                lastActivityAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            {
                                merge: true,
                            }
                        );
                    }

                    return {
                        duplicate: true,
                        result:
                            stored.result,

                        progress:
                            stored.progress,
                    };
                }

                const control =
                    controlSnap.data() ||
                    {};

                const device =
                    deviceSnap.data() ||
                    {};

                if (
                    attempt.status !==
                        "active" ||
                    control
                        .activeAttemptId !==
                        batch.attemptId ||
                    control.deviceHash !==
                        deviceHash ||
                    device.attemptId !==
                        batch.attemptId ||
                    device.status !==
                        "active"
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        "El intento de migracion ya no esta activo.",
                        {
                            motivo:
                                "migration-lock-lost",
                        }
                    );
                }

                if (
                    attempt.nextKind !==
                        batch.kind ||
                    Number(
                        attempt.nextIndex ||
                        0
                    ) !==
                        batch.index
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        "El lote no respeta el orden esperado.",
                        {
                            motivo:
                                "migration-batch-out-of-order",

                            nextKind:
                                attempt
                                    .nextKind ||
                                null,

                            nextIndex:
                                Number(
                                    attempt
                                        .nextIndex ||
                                    0
                                ),
                        }
                    );
                }

                const currentReceived =
                    Number(
                        attempt.received
                            ?.[
                                batch
                                    .kind
                            ] ||
                        0
                    );

                const expected =
                    Number(
                        attempt.expected
                            ?.[
                                batch
                                    .kind
                            ] ||
                        0
                    );

                const nextReceived =
                    currentReceived +
                    batch.normalized
                        .length;

                if (
                    nextReceived >
                    expected
                ) {
                    throw new HttpsError(
                        "invalid-argument",
                        "El lote excede la cantidad declarada al iniciar."
                    );
                }

                const nextOpenCashSessionCount =
                    Number(
                        attempt
                            .openCashSessionCount ||
                        0
                    ) +
                    openCashSessionsInBatch;

                if (
                    nextOpenCashSessionCount >
                    1
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        "Los datos locales contienen mas de una caja abierta.",
                        {
                            motivo:
                                "migration-multiple-open-cash-sessions",
                        }
                    );
                }

                /*
                 * Estas lecturas se completan antes de cualquier
                 * escritura. Los documentos cloud existentes
                 * siempre conservan prioridad.
                 */
                const destinationSnaps =
                    [];

                for (
                    const destination of
                    destinations
                ) {
                    destinationSnaps.push(
                        await transaction.get(
                            destination
                        )
                    );
                }

                let migratedCount =
                    0;

                let skippedCount =
                    0;

                for (
                    let index = 0;
                    index <
                        destinations
                            .length;
                    index += 1
                ) {
                    const normalizedItem =
                        batch.normalized[
                            index
                        ];

                    const isDeferredOpenCash =
                        batch.kind ===
                            "cashSessions" &&
                        normalizedItem.data
                            .status ===
                            "open";

                    if (
                        isDeferredOpenCash
                    ) {
                        continue;
                    }

                    if (
                        destinationSnaps[
                            index
                        ].exists
                    ) {
                        if (
                            batch.kind !==
                                "products" &&
                            !documentoDestinoPosLegacyCoincide(
                                batch.kind,
                                normalizedItem,
                                destinationSnaps[
                                    index
                                ].data()
                            )
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "Un documento existente en Cloud no coincide con la copia local.",
                                {
                                    motivo:
                                        "migration-existing-document-conflict",

                                    kind:
                                        batch.kind,

                                    documentId:
                                        normalizedItem.id,
                                }
                            );
                        }

                        skippedCount +=
                            1;
                        continue;
                    }

                    transaction.set(
                        destinations[
                            index
                        ],
                        datosDestinoPosLegacy(
                            batch.normalized[
                                index
                            ],
                            batch.kind,
                            context.deviceId
                        )
                    );

                    migratedCount +=
                        1;
                }

                for (
                    const marker of
                    openMarkers
                ) {
                    transaction.set(
                        marker.ref,
                        {
                            type:
                                "open-cash-marker",

                            attemptId:
                                batch.attemptId,

                            cashSessionId:
                                marker.item.id,

                            cashSession:
                                marker.item.data,

                            destinationExisted:
                                destinationSnaps[
                                    marker.index
                                ].exists,

                            createdAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        }
                    );
                }

                const received = {
                    ...attempt.received,

                    [
                        batch.kind
                    ]:
                        nextReceived,
                };

                const migrated = {
                    ...attempt.migrated,

                    [
                        batch.kind
                    ]:
                        Number(
                            attempt.migrated
                                ?.[
                                    batch
                                        .kind
                                ] ||
                            0
                        ) +
                        migratedCount,
                };

                const skipped = {
                    ...attempt.skipped,

                    [
                        batch.kind
                    ]:
                        Number(
                            attempt.skipped
                                ?.[
                                    batch
                                        .kind
                                ] ||
                            0
                        ) +
                        skippedCount,
                };

                const kindCompleted =
                    nextReceived ===
                    expected;

                const nextKind =
                    kindCompleted
                        ? siguienteKindPosLegacy(
                            attempt
                                .expected,
                            received,
                            batch.kind
                        )
                        : batch.kind;

                const nextIndex =
                    kindCompleted
                        ? 0
                        : batch.index +
                            1;

                const progress = {
                    attemptId:
                        batch.attemptId,
                    expected:
                        attempt.expected,
                    received,
                    migrated,
                    skipped,
                    nextKind,
                    nextIndex,
                };

                const batchResult = {
                    kind:
                        batch.kind,
                    index:
                        batch.index,
                    received:
                        batch.normalized
                            .length,
                    migrated:
                        migratedCount,
                    skipped:
                        skippedCount,
                };

                transaction.set(
                    lotRef,
                    {
                        type:
                            "batch",

                        attemptId:
                            batch.attemptId,

                        kind:
                            batch.kind,

                        index:
                            batch.index,

                        hash:
                            batch.hash,

                        itemCount:
                            batch.normalized
                                .length,

                        result:
                            batchResult,

                        progress,

                        createdAt:
                            admin.firestore.FieldValue.serverTimestamp(),
                    }
                );

                transaction.set(
                    attemptRef,
                    {
                        received,
                        migrated,
                        skipped,
                        nextKind,
                        nextIndex,

                        openCashSessionCount:
                            nextOpenCashSessionCount,

                        lastActivityAtMs:
                            nowMs,

                        lastActivityAt:
                            admin.firestore.FieldValue.serverTimestamp(),
                    },
                    {
                        merge: true,
                    }
                );

                transaction.set(
                    refs.control,
                    {
                        lastActivityAtMs:
                            nowMs,

                        lastActivityAt:
                            admin.firestore.FieldValue.serverTimestamp(),
                    },
                    {
                        merge: true,
                    }
                );

                transaction.set(
                    deviceRef,
                    {
                        received,
                        lastActivityAtMs:
                            nowMs,

                        lastActivityAt:
                            admin.firestore.FieldValue.serverTimestamp(),
                    },
                    {
                        merge: true,
                    }
                );

                return {
                    duplicate: false,
                    result:
                        batchResult,
                    progress,
                };
            }
        );

    return {
        ok: true,
        action: "batch",
        duplicate:
            result.duplicate,
        batch:
            result.result,
        ...result.progress,
    };
}

function nombreOpcionalPosLegacy(
    value
) {
    if (
        value == null ||
        value ===
            ""
    ) {
        return null;
    }

    return validarTextoEstricto(
        value,
        "shopName",
        {
            minLength: 1,
            maxLength: 120,
        }
    );
}

async function completarMigracionPosLegacy(
    request,
    context
) {
    const attemptId =
        validarId(
            request.data
                ?.attemptId,
            "attemptId"
        );

    const shopName =
        nombreOpcionalPosLegacy(
            request.data
                ?.shopName
        );

    const rawOpenCashSessionId =
        request.data
            ?.openCashSessionId;

    const openCashSessionId =
        rawOpenCashSessionId == null ||
        rawOpenCashSessionId ===
            ""
            ? null
            : normalizarIdPosLegacy(
                textoPosLegacy(
                    rawOpenCashSessionId,
                    "openCashSessionId",
                    {
                        maxLength: 1000,
                        required: true,
                    }
                ),
                "cashSessions"
            );

    const deviceHash =
        hashPosLegacy(
            context.deviceId
        );

    const refs =
        refsEstadoPosLegacy(
            context.clienteRef
        );

    const attemptRef =
        refs.attempts.doc(
            attemptId
        );

    const deviceRef =
        refs.devices.doc(
            deviceHash
        );

    const configRef =
        context.clienteRef
            .collection(
                "configuracion"
            )
            .doc(
                "pos"
            );

    const openMarkerRef =
        openCashSessionId
            ? refs.batches.doc(
                hashPosLegacy(
                    "open-cash" +
                    "\u0000" +
                    attemptId +
                    "\u0000" +
                    openCashSessionId
                )
            )
            : null;

    const openCashRef =
        openCashSessionId
            ? context.clienteRef
                .collection(
                    "cajas"
                )
                .doc(
                    openCashSessionId
                )
            : null;

    const nowMs =
        Date.now();

    const result =
        await db.runTransaction(
            async (
                transaction
            ) => {
                const attemptSnap =
                    await transaction.get(
                        attemptRef
                    );

                const controlSnap =
                    await transaction.get(
                        refs.control
                    );

                const deviceSnap =
                    await transaction.get(
                        deviceRef
                    );

                const configSnap =
                    await transaction.get(
                        configRef
                    );

                const configuredOpenCashSessionId =
                    normalizarIdDocumentoSeguro(
                        configSnap.data()
                            ?.openCashSessionId,
                        180
                    );

                let configuredOpenCashSnap =
                    null;

                if (
                    configuredOpenCashSessionId
                ) {
                    configuredOpenCashSnap =
                        await transaction.get(
                            context.clienteRef
                                .collection(
                                    "cajas"
                                )
                                .doc(
                                    configuredOpenCashSessionId
                                )
                        );
                }

                let openMarkerSnap =
                    null;

                let openCashSnap =
                    null;

                if (
                    openMarkerRef &&
                    openCashRef
                ) {
                    openMarkerSnap =
                        await transaction.get(
                            openMarkerRef
                        );

                    openCashSnap =
                        configuredOpenCashSessionId ===
                        openCashSessionId
                            ? configuredOpenCashSnap
                            : await transaction.get(
                                openCashRef
                            );
                }

                if (
                    !attemptSnap.exists
                ) {
                    throw new HttpsError(
                        "not-found",
                        "El intento de migracion no existe."
                    );
                }

                const attempt = {
                    id:
                        attemptSnap.id,

                    ...attemptSnap.data(),
                };

                if (
                    attempt.deviceHash !==
                    deviceHash
                ) {
                    throw new HttpsError(
                        "permission-denied",
                        "El intento pertenece a otro dispositivo."
                    );
                }

                if (
                    attempt.status ===
                    "completed"
                ) {
                    return {
                        duplicate: true,
                        result:
                            attempt.result ||
                            null,
                    };
                }

                const control =
                    controlSnap.data() ||
                    {};

                const device =
                    deviceSnap.data() ||
                    {};

                if (
                    attempt.status !==
                        "active" ||
                    control
                        .activeAttemptId !==
                        attemptId ||
                    control.deviceHash !==
                        deviceHash ||
                    device.attemptId !==
                        attemptId ||
                    device.status !==
                        "active"
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        "El intento de migracion ya no esta activo.",
                        {
                            motivo:
                                "migration-lock-lost",
                        }
                    );
                }

                if (
                    attempt.nextKind ||
                    !mismosContadoresPosLegacy(
                        attempt.expected,
                        attempt.received
                    )
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        "Todavia faltan lotes por recibir.",
                        {
                            motivo:
                                "migration-incomplete",

                            expected:
                                attempt
                                    .expected,

                            received:
                                attempt
                                    .received,

                            nextKind:
                                attempt
                                    .nextKind ||
                                null,

                            nextIndex:
                                Number(
                                    attempt
                                        .nextIndex ||
                                    0
                                ),
                        }
                    );
                }

                const openCashSessionCount =
                    Number(
                        attempt
                            .openCashSessionCount ||
                        0
                    );

                if (
                    openCashSessionCount >
                        1 ||
                    (
                        openCashSessionCount ===
                            1 &&
                        !openCashSessionId
                    ) ||
                    (
                        openCashSessionCount ===
                            0 &&
                        openCashSessionId
                    )
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        "La caja abierta declarada no coincide con los datos migrados.",
                        {
                            motivo:
                                "migration-open-cash-mismatch",
                        }
                    );
                }

                const config =
                    configSnap.data() ||
                    {};

                const existingShopName =
                    textoSeguro(
                        config.shopName,
                        120
                    );

                const shopNameMigrated =
                    Boolean(
                        shopName &&
                        !existingShopName
                    );

                let openCashRecovered =
                    false;

                let openCashAutoClosed =
                    false;

                let deferredOpenCashMigrated =
                    0;

                let deferredOpenCashSkipped =
                    0;

                const hasValidConfiguredOpenCash =
                    Boolean(
                        configuredOpenCashSessionId &&
                        configuredOpenCashSnap
                            ?.exists &&
                        configuredOpenCashSnap.data()
                            ?.status ===
                            "open"
                    );

                if (
                    openCashSessionId
                ) {
                    const markerData =
                        openMarkerSnap
                            ?.data() ||
                        {};

                    if (
                        !openMarkerSnap
                            ?.exists ||
                        markerData.type !==
                            "open-cash-marker" ||
                        markerData.attemptId !==
                            attemptId ||
                        markerData.cashSessionId !==
                            openCashSessionId
                    ) {
                        throw new HttpsError(
                            "failed-precondition",
                            "No se encontro la caja abierta validada del intento.",
                            {
                                motivo:
                                    "migration-open-cash-marker-missing",
                            }
                        );
                    }

                    const normalizedOpenCash =
                        normalizarCajaPosLegacy(
                            markerData
                                .cashSession
                        );

                    if (
                        normalizedOpenCash.id !==
                            openCashSessionId ||
                        normalizedOpenCash
                            .data
                            .status !==
                            "open"
                    ) {
                        throw new HttpsError(
                            "failed-precondition",
                            "El marcador de caja abierta no es valido.",
                            {
                                motivo:
                                    "migration-open-cash-marker-invalid",
                            }
                        );
                    }

                    if (
                        openCashSnap
                            ?.exists &&
                        !documentoDestinoPosLegacyCoincide(
                            "cashSessions",
                            normalizedOpenCash,
                            openCashSnap.data()
                        )
                    ) {
                        throw new HttpsError(
                            "failed-precondition",
                            "La caja existente en Cloud no coincide con la copia local.",
                            {
                                motivo:
                                    "migration-existing-document-conflict",

                                kind:
                                    "cashSessions",

                                documentId:
                                    openCashSessionId,
                            }
                        );
                    }

                    if (
                        hasValidConfiguredOpenCash &&
                        configuredOpenCashSessionId !==
                            openCashSessionId
                    ) {
                        if (
                            openCashSnap
                                ?.exists
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "Cloud ya contiene otra caja abierta y la caja local tambien existe.",
                                {
                                    motivo:
                                        "migration-cloud-open-cash-conflict",
                                }
                            );
                        }

                        const autoClosedData = {
                            ...datosDestinoPosLegacy(
                                {
                                    data:
                                        cerrarCajaPosLegacyPorConflicto(
                                            normalizedOpenCash
                                                .data
                                        ),
                                },
                                "cashSessions",
                                context.deviceId
                            ),

                            migrationAutoClosed:
                                true,

                            migrationAutoCloseReason:
                                "cloud-cash-already-open",
                        };

                        transaction.set(
                            openCashRef,
                            autoClosedData
                        );

                        openCashAutoClosed =
                            true;

                        deferredOpenCashMigrated =
                            1;
                    } else {
                        if (
                            openCashSnap
                                ?.exists
                        ) {
                            deferredOpenCashSkipped =
                                1;
                        } else {
                            transaction.set(
                                openCashRef,
                                datosDestinoPosLegacy(
                                    normalizedOpenCash,
                                    "cashSessions",
                                    context.deviceId
                                )
                            );

                            deferredOpenCashMigrated =
                                1;
                        }

                        if (
                            !hasValidConfiguredOpenCash
                        ) {
                            openCashRecovered =
                                true;
                        }
                    }
                }

                const configUpdate = {};

                if (
                    shopNameMigrated
                ) {
                    configUpdate.shopName =
                        shopName;
                }

                if (
                    openCashRecovered
                ) {
                    configUpdate
                        .openCashSessionId =
                        openCashSessionId;
                }

                if (
                    Object.keys(
                        configUpdate
                    ).length >
                    0
                ) {
                    transaction.set(
                        configRef,
                        {
                            ...configUpdate,

                            migratedFromLocal:
                                true,

                            migrationVersion:
                                POS_LEGACY_MIGRATION_VERSION,

                            migratedByDeviceId:
                                context.deviceId,

                            migratedAt:
                                admin.firestore.FieldValue.serverTimestamp(),

                            updatedAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        },
                        {
                            merge: true,
                        }
                    );
                }

                const stats = {
                    products: {
                        migrated:
                            Number(
                                attempt.migrated
                                    ?.products ||
                                0
                            ),

                        skipped:
                            Number(
                                attempt.skipped
                                    ?.products ||
                                0
                            ),
                    },

                    sales: {
                        migrated:
                            Number(
                                attempt.migrated
                                    ?.sales ||
                                0
                            ),

                        skipped:
                            Number(
                                attempt.skipped
                                    ?.sales ||
                                0
                            ),
                    },

                    cashSessions: {
                        migrated:
                            Number(
                                attempt.migrated
                                    ?.cashSessions ||
                                0
                            ) +
                            deferredOpenCashMigrated,

                        skipped:
                            Number(
                                attempt.skipped
                                    ?.cashSessions ||
                                0
                            ) +
                            deferredOpenCashSkipped,
                    },

                    shopName: {
                        migrated:
                            shopNameMigrated,

                        skipped:
                            Boolean(
                                shopName &&
                                !shopNameMigrated
                            ),
                    },

                    openCashRecovered,

                    openCashAutoClosed,
                };

                const eventoAuditoria =
                    crearEventoAuditoria({
                        clienteRef:
                            context
                                .clienteRef,

                        operador:
                            context
                                .operador,

                        accion:
                            AUDIT_ACTIONS
                                .MIGRACION_POS_LEGACY,

                        deviceId:
                            context
                                .deviceId,

                        detalle: {
                            intentoId:
                                attemptId,

                            productosMigrados:
                                stats.products
                                    .migrated,

                            productosOmitidos:
                                stats.products
                                    .skipped,

                            ventasMigradas:
                                stats.sales
                                    .migrated,

                            ventasOmitidas:
                                stats.sales
                                    .skipped,

                            cajasMigradas:
                                stats.cashSessions
                                    .migrated,

                            cajasOmitidas:
                                stats.cashSessions
                                    .skipped,

                            nombreMigrado:
                                shopNameMigrated,

                            cajaAbiertaRecuperada:
                                openCashRecovered,

                            cajaAbiertaCerradaPorConflicto:
                                openCashAutoClosed,
                        },
                    });

                transaction.set(
                    eventoAuditoria.ref,
                    eventoAuditoria.data
                );

                transaction.set(
                    attemptRef,
                    {
                        status:
                            "completed",

                        result:
                            stats,

                        completedAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        lastActivityAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        lastActivityAtMs:
                            nowMs,
                    },
                    {
                        merge: true,
                    }
                );

                transaction.set(
                    deviceRef,
                    {
                        version:
                            POS_LEGACY_MIGRATION_VERSION,

                        status:
                            "completed",

                        attemptId,

                        expected:
                            attempt.expected,

                        received:
                            attempt.received,

                        result:
                            stats,

                        completedAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        lastActivityAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        lastActivityAtMs:
                            nowMs,
                    },
                    {
                        merge: true,
                    }
                );

                transaction.set(
                    refs.control,
                    {
                        version:
                            POS_LEGACY_MIGRATION_VERSION,

                        status:
                            "idle",

                        activeAttemptId:
                            null,

                        deviceHash:
                            null,

                        lastCompletedAttemptId:
                            attemptId,

                        lastActivityAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        lastActivityAtMs:
                            nowMs,
                    }
                );

                return {
                    duplicate: false,
                    result: stats,
                };
            }
        );

    return {
        ok: true,
        action: "complete",
        migrated: true,
        reason:
            result.duplicate
                ? "already-completed"
                : "completed",
        duplicate:
            result.duplicate,
        result:
            result.result,
    };
}

exports.migrarPosLegacy =
    onCall(
        POS_LEGACY_CALLABLE_OPTIONS,
        async (request) => {
            const version =
                Number(
                    request.data
                        ?.version
                );

            if (
                version !==
                POS_LEGACY_MIGRATION_VERSION
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "La versión de migración no es compatible.",
                    {
                        motivo:
                            "migration-version-unsupported",

                        expectedVersion:
                            POS_LEGACY_MIGRATION_VERSION,
                    }
                );
            }

            const action =
                textoPosLegacy(
                    request.data
                        ?.action,
                    "action",
                    {
                        maxLength: 20,
                        required: true,
                    }
                );

            const context =
                await resolverContextoEscrituraPos(
                    request,
                    {
                        requireRole:
                            action ===
                            "start"
                                ? null
                                : "administrador",
                    }
                );

            if (
                action ===
                "start"
            ) {
                return iniciarMigracionPosLegacy(
                    request,
                    context
                );
            }

            if (
                action ===
                "batch"
            ) {
                return guardarLotePosLegacy(
                    request,
                    context
                );
            }

            if (
                action ===
                "complete"
            ) {
                return completarMigracionPosLegacy(
                    request,
                    context
                );
            }

            throw new HttpsError(
                "invalid-argument",
                "Accion de migracion legacy invalida."
            );
        }
    );


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
   CUENTAS POR COBRAR — ALTA MANUAL + AUDITORÍA
========================================================= */

function redondearDineroCuentaPorCobrar(
    value
) {
    return (
        Math.round(
            (
                Number(value) +
                Number.EPSILON
            ) *
            100
        ) /
        100
    );
}

function validarFechaCuentaPorCobrar(
    value,
    fieldName,
    {
        required = false,
    } = {}
) {
    const clean =
        textoSeguro(
            value,
            10
        );

    if (!clean) {
        if (required) {
            throw new HttpsError(
                "invalid-argument",
                `${fieldName} es obligatoria.`
            );
        }

        return null;
    }

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
            clean
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            `${fieldName} no es válida.`
        );
    }

    const parsed =
        new Date(
            `${clean}T00:00:00.000Z`
        );

    if (
        Number.isNaN(
            parsed.getTime()
        ) ||
        parsed
            .toISOString()
            .slice(0, 10) !==
            clean
    ) {
        throw new HttpsError(
            "invalid-argument",
            `${fieldName} no es válida.`
        );
    }

    return clean;
}

function normalizarCuentaPorCobrarManual(
    value
) {
    if (
        !esObjetoPlano(
            value
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Los datos de la deuda no son válidos."
        );
    }

    const clienteNombre =
        textoSeguro(
            value.clienteNombre,
            120
        );

    const clienteTelefono =
        textoSeguro(
            value.clienteTelefono,
            50
        );

    const concepto =
        textoSeguro(
            value.concepto,
            180
        );

    const notas =
        textoSeguro(
            value.notas,
            1000
        );

    if (!clienteNombre) {
        throw new HttpsError(
            "invalid-argument",
            "El nombre del cliente es obligatorio."
        );
    }

    if (!concepto) {
        throw new HttpsError(
            "invalid-argument",
            "El concepto de la deuda es obligatorio."
        );
    }

    const importeOriginal =
        redondearDineroCuentaPorCobrar(
            value.importeOriginal
        );

    if (
        !Number.isFinite(
            importeOriginal
        ) ||
        importeOriginal <= 0 ||
        importeOriginal >
            999999999999
    ) {
        throw new HttpsError(
            "invalid-argument",
            "El importe de la deuda no es válido."
        );
    }

    const fechaOrigen =
        validarFechaCuentaPorCobrar(
            value.fechaOrigen,
            "La fecha de origen",
            {
                required: true,
            }
        );

    const vencimiento =
        validarFechaCuentaPorCobrar(
            value.vencimiento,
            "La fecha de vencimiento"
        );

    if (
        vencimiento &&
        vencimiento <
            fechaOrigen
    ) {
        throw new HttpsError(
            "invalid-argument",
            "El vencimiento no puede ser anterior a la fecha de origen."
        );
    }

    return {
        clienteNombre,
        clienteTelefono,
        concepto,
        notas,
        importeOriginal,
        fechaOrigen,
        vencimiento,
    };
}

exports.crearCuentaPorCobrarManual =
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
                    request.data
                        ?.deviceId,
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

            const cuenta =
                normalizarCuentaPorCobrarManual(
                    request.data
                        ?.cuenta
                );

            const cuentaRef =
                clienteRef
                    .collection(
                        "cuentasPorCobrar"
                    )
                    .doc();

            const operadorNombre =
                textoSeguro(
                    operadorAutorizado
                        ?.data
                        ?.nombre,
                    80
                );

            const operadorRol =
                validarRolOperador(
                    operadorAutorizado
                        .rol
                );

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const sessionId =
                            await obtenerSessionIdCajaAbiertaEnTransaccion(
                                transaction,
                                clienteRef
                            );

                        transaction.set(
                            cuentaRef,
                            {
                                ...cuenta,

                                origen:
                                    "manual",

                                ventaId:
                                    null,

                                totalPagado:
                                    0,

                                saldoPendiente:
                                    cuenta
                                        .importeOriginal,

                                estado:
                                    "pendiente",

                                creadoPor: {
                                    operadorId:
                                        operadorAutorizado
                                            .id,

                                    operadorNombre,

                                    operadorRol,
                                },

                                creadoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),

                                actualizadoEn:
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
                                        .ALTA_CUENTA_POR_COBRAR,

                                sessionId,

                                deviceId,

                                detalle: {
                                    cuentaId:
                                        cuentaRef.id,

                                    clienteNombre:
                                        cuenta
                                            .clienteNombre,

                                    concepto:
                                        cuenta
                                            .concepto,

                                    importeOriginal:
                                        cuenta
                                            .importeOriginal,

                                    fechaOrigen:
                                        cuenta
                                            .fechaOrigen,

                                    vencimiento:
                                        cuenta
                                            .vencimiento,

                                    origen:
                                        "manual",
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            sessionId,
                        };
                    }
                );

            return {
                ok: true,

                cuenta: {
                    id:
                        cuentaRef.id,

                    ...cuenta,

                    origen:
                        "manual",

                    ventaId:
                        null,

                    totalPagado:
                        0,

                    saldoPendiente:
                        cuenta
                            .importeOriginal,

                    estado:
                        "pendiente",

                    sessionIdAuditoria:
                        result.sessionId,
                },
            };
        }
    );

/* =========================================================
   CUENTAS POR COBRAR — REGISTRAR PAGO
========================================================= */

exports.registrarPagoCuentaPorCobrar =
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
                    request.data
                        ?.deviceId,
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

            const cuentaId =
                validarId(
                    request.data
                        ?.cuentaId,
                    "cuentaId"
                );

            const importe =
                redondearDineroCuentaPorCobrar(
                    request.data
                        ?.pago
                        ?.importe
                );

            if (
                !Number.isFinite(
                    importe
                ) ||
                importe <= 0 ||
                importe >
                    999999999999
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "El importe del pago no es válido."
                );
            }

            const metodoPago =
                textoSeguro(
                    request.data
                        ?.pago
                        ?.metodoPago,
                    40
                ) ||
                "efectivo";

            if (
                !POS_METODOS_PAGO.has(
                    metodoPago
                )
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    "El método de pago no es válido."
                );
            }

            const cuentaRef =
                clienteRef
                    .collection(
                        "cuentasPorCobrar"
                    )
                    .doc(
                        cuentaId
                    );

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const sessionId =
                            await obtenerSessionIdCajaAbiertaEnTransaccion(
                                transaction,
                                clienteRef
                            );

                        if (!sessionId) {
                            throw new HttpsError(
                                "failed-precondition",
                                "Abrí una caja antes de registrar el cobro.",
                                {
                                    motivo:
                                        "cash-required",
                                }
                            );
                        }

                        const sessionRef =
                            clienteRef
                                .collection(
                                    "cajas"
                                )
                                .doc(
                                    sessionId
                                );

                        const [
                            cuentaSnap,
                            sessionSnap,
                        ] =
                            await Promise.all([
                                transaction.get(
                                    cuentaRef
                                ),
                                transaction.get(
                                    sessionRef
                                ),
                            ]);

                        if (
                            !cuentaSnap.exists
                        ) {
                            throw new HttpsError(
                                "not-found",
                                "La cuenta por cobrar no existe."
                            );
                        }

                        if (
                            !sessionSnap.exists ||
                            sessionSnap.data()
                                ?.status !==
                                "open"
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "La caja activa ya no está disponible.",
                                {
                                    motivo:
                                        "cash-required",
                                }
                            );
                        }

                        const cuenta =
                            cuentaSnap.data() ||
                            {};

                        const saldoAnterior =
                            redondearDineroCuentaPorCobrar(
                                cuenta
                                    .saldoPendiente
                            );

                        if (
                            cuenta.estado ===
                                "pagado" ||
                            cuenta.estado ===
                                "cancelado" ||
                            saldoAnterior <= 0
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "Esta cuenta ya está saldada.",
                                {
                                    motivo:
                                        "receivable-settled",
                                }
                            );
                        }

                        if (
                            importe >
                            saldoAnterior
                        ) {
                            throw new HttpsError(
                                "invalid-argument",
                                "El pago no puede superar el saldo pendiente.",
                                {
                                    saldoPendiente:
                                        saldoAnterior,
                                }
                            );
                        }

                        const pagosAnteriores =
                            Array.isArray(
                                cuenta.pagos
                            )
                                ? cuenta.pagos
                                : [];

                        if (
                            pagosAnteriores.length >=
                            1000
                        ) {
                            throw new HttpsError(
                                "resource-exhausted",
                                "Esta cuenta alcanzó el máximo de pagos registrados."
                            );
                        }

                        const saldoRestante =
                            redondearDineroCuentaPorCobrar(
                                Math.max(
                                    0,
                                    saldoAnterior -
                                    importe
                                )
                            );

                        const totalPagado =
                            redondearDineroCuentaPorCobrar(
                                Number(
                                    cuenta.totalPagado ||
                                    0
                                ) +
                                importe
                            );

                        const estadoNuevo =
                            saldoRestante <= 0
                                ? "pagado"
                                : "parcial";

                        const operadorNombre =
                            textoSeguro(
                                operadorAutorizado
                                    ?.data
                                    ?.nombre,
                                80
                            );

                        const operadorRol =
                            validarRolOperador(
                                operadorAutorizado
                                    .rol
                            );

                        const pagoId =
                            crypto.randomUUID();

                        const fecha =
                            admin.firestore.Timestamp.now();

                        const pago = {
                            id:
                                pagoId,

                            importe,

                            metodoPago,

                            sessionId,

                            fecha,

                            deviceId,

                            operador: {
                                operadorId:
                                    operadorAutorizado
                                        .id,

                                operadorNombre,

                                operadorRol,
                            },
                        };

                        transaction.update(
                            cuentaRef,
                            {
                                pagos: [
                                    ...pagosAnteriores,
                                    pago,
                                ],

                                totalPagado,

                                saldoPendiente:
                                    saldoRestante,

                                estado:
                                    estadoNuevo,

                                ultimoPagoEn:
                                    fecha,

                                actualizadoEn:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            }
                        );

                        const sessionData =
                            sessionSnap.data() ||
                            {};

                        const receivablePaymentTotals = {
                            efectivo:
                                redondearDineroCuentaPorCobrar(
                                    sessionData
                                        ?.receivablePaymentTotals
                                        ?.efectivo ||
                                    0
                                ),

                            transferencia:
                                redondearDineroCuentaPorCobrar(
                                    sessionData
                                        ?.receivablePaymentTotals
                                        ?.transferencia ||
                                    0
                                ),

                            qr:
                                redondearDineroCuentaPorCobrar(
                                    sessionData
                                        ?.receivablePaymentTotals
                                        ?.qr ||
                                    0
                                ),

                            tarjeta:
                                redondearDineroCuentaPorCobrar(
                                    sessionData
                                        ?.receivablePaymentTotals
                                        ?.tarjeta ||
                                    0
                                ),
                        };

                        receivablePaymentTotals[
                            metodoPago
                        ] =
                            redondearDineroCuentaPorCobrar(
                                receivablePaymentTotals[
                                    metodoPago
                                ] +
                                importe
                            );

                        const receivablePaymentsTotal =
                            redondearDineroCuentaPorCobrar(
                                Number(
                                    sessionData
                                        .receivablePaymentsTotal ||
                                    0
                                ) +
                                importe
                            );

                        const receivablePaymentsCount =
                            Math.max(
                                0,
                                Math.trunc(
                                    Number(
                                        sessionData
                                            .receivablePaymentsCount ||
                                        0
                                    )
                                )
                            ) +
                            1;

                        transaction.update(
                            sessionRef,
                            {
                                receivablePaymentTotals,

                                receivablePaymentsTotal,

                                receivablePaymentsCount,

                                updatedAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            }
                        );

                        const eventoCobro =
                            crearEventoAuditoria({
                                clienteRef,

                                operador:
                                    operadorAutorizado,

                                accion:
                                    AUDIT_ACTIONS
                                        .COBRO_CUENTA_POR_COBRAR,

                                sessionId,

                                deviceId,

                                detalle: {
                                    cajaId:
                                        sessionId,

                                    cuentaId,

                                    pagoId,

                                    clienteNombre:
                                        textoSeguro(
                                            cuenta
                                                .clienteNombre,
                                            120
                                        ),

                                    concepto:
                                        textoSeguro(
                                            cuenta
                                                .concepto,
                                            180
                                        ),

                                    importe,

                                    metodoPago,

                                    saldoAnterior,

                                    saldoRestante,

                                    estadoNuevo,
                                },
                            });

                        transaction.set(
                            eventoCobro.ref,
                            eventoCobro.data
                        );

                        if (
                            estadoNuevo ===
                            "pagado"
                        ) {
                            const eventoSaldada =
                                crearEventoAuditoria({
                                    clienteRef,

                                    operador:
                                        operadorAutorizado,

                                    accion:
                                        AUDIT_ACTIONS
                                            .CUENTA_POR_COBRAR_SALDADA,

                                    sessionId,

                                    deviceId,

                                    detalle: {
                                        cajaId:
                                            sessionId,

                                        cuentaId,

                                        pagoId,

                                        clienteNombre:
                                            textoSeguro(
                                                cuenta
                                                    .clienteNombre,
                                                120
                                            ),

                                        importeOriginal:
                                            redondearDineroCuentaPorCobrar(
                                                cuenta
                                                    .importeOriginal
                                            ),

                                        totalPagado,
                                    },
                                });

                            transaction.set(
                                eventoSaldada.ref,
                                eventoSaldada.data
                            );
                        }

                        return {
                            pago: {
                                ...pago,

                                fecha:
                                    fecha
                                        .toDate()
                                        .toISOString(),
                            },

                            cuenta: {
                                id:
                                    cuentaId,

                                totalPagado,

                                saldoPendiente:
                                    saldoRestante,

                                estado:
                                    estadoNuevo,
                            },
                        };
                    }
                );

            return {
                ok: true,
                ...result,
            };
        }
    );

/* =========================================================
   PRODUCTOS — VALIDACIÓN + AUDITORÍA
========================================================= */

const INVENTORY_PRODUCT_TYPES =
    new Set([
        "unidad",
        "peso",
        "precio-libre",
    ]);

function redondearDineroInventario(
    value
) {
    return (
        Math.round(
            (
                Number(value) +
                Number.EPSILON
            ) *
            100
        ) /
        100
    );
}

function redondearCantidadInventario(
    value
) {
    return (
        Math.round(
            (
                Number(value) +
                Number.EPSILON
            ) *
            1000
        ) /
        1000
    );
}

function normalizarProductoInventario(
    value
) {
    if (
        !value ||
        typeof value !==
            "object" ||
        Array.isArray(
            value
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Datos del producto inválidos."
        );
    }

    const barcode =
        textoSeguro(
            value.barcode,
            180
        );

    const name =
        textoSeguro(
            value.name,
            180
        );

    if (
        !barcode ||
        !name
    ) {
        throw new HttpsError(
            "invalid-argument",
            "El código y el nombre del producto son obligatorios."
        );
    }

    const tipoVenta =
        INVENTORY_PRODUCT_TYPES
            .has(
                value.tipoVenta
            )
            ? value.tipoVenta
            : "unidad";

    const price =
        tipoVenta ===
            "precio-libre"
            ? 0
            : redondearDineroInventario(
                value.price
            );

    let stock = 0;

    if (
        tipoVenta ===
        "peso"
    ) {
        stock =
            redondearCantidadInventario(
                value.stock
            );
    } else if (
        tipoVenta ===
        "unidad"
    ) {
        stock =
            Math.trunc(
                Number(
                    value.stock
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
            value.expiry,
            120
        ) ||
        null;

    const unidadMedida =
        tipoVenta ===
            "peso"
            ? (
                textoSeguro(
                    value.unidadMedida,
                    40
                ) ||
                "kg"
            )
            : null;

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

/* =========================================================
   CREAR PRODUCTO + AUDITORÍA
========================================================= */

/*
 * El alta pasa por backend para que producto y auditoría
 * formen parte de la misma transacción. Si existe una caja
 * abierta, el backend la vincula mediante sessionId.
 */
exports.crearProducto =
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

            const producto =
                normalizarProductoInventario(
                    request.data?.product
                );

            const productoRef =
                clienteRef
                    .collection(
                        "productos"
                    )
                    .doc(
                        encodeURIComponent(
                            producto.barcode
                        )
                    );

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        const existingSnap =
                            await transaction.get(
                                productoRef
                            );

                        if (
                            existingSnap.exists
                        ) {
                            throw new HttpsError(
                                "already-exists",
                                "Ya existe un producto con ese código.",
                                {
                                    motivo:
                                        "product-barcode-conflict",
                                }
                            );
                        }

                        const sessionId =
                            await obtenerSessionIdCajaAbiertaEnTransaccion(
                                transaction,
                                clienteRef
                            );

                        transaction.set(
                            productoRef,
                            {
                                ...producto,

                                createdAt:
                                    admin.firestore.FieldValue.serverTimestamp(),

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
                                        .ALTA_PRODUCTO,

                                sessionId,

                                deviceId,

                                detalle: {
                                    barcode:
                                        producto.barcode,

                                    productoNombre:
                                        producto.name,

                                    tipoVenta:
                                        producto.tipoVenta,

                                    precio:
                                        producto.price,

                                    stock:
                                        producto.stock,

                                    vencimiento:
                                        producto.expiry,
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            product:
                                producto,
                        };
                    }
                );

            return {
                ok:
                    true,

                product:
                    result.product,
            };
        }
    );

/* =========================================================
   EDITAR PRODUCTO + AUDITORÍA
========================================================= */

/*
 * La edición y el evento de auditoría se escriben en la misma
 * transacción. Si existe una caja abierta, el backend la
 * vincula mediante sessionId.
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

            const previousBarcode =
                textoSeguro(
                    request.data
                        ?.previousBarcode,
                    180
                );

            if (!previousBarcode) {
                throw new HttpsError(
                    "invalid-argument",
                    "El código anterior del producto es obligatorio."
                );
            }

            const producto =
                normalizarProductoInventario(
                    request.data?.product
                );

            const {
                barcode,
                name,
                tipoVenta,
                unidadMedida,
                price,
                stock,
                expiry,
            } = producto;

            const previousRef =
                clienteRef
                    .collection(
                        "productos"
                    )
                    .doc(
                        encodeURIComponent(
                            previousBarcode
                        )
                    );

            const nextRef =
                clienteRef
                    .collection(
                        "productos"
                    )
                    .doc(
                        encodeURIComponent(
                            barcode
                        )
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

                        const sessionId =
                            await obtenerSessionIdCajaAbiertaEnTransaccion(
                                transaction,
                                clienteRef
                            );

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

                                sessionId,

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

/* =========================================================
   ELIMINAR PRODUCTO + AUDITORÍA
========================================================= */

/*
 * La eliminación pasa por backend. El producto y su evento de
 * auditoría se confirman dentro de la misma transacción.
 */
exports.eliminarProducto =
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

            const productoRef =
                clienteRef
                    .collection(
                        "productos"
                    )
                    .doc(
                        encodeURIComponent(
                            barcode
                        )
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
                            return {
                                alreadyDeleted:
                                    true,
                            };
                        }

                        const sessionId =
                            await obtenerSessionIdCajaAbiertaEnTransaccion(
                                transaction,
                                clienteRef
                            );

                        const producto =
                            productoSnap.data() ||
                            {};

                        transaction.delete(
                            productoRef
                        );

                        const eventoAuditoria =
                            crearEventoAuditoria({
                                clienteRef,

                                operador:
                                    operadorAutorizado,

                                accion:
                                    AUDIT_ACTIONS
                                        .ELIMINACION_PRODUCTO,

                                sessionId,

                                deviceId,

                                detalle: {
                                    barcode,

                                    productoNombre:
                                        textoSeguro(
                                            producto.name,
                                            180
                                        ),

                                    tipoVenta:
                                        textoSeguro(
                                            producto.tipoVenta,
                                            40
                                        ) ||
                                        "unidad",

                                    precio:
                                        Number(
                                            producto.price ||
                                            0
                                        ),

                                    stock:
                                        Number(
                                            producto.stock ||
                                            0
                                        ),
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            alreadyDeleted:
                                false,
                        };
                    }
                );

            return {
                ok:
                    true,

                barcode,

                alreadyDeleted:
                    result.alreadyDeleted,
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
                        encodeURIComponent(
                            barcode
                        )
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

                        const sessionId =
                            await obtenerSessionIdCajaAbiertaEnTransaccion(
                                transaction,
                                clienteRef
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

                                sessionId,

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


/* =========================================================
   REGISTRAR VENTA + AUDITORÍA
========================================================= */

/*
 * La venta completa pasa por backend para que:
 *
 * - la licencia y la sesión interna se validen;
 * - la caja activa se resuelva desde Firestore;
 * - el precio y el stock se contrasten con el catálogo real;
 * - venta, descuento de stock, totales de caja y auditoría
 *   se confirmen dentro de una única transacción;
 * - un reintento con el mismo saleId no duplique la venta.
 */

const POS_VENTA_TIPOS =
    new Set([
        "unidad",
        "peso",
        "precio-libre",
    ]);

const POS_METODOS_PAGO =
    new Set([
        "efectivo",
        "transferencia",
        "qr",
        "tarjeta",
    ]);

const POS_MAX_LINEAS_VENTA = 100;

function redondearDineroVenta(
    value
) {
    return Math.round(
        (
            Number(value) +
            Number.EPSILON
        ) *
        100
    ) / 100;
}

function redondearCantidadVenta(
    value
) {
    return Math.round(
        (
            Number(value) +
            Number.EPSILON
        ) *
        1000
    ) / 1000;
}

function normalizarFechaIsoVenta(
    value
) {
    const date =
        value
            ? new Date(value)
            : new Date();

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return new Date()
            .toISOString();
    }

    return date.toISOString();
}

function normalizarItemsVenta(
    rawItems
) {
    if (
        !Array.isArray(
            rawItems
        ) ||
        rawItems.length === 0
    ) {
        throw new HttpsError(
            "invalid-argument",
            "El carrito está vacío."
        );
    }

    if (
        rawItems.length >
        POS_MAX_LINEAS_VENTA
    ) {
        throw new HttpsError(
            "invalid-argument",
            "La venta contiene demasiados productos."
        );
    }

    return rawItems.map(
        (
            rawItem,
            index
        ) => {
            if (
                !esObjetoPlano(
                    rawItem
                )
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    `El producto ${index + 1} de la venta es inválido.`
                );
            }

            const barcode =
                textoSeguro(
                    rawItem.barcode,
                    180
                );

            const name =
                textoSeguro(
                    rawItem.name,
                    180
                );

            const tipoVenta =
                textoSeguro(
                    rawItem.tipoVenta,
                    40
                );

            if (
                !barcode ||
                !name ||
                !POS_VENTA_TIPOS.has(
                    tipoVenta
                )
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    `Hay datos inválidos en el producto ${index + 1}.`
                );
            }

            let qty;

            if (
                tipoVenta ===
                "peso"
            ) {
                qty =
                    redondearCantidadVenta(
                        rawItem.qty
                    );
            } else if (
                tipoVenta ===
                "unidad"
            ) {
                qty =
                    Math.trunc(
                        Number(
                            rawItem.qty
                        )
                    );
            } else {
                qty = 1;
            }

            if (
                !Number.isFinite(
                    qty
                ) ||
                qty <= 0
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    `Cantidad inválida para ${name}.`
                );
            }

            const price =
                redondearDineroVenta(
                    rawItem.price
                );

            if (
                !Number.isFinite(
                    price
                ) ||
                price < 0
            ) {
                throw new HttpsError(
                    "invalid-argument",
                    `Precio inválido para ${name}.`
                );
            }

            return {
                barcode,
                name,
                tipoVenta,

                unidadMedida:
                    tipoVenta ===
                    "peso"
                        ? textoSeguro(
                            rawItem.unidadMedida,
                            20
                        ) ||
                        "kg"
                        : null,

                price,
                qty,
            };
        }
    );
}

exports.registrarVenta =
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

            const saleId =
                validarId(
                    request.data?.saleId,
                    "saleId"
                );

            const itemsEntrada =
                normalizarItemsVenta(
                    request.data?.items
                );

            const timestamp =
                normalizarFechaIsoVenta(
                    request.data
                        ?.timestamp
                );

            const configRef =
                clienteRef
                    .collection(
                        "configuracion"
                    )
                    .doc(
                        "pos"
                    );

            const saleRef =
                clienteRef
                    .collection(
                        "ventas"
                    )
                    .doc(
                        saleId
                    );

            const result =
                await db.runTransaction(
                    async (
                        transaction
                    ) => {
                        /*
                         * Todas las lecturas se completan antes de
                         * iniciar las escrituras de la transacción.
                         */
                        const configSnap =
                            await transaction.get(
                                configRef
                            );

                        const sessionId =
                            textoSeguro(
                                configSnap.data()
                                    ?.openCashSessionId,
                                180
                            );

                        if (!sessionId) {
                            throw new HttpsError(
                                "failed-precondition",
                                "Abrí la caja primero.",
                                {
                                    motivo:
                                        "cash-not-open",
                                }
                            );
                        }

                        const sessionRef =
                            clienteRef
                                .collection(
                                    "cajas"
                                )
                                .doc(
                                    sessionId
                                );

                        const sessionSnap =
                            await transaction.get(
                                sessionRef
                            );

                        if (
                            !sessionSnap.exists ||
                            sessionSnap.data()
                                ?.status !==
                                "open"
                        ) {
                            throw new HttpsError(
                                "failed-precondition",
                                "La caja ya no se encuentra abierta.",
                                {
                                    motivo:
                                        "cash-not-open",
                                }
                            );
                        }

                        const existingSaleSnap =
                            await transaction.get(
                                saleRef
                            );

                        if (
                            existingSaleSnap.exists
                        ) {
                            const existingSale =
                                existingSaleSnap.data() ||
                                {};

                            if (
                                textoSeguro(
                                    existingSale.sessionId,
                                    180
                                ) !==
                                sessionId
                            ) {
                                throw new HttpsError(
                                    "already-exists",
                                    "El identificador de venta ya fue utilizado."
                                );
                            }

                            return {
                                alreadyExists:
                                    true,

                                sale: {
                                    id:
                                        existingSaleSnap.id,

                                    ...existingSale,

                                    createdAt:
                                        null,
                                },
                            };
                        }

                        const requiredByBarcode =
                            new Map();

                        for (
                            const item of
                            itemsEntrada
                        ) {
                            const current =
                                requiredByBarcode.get(
                                    item.barcode
                                ) ||
                                0;

                            const required =
                                item.tipoVenta ===
                                    "precio-libre"
                                    ? 0
                                    : item.qty;

                            requiredByBarcode.set(
                                item.barcode,
                                redondearCantidadVenta(
                                    current +
                                    required
                                )
                            );
                        }

                        const productEntries =
                            new Map();

                        for (
                            const [
                                barcode,
                                required,
                            ] of
                            requiredByBarcode
                        ) {
                            const productRef =
                                clienteRef
                                    .collection(
                                        "productos"
                                    )
                                    .doc(
                                        encodeURIComponent(
                                            barcode
                                        )
                                    );

                            const productSnap =
                                await transaction.get(
                                    productRef
                                );

                            if (
                                !productSnap.exists
                            ) {
                                throw new HttpsError(
                                    "not-found",
                                    `Producto no encontrado: ${barcode}.`,
                                    {
                                        motivo:
                                            "product-not-found",

                                        barcode,
                                    }
                                );
                            }

                            productEntries.set(
                                barcode,
                                {
                                    ref:
                                        productRef,

                                    data:
                                        productSnap.data() ||
                                        {},

                                    required,
                                }
                            );
                        }

                        /*
                         * Ya no se realizan más lecturas a partir
                         * de este punto.
                         */

                        for (
                            const [
                                barcode,
                                entry,
                            ] of
                            productEntries
                        ) {
                            const product =
                                entry.data;

                            const tipoVenta =
                                textoSeguro(
                                    product.tipoVenta,
                                    40
                                );

                            if (
                                !POS_VENTA_TIPOS.has(
                                    tipoVenta
                                )
                            ) {
                                throw new HttpsError(
                                    "failed-precondition",
                                    `El producto ${product.name || barcode} cambió. Volvé a agregarlo al ticket.`,
                                    {
                                        motivo:
                                            "product-changed",

                                        barcode,
                                    }
                                );
                            }

                            const cartItems =
                                itemsEntrada.filter(
                                    (item) =>
                                        item.barcode ===
                                        barcode
                                );

                            if (
                                cartItems.length === 0 ||
                                cartItems.some(
                                    (item) =>
                                        item.tipoVenta !==
                                        tipoVenta
                                )
                            ) {
                                throw new HttpsError(
                                    "failed-precondition",
                                    `El producto ${product.name || barcode} cambió. Volvé a agregarlo al ticket.`,
                                    {
                                        motivo:
                                            "product-changed",

                                        barcode,
                                    }
                                );
                            }

                            if (
                                tipoVenta ===
                                "precio-libre"
                            ) {
                                continue;
                            }

                            const currentPrice =
                                redondearDineroVenta(
                                    product.price
                                );

                            if (
                                !Number.isFinite(
                                    currentPrice
                                ) ||
                                currentPrice < 0 ||
                                cartItems.some(
                                    (item) =>
                                        Math.abs(
                                            currentPrice -
                                            item.price
                                        ) >
                                        0.009
                                )
                            ) {
                                throw new HttpsError(
                                    "failed-precondition",
                                    `El precio de ${product.name || barcode} cambió. Volvé a agregarlo al ticket.`,
                                    {
                                        motivo:
                                            "product-changed",

                                        barcode,
                                    }
                                );
                            }

                            const currentStock =
                                Number(
                                    product.stock
                                );

                            if (
                                !Number.isFinite(
                                    currentStock
                                ) ||
                                currentStock +
                                    0.000001 <
                                    entry.required
                            ) {
                                throw new HttpsError(
                                    "failed-precondition",
                                    `Stock insuficiente para ${product.name || barcode}.`,
                                    {
                                        motivo:
                                            "insufficient-stock",

                                        barcode,

                                        required:
                                            entry.required,

                                        available:
                                            Number.isFinite(
                                                currentStock
                                            )
                                                ? currentStock
                                                : 0,
                                    }
                                );
                            }
                        }

                        const items =
                            itemsEntrada.map(
                                (item) => {
                                    const product =
                                        productEntries.get(
                                            item.barcode
                                        )?.data ||
                                        {};

                                    if (
                                        item.tipoVenta ===
                                        "precio-libre"
                                    ) {
                                        const subtotal =
                                            redondearDineroVenta(
                                                item.qty *
                                                item.price
                                            );

                                        if (
                                            subtotal <= 0
                                        ) {
                                            throw new HttpsError(
                                                "invalid-argument",
                                                `Importe inválido para ${item.name}.`
                                            );
                                        }

                                        return {
                                            ...item,

                                            name:
                                                textoSeguro(
                                                    product.name,
                                                    180
                                                ) ||
                                                item.name,

                                            subtotal,
                                        };
                                    }


                                    const price =
                                        redondearDineroVenta(
                                            product.price
                                        );

                                    const subtotal =
                                        redondearDineroVenta(
                                            item.qty *
                                            price
                                        );

                                    if (
                                        subtotal <= 0
                                    ) {
                                        throw new HttpsError(
                                            "invalid-argument",
                                            `Importe inválido para ${product.name || item.name}.`
                                        );
                                    }

                                    return {
                                        ...item,

                                        name:
                                            textoSeguro(
                                                product.name,
                                                180
                                            ) ||
                                            item.name,

                                        price,
                                        subtotal,
                                    };
                                }
                            );

                        const total =
                            redondearDineroVenta(
                                items.reduce(
                                    (
                                        sum,
                                        item
                                    ) =>
                                        sum +
                                        item.subtotal,
                                    0
                                )
                            );

                        if (
                            !Number.isFinite(
                                total
                            ) ||
                            total <= 0
                        ) {
                            throw new HttpsError(
                                "invalid-argument",
                                "El total de la venta debe ser mayor a cero."
                            );
                        }

                        const rawMethod =
                            textoSeguro(
                                request.data
                                    ?.payment
                                    ?.method,
                                40
                            ) ||
                            "efectivo";

                        if (
                            !POS_METODOS_PAGO.has(
                                rawMethod
                            )
                        ) {
                            throw new HttpsError(
                                "invalid-argument",
                                "El método de pago no es válido."
                            );
                        }

                        const receivedRaw =
                            rawMethod ===
                                "efectivo"
                                ? Number(
                                    request.data
                                        ?.payment
                                        ?.received ??
                                    total
                                )
                                : total;

                        const received =
                            redondearDineroVenta(
                                receivedRaw
                            );

                        if (
                            !Number.isFinite(
                                received
                            ) ||
                            (
                                rawMethod ===
                                    "efectivo" &&
                                received <
                                    total
                            )
                        ) {
                            throw new HttpsError(
                                "invalid-argument",
                                "El monto recibido es menor al total."
                            );
                        }

                        const change =
                            rawMethod ===
                                "efectivo"
                                ? redondearDineroVenta(
                                    received -
                                    total
                                )
                                : 0;

                        const sessionData =
                            sessionSnap.data() ||
                            {};

                        const paymentTotals = {
                            efectivo:
                                redondearDineroVenta(
                                    sessionData
                                        ?.paymentTotals
                                        ?.efectivo ||
                                    0
                                ),

                            transferencia:
                                redondearDineroVenta(
                                    sessionData
                                        ?.paymentTotals
                                        ?.transferencia ||
                                    0
                                ),

                            qr:
                                redondearDineroVenta(
                                    sessionData
                                        ?.paymentTotals
                                        ?.qr ||
                                    0
                                ),

                            tarjeta:
                                redondearDineroVenta(
                                    sessionData
                                        ?.paymentTotals
                                        ?.tarjeta ||
                                    0
                                ),
                        };

                        paymentTotals[
                            rawMethod
                        ] =
                            redondearDineroVenta(
                                paymentTotals[
                                    rawMethod
                                ] +
                                total
                            );

                        const nextTotalSales =
                            redondearDineroVenta(
                                Number(
                                    sessionData.totalSales ||
                                    0
                                ) +
                                total
                            );

                        const nextSalesCount =
                            Math.max(
                                0,
                                Math.trunc(
                                    Number(
                                        sessionData.salesCount ||
                                        0
                                    )
                                )
                            ) +
                            1;

                        const sale = {
                            id:
                                saleId,

                            timestamp,

                            items,

                            total,

                            sessionId,

                            payment: {
                                method:
                                    rawMethod,

                                received,

                                change,
                            },

                            deviceId,

                            createdAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        };

                        /*
                         * A partir de aquí comienzan las escrituras.
                         */
                        transaction.set(
                            saleRef,
                            sale
                        );

                        for (
                            const [
                                ,
                                entry,
                            ] of
                            productEntries
                        ) {
                            const tipoVenta =
                                textoSeguro(
                                    entry.data
                                        .tipoVenta,
                                    40
                                );

                            if (
                                tipoVenta ===
                                "precio-libre"
                            ) {
                                continue;
                            }

                            const currentStock =
                                Number(
                                    entry.data.stock
                                );

                            const nextStockRaw =
                                currentStock -
                                entry.required;

                            const nextStock =
                                tipoVenta ===
                                    "peso"
                                    ? redondearCantidadVenta(
                                        Math.max(
                                            0,
                                            nextStockRaw
                                        )
                                    )
                                    : Math.max(
                                        0,
                                        Math.trunc(
                                            nextStockRaw
                                        )
                                    );

                            transaction.update(
                                entry.ref,
                                {
                                    stock:
                                        nextStock,

                                    updatedAt:
                                        admin.firestore.FieldValue.serverTimestamp(),
                                }
                            );
                        }

                        transaction.update(
                            sessionRef,
                            {
                                totalSales:
                                    nextTotalSales,

                                salesCount:
                                    nextSalesCount,

                                paymentTotals,

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
                                        .VENTA_REALIZADA,

                                sessionId,

                                deviceId,

                                detalle: {
                                    cajaId:
                                        sessionId,

                                    ventaId:
                                        saleId,

                                    total,

                                    metodoPago:
                                        rawMethod,

                                    cantidadItems:
                                        items.length,
                                },
                            });

                        transaction.set(
                            eventoAuditoria.ref,
                            eventoAuditoria.data
                        );

                        return {
                            alreadyExists:
                                false,

                            sale: {
                                ...sale,

                                createdAt:
                                    null,
                            },
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

                                sessionId,

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

                        const receivablePaymentTotals = {
                            efectivo:
                                roundMoney(
                                    session
                                        ?.receivablePaymentTotals
                                        ?.efectivo
                                ),

                            transferencia:
                                roundMoney(
                                    session
                                        ?.receivablePaymentTotals
                                        ?.transferencia
                                ),

                            qr:
                                roundMoney(
                                    session
                                        ?.receivablePaymentTotals
                                        ?.qr
                                ),

                            tarjeta:
                                roundMoney(
                                    session
                                        ?.receivablePaymentTotals
                                        ?.tarjeta
                                ),
                        };

                        const receivablePaymentsTotal =
                            roundMoney(
                                session
                                    .receivablePaymentsTotal
                            );

                        const receivablePaymentsCount =
                            Math.max(
                                0,
                                Math.trunc(
                                    Number(
                                        session
                                            .receivablePaymentsCount ||
                                        0
                                    )
                                )
                            );

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
                                paymentTotals.efectivo +
                                receivablePaymentTotals
                                    .efectivo
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

                                receivablePaymentTotals,

                                receivablePaymentsTotal,

                                receivablePaymentsCount,

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

                                sessionId,

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

                                    totalCobranzas:
                                        receivablePaymentsTotal,

                                    cantidadCobranzas:
                                        receivablePaymentsCount,
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
