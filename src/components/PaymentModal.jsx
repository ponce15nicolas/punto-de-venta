// src/components/PaymentModal.jsx
// Modal de cobro rediseñado con la misma identidad visual del POS.
// Mantiene la lógica original, motion/react, money() y el componente Modal.
// No requiere librerías de iconos externas.

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { money } from "../lib/format";
import Modal from "./Modal";

const METHODS = [
  {
    id: "efectivo",
    label: "Efectivo",
    icon: CashIcon,
  },
  {
    id: "transferencia",
    label: "Transferencia",
    icon: TransferIcon,
  },
  {
    id: "qr",
    label: "QR",
    icon: QrIcon,
  },
  {
    id: "tarjeta",
    label: "Tarjeta",
    icon: CardIcon,
  },
];

export default function PaymentModal({
  open,
  onClose,
  total,
  onConfirm,
}) {
  const [method, setMethod] = useState("efectivo");
  const [received, setReceived] = useState("");

  useEffect(() => {
    if (open) {
      setMethod("efectivo");
      setReceived("");
    }
  }, [open]);

  const receivedNum = parseFloat(received);

  const change =
    method === "efectivo" && !isNaN(receivedNum)
      ? receivedNum - total
      : 0;

  const canConfirm =
    method !== "efectivo" ||
    (!isNaN(receivedNum) && receivedNum >= total);

  const selectedMethod =
    METHODS.find((item) => item.id === method) || METHODS[0];

  const SelectedMethodIcon = selectedMethod.icon;

  const confirmar = () => {
    if (!canConfirm) return;

    onConfirm({
      method,
      received:
        method === "efectivo"
          ? receivedNum
          : total,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cobrar venta"
    >
      <div>
        {/* =================================================
            TOTAL A COBRAR
        ================================================= */}

        <div
          className="
            mb-4
            overflow-hidden
            rounded-[24px]
            bg-white
            text-[#111318]
          "
        >
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">

              <div className="min-w-0">
                <p
                  className="
                    text-[10px]
                    font-extrabold
                    uppercase
                    tracking-[0.16em]
                    text-[#B98700]
                  "
                >
                  Total a cobrar
                </p>

                <div
                  className="
                    mt-1
                    text-3xl
                    font-black
                    tracking-[-0.04em]
                    text-[#111318]
                    sm:text-[34px]
                  "
                >
                  {money(total)}
                </div>
              </div>

              <div
                className="
                  grid
                  h-11
                  w-11
                  shrink-0
                  place-items-center
                  rounded-2xl
                  bg-[#FFF5CC]
                  text-[#9A7100]
                "
              >
                <ReceiptIcon className="h-5 w-5" />
              </div>

            </div>

            <div
              className="
                mt-4
                h-[3px]
                rounded-full
                bg-[#FFC61A]
              "
            />
          </div>
        </div>

        {/* =================================================
            MÉTODO DE PAGO
        ================================================= */}

        <div className="mb-4">
          <label
            className="
              mb-2
              block
              text-xs
              font-bold
              text-white/55
            "
          >
            Método de pago
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            {METHODS.map((item) => {
              const activo = method === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMethod(item.id)}
                  className={
                    `
                      flex
                      min-h-[62px]
                      items-center
                      gap-3
                      rounded-2xl
                      border
                      px-3.5
                      py-3
                      text-left
                      text-sm
                      font-extrabold
                      transition
                      active:scale-[0.98]
                    ` +
                    (activo
                      ? `
                        border-[#FFC61A]
                        bg-[#FFC61A]
                        text-black
                        shadow-[0_10px_26px_rgba(255,198,26,0.16)]
                      `
                      : `
                        border-white/10
                        bg-[#171B23]
                        text-white
                        hover:border-white/20
                        hover:bg-[#202630]
                      `)
                  }
                >
                  <span
                    className={
                      `
                        grid
                        h-9
                        w-9
                        shrink-0
                        place-items-center
                        rounded-xl
                      ` +
                      (activo
                        ? "bg-black/10 text-black"
                        : "bg-white/5 text-white/55")
                    }
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>

                  <span className="truncate">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* =================================================
            EFECTIVO
        ================================================= */}

        {method === "efectivo" && (
          <motion.div
            initial={{
              opacity: 0,
              height: 0,
              y: -6,
            }}
            animate={{
              opacity: 1,
              height: "auto",
              y: 0,
            }}
            transition={{
              duration: 0.2,
            }}
            className="
              mb-4
              overflow-hidden
            "
          >
            <label
              htmlFor="payment-received"
              className="
                mb-1.5
                block
                text-xs
                font-bold
                text-white/55
              "
            >
              Monto recibido
            </label>

            <div className="relative">
              <span
                className="
                  pointer-events-none
                  absolute
                  left-4
                  top-1/2
                  -translate-y-1/2
                  text-base
                  font-black
                  text-[#FFC61A]
                "
              >
                $
              </span>

              <input
                id="payment-received"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                autoFocus
                className="
                  w-full
                  rounded-2xl
                  border
                  border-white/10
                  bg-[#171B23]
                  py-3.5
                  pl-9
                  pr-4
                  text-lg
                  font-black
                  text-white
                  outline-none
                  transition
                  placeholder:text-white/25
                  focus:border-[#FFC61A]
                  focus:ring-2
                  focus:ring-[#FFC61A]/10
                "
                placeholder="0.00"
                value={received}
                onChange={(e) =>
                  setReceived(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    confirmar();
                  }
                }}
              />
            </div>

            {/* ATAJOS DE EFECTIVO */}

            <div className="mt-2.5 flex flex-wrap gap-2">
              <QuickAmount
                label="Exacto"
                onClick={() =>
                  setReceived(String(total))
                }
              />

              <QuickAmount
                label="+ $1.000"
                onClick={() =>
                  setReceived(
                    String(
                      Math.ceil((total + 1000) / 1000) * 1000
                    )
                  )
                }
              />

              <QuickAmount
                label="+ $5.000"
                onClick={() =>
                  setReceived(
                    String(
                      Math.ceil((total + 5000) / 5000) * 5000
                    )
                  )
                }
              />
            </div>

            {/* VUELTO */}

            <div
              className={
                `
                  mt-3
                  flex
                  items-center
                  justify-between
                  gap-3
                  rounded-[22px]
                  border
                  px-3.5
                  py-3
                ` +
                (isNaN(receivedNum)
                  ? `
                    border-white/10
                    bg-[#151A22]
                  `
                  : change < 0
                    ? `
                    border-red-400/20
                    bg-red-500/10
                  `
                    : `
                    border-emerald-400/20
                    bg-emerald-500/10
                  `)
              }
            >
              <div className="flex items-center gap-2.5">

                <div
                  className={
                    `
                      grid
                      h-9
                      w-9
                      shrink-0
                      place-items-center
                      rounded-xl
                    ` +
                    (isNaN(receivedNum)
                      ? "bg-white/5 text-white/35"
                      : change < 0
                        ? "bg-red-500/15 text-red-400"
                        : "bg-emerald-500/15 text-emerald-400")
                  }
                >
                  <ChangeIcon className="h-4 w-4" />
                </div>

                <div>
                  <span
                    className="
                      block
                      text-[9px]
                      font-bold
                      uppercase
                      tracking-[0.12em]
                      text-white/35
                    "
                  >
                    {change < 0 && !isNaN(receivedNum)
                      ? "Falta"
                      : "Vuelto"}
                  </span>

                  <span
                    className="
                      mt-0.5
                      block
                      text-xs
                      font-semibold
                      text-white/45
                    "
                  >
                    {isNaN(receivedNum)
                      ? "Ingresá el monto recibido"
                      : change < 0
                        ? "El monto no alcanza"
                        : "Entregar al cliente"}
                  </span>
                </div>

              </div>

              <span
                className={
                  `
                    shrink-0
                    text-lg
                    font-black
                  ` +
                  (isNaN(receivedNum)
                    ? "text-white/35"
                    : change < 0
                      ? "text-red-400"
                      : "text-emerald-400")
                }
              >
                {isNaN(receivedNum)
                  ? "—"
                  : money(change)}
              </span>
            </div>
          </motion.div>
        )}

        {/* =================================================
            RESUMEN MÉTODO NO EFECTIVO
        ================================================= */}

        {method !== "efectivo" && (
          <motion.div
            key={method}
            initial={{
              opacity: 0,
              y: -5,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            className="
              mb-4
              flex
              items-center
              gap-3
              rounded-[22px]
              border
              border-white/10
              bg-[#151A22]
              p-3.5
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
              <SelectedMethodIcon className="h-[18px] w-[18px]" />
            </div>

            <div className="min-w-0">
              <p
                className="
                  text-[9px]
                  font-bold
                  uppercase
                  tracking-[0.12em]
                  text-white/35
                "
              >
                Método seleccionado
              </p>

              <p
                className="
                  mt-0.5
                  truncate
                  text-sm
                  font-extrabold
                  text-white
                "
              >
                {selectedMethod.label}
              </p>
            </div>

            <div
              className="
                ml-auto
                shrink-0
                text-sm
                font-black
                text-[#FFC61A]
              "
            >
              {money(total)}
            </div>
          </motion.div>
        )}

        {/* =================================================
            CONFIRMAR
        ================================================= */}

        <button
          type="button"
          disabled={!canConfirm}
          onClick={confirmar}
          className="
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
            disabled:cursor-not-allowed
            disabled:opacity-40
          "
        >
          <CheckIcon className="h-4 w-4" />
          Confirmar cobro · {money(total)}
        </button>
      </div>
    </Modal>
  );
}

/* =========================================================
   BOTÓN DE MONTO RÁPIDO
========================================================= */

function QuickAmount({
  label,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        rounded-xl
        border
        border-white/10
        bg-[#171B23]
        px-3
        py-2
        text-[11px]
        font-bold
        text-white/60
        transition
        hover:border-[#FFC61A]/40
        hover:text-[#FFC61A]
        active:scale-[0.98]
      "
    >
      {label}
    </button>
  );
}

/* =========================================================
   ICONOS INLINE
========================================================= */

function ReceiptIcon({ className = "" }) {
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
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.2V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function CashIcon({ className = "" }) {
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
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7 9H6v1M17 15h1v-1" />
    </svg>
  );
}

function TransferIcon({ className = "" }) {
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
      <path d="M4 7h14" />
      <path d="m15 4 3 3-3 3" />
      <path d="M20 17H6" />
      <path d="m9 14-3 3 3 3" />
    </svg>
  );
}

function QrIcon({ className = "" }) {
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
      <path d="M4 4h6v6H4z" />
      <path d="M14 4h6v6h-6z" />
      <path d="M4 14h6v6H4z" />
      <path d="M14 14h2v2h-2z" />
      <path d="M18 14h2v6h-6v-2" />
    </svg>
  );
}

function CardIcon({ className = "" }) {
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
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

function ChangeIcon({ className = "" }) {
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
      <path d="M20 7h-9a4 4 0 0 0-4 4v1" />
      <path d="m4 9 3 3 3-3" />
      <path d="M4 17h9a4 4 0 0 0 4-4v-1" />
      <path d="m20 15-3-3-3 3" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5 9.2 17 19 7" />
    </svg>
  );
}