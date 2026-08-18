// src/hooks/useLicenseCheck.js
//
// Control de:
// - Firebase Authentication
// - Estado de licencia
// - Registro de dispositivo
// - Límite de dispositivos
// - Heartbeat de sesión
// - Cierre remoto desde Admin
//
// IMPORTANTE:
// Este archivo es .js y NO contiene JSX.
// Toda la interfaz visual pertenece a LicenseGate.jsx.

import {
    useCallback,
    useEffect,
    useState,
} from "react";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where,
} from "firebase/firestore";

import {
    onAuthStateChanged,
    signOut,
} from "firebase/auth";

import {
    httpsCallable,
} from "firebase/functions";

import {
    auth,
    db,
    functions,
} from "../firebase/config";

import {
    storeGet,
    storeRemove,
    storeSet,
} from "../lib/storage";

import {
    uid,
} from "../lib/format";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const REVALIDAR_TOKEN_CADA_MS =
    5 * 60 * 1000;

const HEARTBEAT_DEFAULT_MS =
    2 * 60 * 1000;

const HEARTBEAT_MIN_MS =
    30 * 1000;

const HEARTBEAT_MAX_MS =
    5 * 60 * 1000;

const DEVICE_ID_KEY =
    "licenseDeviceId";

const SESSION_KEY_PREFIX =
    "licenseSession:";

const SESSION_NOTICE_KEY =
    "licenseSessionNotice";

/* =========================================================
   CLOUD FUNCTIONS
========================================================= */

const registrarSesionFunction =
    httpsCallable(
        functions,
        "registrarSesion"
    );

const actualizarSesionFunction =
    httpsCallable(
        functions,
        "actualizarSesion"
    );

const cerrarSesionClienteFunction =
    httpsCallable(
        functions,
        "cerrarSesionCliente"
    );

/*
 * Evita que React StrictMode pueda disparar dos registros
 * simultáneos del mismo dispositivo durante desarrollo.
 */
const registrationRequests =
    new Map();

/* =========================================================
   DEVICE ID
========================================================= */

function getOrCreateDeviceId() {
    const existente =
        storeGet(
            DEVICE_ID_KEY,
            null
        );

    if (
        typeof existente ===
        "string" &&
        existente.trim()
    ) {
        return existente;
    }

    const nuevoId =
        uid();

    storeSet(
        DEVICE_ID_KEY,
        nuevoId
    );

    return nuevoId;
}

/* =========================================================
   SESSION ID
========================================================= */

function getSessionKey(user) {
    return `${SESSION_KEY_PREFIX}${user.uid}`;
}

function getOrCreateSessionId(
    user
) {
    const key =
        getSessionKey(
            user
        );

    const existente =
        storeGet(
            key,
            null
        );

    if (
        typeof existente ===
        "string" &&
        existente.trim()
    ) {
        return existente;
    }

    const nuevoId =
        uid();

    storeSet(
        key,
        nuevoId
    );

    return nuevoId;
}

function removeSessionId(
    user
) {
    if (!user) {
        return;
    }

    storeRemove(
        getSessionKey(
            user
        )
    );
}

/* =========================================================
   AVISO DE CIERRE REMOTO
========================================================= */

function leerAvisoSesion() {
    if (
        typeof window ===
        "undefined"
    ) {
        return null;
    }

    try {
        const raw =
            window.sessionStorage.getItem(
                SESSION_NOTICE_KEY
            );

        if (!raw) {
            return null;
        }

        const parsed =
            JSON.parse(
                raw
            );

        if (
            !parsed ||
            parsed.estado !==
            "sesion-cerrada"
        ) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function guardarAvisoSesion(
    mensaje
) {
    const aviso = {
        estado:
            "sesion-cerrada",

        mensaje:
            mensaje ||
            "Esta sesión fue cerrada desde el panel administrativo.",

        fecha:
            Date.now(),
    };

    if (
        typeof window !==
        "undefined"
    ) {
        try {
            window.sessionStorage.setItem(
                SESSION_NOTICE_KEY,
                JSON.stringify(
                    aviso
                )
            );
        } catch {
            // sessionStorage puede estar deshabilitado.
        }
    }

    return aviso;
}

function borrarAvisoSesion() {
    if (
        typeof window ===
        "undefined"
    ) {
        return;
    }

    try {
        window.sessionStorage.removeItem(
            SESSION_NOTICE_KEY
        );
    } catch {
        // No hacemos nada.
    }
}

/* =========================================================
   INFORMACIÓN DEL DISPOSITIVO
========================================================= */

function detectarNavegador() {
    if (
        typeof navigator ===
        "undefined"
    ) {
        return "Desconocido";
    }

    const ua =
        navigator.userAgent ||
        "";

    if (
        ua.includes("Edg/")
    ) {
        return "Microsoft Edge";
    }

    if (
        ua.includes("OPR/") ||
        ua.includes("Opera")
    ) {
        return "Opera";
    }

    if (
        ua.includes("Firefox/")
    ) {
        return "Firefox";
    }

    if (
        ua.includes("Chrome/")
    ) {
        return "Chrome";
    }

    if (
        ua.includes("Safari/")
    ) {
        return "Safari";
    }

    return "Navegador";
}

function detectarPlataforma() {
    if (
        typeof navigator ===
        "undefined"
    ) {
        return "Desconocida";
    }

    const ua =
        navigator.userAgent ||
        "";

    const plataforma =
        navigator.userAgentData
            ?.platform ||
        navigator.platform ||
        "";

    if (
        /Android/i.test(
            ua
        )
    ) {
        return "Android";
    }

    if (
        /iPhone|iPad|iPod/i.test(
            ua
        )
    ) {
        return "iOS";
    }

    if (
        /Windows/i.test(
            plataforma
        ) ||
        /Windows/i.test(
            ua
        )
    ) {
        return "Windows";
    }

    if (
        /Mac/i.test(
            plataforma
        )
    ) {
        return "macOS";
    }

    if (
        /Linux/i.test(
            plataforma
        )
    ) {
        return "Linux";
    }

    return (
        plataforma ||
        "Desconocida"
    );
}

function detectarTipoDispositivo() {
    if (
        typeof navigator ===
        "undefined"
    ) {
        return "desconocido";
    }

    const ua =
        navigator.userAgent ||
        "";

    if (
        /iPad|Tablet/i.test(
            ua
        )
    ) {
        return "tablet";
    }

    if (
        /Android|iPhone|iPod|Mobile/i.test(
            ua
        )
    ) {
        return "movil";
    }

    return "escritorio";
}

function obtenerInfoDispositivo() {
    const userAgent =
        typeof navigator !==
            "undefined"
            ? navigator.userAgent ||
            ""
            : "";

    return {
        navegador:
            detectarNavegador(),

        plataforma:
            detectarPlataforma(),

        tipo:
            detectarTipoDispositivo(),

        userAgent:
            userAgent.slice(
                0,
                300
            ),
    };
}

/* =========================================================
   RESOLVER CLIENTE
========================================================= */

async function resolverIdDeCliente(
    user
) {
    if (!user) {
        return null;
    }

    /* ---------------------------------------------------------
       1. Buscar por UID
    --------------------------------------------------------- */

    const clienteDirectoRef =
        doc(
            db,
            "clientes",
            user.uid
        );

    const clienteDirectoSnap =
        await getDoc(
            clienteDirectoRef
        );

    if (
        clienteDirectoSnap.exists()
    ) {
        return user.uid;
    }

    /* ---------------------------------------------------------
       2. Buscar por email
       Necesario para Google Sign-In cuando el UID es diferente.
    --------------------------------------------------------- */

    const email =
        user.email?.trim();

    if (!email) {
        return null;
    }

    const clientesRef =
        collection(
            db,
            "clientes"
        );

    const consulta =
        query(
            clientesRef,
            where(
                "email",
                "==",
                email
            )
        );

    const resultados =
        await getDocs(
            consulta
        );

    if (
        resultados.empty
    ) {
        return null;
    }

    return resultados
        .docs[0]
        .id;
}

/* =========================================================
   ESTADO DE LICENCIA
========================================================= */

function obtenerEstadoLicencia(
    data
) {
    if (!data) {
        return "inactivo";
    }

    const vencimiento =
        data.fechaVencimiento
            ?.toDate?.();

    const vencidoPorFecha =
        vencimiento instanceof
        Date &&
        vencimiento.getTime() <
        Date.now();

    if (
        data.estado ===
        "inactivo"
    ) {
        return "inactivo";
    }

    if (
        data.estado ===
        "vencido" ||
        vencidoPorFecha
    ) {
        return "vencido";
    }

    if (
        data.estado ===
        "activo"
    ) {
        return "activo";
    }

    return "inactivo";
}

/* =========================================================
   NÚMEROS
========================================================= */

function numeroSeguro(
    value,
    fallback = 0
) {
    const numero =
        Number(
            value
        );

    return Number.isFinite(
        numero
    )
        ? numero
        : fallback;
}

function normalizarLimite(
    value
) {
    return Math.max(
        1,
        Math.trunc(
            numeroSeguro(
                value,
                1
            )
        )
    );
}

/* =========================================================
   HEARTBEAT
========================================================= */

function obtenerHeartbeatMs(
    data
) {
    let value =
        data?.heartbeatMs ??
        data?.heartbeatIntervalMs ??
        data?.heartbeatCadaMs ??
        null;

    if (
        value == null &&
        data?.heartbeatSegundos !=
        null
    ) {
        value =
            numeroSeguro(
                data.heartbeatSegundos,
                120
            ) * 1000;
    }

    const ms =
        numeroSeguro(
            value,
            HEARTBEAT_DEFAULT_MS
        );

    return Math.min(
        HEARTBEAT_MAX_MS,
        Math.max(
            HEARTBEAT_MIN_MS,
            ms
        )
    );
}

/* =========================================================
   ERRORES DE CLOUD FUNCTIONS
========================================================= */

function obtenerCodigoError(
    error
) {
    const code =
        String(
            error?.code ||
            ""
        );

    if (
        code.includes("/")
    ) {
        return code
            .split("/")
            .pop();
    }

    return code;
}

function interpretarErrorFuncion(
    error
) {
    const codigo =
        obtenerCodigoError(
            error
        );

    const details =
        error?.details &&
            typeof error.details ===
            "object"
            ? error.details
            : {};

    const motivo =
        String(
            details.motivo ||
            details.reason ||
            ""
        ).toLowerCase();

    const mensajeServidor =
        details.mensaje ||
        details.message ||
        "";

    const dispositivosActivos =
        numeroSeguro(
            details.dispositivosActivos,
            0
        );

    const maxDispositivos =
        normalizarLimite(
            details.maxDispositivos ??
            1
        );

    /* ---------------------------------------------------------
       SESIÓN CERRADA / REVOCADA
    --------------------------------------------------------- */

    if (
        motivo ===
        "sesion-cerrada" ||
        motivo ===
        "sesion-revocada"
    ) {
        return {
            estado:
                "sesion-cerrada",

            mensaje:
                mensajeServidor ||
                "Esta sesión fue cerrada desde el panel administrativo.",

            dispositivosActivos,
            maxDispositivos,
        };
    }

    /* ---------------------------------------------------------
       LÍMITE
    --------------------------------------------------------- */

    if (
        codigo ===
        "resource-exhausted"
    ) {
        return {
            estado:
                "limite-dispositivos",

            mensaje:
                mensajeServidor ||
                "Esta licencia alcanzó el límite de dispositivos permitidos.",

            dispositivosActivos,
            maxDispositivos,
        };
    }

    /* ---------------------------------------------------------
       VENCIDO
    --------------------------------------------------------- */

    if (
        motivo ===
        "vencido" ||
        motivo ===
        "licencia-vencida"
    ) {
        return {
            estado:
                "vencido",

            mensaje:
                mensajeServidor ||
                "La licencia se encuentra vencida.",

            dispositivosActivos,
            maxDispositivos,
        };
    }

    /* ---------------------------------------------------------
       INACTIVO
    --------------------------------------------------------- */

    if (
        motivo ===
        "inactivo" ||
        motivo ===
        "licencia-inactiva"
    ) {
        return {
            estado:
                "inactivo",

            mensaje:
                mensajeServidor ||
                "La licencia se encuentra desactivada.",

            dispositivosActivos,
            maxDispositivos,
        };
    }

    /* ---------------------------------------------------------
       NO ENCONTRADO
    --------------------------------------------------------- */

    if (
        codigo ===
        "not-found"
    ) {
        return {
            estado:
                "no-encontrado",

            mensaje:
                mensajeServidor ||
                "No encontramos una licencia asociada a esta cuenta.",

            dispositivosActivos,
            maxDispositivos,
        };
    }

    /* ---------------------------------------------------------
       NO AUTENTICADO
    --------------------------------------------------------- */

    if (
        codigo ===
        "unauthenticated"
    ) {
        return {
            estado:
                "sesion-cerrada",

            mensaje:
                mensajeServidor ||
                "Tu sesión dejó de ser válida. Iniciá sesión nuevamente.",

            dispositivosActivos,
            maxDispositivos,
        };
    }

    /* ---------------------------------------------------------
       FAILED PRECONDITION
    --------------------------------------------------------- */

    if (
        codigo ===
        "failed-precondition"
    ) {
        return {
            estado:
                motivo ||
                "inactivo",

            mensaje:
                mensajeServidor ||
                "La licencia no está disponible en este momento.",

            dispositivosActivos,
            maxDispositivos,
        };
    }

    /* ---------------------------------------------------------
       ERROR GENERAL
    --------------------------------------------------------- */

    return {
        estado:
            "error-sesion",

        mensaje:
            mensajeServidor ||
            "No pudimos verificar este dispositivo. Revisá tu conexión e intentá nuevamente.",

        dispositivosActivos,
        maxDispositivos,
    };
}

/* =========================================================
   REGISTRO DEDUPLICADO
========================================================= */

function registrarSesionDedupe(
    key,
    payload
) {
    const existente =
        registrationRequests.get(
            key
        );

    if (existente) {
        return existente;
    }

    const promise =
        registrarSesionFunction(
            payload
        );

    registrationRequests.set(
        key,
        promise
    );

    const limpiar = () => {
        window.setTimeout(
            () => {
                if (
                    registrationRequests.get(
                        key
                    ) === promise
                ) {
                    registrationRequests.delete(
                        key
                    );
                }
            },
            1500
        );
    };

    promise.then(
        limpiar,
        limpiar
    );

    return promise;
}

/* =========================================================
   HOOK
========================================================= */

export function useLicenseCheck() {
    /* =======================================================
       AUTH
    ======================================================= */

    const [
        authState,
        setAuthState,
    ] = useState(
        "cargando"
    );

    const [
        usuario,
        setUsuario,
    ] = useState(
        null
    );

    /* =======================================================
       CLIENTE
    ======================================================= */

    const [
        clienteId,
        setClienteId,
    ] = useState(
        null
    );

    const [
        datosCliente,
        setDatosCliente,
    ] = useState(
        null
    );

    const [
        estadoLicencia,
        setEstadoLicencia,
    ] = useState(
        "cargando"
    );

    /* =======================================================
       DISPOSITIVO
    ======================================================= */

    const [
        estadoDispositivo,
        setEstadoDispositivo,
    ] = useState(
        "pendiente"
    );

    const [
        mensajeBloqueo,
        setMensajeBloqueo,
    ] = useState(
        ""
    );

    const [
        dispositivosActivos,
        setDispositivosActivos,
    ] = useState(
        0
    );

    const [
        maxDispositivos,
        setMaxDispositivos,
    ] = useState(
        1
    );

    const [
        reintento,
        setReintento,
    ] = useState(
        0
    );

    /* =======================================================
       AVISO DE CIERRE ADMIN
    ======================================================= */

    const [
        avisoSesion,
        setAvisoSesion,
    ] = useState(
        () =>
            leerAvisoSesion()
    );

    /* =======================================================
       DEVICE ID
    ======================================================= */

    const [
        deviceId,
    ] = useState(
        () =>
            getOrCreateDeviceId()
    );

    /* =======================================================
       AUTH OBSERVER
    ======================================================= */

    useEffect(() => {
        const unsubscribe =
            onAuthStateChanged(
                auth,
                (user) => {
                    if (!user) {
                        setUsuario(
                            null
                        );

                        setClienteId(
                            null
                        );

                        setDatosCliente(
                            null
                        );

                        setEstadoLicencia(
                            "cargando"
                        );

                        setEstadoDispositivo(
                            "pendiente"
                        );

                        setDispositivosActivos(
                            0
                        );

                        setMaxDispositivos(
                            1
                        );

                        setAuthState(
                            "sin-sesion"
                        );

                        return;
                    }

                    setUsuario(
                        user
                    );

                    setAuthState(
                        "autenticado"
                    );
                }
            );

        return unsubscribe;
    }, []);

    /* =======================================================
       ESCUCHAR LICENCIA
    ======================================================= */

    useEffect(() => {
        if (!usuario) {
            return undefined;
        }

        let cancelado =
            false;

        let unsubscribeCliente =
            null;

        setEstadoLicencia(
            "cargando"
        );

        setDatosCliente(
            null
        );

        setClienteId(
            null
        );

        async function iniciar() {
            try {
                const id =
                    await resolverIdDeCliente(
                        usuario
                    );

                if (cancelado) {
                    return;
                }

                if (!id) {
                    setEstadoLicencia(
                        "no-encontrado"
                    );

                    setMensajeBloqueo(
                        "No encontramos una licencia asociada a esta cuenta."
                    );

                    return;
                }

                setClienteId(
                    id
                );

                const clienteRef =
                    doc(
                        db,
                        "clientes",
                        id
                    );

                unsubscribeCliente =
                    onSnapshot(
                        clienteRef,

                        (snapshot) => {
                            if (
                                cancelado
                            ) {
                                return;
                            }

                            if (
                                !snapshot.exists()
                            ) {
                                setDatosCliente(
                                    null
                                );

                                setEstadoLicencia(
                                    "no-encontrado"
                                );

                                return;
                            }

                            const data =
                                snapshot.data();

                            setDatosCliente(
                                data
                            );

                            setEstadoLicencia(
                                obtenerEstadoLicencia(
                                    data
                                )
                            );

                            setDispositivosActivos(
                                numeroSeguro(
                                    data.dispositivosActivos,
                                    0
                                )
                            );

                            setMaxDispositivos(
                                normalizarLimite(
                                    data.maxDispositivos ??
                                    1
                                )
                            );
                        },

                        (error) => {
                            console.error(
                                "Error escuchando licencia:",
                                error
                            );

                            if (
                                cancelado
                            ) {
                                return;
                            }

                            setDatosCliente(
                                null
                            );

                            setEstadoLicencia(
                                "inactivo"
                            );

                            setMensajeBloqueo(
                                "No pudimos verificar la licencia."
                            );
                        }
                    );
            } catch (error) {
                console.error(
                    "Error verificando licencia:",
                    error
                );

                if (
                    cancelado
                ) {
                    return;
                }

                setDatosCliente(
                    null
                );

                setEstadoLicencia(
                    "inactivo"
                );

                setMensajeBloqueo(
                    "No pudimos verificar la licencia."
                );
            }
        }

        iniciar();

        return () => {
            cancelado =
                true;

            if (
                unsubscribeCliente
            ) {
                unsubscribeCliente();
            }
        };
    }, [
        usuario,
    ]);

    /* =======================================================
       FORZAR CIERRE REMOTO
    ======================================================= */

    const forzarCierreRemoto =
        useCallback(
            async (
                mensaje
            ) => {
                const user =
                    auth.currentUser;

                const aviso =
                    guardarAvisoSesion(
                        mensaje
                    );

                setAvisoSesion(
                    aviso
                );

                setEstadoDispositivo(
                    "sesion-cerrada"
                );

                setMensajeBloqueo(
                    aviso.mensaje
                );

                if (user) {
                    removeSessionId(
                        user
                    );
                }

                try {
                    await signOut(
                        auth
                    );
                } catch (error) {
                    console.error(
                        "Error cerrando sesión remota:",
                        error
                    );
                }
            },
            []
        );

    /* =======================================================
       CIERRE REMOTO EN TIEMPO REAL
    ======================================================= */

    useEffect(() => {
        if (
            !usuario ||
            !clienteId ||
            !datosCliente ||
            estadoLicencia !==
            "activo" ||
            avisoSesion
        ) {
            return;
        }

        const sessionId =
            storeGet(
                getSessionKey(
                    usuario
                ),
                null
            );

        if (
            !sessionId
        ) {
            return;
        }

        const cierre =
            datosCliente
                ?.cierresDispositivos
                ?.[deviceId];

        if (
            !cierre ||
            typeof cierre !==
            "object" ||
            cierre.sessionId !==
            sessionId
        ) {
            return;
        }

        const motivo =
            String(
                cierre.motivo ||
                ""
            );

        const mensaje =
            motivo ===
            "limite-reducido"
                ? "Este dispositivo fue desconectado porque cambió el límite permitido de la licencia."
                : motivo ===
                  "cerrar-todas"
                    ? "Todas las sesiones fueron cerradas desde el panel administrativo."
                    : "Esta sesión fue cerrada desde el panel administrativo.";

        forzarCierreRemoto(
            mensaje
        );
    }, [
        usuario,
        clienteId,
        datosCliente,
        estadoLicencia,
        avisoSesion,
        deviceId,
        forzarCierreRemoto,
    ]);

    /* =======================================================
       REGISTRAR DISPOSITIVO
    ======================================================= */

    useEffect(() => {
        if (
            !usuario ||
            estadoLicencia !==
            "activo" ||
            avisoSesion
        ) {
            return undefined;
        }

        let cancelado =
            false;

        let heartbeatTimer =
            null;

        let heartbeatEnCurso =
            false;

        const sessionId =
            getOrCreateSessionId(
                usuario
            );

        const requestKey =
            [
                usuario.uid,
                deviceId,
                sessionId,
            ].join(":");

        const payload = {
            deviceId,
            sessionId,

            dispositivo:
                obtenerInfoDispositivo(),
        };

        async function manejarError(
            error
        ) {
            const info =
                interpretarErrorFuncion(
                    error
                );

            if (
                cancelado
            ) {
                return;
            }

            setMensajeBloqueo(
                info.mensaje
            );

            setDispositivosActivos(
                info.dispositivosActivos
            );

            setMaxDispositivos(
                info.maxDispositivos
            );

            if (
                info.estado ===
                "sesion-cerrada"
            ) {
                await forzarCierreRemoto(
                    info.mensaje
                );

                return;
            }

            if (
                info.estado ===
                "vencido" ||
                info.estado ===
                "inactivo" ||
                info.estado ===
                "no-encontrado"
            ) {
                setEstadoLicencia(
                    info.estado
                );

                setEstadoDispositivo(
                    "pendiente"
                );

                return;
            }

            setEstadoDispositivo(
                info.estado
            );
        }

        async function heartbeat() {
            if (
                heartbeatEnCurso ||
                cancelado
            ) {
                return;
            }

            heartbeatEnCurso =
                true;

            try {
                const response =
                    await actualizarSesionFunction(
                        {
                            deviceId,
                            sessionId,
                        }
                    );

                if (
                    cancelado
                ) {
                    return;
                }

                const data =
                    response?.data ||
                    {};

                setEstadoDispositivo(
                    "activo"
                );

                setMensajeBloqueo(
                    ""
                );

                if (
                    data.dispositivosActivos !=
                    null
                ) {
                    setDispositivosActivos(
                        numeroSeguro(
                            data.dispositivosActivos,
                            0
                        )
                    );
                }

                if (
                    data.maxDispositivos !=
                    null
                ) {
                    setMaxDispositivos(
                        normalizarLimite(
                            data.maxDispositivos
                        )
                    );
                }
            } catch (error) {
                console.error(
                    "Error actualizando sesión:",
                    error
                );

                await manejarError(
                    error
                );
            } finally {
                heartbeatEnCurso =
                    false;
            }
        }

        async function registrar() {
            setEstadoDispositivo(
                "pendiente"
            );

            setMensajeBloqueo(
                ""
            );

            try {
                const response =
                    await registrarSesionDedupe(
                        requestKey,
                        payload
                    );

                if (
                    cancelado
                ) {
                    return;
                }

                const data =
                    response?.data ||
                    {};

                setEstadoDispositivo(
                    "activo"
                );

                setMensajeBloqueo(
                    ""
                );

                if (
                    data.dispositivosActivos !=
                    null
                ) {
                    setDispositivosActivos(
                        numeroSeguro(
                            data.dispositivosActivos,
                            0
                        )
                    );
                }

                if (
                    data.maxDispositivos !=
                    null
                ) {
                    setMaxDispositivos(
                        normalizarLimite(
                            data.maxDispositivos
                        )
                    );
                }

                const heartbeatMs =
                    obtenerHeartbeatMs(
                        data
                    );

                heartbeatTimer =
                    window.setInterval(
                        heartbeat,
                        heartbeatMs
                    );
            } catch (error) {
                console.error(
                    "Error registrando dispositivo:",
                    error
                );

                await manejarError(
                    error
                );
            }
        }

        registrar();

        return () => {
            cancelado =
                true;

            if (
                heartbeatTimer
            ) {
                window.clearInterval(
                    heartbeatTimer
                );
            }
        };
    }, [
        usuario,
        estadoLicencia,
        deviceId,
        reintento,
        avisoSesion,
        forzarCierreRemoto,
    ]);

    /* =======================================================
       REVALIDACIÓN DEL TOKEN
    ======================================================= */

    useEffect(() => {
        const interval =
            window.setInterval(
                async () => {
                    const user =
                        auth.currentUser;

                    if (!user) {
                        return;
                    }

                    try {
                        await user.getIdToken(
                            true
                        );
                    } catch (error) {
                        console.error(
                            "Error renovando token:",
                            error
                        );
                    }
                },
                REVALIDAR_TOKEN_CADA_MS
            );

        return () => {
            window.clearInterval(
                interval
            );
        };
    }, []);

    /* =======================================================
       REINTENTAR DISPOSITIVO
    ======================================================= */

    const reintentarDispositivo =
        useCallback(
            () => {
                if (
                    !auth.currentUser
                ) {
                    return;
                }

                setMensajeBloqueo(
                    ""
                );

                setEstadoDispositivo(
                    "pendiente"
                );

                setReintento(
                    (value) =>
                        value + 1
                );
            },
            []
        );

    /* =======================================================
       CERRAR SESIÓN MANUALMENTE
    ======================================================= */

    const cerrarSesion =
        useCallback(
            async () => {
                const user =
                    auth.currentUser;

                /*
                 * Si estamos mostrando el aviso de sesión
                 * cerrada por Admin, este botón limpia el aviso
                 * y permite volver al Login.
                 */
                borrarAvisoSesion();

                setAvisoSesion(
                    null
                );

                setMensajeBloqueo(
                    ""
                );

                if (!user) {
                    setEstadoDispositivo(
                        "pendiente"
                    );

                    return;
                }

                const sessionId =
                    storeGet(
                        getSessionKey(
                            user
                        ),
                        null
                    );

                /*
                 * Intentamos liberar el dispositivo en backend.
                 * Si falla por falta de conexión, igualmente
                 * cerramos Firebase Auth.
                 */
                if (sessionId) {
                    try {
                        await cerrarSesionClienteFunction(
                            {
                                deviceId,
                                sessionId,
                            }
                        );
                    } catch (error) {
                        console.warn(
                            "No se pudo cerrar la sesión en el servidor:",
                            error
                        );
                    }
                }

                removeSessionId(
                    user
                );

                await signOut(
                    auth
                );
            },
            [
                deviceId,
            ]
        );

    /* =======================================================
       ESTADO FINAL
    ======================================================= */

    let estado =
        "cargando";

    /*
     * Prioridad máxima:
     * una sesión cerrada remotamente debe seguir mostrando
     * el bloqueo incluso después de hacer signOut.
     */
    if (
        avisoSesion?.estado ===
        "sesion-cerrada"
    ) {
        estado =
            "sesion-cerrada";
    } else if (
        authState ===
        "cargando"
    ) {
        estado =
            "cargando";
    } else if (
        authState ===
        "sin-sesion"
    ) {
        estado =
            "sin-sesion";
    } else if (
        estadoLicencia ===
        "cargando"
    ) {
        estado =
            "cargando";
    } else if (
        estadoLicencia !==
        "activo"
    ) {
        estado =
            estadoLicencia;
    } else if (
        estadoDispositivo ===
        "pendiente"
    ) {
        estado =
            "cargando";
    } else {
        estado =
            estadoDispositivo;
    }

    /* =======================================================
       BLOQUEO
    ======================================================= */

    const bloqueado =
        estado ===
        "inactivo" ||
        estado ===
        "vencido" ||
        estado ===
        "no-encontrado" ||
        estado ===
        "limite-dispositivos" ||
        estado ===
        "sesion-cerrada" ||
        estado ===
        "error-sesion";

    /* =======================================================
       RETURN
    ======================================================= */

    return {
        estado,
        bloqueado,

        datosCliente,
        clienteId,

        cerrarSesion,
        reintentarDispositivo,

        dispositivosActivos,
        maxDispositivos,

        mensajeBloqueo,

        deviceId,
    };
}