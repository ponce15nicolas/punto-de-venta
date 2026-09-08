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

function formatDate(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function normalizeBalances(value) {
  return {
    efectivo: Math.max(0, roundMoney(value?.efectivo || 0)),
    transferencia: Math.max(
      0,
      roundMoney(value?.transferencia || 0)
    ),
  };
}

export default function FundConversionModal({
  open,
  activeActivity = null,
  isOnline = true,
  onLoadFunds,
  onConvert,
  onClose,
}) {
  const [origen, setOrigen] = useState("efectivo");
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingFunds, setLoadingFunds] = useState(false);
  const [fundData, setFundData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;

    setOrigen("efectivo");
    setImporte("");
    setMotivo("");
    setSaving(false);
    setError("");
    setFundData(null);

    async function loadFunds() {
      if (!activeActivity) {
        setError("No se encontró una actividad activa.");
        return;
      }

      if (!isOnline) {
        setError("Necesitás conexión para consultar los fondos de la actividad.");
        return;
      }

      setLoadingFunds(true);

      try {
        const result = await onLoadFunds?.();

        if (cancelled) return;

        if (!result?.activity?.id) {
          setError("No se pudieron cargar los fondos de la actividad.");
          return;
        }

        setFundData({
          ...result,
          balances: normalizeBalances(result.balances),
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(
            String(
              loadError?.message ||
                "No se pudieron cargar los fondos de la actividad."
            )
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingFunds(false);
        }
      }
    }

    loadFunds();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    activeActivity,
    isOnline,
    onLoadFunds,
  ]);

  const balances = useMemo(
    () => normalizeBalances(fundData?.balances),
    [fundData]
  );

  const destino = origen === "efectivo"
    ? "transferencia"
    : "efectivo";

  const amountNumber = roundMoney(importe);
  const validAmount =
    Number.isFinite(amountNumber) &&
    amountNumber > 0;
  const validReason = motivo.trim().length >= 3;
  const availableOrigin = balances[origen] || 0;
  const insufficientFunds =
    validAmount &&
    amountNumber > availableOrigin + 0.001;

  const canSubmit =
    Boolean(activeActivity) &&
    Boolean(fundData?.activity?.id) &&
    isOnline &&
    !loadingFunds &&
    validAmount &&
    validReason &&
    !insufficientFunds &&
    !saving;

  async function submit(event) {
    event?.preventDefault?.();

    if (!canSubmit) {
      if (!activeActivity) {
        setError("No se encontró una actividad activa.");
      } else if (!isOnline) {
        setError("Necesitás conexión para registrar este movimiento.");
      } else if (loadingFunds || !fundData) {
        setError("Esperá a que se carguen los fondos de la actividad.");
      } else if (insufficientFunds) {
        setError(
          `El importe supera los fondos disponibles en ${
            origen === "efectivo" ? "efectivo" : "transferencia"
          } de la actividad.`
        );
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
        String(
          submitError?.message ||
            "No se pudo registrar la conversión."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  const activitySequence =
    fundData?.activity?.sequence ||
    activeActivity?.sequence ||
    1;
  const activityStart = formatDate(
    fundData?.activity?.financialStartAt ||
    activeActivity?.financialStartAt ||
    activeActivity?.startedAt
  );

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Conversión de fondos"
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.035] p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="block text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#FFC61A]">
                Actividad #{String(activitySequence).padStart(3, "0")}
              </span>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                Convierte fondos acumulados de toda la actividad. No modifica ventas, ganancias ni el efectivo esperado de un turno de caja.
              </p>
            </div>

            {activityStart && (
              <span className="shrink-0 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-1.5 text-[9px] font-extrabold text-white/35">
                Desde {activityStart}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <BalanceCard
            label="Efectivo disponible"
            value={money(balances.efectivo)}
            loading={loadingFunds}
            active={origen === "efectivo"}
          />
          <BalanceCard
            label="Transferencia disponible"
            value={money(balances.transferencia)}
            loading={loadingFunds}
            active={origen === "transferencia"}
          />
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
              disabled={saving || loadingFunds}
              onClick={() => {
                setOrigen("efectivo");
                setError("");
              }}
            />
            <DirectionButton
              active={origen === "transferencia"}
              label="Transferencia"
              target="Efectivo"
              disabled={saving || loadingFunds}
              onClick={() => {
                setOrigen("transferencia");
                setError("");
              }}
            />
          </div>
        </div>

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
              disabled={saving || loadingFunds}
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
            disabled={saving || loadingFunds}
            placeholder="Ej. depósito de efectivo en cuenta"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm font-bold text-white outline-none transition placeholder:text-white/20 focus:border-[#FFC61A]/45 focus:ring-2 focus:ring-[#FFC61A]/10 disabled:opacity-50"
          />
        </label>

        {validAmount && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="block text-xs font-bold text-white/45">
                  {origen === "efectivo" ? "Efectivo" : "Transferencia"} → {destino === "efectivo" ? "Efectivo" : "Transferencia"}
                </span>
                <span className="mt-0.5 block text-[9px] font-semibold text-white/25">
                  Disponible en origen: {money(availableOrigin)}
                </span>
              </div>
              <strong className="text-sm font-black text-white/80">
                {money(amountNumber)}
              </strong>
            </div>
          </div>
        )}

        {!activeActivity && (
          <Notice text="No hay una actividad activa disponible para convertir fondos." />
        )}

        {!isOnline && (
          <Notice text="La conversión requiere conexión porque se valida y registra de forma segura en la nube." />
        )}

        {insufficientFunds && (
          <Notice
            text={`El importe supera los fondos disponibles en ${
              origen === "efectivo" ? "efectivo" : "transferencia"
            } de la actividad.`}
            error
          />
        )}

        {error && (
          <Notice text={error} error />
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex w-full items-center justify-center rounded-2xl bg-[#FFC61A] px-4 py-3.5 text-sm font-extrabold text-black transition hover:bg-[#FFD248] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loadingFunds
            ? "Calculando fondos..."
            : saving
              ? "Registrando..."
              : "Confirmar conversión"}
        </button>

        <p className="text-center text-[10px] leading-relaxed text-white/30">
          La conversión queda vinculada a la actividad. Si necesitás corregirla después, registrá la conversión inversa para conservar la trazabilidad.
        </p>
      </form>
    </Modal>
  );
}

function BalanceCard({
  label,
  value,
  loading = false,
  active = false,
}) {
  return (
    <div
      className={
        "rounded-2xl border px-3.5 py-3 transition " +
        (active
          ? "border-[#FFC61A]/25 bg-[#FFC61A]/[0.08]"
          : "border-white/10 bg-white/[0.03]")
      }
    >
      <span className="block text-[9px] font-extrabold uppercase tracking-[0.08em] text-white/35">
        {label}
      </span>
      <strong
        className={
          "mt-1 block text-sm font-black " +
          (active ? "text-[#FFC61A]" : "text-white/75")
        }
      >
        {loading ? "Calculando..." : value}
      </strong>
    </div>
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
      <strong
        className={
          active
            ? "block text-xs font-black text-[#FFC61A]"
            : "block text-xs font-black text-white/70"
        }
      >
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
