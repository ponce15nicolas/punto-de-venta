// src/components/LicenseGate.jsx
//
// Protege el POS según:
// - autenticación
// - estado de licencia
// - vencimiento
// - dispositivo autorizado
// - límite de dispositivos
// - cierre remoto de sesión
// - errores de verificación
//
// Mantiene la identidad visual del POS.
// No requiere librerías de iconos externas.
//
// IMPORTANTE:
// La instancia de useLicenseCheck se crea en App.jsx y se recibe
// mediante la prop "license". No se crea una segunda instancia acá.

import { motion } from "motion/react";
import Login from "./Login";
import OperatorGate from "./OperatorGate";

/* =========================================================
   MENSAJES
========================================================= */

const MENSAJES = {
    inactivo: {
        titulo: "Cuenta desactivada",
        texto:
            "Tu acceso al sistema fue desactivado. Contactá a soporte para más información.",
        icon: DisabledIcon,
        tone: "danger",
        badge: "Licencia bloqueada",
        showRetry: false,
    },

    vencido: {
        titulo: "Suscripción vencida",
        texto:
            "Tu período de pago venció. Regularizá tu situación para seguir usando el POS.",
        icon: ClockIcon,
        tone: "warning",
        badge: "Licencia vencida",
        showRetry: false,
    },

    "no-encontrado": {
        titulo: "Cuenta no encontrada",
        texto:
            "No encontramos ningún cliente registrado con este email. Verificá la cuenta utilizada o contactá a soporte.",
        icon: UserSearchIcon,
        tone: "neutral",
        badge: "Sin licencia",
        showRetry: false,
    },

    "limite-dispositivos": {
        titulo: "Límite de dispositivos alcanzado",
        texto:
            "Esta licencia ya está siendo utilizada en la cantidad máxima de dispositivos permitidos.",
        icon: DevicesIcon,
        tone: "warning",
        badge: "Dispositivo no autorizado",
        showRetry: true,
    },

    "sesion-cerrada": {
        titulo: "Sesión cerrada",
        texto:
            "Este dispositivo fue desconectado. Iniciá sesión nuevamente para continuar.",
        icon: SessionClosedIcon,
        tone: "danger",
        badge: "Sesión finalizada",
        showRetry: false,
    },

    "error-sesion": {
        titulo: "No pudimos verificar el dispositivo",
        texto:
            "No fue posible validar este dispositivo en este momento. Revisá tu conexión e intentá nuevamente.",
        icon: ShieldAlertIcon,
        tone: "neutral",
        badge: "Verificación pendiente",
        showRetry: true,
    },
};

/* =========================================================
   COMPONENTE PRINCIPAL
========================================================= */

export default function LicenseGate({
    children,
    license,
}) {
    const {
        estado,
        bloqueado,
        cerrarSesion,

        mensajeBloqueo,
        reintentarDispositivo,

        dispositivosActivos,
        maxDispositivos,
    } = license || {};

    /* =========================================================
       CARGANDO
    ========================================================= */

    if (estado === "cargando") {
        return <LicenseLoading />;
    }

    /* =========================================================
       SIN SESIÓN
    ========================================================= */

    if (estado === "sin-sesion") {
        return <Login />;
    }

    /* =========================================================
       BLOQUEADO
    ========================================================= */

    if (bloqueado) {
        const baseMessage =
            MENSAJES[estado] ||
            MENSAJES.inactivo;

        /*
         * Si useLicenseCheck recibió un mensaje más específico
         * desde Cloud Functions, lo mostramos.
         */
        const message = {
            ...baseMessage,

            texto:
                mensajeBloqueo ||
                baseMessage.texto,
        };

        return (
            <BlockedScreen
                estado={estado}
                message={message}
                onLogout={cerrarSesion}
                onRetry={
                    message.showRetry
                        ? reintentarDispositivo
                        : null
                }
                dispositivosActivos={
                    dispositivosActivos
                }
                maxDispositivos={
                    maxDispositivos
                }
            />
        );
    }

    /* =========================================================
       LICENCIA + DISPOSITIVO AUTORIZADOS
    ========================================================= */

    return (
        <OperatorGate
            license={license}
        >
            {children}
        </OperatorGate>
    );
}

/* =========================================================
   PANTALLA DE CARGA
========================================================= */

function LicenseLoading() {
    return (
        <div
            className="
        relative
        flex
        min-h-screen
        items-center
        justify-center
        overflow-hidden
        bg-[#0B0D12]
        px-6
      "
        >
            {/* Fondo */}

            <div
                className="
          pointer-events-none
          absolute
          inset-0
          overflow-hidden
        "
                aria-hidden="true"
            >
                <div
                    className="
            absolute
            left-1/2
            top-1/2
            h-[360px]
            w-[360px]
            -translate-x-1/2
            -translate-y-1/2
            rounded-full
            bg-[#FFC61A]/[0.055]
            blur-[100px]
          "
                />
            </div>

            <motion.div
                initial={{
                    opacity: 0,
                    scale: 0.96,
                    y: 8,
                }}
                animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                }}
                transition={{
                    duration: 0.28,
                    ease: "easeOut",
                }}
                className="
          relative
          z-10
          flex
          w-full
          max-w-[320px]
          flex-col
          items-center
          text-center
        "
            >
                <motion.div
                    animate={{
                        scale: [
                            1,
                            1.06,
                            1,
                        ],
                    }}
                    transition={{
                        duration: 1.8,
                        repeat: Infinity,
                        ease: "easeInOut",
                    }}
                    className="
            grid
            h-16
            w-16
            place-items-center
            rounded-[22px]
            bg-[#FFC61A]
            text-black
            shadow-[0_18px_45px_rgba(255,198,26,0.18)]
          "
                >
                    <ShieldIcon className="h-7 w-7" />
                </motion.div>

                <p
                    className="
            mt-5
            text-[10px]
            font-extrabold
            uppercase
            tracking-[0.2em]
            text-[#FFC61A]
          "
                >
                    Punto de venta
                </p>

                <h1
                    className="
            mt-1
            text-xl
            font-black
            tracking-[-0.03em]
            text-white
          "
                >
                    Verificando acceso
                </h1>

                <p
                    className="
            mt-2
            text-sm
            leading-relaxed
            text-white/40
          "
                >
                    Estamos comprobando tu licencia y autorizando este dispositivo.
                </p>

                <div
                    className="
            mt-5
            h-1
            w-28
            overflow-hidden
            rounded-full
            bg-white/10
          "
                >
                    <motion.div
                        animate={{
                            x: [
                                "-100%",
                                "100%",
                            ],
                        }}
                        transition={{
                            duration: 1.1,
                            repeat: Infinity,
                            ease: "easeInOut",
                        }}
                        className="
              h-full
              w-1/2
              rounded-full
              bg-[#FFC61A]
            "
                    />
                </div>

                <div
                    className="
            mt-4
            flex
            items-center
            gap-2
            text-[10px]
            font-semibold
            text-white/25
          "
                >
                    <DeviceSmallIcon className="h-3.5 w-3.5" />

                    Licencia y dispositivo
                </div>
            </motion.div>
        </div>
    );
}

/* =========================================================
   PANTALLA BLOQUEADA
========================================================= */

function BlockedScreen({
    estado,
    message,
    onLogout,
    onRetry,
    dispositivosActivos,
    maxDispositivos,
}) {
    const Icon =
        message.icon ||
        DisabledIcon;

    const styles = {
        danger: {
            iconWrap:
                "bg-red-50 text-red-600",

            badge:
                "bg-red-50 text-red-600",

            line:
                "bg-red-500",
        },

        warning: {
            iconWrap:
                "bg-[#FFF5CC] text-[#9A7100]",

            badge:
                "bg-[#FFF8DD] text-[#9A7100]",

            line:
                "bg-[#FFC61A]",
        },

        neutral: {
            iconWrap:
                "bg-[#F4F5F7] text-black/45",

            badge:
                "bg-[#F4F5F7] text-black/45",

            line:
                "bg-[#FFC61A]",
        },
    };

    const tone =
        styles[message.tone] ||
        styles.danger;

    const mostrarContador =
        estado ===
        "limite-dispositivos" &&
        Number.isFinite(
            Number(
                maxDispositivos
            )
        );

    const activos =
        Number.isFinite(
            Number(
                dispositivosActivos
            )
        )
            ? Number(
                dispositivosActivos
            )
            : null;

    const maximo =
        Number.isFinite(
            Number(
                maxDispositivos
            )
        )
            ? Number(
                maxDispositivos
            )
            : null;

    return (
        <div
            className="
        relative
        flex
        min-h-screen
        items-center
        justify-center
        overflow-hidden
        bg-[#0B0D12]
        px-4
        py-8
      "
        >
            {/* =====================================================
          FONDO
      ===================================================== */}

            <div
                className="
          pointer-events-none
          absolute
          inset-0
          overflow-hidden
        "
                aria-hidden="true"
            >
                <div
                    className="
            absolute
            -left-28
            -top-32
            h-[320px]
            w-[320px]
            rounded-full
            bg-[#FFC61A]/[0.045]
            blur-[90px]
          "
                />

                <div
                    className="
            absolute
            -bottom-36
            -right-28
            h-[300px]
            w-[300px]
            rounded-full
            bg-white/[0.025]
            blur-[100px]
          "
                />
            </div>

            <motion.div
                initial={{
                    opacity: 0,
                    y: 14,
                    scale: 0.98,
                }}
                animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1,
                }}
                transition={{
                    duration: 0.25,
                    ease: "easeOut",
                }}
                className="
          relative
          z-10
          w-full
          max-w-[390px]
        "
            >
                {/* ===================================================
            MARCA
        =================================================== */}

                <div
                    className="
            mb-4
            flex
            items-center
            justify-center
            gap-2
          "
                >
                    <div
                        className="
              grid
              h-9
              w-9
              place-items-center
              rounded-xl
              bg-[#FFC61A]
              text-black
            "
                    >
                        <StoreIcon className="h-4 w-4" />
                    </div>

                    <div className="text-left">
                        <span
                            className="
                block
                text-[8px]
                font-extrabold
                uppercase
                tracking-[0.16em]
                text-[#FFC61A]
              "
                        >
                            Punto de venta
                        </span>

                        <span
                            className="
                mt-0.5
                block
                text-xs
                font-extrabold
                text-white
              "
                        >
                            Mi Negocio
                        </span>
                    </div>
                </div>

                {/* ===================================================
            TARJETA
        =================================================== */}

                <div
                    className="
            overflow-hidden
            rounded-[30px]
            bg-white
            text-[#111318]
            shadow-[0_24px_70px_rgba(0,0,0,0.30)]
          "
                >
                    <div className="p-5 sm:p-6">

                        {/* ICONO */}

                        <motion.div
                            initial={{
                                scale: 0.9,
                            }}
                            animate={{
                                scale: 1,
                            }}
                            transition={{
                                type: "spring",
                                stiffness: 350,
                                damping: 20,
                            }}
                            className={`
                mx-auto
                grid
                h-14
                w-14
                place-items-center
                rounded-[20px]
                ${tone.iconWrap}
              `}
                        >
                            <Icon className="h-6 w-6" />
                        </motion.div>

                        {/* TEXTO */}

                        <div className="mt-4 text-center">
                            <span
                                className={`
                  inline-flex
                  items-center
                  rounded-full
                  px-2.5
                  py-1
                  text-[9px]
                  font-extrabold
                  uppercase
                  tracking-[0.12em]
                  ${tone.badge}
                `}
                            >
                                {message.badge ||
                                    "Acceso restringido"}
                            </span>

                            <h1
                                className="
                  mt-3
                  text-xl
                  font-black
                  tracking-[-0.025em]
                  text-[#111318]
                "
                            >
                                {message.titulo}
                            </h1>

                            <p
                                className="
                  mx-auto
                  mt-2
                  max-w-[315px]
                  text-sm
                  leading-relaxed
                  text-black/45
                "
                            >
                                {message.texto}
                            </p>
                        </div>

                        <div
                            className={`
                my-5
                h-[3px]
                rounded-full
                ${tone.line}
              `}
                        />

                        {/* =================================================
                CONTADOR DE DISPOSITIVOS
            ================================================= */}

                        {mostrarContador && (
                            <div
                                className="
                  mb-3
                  overflow-hidden
                  rounded-[20px]
                  border
                  border-[#F2D675]
                  bg-[#FFF8DD]
                "
                            >
                                <div
                                    className="
                    flex
                    items-center
                    gap-3
                    px-3.5
                    py-3.5
                  "
                                >
                                    <div
                                        className="
                      grid
                      h-10
                      w-10
                      shrink-0
                      place-items-center
                      rounded-xl
                      bg-[#FFC61A]
                      text-black
                    "
                                    >
                                        <DevicesIcon className="h-[18px] w-[18px]" />
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <span
                                            className="
                        block
                        text-[9px]
                        font-bold
                        uppercase
                        tracking-[0.1em]
                        text-black/35
                      "
                                        >
                                            Uso de la licencia
                                        </span>

                                        <span
                                            className="
                        mt-0.5
                        block
                        text-sm
                        font-black
                        text-[#111318]
                      "
                                        >
                                            {activos !== null
                                                ? activos
                                                : maximo}
                                            {" / "}
                                            {maximo}{" "}
                                            {maximo === 1
                                                ? "dispositivo"
                                                : "dispositivos"}
                                        </span>
                                    </div>

                                    <div
                                        className="
                      rounded-xl
                      bg-white/70
                      px-2.5
                      py-1.5
                      text-[10px]
                      font-black
                      text-[#9A7100]
                    "
                                    >
                                        COMPLETO
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* =================================================
                INFORMACIÓN
            ================================================= */}

                        <div
                            className="
                flex
                items-start
                gap-2.5
                rounded-2xl
                bg-[#F4F5F7]
                px-3.5
                py-3
              "
                        >
                            <InfoIcon
                                className="
                  mt-0.5
                  h-4
                  w-4
                  shrink-0
                  text-black/35
                "
                            />

                            <p
                                className="
                  text-xs
                  leading-relaxed
                  text-black/45
                "
                            >
                                {getHelpText(
                                    estado
                                )}
                            </p>
                        </div>

                        {/* =================================================
                REINTENTAR
            ================================================= */}

                        {onRetry && (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="
                  mt-4
                  inline-flex
                  w-full
                  items-center
                  justify-center
                  gap-2
                  rounded-2xl
                  bg-[#FFC61A]
                  px-4
                  py-3.5
                  text-sm
                  font-extrabold
                  text-black
                  shadow-[0_12px_30px_rgba(255,198,26,0.18)]
                  transition
                  hover:bg-[#FFD248]
                  active:scale-[0.99]
                "
                            >
                                <RefreshIcon className="h-4 w-4" />

                                Reintentar acceso
                            </button>
                        )}

                        {/* =================================================
                CERRAR SESIÓN
            ================================================= */}

                        <button
                            type="button"
                            onClick={onLogout}
                            className={`
                inline-flex
                w-full
                items-center
                justify-center
                gap-2
                rounded-2xl
                px-4
                py-3.5
                text-sm
                font-extrabold
                transition
                active:scale-[0.99]
                ${onRetry
                                    ? `
                      mt-2.5
                      border
                      border-black/10
                      bg-[#F4F5F7]
                      text-black/55
                      hover:bg-[#ECEEF1]
                    `
                                    : `
                      mt-4
                      bg-[#FFC61A]
                      text-black
                      shadow-[0_12px_30px_rgba(255,198,26,0.18)]
                      hover:bg-[#FFD248]
                    `
                                }
              `}
                        >
                            <LogoutIcon className="h-4 w-4" />

                            Cerrar sesión
                        </button>
                    </div>
                </div>

                {/* ===================================================
            SEGURIDAD
        =================================================== */}

                {(estado ===
                    "limite-dispositivos" ||
                    estado ===
                    "error-sesion") && (
                        <div
                            className="
              mt-3
              flex
              items-center
              justify-center
              gap-1.5
              text-[9px]
              font-semibold
              text-white/25
            "
                        >
                            <ShieldSmallIcon className="h-3 w-3" />

                            Control de dispositivos activo
                        </div>
                    )}
            </motion.div>
        </div>
    );
}

/* =========================================================
   TEXTO DE AYUDA
========================================================= */

function getHelpText(
    estado
) {
    switch (estado) {
        case "limite-dispositivos":
            return "Si otro dispositivo dejó de usar el sistema, esperá unos minutos y tocá “Reintentar acceso”. También podés cerrar sesión en el otro dispositivo.";

        case "error-sesion":
            return "Comprobá que tengas conexión a internet. Si el problema continúa, intentá nuevamente o cerrá sesión e ingresá otra vez.";

        case "sesion-cerrada":
            return "La sesión puede haber sido cerrada desde el panel administrativo o porque cambió la autorización de este dispositivo.";

        case "vencido":
            return "Cuando el administrador renueve tu período de uso, el sistema volverá a habilitarse automáticamente.";

        case "inactivo":
            return "El administrador debe volver a activar esta licencia para poder utilizar el punto de venta.";

        case "no-encontrado":
            return "Verificá que estés usando la misma cuenta de Google o correo electrónico asociado a la licencia.";

        default:
            return "Si creés que esto es un error, cerrá sesión e ingresá nuevamente con la cuenta asociada a tu licencia.";
    }
}

/* =========================================================
   ICONOS
========================================================= */

function ShieldIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 3 19 6v5c0 4.8-2.9 8.6-7 10-4.1-1.4-7-5.2-7-10V6l7-3Z" />
            <path d="m9.5 12 1.7 1.7 3.5-3.7" />
        </svg>
    );
}

function DisabledIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle
                cx="12"
                cy="12"
                r="9"
            />

            <path d="M6 6l12 12" />
        </svg>
    );
}

function ClockIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle
                cx="12"
                cy="12"
                r="9"
            />

            <path d="M12 7v5l3 2" />
        </svg>
    );
}

function UserSearchIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle
                cx="10"
                cy="8"
                r="3.5"
            />

            <path d="M4 19a6 6 0 0 1 10.5-4" />

            <circle
                cx="17"
                cy="17"
                r="3"
            />

            <path d="m19.2 19.2 2 2" />
        </svg>
    );
}

function StoreIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M4 10v10h16V10" />

            <path d="M3 10l2-6h14l2 6" />

            <path d="M8 20v-6h8v6" />

            <path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2" />
        </svg>
    );
}

function InfoIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle
                cx="12"
                cy="12"
                r="9"
            />

            <path d="M12 11v5" />

            <path d="M12 8h.01" />
        </svg>
    );
}

function LogoutIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M16 17l5-5-5-5" />

            <path d="M21 12H9" />

            <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
        </svg>
    );
}

function DevicesIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect
                x="3"
                y="4"
                width="13"
                height="10"
                rx="2"
            />

            <path d="M7 18h5" />

            <path d="M9.5 14v4" />

            <rect
                x="17"
                y="8"
                width="4"
                height="9"
                rx="1"
            />

            <path d="M18.5 15h1" />
        </svg>
    );
}

function DeviceSmallIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect
                x="4"
                y="3"
                width="16"
                height="13"
                rx="2"
            />

            <path d="M8 21h8" />

            <path d="M12 16v5" />
        </svg>
    );
}

function SessionClosedIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />

            <path d="M14 8l4 4-4 4" />

            <path d="M18 12H9" />

            <path d="M19.5 4.5 21 6" />

            <path d="M21 4.5 19.5 6" />
        </svg>
    );
}

function ShieldAlertIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 3 19 6v5c0 4.8-2.9 8.6-7 10-4.1-1.4-7-5.2-7-10V6l7-3Z" />

            <path d="M12 8v5" />

            <path d="M12 16h.01" />
        </svg>
    );
}

function RefreshIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M20 6v5h-5" />

            <path d="M4 18v-5h5" />

            <path d="M18.2 9a7 7 0 0 0-11.7-2.2L4 11" />

            <path d="M5.8 15a7 7 0 0 0 11.7 2.2L20 13" />
        </svg>
    );
}

function ShieldSmallIcon({
    className = "",
}) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 3 19 6v5c0 4.8-2.9 8.6-7 10-4.1-1.4-7-5.2-7-10V6l7-3Z" />
        </svg>
    );
}