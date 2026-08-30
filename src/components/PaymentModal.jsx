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
  {
    id: "cuenta",
    label: "A cuenta",
    icon: DebtIcon,
  },
];

const SPLIT_METHODS = METHODS.filter((item) => item.id !== "cuenta");

function toMoneyNumber(value, fallback = Number.NaN) {
  const normalized =
    typeof value === "string"
      ? value.replace(",", ".")
      : value;

  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function todayDateOnly() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;

  return new Date(now.getTime() - offset)
    .toISOString()
    .slice(0, 10);
}

export default function PaymentModal({
  open,
  onClose,
  total,
  onConfirm,
  processing = false,
}) {
  const [method, setMethod] = useState("efectivo");
  const [received, setReceived] = useState("");
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [secondMethod, setSecondMethod] = useState("transferencia");
  const [splitAmount, setSplitAmount] = useState("");
  const [secondReceived, setSecondReceived] = useState("");
  const [secondReceivedTouched, setSecondReceivedTouched] = useState(false);
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [notas, setNotas] = useState("");

  useEffect(() => {
    if (open) {
      setMethod("efectivo");
      setReceived("");
      setReceivedTouched(false);
      setSplitEnabled(false);
      setSecondMethod("transferencia");
      setSplitAmount("");
      setSecondReceived("");
      setSecondReceivedTouched(false);
      setClienteNombre("");
      setClienteTelefono("");
      setVencimiento("");
      setNotas("");
    }
  }, [open]);

  const receivedNum = toMoneyNumber(received);
  const secondReceivedNum = toMoneyNumber(secondReceived);
  const fechaOrigen = todayDateOnly();

  const rawSplitAmount = toMoneyNumber(splitAmount, 0);
  const firstSplitAmount = splitEnabled
    ? roundMoney(Math.min(Math.max(rawSplitAmount, 0), total))
    : total;
  const secondSplitAmount = splitEnabled
    ? roundMoney(total - firstSplitAmount)
    : 0;

  useEffect(() => {
    if (!splitEnabled || method !== "efectivo" || receivedTouched) return;
    setReceived(String(firstSplitAmount));
  }, [splitEnabled, method, firstSplitAmount, receivedTouched]);

  useEffect(() => {
    if (!splitEnabled || secondMethod !== "efectivo" || secondReceivedTouched) return;
    setSecondReceived(String(secondSplitAmount));
  }, [splitEnabled, secondMethod, secondSplitAmount, secondReceivedTouched]);

  const firstCashChange =
    method === "efectivo" && Number.isFinite(receivedNum)
      ? roundMoney(receivedNum - firstSplitAmount)
      : 0;

  const secondCashChange =
    splitEnabled &&
    secondMethod === "efectivo" &&
    Number.isFinite(secondReceivedNum)
      ? roundMoney(secondReceivedNum - secondSplitAmount)
      : 0;

  const change = splitEnabled ? firstCashChange + secondCashChange : firstCashChange;

  const validReceivable =
    method !== "cuenta" ||
    (
      clienteNombre.trim().length > 0 &&
      (!vencimiento || vencimiento >= fechaOrigen)
    );

  const validFirstCash =
    method !== "efectivo" ||
    (Number.isFinite(receivedNum) && receivedNum >= firstSplitAmount);

  const validSecondCash =
    !splitEnabled ||
    secondMethod !== "efectivo" ||
    (Number.isFinite(secondReceivedNum) && secondReceivedNum >= secondSplitAmount);

  const validSplit =
    !splitEnabled ||
    (
      method !== "cuenta" &&
      secondMethod !== method &&
      firstSplitAmount > 0 &&
      secondSplitAmount > 0 &&
      validFirstCash &&
      validSecondCash
    );

  const canConfirm =
    validReceivable &&
    validSplit &&
    (!splitEnabled ? validFirstCash : true);

  const selectedMethod =
    METHODS.find((item) => item.id === method) || METHODS[0];

  const SelectedMethodIcon = selectedMethod.icon;

  const confirmar = () => {
    if (!canConfirm || processing) return;

    if (splitEnabled) {
      const parts = [
        {
          method,
          amount: firstSplitAmount,
          received:
            method === "efectivo" ? roundMoney(receivedNum) : firstSplitAmount,
          change:
            method === "efectivo" ? roundMoney(firstCashChange) : 0,
        },
        {
          method: secondMethod,
          amount: secondSplitAmount,
          received:
            secondMethod === "efectivo"
              ? roundMoney(secondReceivedNum)
              : secondSplitAmount,
          change:
            secondMethod === "efectivo" ? roundMoney(secondCashChange) : 0,
        },
      ];

      onConfirm({
        method: "mixto",
        parts,
        received: roundMoney(parts.reduce((sum, part) => sum + part.received, 0)),
        change: roundMoney(parts.reduce((sum, part) => sum + part.change, 0)),
      });
      return;
    }

    if (method === "cuenta") {
      onConfirm({
        method,
        received: 0,
        receivable: {
          clienteNombre: clienteNombre.trim(),
          clienteTelefono: clienteTelefono.trim(),
          fechaOrigen,
          vencimiento: vencimiento || null,
          notas: notas.trim(),
        },
      });

      return;
    }

    onConfirm({
      method,
      received: method === "efectivo" ? receivedNum : total,
    });
  };

  function selectPrimaryMethod(nextMethod) {
    setMethod(nextMethod);
    setReceivedTouched(false);

    if (nextMethod === "cuenta") {
      setSplitEnabled(false);
      setSplitAmount("");
      setSecondReceived("");
      setSecondReceivedTouched(false);
      return;
    }

    if (nextMethod === secondMethod) {
      const alternative = SPLIT_METHODS.find((item) => item.id !== nextMethod);
      if (alternative) {
        setSecondMethod(alternative.id);
        setSecondReceived("");
        setSecondReceivedTouched(false);
      }
    }
  }

  function toggleSplitPayment() {
    if (method === "cuenta") return;

    setSplitEnabled((current) => {
      const next = !current;
      if (next) {
        setSplitAmount(String(roundMoney(total / 2)));
        setReceived("");
        setReceivedTouched(false);
        setSecondReceived("");
        setSecondReceivedTouched(false);
      } else {
        setSplitAmount("");
        setReceived("");
        setReceivedTouched(false);
        setSecondReceived("");
        setSecondReceivedTouched(false);
      }
      return next;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Finalizar venta"
    >
      <div
        aria-busy={processing}
        className={processing ? "pointer-events-none select-none" : ""}
      >
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
                  {method === "cuenta"
                    ? "Total de la venta"
                    : "Total a cobrar"}
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
            Forma de cobro
          </label>

          <div
            data-modal-horizontal-group="true"
            className="grid grid-cols-2 gap-2.5"
          >
            {METHODS.map((item) => {
              const activo = method === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  data-modal-horizontal-item="true"
                  onClick={() => selectPrimaryMethod(item.id)}
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
                      ${item.id === "cuenta" ? "col-span-2" : ""}
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

        {method !== "cuenta" && (
          <div className="mb-4">
            <button
              type="button"
              onClick={toggleSplitPayment}
              className={
                `w-full rounded-2xl border px-4 py-3 text-sm font-extrabold transition active:scale-[0.99] ` +
                (splitEnabled
                  ? "border-[#FFC61A]/50 bg-[#FFC61A]/12 text-[#FFC61A]"
                  : "border-white/10 bg-[#151A22] text-white/65 hover:border-white/20")
              }
            >
              {splitEnabled ? "✓ Cobro dividido en 2 medios" : "+ Cobrar con 2 medios de pago"}
            </button>
          </div>
        )}

        {splitEnabled && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-[22px] border border-[#FFC61A]/20 bg-[#151A22] p-3.5"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-extrabold text-white">Pago combinado</p>
                <p className="mt-0.5 text-[11px] text-white/40">Ingresá cuánto se paga con el primer medio. El resto se calcula solo.</p>
              </div>
              <span className="shrink-0 rounded-xl bg-[#FFC61A]/10 px-2.5 py-1.5 text-[10px] font-black text-[#FFC61A]">2 medios</span>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-white/55">
                {selectedMethod.label} · importe
              </span>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-black text-[#FFC61A]">$</span>
                <input
                  type="number"
                  data-modal-autofocus="true"
                  min="0.01"
                  max={Math.max(0, total - 0.01)}
                  step="0.01"
                  inputMode="decimal"
                  value={splitAmount}
                  onChange={(event) => setSplitAmount(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#171B23] py-3.5 pl-9 pr-4 text-base font-black text-white outline-none transition focus:border-[#FFC61A] focus:ring-2 focus:ring-[#FFC61A]/10"
                />
              </div>
            </label>

            <div className="mt-3">
              <span className="mb-1.5 block text-xs font-bold text-white/55">Segundo medio</span>
              <div
                data-modal-horizontal-group="true"
                className="grid grid-cols-2 gap-2"
              >
                {SPLIT_METHODS.filter((item) => item.id !== method).map((item) => {
                  const Icon = item.icon;
                  const active = secondMethod === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-modal-horizontal-item="true"
                      onClick={() => {
                        setSecondMethod(item.id);
                        setSecondReceived("");
                        setSecondReceivedTouched(false);
                      }}
                      className={
                        `flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-extrabold transition ` +
                        (active
                          ? "border-[#FFC61A] bg-[#FFC61A] text-black"
                          : "border-white/10 bg-[#171B23] text-white/65 hover:border-white/20")
                      }
                    >
                      <Icon className="h-4 w-4" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3.5 py-3">
              <span className="text-xs font-bold text-white/50">Resto con {METHODS.find((item) => item.id === secondMethod)?.label || "Segundo medio"}</span>
              <span className="text-base font-black text-[#FFC61A]">{money(secondSplitAmount)}</span>
            </div>

            {method === "efectivo" && (
              <label className="mt-3 block">
                <span className="mb-1.5 block text-xs font-bold text-white/55">Efectivo recibido · primer medio</span>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={received}
                  onChange={(event) => {
                    setReceivedTouched(true);
                    setReceived(event.target.value);
                  }}
                  placeholder={String(firstSplitAmount)}
                  className="w-full rounded-2xl border border-white/10 bg-[#171B23] px-4 py-3.5 text-sm font-black text-white outline-none focus:border-[#FFC61A]"
                />
                {Number.isFinite(receivedNum) && (
                  <span className={`mt-1.5 block text-xs font-bold ${firstCashChange < 0 ? "text-red-400" : "text-emerald-400"}`}>
                    {firstCashChange < 0 ? `Falta ${money(Math.abs(firstCashChange))}` : `Vuelto ${money(firstCashChange)}`}
                  </span>
                )}
              </label>
            )}

            {secondMethod === "efectivo" && (
              <label className="mt-3 block">
                <span className="mb-1.5 block text-xs font-bold text-white/55">Efectivo recibido · segundo medio</span>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={secondReceived}
                  onChange={(event) => {
                    setSecondReceivedTouched(true);
                    setSecondReceived(event.target.value);
                  }}
                  placeholder={String(secondSplitAmount)}
                  className="w-full rounded-2xl border border-white/10 bg-[#171B23] px-4 py-3.5 text-sm font-black text-white outline-none focus:border-[#FFC61A]"
                />
                {Number.isFinite(secondReceivedNum) && (
                  <span className={`mt-1.5 block text-xs font-bold ${secondCashChange < 0 ? "text-red-400" : "text-emerald-400"}`}>
                    {secondCashChange < 0 ? `Falta ${money(Math.abs(secondCashChange))}` : `Vuelto ${money(secondCashChange)}`}
                  </span>
                )}
              </label>
            )}

            {(!Number.isFinite(rawSplitAmount) || firstSplitAmount <= 0 || secondSplitAmount <= 0) && (
              <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
                El importe del primer medio debe ser mayor a $0 y menor al total.
              </p>
            )}
          </motion.div>
        )}

        {/* =================================================
            EFECTIVO
        ================================================= */}

        {!splitEnabled && method === "efectivo" && (
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
                data-modal-autofocus="true"
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
            VENTA A CUENTA
        ================================================= */}

        {!splitEnabled && method === "cuenta" && (
          <motion.div
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
              overflow-hidden
              rounded-[22px]
              border
              border-[#FFC61A]/20
              bg-[#151A22]
              p-3.5
            "
          >
            <div className="flex items-start gap-3">
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
                <DebtIcon className="h-[18px] w-[18px]" />
              </div>

              <div className="min-w-0">
                <p className="text-sm font-extrabold text-white">
                  Venta a cuenta
                </p>

                <p className="mt-1 text-xs leading-relaxed text-white/40">
                  No ingresa dinero a caja. Se generará automáticamente una cuenta por cobrar por {money(total)}.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-white/55">
                  Cliente <span className="text-[#FFC61A]">*</span>
                </span>

                <input
                  type="text"
                  autoFocus
                  autoComplete="off"
                  maxLength={120}
                  value={clienteNombre}
                  onChange={(event) =>
                    setClienteNombre(event.target.value)
                  }
                  placeholder="Ej. Juan Pérez"
                  className="
                    w-full
                    rounded-2xl
                    border
                    border-white/10
                    bg-[#171B23]
                    px-4
                    py-3.5
                    text-sm
                    font-semibold
                    text-white
                    outline-none
                    transition
                    placeholder:text-white/25
                    focus:border-[#FFC61A]/40
                    focus:ring-2
                    focus:ring-[#FFC61A]/10
                  "
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-white/55">
                  Teléfono
                </span>

                <input
                  type="tel"
                  autoComplete="off"
                  maxLength={50}
                  value={clienteTelefono}
                  onChange={(event) =>
                    setClienteTelefono(event.target.value)
                  }
                  placeholder="Opcional"
                  className="
                    w-full
                    rounded-2xl
                    border
                    border-white/10
                    bg-[#171B23]
                    px-4
                    py-3.5
                    text-sm
                    font-semibold
                    text-white
                    outline-none
                    transition
                    placeholder:text-white/25
                    focus:border-[#FFC61A]/40
                    focus:ring-2
                    focus:ring-[#FFC61A]/10
                  "
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-white/55">
                  Vencimiento
                </span>

                <input
                  type="date"
                  min={fechaOrigen}
                  value={vencimiento}
                  onChange={(event) =>
                    setVencimiento(event.target.value)
                  }
                  className="
                    w-full
                    rounded-2xl
                    border
                    border-white/10
                    bg-[#171B23]
                    px-4
                    py-3.5
                    text-sm
                    font-semibold
                    text-white
                    outline-none
                    transition
                    focus:border-[#FFC61A]/40
                    focus:ring-2
                    focus:ring-[#FFC61A]/10
                  "
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-white/55">
                  Notas
                </span>

                <textarea
                  rows="2"
                  maxLength={1000}
                  value={notas}
                  onChange={(event) =>
                    setNotas(event.target.value)
                  }
                  placeholder="Opcional"
                  className="
                    w-full
                    resize-none
                    rounded-2xl
                    border
                    border-white/10
                    bg-[#171B23]
                    px-4
                    py-3.5
                    text-sm
                    font-semibold
                    text-white
                    outline-none
                    transition
                    placeholder:text-white/25
                    focus:border-[#FFC61A]/40
                    focus:ring-2
                    focus:ring-[#FFC61A]/10
                  "
                />
              </label>
            </div>

            {vencimiento && vencimiento < fechaOrigen && (
              <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-200">
                El vencimiento no puede ser anterior a hoy.
              </p>
            )}
          </motion.div>
        )}

        {/* =================================================
            RESUMEN MÉTODO NO EFECTIVO
        ================================================= */}

        {!splitEnabled && method !== "efectivo" && method !== "cuenta" && (
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
          data-modal-primary="true"
          disabled={!canConfirm || processing}
          aria-busy={processing}
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
          {processing ? (
            <LoadingIcon className="h-4 w-4 animate-spin" />
          ) : (
            <CheckIcon className="h-4 w-4" />
          )}
          {processing
            ? "Registrando venta..."
            : splitEnabled
              ? `Confirmar pago combinado · ${money(total)}`
              : method === "cuenta"
                ? `Registrar a cuenta · ${money(total)}`
                : `Confirmar cobro · ${money(total)}`}
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
      data-modal-skip-nav="true"
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

function DebtIcon({ className = "" }) {
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
      <path d="M5 4h14v16H5z" />
      <path d="M8 8h8" />
      <path d="M8 12h5" />
      <path d="M8 16h3" />
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

function LoadingIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 3a9 9 0 1 0 9 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
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