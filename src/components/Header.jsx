// src/components/Header.jsx
// Cabecera compacta del POS: identidad del negocio + estado de caja.

import { motion } from "motion/react";
import { fmtTime } from "../lib/format";

export default function Header({
  shopName,
  onRename,
  openSession,
}) {
  return (
    <header className="pos-header sticky top-0 z-20 px-4 pb-3 pt-4 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[520px] items-center justify-between gap-3">
        <button
          type="button"
          onClick={onRename}
          className="group flex min-w-0 items-center gap-3 text-left outline-none"
          aria-label="Cambiar nombre del negocio"
        >
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black shadow-[0_10px_26px_rgba(255,198,26,0.18)] transition group-active:scale-[0.97] sm:h-12 sm:w-12">
            <CartIcon className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="block text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#FFC61A] sm:text-[10px]">
                Punto de venta
              </span>

              <EditIcon className="h-3 w-3 text-white/25 transition group-hover:text-[#FFC61A]" />
            </div>

            <h1 className="mt-0.5 max-w-[170px] truncate text-lg font-black leading-tight tracking-[-0.02em] text-white sm:max-w-[240px] sm:text-xl">
              {shopName}
            </h1>
          </div>
        </button>

        <motion.div
          key={openSession ? "open" : "closed"}
          initial={{ scale: 0.94, opacity: 0, y: -2 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
          className={
            `flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-[10px] font-extrabold leading-none shadow-sm sm:text-[11px] ` +
            (openSession
              ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-400"
              : "border-red-400/25 bg-red-500/10 text-red-400")
          }
        >
          <motion.span
            animate={
              openSession
                ? { scale: [1, 1.35, 1], opacity: [1, 0.65, 1] }
                : { scale: 1, opacity: 1 }
            }
            transition={
              openSession
                ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
                : undefined
            }
            className="h-2 w-2 shrink-0 rounded-full bg-current"
          />

          <div className="whitespace-nowrap">
            {openSession ? (
              <>
                <span className="hidden sm:inline">Caja abierta · </span>
                <span className="sm:hidden">Abierta · </span>
                {fmtTime(openSession.openTime)}
              </>
            ) : (
              "Caja cerrada"
            )}
          </div>
        </motion.div>
      </div>
    </header>
  );
}

function CartIcon({ className = "" }) {
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

function EditIcon({ className = "" }) {
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
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}
