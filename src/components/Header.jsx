// src/components/Header.jsx
// Header principal del POS.
//
// Mantiene:
// - identidad visual;
// - estado de caja;
// - edición del nombre del negocio.
//
// Agrega:
// - identidad del operador interno activo;
// - acceso a gestión de usuarios sólo para Administrador.

import {
  useState,
} from "react";

import { motion } from "motion/react";

import { fmtTime } from "../lib/format";
import { useOperator } from "./OperatorGate";
import UserManagementModal from "./UserManagementModal";

export default function Header({
  shopName,
  onRename,
  openSession,
  deviceId = null,
  allowOperatorChangeWithOpenSession = false,
}) {
  const {
    operador,
    esAdministrador,
    cerrarSesionInterna,
  } = useOperator();

  const [
    showUsers,
    setShowUsers,
  ] = useState(false);

  const [
    cambiandoUsuario,
    setCambiandoUsuario,
  ] = useState(false);

  async function handleCambiarUsuario() {
    if (cambiandoUsuario) {
      return;
    }

    if (
      openSession &&
      !allowOperatorChangeWithOpenSession
    ) {
      window.alert(
        "No es posible cambiar de usuario mientras la caja está abierta. Cerrá la caja primero."
      );

      return;
    }

    setCambiandoUsuario(true);
    setShowUsers(false);

    try {
      await cerrarSesionInterna();
    } catch (error) {
      console.error(
        "Error cerrando sesión interna:",
        error
      );

      setCambiandoUsuario(false);
    }
  }

  return (
    <>
      <header
        className="
          sticky
          top-0
          z-20
          border-b
          border-white/10
          bg-[#0B0D12]/95
          px-4
          pb-3
          pt-4
          backdrop-blur-xl
        "
      >
        <div
          className="
            mx-auto
            flex
            max-w-[520px]
            items-center
            justify-between
            gap-3
          "
        >
          <button
            type="button"
            onClick={onRename}
            className="
              group
              flex
              min-w-0
              items-center
              gap-3
              text-left
              outline-none
            "
            aria-label="Cambiar nombre del negocio"
          >
            <div
              className="
                grid
                h-11
                w-11
                shrink-0
                place-items-center
                rounded-2xl
                bg-[#FFC61A]
                text-black
                shadow-[0_10px_26px_rgba(255,198,26,0.18)]
                transition
                group-active:scale-[0.97]
              "
            >
              <CartIcon className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="
                    block
                    text-[9px]
                    font-extrabold
                    uppercase
                    tracking-[0.2em]
                    text-[#FFC61A]
                    sm:text-[10px]
                  "
                >
                  Punto de venta
                </span>

                <EditIcon
                  className="
                    h-3
                    w-3
                    text-white/25
                    transition
                    group-hover:text-[#FFC61A]
                  "
                />
              </div>

              <h1
                className="
                  mt-0.5
                  max-w-[160px]
                  truncate
                  text-lg
                  font-black
                  leading-tight
                  tracking-[-0.02em]
                  text-white
                  sm:max-w-[220px]
                  sm:text-xl
                "
              >
                {shopName}
              </h1>
            </div>
          </button>

          <motion.div
            key={
              openSession
                ? "open"
                : "closed"
            }
            initial={{
              scale: 0.92,
              opacity: 0,
              y: -2,
            }}
            animate={{
              scale: 1,
              opacity: 1,
              y: 0,
            }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 28,
            }}
            className={
              `
                flex
                shrink-0
                items-center
                gap-2
                rounded-2xl
                border
                px-3
                py-2
                text-[10px]
                font-extrabold
                leading-none
                shadow-sm
                sm:text-[11px]
              ` +
              (openSession
                ? `
                  border-emerald-400/25
                  bg-emerald-500/10
                  text-emerald-400
                `
                : `
                  border-red-400/25
                  bg-red-500/10
                  text-red-400
                `)
            }
          >
            <motion.span
              animate={
                openSession
                  ? {
                      scale: [
                        1,
                        1.35,
                        1,
                      ],
                      opacity: [
                        1,
                        0.65,
                        1,
                      ],
                    }
                  : {
                      scale: 1,
                      opacity: 1,
                    }
              }
              transition={
                openSession
                  ? {
                      duration: 2,
                      repeat:
                        Infinity,
                      ease:
                        "easeInOut",
                    }
                  : undefined
              }
              className="
                h-2
                w-2
                shrink-0
                rounded-full
                bg-current
              "
            />

            <div className="whitespace-nowrap">
              {openSession ? (
                <>
                  <span className="hidden sm:inline">
                    Caja abierta ·{" "}
                  </span>

                  <span className="sm:hidden">
                    Abierta ·{" "}
                  </span>

                  {fmtTime(
                    openSession.openTime
                  )}
                </>
              ) : (
                "Caja cerrada"
              )}
            </div>
          </motion.div>
        </div>

        <div
          className="
            mx-auto
            mt-3
            flex
            max-w-[520px]
            flex-col
            items-stretch
            gap-2
            border-t
            border-white/[0.06]
            pt-2.5
            min-[480px]:flex-row
            min-[480px]:items-center
            min-[480px]:justify-between
            min-[480px]:gap-3
          "
        >
          <div
            className="
              flex
              min-w-0
              items-center
              gap-2
            "
          >
            <div
              className="
                grid
                h-8
                w-8
                shrink-0
                place-items-center
                rounded-xl
                border
                border-white/10
                bg-white/[0.04]
                text-white/45
              "
            >
              <UserIcon className="h-3.5 w-3.5" />
            </div>

            <div className="min-w-0">
              <span
                className="
                  block
                  max-w-[180px]
                  truncate
                  text-[11px]
                  font-extrabold
                  text-white/70
                "
              >
                {operador?.nombre ||
                  "Operador"}
              </span>

              <span
                className="
                  mt-0.5
                  block
                  text-[8px]
                  font-bold
                  uppercase
                  tracking-[0.12em]
                  text-white/25
                "
              >
                {esAdministrador
                  ? "Administrador"
                  : "Encargado"}
              </span>
            </div>
          </div>

          <div
            className="
              flex
              w-full
              items-center
              gap-2
              min-[480px]:w-auto
              min-[480px]:shrink-0
            "
          >
            {esAdministrador && (
              <button
                type="button"
                onClick={() =>
                  setShowUsers(
                    true
                  )
                }
                className="
                  inline-flex
                  min-w-0
                  flex-1
                  items-center
                  justify-center
                  gap-1.5
                  min-[480px]:flex-none
                  rounded-xl
                  border
                  border-[#FFC61A]/20
                  bg-[#FFC61A]/10
                  px-2.5
                  py-2
                  text-[10px]
                  font-extrabold
                  text-[#FFC61A]
                  transition
                  hover:border-[#FFC61A]/35
                  hover:bg-[#FFC61A]/15
                  active:scale-[0.98]
                "
              >
                <UsersIcon className="h-3.5 w-3.5" />
                Usuarios
              </button>
            )}

            <button
              type="button"
              onClick={
                handleCambiarUsuario
              }
              disabled={
                cambiandoUsuario
              }
              title={
                openSession
                  ? "Cerrá la caja antes de cambiar de usuario"
                  : "Cambiar usuario"
              }
              aria-label={
                openSession
                  ? "No se puede cambiar de usuario con la caja abierta"
                  : "Cambiar usuario"
              }
              className="
                inline-flex
                min-w-0
                flex-1
                items-center
                justify-center
                gap-1.5
                min-[480px]:flex-none
                rounded-xl
                border
                border-white/10
                bg-white/[0.04]
                px-2.5
                py-2
                text-[10px]
                font-extrabold
                text-white/60
                transition
                hover:border-white/20
                hover:bg-white/[0.08]
                hover:text-white
                active:scale-[0.98]
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              <SwitchUserIcon className="h-3.5 w-3.5" />

              {cambiandoUsuario
                ? "Saliendo..."
                : "Cambiar usuario"}
            </button>
          </div>
        </div>
      </header>

      <UserManagementModal
        open={showUsers}
        deviceId={deviceId}
        onClose={() =>
          setShowUsers(
            false
          )
        }
      />
    </>
  );
}

/* =========================================================
   ICONOS INLINE
========================================================= */

function CartIcon({
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
      <circle cx="9" cy="20" r="1" />
      <circle cx="19" cy="20" r="1" />
      <path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  );
}

function EditIcon({
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}

function UserIcon({
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
        cy="8"
        r="3"
      />
      <path d="M6 20a6 6 0 0 1 12 0" />
    </svg>
  );
}

function SwitchUserIcon({
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
      <path d="M8 7h11" />
      <path d="m16 4 3 3-3 3" />
      <path d="M16 17H5" />
      <path d="m8 14-3 3 3 3" />
    </svg>
  );
}


function UsersIcon({
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle
        cx="9.5"
        cy="7"
        r="4"
      />
      <path d="M17 11a4 4 0 0 1 4 4v2" />
      <path d="M17 3.2a4 4 0 0 1 0 7.6" />
    </svg>
  );
}
