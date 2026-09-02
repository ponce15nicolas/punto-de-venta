// src/components/FundConversionModal.jsx

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return roundMoney(value).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function getSessionBalances(openSession) {
  if (!openSession) {
    return {
      efectivo: 0,
      transferenciaTurno: 0,
    };
  }

  const paymentTotals = openSession.paymentTotals || {};
  const receivableTotals = openSession.receivablePaymentTotals || {};
  const payableTotals = openSession.payablePaymentTotals || {};
  const conversionTotals = openSession.fundConversionTotals || {};

  return {
    efectivo: roundMoney(
      toNumber(openSession.openAmount) +
      toNumber(paymentTotals.efectivo) +
      toNumber(receivableTotals.efectivo) -
      toNumber(payableTotals.efectivo) +
      toNumber(conversionTotals.efectivo)
    ),
    transferenciaTurno: roundMoney(
      toNumber(paymentTotals.transferencia) +
      toNumber(receivableTotals.transferencia) -
      toNumber(payableTotals.transferencia) +
      toNumber(conversionTotals.transferencia)
    ),
  };
}

export default function FundConversionModal({
  open,
  openSession,
  isOnline = true,
  onConvert,
  onClose,
}) {
  const [origen, setOrigen] = useState("efectivo");
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const balances = useMemo(
    () => getSessionBalances(openSession),
    [openSession]
  );

  const destino = origen === "efectivo"
    ? "transferencia"
    : "efectivo";

  useEffect(() => {
    if (!open) return;

    setOrigen("efectivo");
    setImporte("");
    setMotivo("");
    setSaving(false);
    setError("");
  }, [open]);

  const amountNumber = roundMoney(importe);
  const validAmount = Number.isFinite(amountNumber) && amountNumber > 0;
  const validReason = motivo.trim().length >= 3;
  const insufficientCash =
    origen === "efectivo" &&
    validAmount &&
    amountNumber > balances.efectivo + 0.001;

  const canSubmit =
    Boolean(openSession) &&
    isOnline &&
    validAmount &&
    validReason &&
    !insufficientCash &&
    !saving;

  async function submit(event) {
    event?.preventDefault?.();

    if (!canSubmit) {
      if (!openSession) {
        setError("Abrí una caja antes de registrar una conversión.");
      } else if (!isOnline) {
        setError("Necesitás conexión para registrar este movimiento.");
      } else if (insufficientCash) {
        setError("El importe supera el efectivo esperado disponible en caja.");
      } else {
        setError("Completá el importe y un motivo breve.");
      }
      return;
    }

    setSaving(true);
    setError("");

    try {
      const result = await onConvert?.({
        origen,
        destino,
        importe: amountNumber,
        motivo: motivo.trim(),
      });

      if (!result) {
        setError("No se pudo registrar la conversión.");
        return;
      }

      onClose?.();
    } catch (submitError) {
      setError(
        String(submitError?.message || "No se pudo registrar la conversión.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Conversión de fondos"
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.035] p-3.5">
          <span className="block text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#FFC61A]">
            Movimiento interno
          </span>
          <p className="mt-1 text-xs leading-relaxed text-white/45">
            Cambia la composición de fondos del turno. No modifica ventas ni ganancias.
          </p>
        </div>

        <div>
          <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-white/40">
            Conversión
          </span>

          <div className="grid grid-cols-2 gap-2">
            <DirectionButton
              active={origen === "efectivo"}
              label="Efectivo"
              target="Transferencia"
              disabled={saving}
              onClick={() => {
                setOrigen("efectivo");
                setError("");
              }}
            />
            <DirectionButton
              active={origen === "transferencia"}
              label="Transferencia"
              target="Efectivo"
              disabled={saving}
              onClick={() => {
                setOrigen("transferencia");
                setError("");
              }}
            />
          </div>
        </div>

        {origen === "efectivo" && (
          <div className="rounded-2xl border border-[#FFC61A]/15 bg-[#FFC61A]/[0.06] px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold text-white/40">
                Efectivo esperado disponible
              </span>
              <strong className="text-sm font-black text-[#FFC61A]">
                {money(balances.efectivo)}
              </strong>
            </div>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-white/40">
            Importe
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-[#FFC61A]">
              $
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              autoComplete="off"
              value={importe}
              onChange={(event) => {
                setImporte(event.target.value);
                setError("");
              }}
              disabled={saving}
              placeholder="0"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.045] py-3 pl-8 pr-3 text-base font-black text-white outline-none transition placeholder:text-white/20 focus:border-[#FFC61A]/45 focus:ring-2 focus:ring-[#FFC61A]/10 disabled:opacity-50"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-white/40">
            Motivo
          </span>
          <input
            type="text"
            maxLength={180}
            value={motivo}
            onChange={(event) => {
              setMotivo(event.target.value);
              setError("");
            }}
            disabled={saving}
            placeholder="Ej. depósito o cambio de disponibilidad"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm font-bold text-white outline-none transition placeholder:text-white/20 focus:border-[#FFC61A]/45 focus:ring-2 focus:ring-[#FFC61A]/10 disabled:opacity-50"
          />
        </label>

        {validAmount && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-white/45">
                {origen === "efectivo" ? "Efectivo" : "Transferencia"} → {destino === "efectivo" ? "Efectivo" : "Transferencia"}
              </span>
              <strong className="text-sm font-black text-white/80">
                {money(amountNumber)}
              </strong>
            </div>
          </div>
        )}

        {!openSession && (
          <Notice text="Abrí una caja para poder convertir fondos del turno." />
        )}

        {!isOnline && (
          <Notice text="La conversión requiere conexión porque se registra de forma segura en la nube." />
        )}

        {insufficientCash && (
          <Notice text="El importe supera el efectivo esperado disponible en caja." error />
        )}

        {error && (
          <Notice text={error} error />
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex w-full items-center justify-center rounded-2xl bg-[#FFC61A] px-4 py-3.5 text-sm font-extrabold text-black transition hover:bg-[#FFD248] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Registrando..." : "Confirmar conversión"}
        </button>

        <p className="text-center text-[10px] leading-relaxed text-white/30">
          Si necesitás corregirla después, registrá la conversión inversa para conservar la trazabilidad.
        </p>
      </form>
    </Modal>
  );
}

function DirectionButton({
  active,
  label,
  target,
  disabled = false,
  onClick,
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "rounded-[18px] border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 " +
        (active
          ? "border-[#FFC61A]/45 bg-[#FFC61A]/10"
          : "border-white/10 bg-white/[0.035] hover:border-white/20")
      }
    >
      <strong className={active ? "block text-xs font-black text-[#FFC61A]" : "block text-xs font-black text-white/70"}>
        {label}
      </strong>
      <span className="mt-1 block text-[10px] font-semibold text-white/35">
        → {target}
      </span>
    </button>
  );
}

function Notice({ text, error = false }) {
  return (
    <div
      className={
        "rounded-2xl border px-3.5 py-3 text-[11px] font-semibold leading-relaxed " +
        (error
          ? "border-red-400/20 bg-red-400/[0.07] text-red-200/80"
          : "border-white/10 bg-white/[0.03] text-white/40")
      }
    >
      {text}
    </div>
  );
}
