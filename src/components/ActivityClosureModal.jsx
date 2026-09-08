import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Modal from "./Modal";
import {
  money,
  uid,
} from "../lib/format";
import {
  downloadActivityClosurePdf,
} from "../lib/pdf";

function toNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function parseMoneyInput(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/\s+/g, "");

  if (!raw) {
    return Number.NaN;
  }

  let normalized = raw;

  if (raw.includes(",") && raw.includes(".")) {
    normalized = raw
      .replace(/\./g, "")
      .replace(",", ".");
  } else if (raw.includes(",")) {
    normalized = raw.replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, "");
  }

  const number = Number(normalized);

  return Number.isFinite(number)
    ? Math.round((number + Number.EPSILON) * 100) / 100
    : Number.NaN;
}

function formatActivityNumber(value) {
  return String(
    Math.max(
      1,
      Math.trunc(
        toNumber(value, 1)
      )
    )
  ).padStart(3, "0");
}

function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Sin fecha";
  }

  return date.toLocaleString(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function formatPercent(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return `${number.toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }
  )}%`;
}

function formatQuantity(value) {
  return Math.max(
    0,
    toNumber(value)
  ).toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }
  );
}

function Stat({
  label,
  value,
  highlight = false,
  danger = false,
}) {
  return (
    <div
      className={
        "rounded-2xl border p-3 " +
        (danger
          ? "border-red-400/20 bg-red-400/[0.07]"
          : highlight
            ? "border-[#FFC61A]/25 bg-[#FFC61A]/[0.08]"
            : "border-white/10 bg-white/[0.035]")
      }
    >
      <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-white/35">
        {label}
      </p>
      <strong
        className={
          "mt-1 block text-sm font-black " +
          (danger
            ? "text-red-300"
            : highlight
              ? "text-[#FFC61A]"
              : "text-white/85")
        }
      >
        {value}
      </strong>
    </div>
  );
}

function FlowCard({
  title,
  data,
  accent = false,
}) {
  const conversions =
    toNumber(data?.conversions);

  return (
    <div
      className={
        "rounded-[20px] border p-3.5 " +
        (accent
          ? "border-[#FFC61A]/20 bg-[#FFC61A]/[0.06]"
          : "border-white/10 bg-white/[0.025]")
      }
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black text-white/85">
          {title}
        </p>
        <strong
          className={
            "text-sm font-black " +
            (toNumber(data?.net) >= 0
              ? "text-emerald-300"
              : "text-red-300")
          }
        >
          {money(data?.net)}
        </strong>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
        <span className="text-white/35">
          Ingresos
        </span>
        <strong className="text-right text-white/70">
          {money(data?.income)}
        </strong>

        <span className="text-white/35">
          Egresos
        </span>
        <strong className="text-right text-white/70">
          {money(data?.expenses)}
        </strong>

        <span className="text-white/35">
          Conversiones
        </span>
        <strong className="text-right text-white/70">
          {conversions > 0
            ? `+${money(conversions)}`
            : money(conversions)}
        </strong>

        <span className="font-bold text-white/45">
          Movimiento neto
        </span>
        <strong className="text-right text-white/90">
          {money(data?.net)}
        </strong>
      </div>
    </div>
  );
}

function ReconciliationBalanceCard({
  title,
  expected,
  inputValue,
  onChange,
  actual,
  difference,
  closed = false,
}) {
  const validDifference =
    Number.isFinite(difference);
  const isMissing =
    validDifference && difference < -0.009;
  const isSurplus =
    validDifference && difference > 0.009;

  return (
    <div className="rounded-[20px] border border-white/10 bg-black/10 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-white/85">
            {title}
          </p>
          <p className="mt-1 text-[9px] text-white/30">
            Esperado por sistema {money(expected)}
          </p>
        </div>
        {closed && (
          <strong className="text-sm font-black text-white/85">
            {money(actual)}
          </strong>
        )}
      </div>

      {!closed && (
        <label className="mt-3 block">
          <span className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-white/35">
            Saldo real
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={inputValue}
            onChange={(event) =>
              onChange(event.target.value)
            }
            placeholder="0,00"
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-white outline-none transition placeholder:text-white/20 focus:border-[#FFC61A]/45"
          />
        </label>
      )}

      <div
        className={
          "mt-3 rounded-xl border px-3 py-2 text-[10px] font-extrabold " +
          (!validDifference
            ? "border-white/10 bg-white/[0.025] text-white/35"
            : isMissing
              ? "border-red-400/20 bg-red-400/[0.07] text-red-200"
              : isSurplus
                ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200"
                : "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200")
        }
      >
        {!validDifference
          ? "Ingresá el saldo real"
          : isMissing
            ? `Faltante ${money(Math.abs(difference))}`
            : isSurplus
              ? `Sobrante ${money(difference)}`
              : "Sin diferencia"}
      </div>
    </div>
  );
}

function Notice({
  children,
  danger = false,
}) {
  return (
    <div
      className={
        "rounded-2xl border px-3 py-2.5 text-[10px] leading-relaxed " +
        (danger
          ? "border-red-400/20 bg-red-400/[0.08] text-red-200/80"
          : "border-amber-300/15 bg-amber-300/[0.06] text-amber-100/65")
      }
    >
      {children}
    </div>
  );
}

export default function ActivityClosureModal({
  open,
  onClose,
  pos,
  onClosed,
}) {
  const [preview, setPreview] =
    useState(null);
  const [loading, setLoading] =
    useState(false);
  const [closing, setClosing] =
    useState(false);
  const [confirmed, setConfirmed] =
    useState(false);
  const [showRestock, setShowRestock] =
    useState(false);
  const [showReceivables, setShowReceivables] =
    useState(true);
  const [closeRequestId, setCloseRequestId] =
    useState("");
  const [closedClosure, setClosedClosure] =
    useState(null);
  const [pdfDownloaded, setPdfDownloaded] =
    useState(false);
  const [actualCashInput, setActualCashInput] =
    useState("");
  const [actualTransferInput, setActualTransferInput] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    if (!open) {
      setPreview(null);
      setLoading(false);
      setClosing(false);
      setConfirmed(false);
      setShowRestock(false);
      setShowReceivables(true);
      setCloseRequestId("");
      setClosedClosure(null);
      setPdfDownloaded(false);
      setActualCashInput("");
      setActualTransferInput("");
      return undefined;
    }

    const requestId = uid();
    setCloseRequestId(requestId);
    setLoading(true);
    setConfirmed(false);
    setShowRestock(false);
    setShowReceivables(true);
    setClosedClosure(null);
    setPdfDownloaded(false);
    setActualCashInput("");
    setActualTransferInput("");

    Promise.resolve(
      pos?.previewActivityClosure?.()
    )
      .then((result) => {
        if (!cancelled) {
          setPreview(result || null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    pos?.previewActivityClosure,
  ]);

  const blockers =
    Array.isArray(
      preview?.blockingReasons
    )
      ? preview.blockingReasons
      : [];
  const warnings =
    Array.isArray(preview?.warnings)
      ? preview.warnings
      : [];
  const pendingItems =
    Array.isArray(
      preview?.pendingRestock?.items
    )
      ? preview.pendingRestock.items
      : [];
  const pendingReceivableItems =
    Array.isArray(
      preview?.receivables?.items
    )
      ? preview.receivables.items
      : [];
  const activityNumber =
    formatActivityNumber(
      preview?.activity?.sequence
    );
  const nextActivityNumber =
    formatActivityNumber(
      toNumber(
        preview?.activity?.sequence,
        1
      ) + 1
    );
  const cashDifference =
    toNumber(
      preview?.reconciliation
        ?.cashSessions
        ?.difference
    );
  const expectedCash = toNumber(
    preview?.reconciliation
      ?.methods?.efectivo?.balance
  );
  const expectedTransfer = toNumber(
    preview?.reconciliation
      ?.methods?.transferencia?.balance
  );
  const storedCashActual =
    preview?.reconciliation
      ?.declaredBalances?.efectivo
      ?.actual;
  const storedTransferActual =
    preview?.reconciliation
      ?.declaredBalances
      ?.transferencia?.actual;
  const actualCash = closedClosure
    ? toNumber(storedCashActual)
    : parseMoneyInput(actualCashInput);
  const actualTransfer = closedClosure
    ? toNumber(storedTransferActual)
    : parseMoneyInput(actualTransferInput);
  const actualBalancesValid =
    Number.isFinite(actualCash) &&
    actualCash >= 0 &&
    Number.isFinite(actualTransfer) &&
    actualTransfer >= 0;
  const cashFinalDifference =
    actualBalancesValid
      ? Math.round(
          (actualCash - expectedCash + Number.EPSILON) * 100
        ) / 100
      : Number.NaN;
  const transferFinalDifference =
    actualBalancesValid
      ? Math.round(
          (actualTransfer - expectedTransfer + Number.EPSILON) * 100
        ) / 100
      : Number.NaN;
  const canClose = Boolean(
    preview &&
    !closedClosure &&
    blockers.length === 0 &&
    actualBalancesValid &&
    confirmed &&
    !closing
  );

  const carrySummary = useMemo(
    () => [
      {
        label: "Fondo inicial próxima actividad",
        value: money(
          preview?.funds
            ?.replacementFund
        ),
      },
      {
        label: "Capital pendiente de recuperar",
        value: money(
          Math.max(
            0,
            toNumber(
              preview?.funds
                ?.pendingRecovery
            )
          )
        ),
      },
      {
        label: `Deudas por cobrar que continúan (${Math.max(
          0,
          Math.trunc(
            toNumber(
              preview?.receivables
                ?.pendingCount
            )
          )
        )})`,
        value: money(
          preview?.receivables
            ?.pendingAmount
        ),
      },
      {
        label: "Cuentas por pagar",
        value: money(
          preview?.payables
            ?.pendingAmount
        ),
      },
    ],
    [preview]
  );

  function downloadClosurePdf(
    closureData = closedClosure
  ) {
    if (!closureData) {
      return false;
    }

    try {
      downloadActivityClosurePdf({
        closure: closureData,
        shopName:
          pos?.shopName ||
          "Full Bebidas",
      });
      setPdfDownloaded(true);
      return true;
    } catch (error) {
      console.error(
        "Error descargando cierre de actividad en PDF:",
        error
      );
      pos?.showToast?.(
        "No se pudo generar el PDF del cierre",
        true
      );
      return false;
    }
  }

  async function refreshPreview() {
    if (loading || closing) {
      return;
    }

    setLoading(true);
    setConfirmed(false);

    try {
      const result =
        await pos?.previewActivityClosure?.();
      setPreview(result || null);
    } finally {
      setLoading(false);
    }
  }

  async function submitClose() {
    if (
      !canClose ||
      !preview?.activity?.id ||
      !closeRequestId
    ) {
      return;
    }

    setClosing(true);

    try {
      const result =
        await pos?.closeActivity?.(
          preview.activity.id,
          closeRequestId,
          {
            efectivo: actualCash,
            transferencia: actualTransfer,
          }
        );

      if (result) {
        const finalClosure =
          result?.closure &&
          typeof result.closure ===
            "object"
            ? result.closure
            : preview;

        setPreview(finalClosure);
        setClosedClosure(finalClosure);
        setConfirmed(false);
        onClosed?.(result);

        if (finalClosure) {
          try {
            downloadActivityClosurePdf({
              closure: finalClosure,
              shopName:
                pos?.shopName ||
                "Full Bebidas",
            });
            setPdfDownloaded(true);
          } catch (error) {
            console.error(
              "No se pudo descargar automáticamente el PDF del cierre:",
              error
            );
            pos?.showToast?.(
              "Actividad cerrada. Podés descargar el PDF manualmente.",
              false
            );
          }
        }
      }
    } finally {
      setClosing(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={
        closing ? undefined : onClose
      }
      title="Cierre de actividad"
    >
      {loading && !preview ? (
        <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-8 text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-[#FFC61A]" />
          <p className="mt-3 text-xs font-bold text-white/45">
            Preparando conciliación...
          </p>
        </div>
      ) : !preview ? (
        <div className="rounded-[22px] border border-red-400/15 bg-red-400/[0.06] p-4 text-center">
          <p className="text-sm font-black text-red-200">
            No se pudo preparar el cierre.
          </p>
          <button
            type="button"
            onClick={refreshPreview}
            className="mt-3 rounded-xl bg-[#FFC61A] px-4 py-2.5 text-xs font-extrabold text-black"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {closedClosure && (
            <div className="rounded-[22px] border border-emerald-400/20 bg-emerald-400/[0.07] p-3.5">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-emerald-300">
                Actividad cerrada correctamente
              </p>
              <p className="mt-1 text-xs font-black text-white/85">
                El snapshot definitivo quedó guardado.
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                {pdfDownloaded
                  ? "El PDF del cierre fue generado. Podés descargarlo nuevamente cuando quieras antes de salir."
                  : "Descargá el PDF del cierre antes de salir."}
              </p>
            </div>
          )}
          <div className="rounded-[22px] border border-[#FFC61A]/20 bg-[#FFC61A]/[0.06] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#FFC61A]">
                  Actividad #{activityNumber}
                </p>
                <h3 className="mt-1 text-base font-black text-white">
                  Resumen final y conciliación
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                  {formatDate(
                    preview.activity
                      ?.financialStartAt
                  )}
                  {" → "}
                  {formatDate(
                    preview.activity
                      ?.closedAt ||
                    preview.activity
                      ?.closingPreviewAt
                  )}
                </p>
              </div>

              {!closedClosure && (
                <button
                  type="button"
                  onClick={refreshPreview}
                  disabled={loading || closing}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-extrabold text-white/55 disabled:opacity-40"
                >
                  {loading
                    ? "Actualizando..."
                    : "Actualizar"}
                </button>
              )}
            </div>
          </div>

          {blockers.map((item) => (
            <Notice
              key={item.code}
              danger
            >
              {item.message}
            </Notice>
          ))}

          {warnings.map((item) => (
            <Notice key={item.code}>
              {item.message}
            </Notice>
          ))}

          <div className="rounded-[22px] border border-white/10 bg-white/[0.025] p-3.5">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-white/35">
              Resultado económico
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat
                label="Ventas"
                value={money(
                  preview.sales?.revenue
                )}
              />
              <Stat
                label="Costo mercadería"
                value={money(
                  preview.sales?.cost
                )}
              />
              <Stat
                label="Ganancia bruta"
                value={money(
                  preview.sales
                    ?.grossProfit
                )}
                highlight
              />
              <Stat
                label="Otros costos"
                value={money(
                  preview.funds
                    ?.otherCosts
                )}
              />
              <Stat
                label="Ganancia disponible"
                value={money(
                  preview.funds
                    ?.availableProfit
                )}
                highlight
              />
              <Stat
                label="Fondo reposición"
                value={money(
                  preview.funds
                    ?.replacementFund
                )}
                highlight
              />
              <Stat
                label="Capital recuperado"
                value={money(
                  preview.funds
                    ?.capitalRecovered ??
                  preview.funds
                    ?.recoveredCost
                )}
              />
              <Stat
                label="Pendiente de recuperar"
                value={money(
                  Math.max(
                    0,
                    toNumber(
                      preview.funds
                        ?.pendingRecovery
                    )
                  )
                )}
              />
            </div>

            {toNumber(
              preview.funds
                ?.unreplacedMerchandise
            ) > 0 && (
              <div className="mt-2">
                <Stat
                  label="Mercadería no repuesta"
                  value={money(
                    preview.funds
                      ?.unreplacedMerchandise
                  )}
                  danger
                />
              </div>
            )}

            {toNumber(
              preview.funds
                ?.externalDeficit
            ) > 0 && (
              <div className="mt-2">
                <Stat
                  label="Déficit / fondos externos"
                  value={money(
                    preview.funds
                      ?.externalDeficit
                  )}
                  danger
                />
              </div>
            )}
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/[0.025] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-white/35">
                  Conciliación financiera
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                  Ingresos, egresos y conversiones registrados durante la actividad.
                </p>
              </div>

              <span
                className={
                  "shrink-0 rounded-xl border px-2.5 py-1.5 text-[9px] font-extrabold " +
                  (Math.abs(
                    cashDifference
                  ) < 0.01
                    ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300"
                    : "border-amber-300/20 bg-amber-300/[0.07] text-amber-200")
                }
              >
                Diferencia cajas {money(
                  cashDifference
                )}
              </span>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <FlowCard
                title="Efectivo"
                data={
                  preview.reconciliation
                    ?.methods?.efectivo
                }
                accent
              />
              <FlowCard
                title="Transferencia"
                data={
                  preview.reconciliation
                    ?.methods
                    ?.transferencia
                }
              />
            </div>

            <div className="mt-3">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-[#FFC61A]">
                Saldo real al cierre
              </p>
              <p className="mt-1 text-[9px] leading-relaxed text-white/30">
                Ingresá cuánto dinero existe realmente. La diferencia queda guardada como conciliación y no modifica la ganancia.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <ReconciliationBalanceCard
                  title="Efectivo real"
                  expected={expectedCash}
                  inputValue={actualCashInput}
                  onChange={setActualCashInput}
                  actual={actualCash}
                  difference={cashFinalDifference}
                  closed={Boolean(closedClosure)}
                />
                <ReconciliationBalanceCard
                  title="Transferencia real"
                  expected={expectedTransfer}
                  inputValue={actualTransferInput}
                  onChange={setActualTransferInput}
                  actual={actualTransfer}
                  difference={transferFinalDifference}
                  closed={Boolean(closedClosure)}
                />
              </div>
            </div>

            {(Math.abs(
              toNumber(
                preview.reconciliation
                  ?.methods?.qr?.net
              )
            ) > 0.009 ||
              Math.abs(
                toNumber(
                  preview.reconciliation
                    ?.methods?.tarjeta
                    ?.net
                )
              ) > 0.009) && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Stat
                  label="Movimiento QR"
                  value={money(
                    preview.reconciliation
                      ?.methods?.qr?.net
                  )}
                />
                <Stat
                  label="Movimiento tarjeta"
                  value={money(
                    preview.reconciliation
                      ?.methods?.tarjeta
                      ?.net
                  )}
                />
              </div>
            )}

            <p className="mt-3 text-[9px] leading-relaxed text-white/25">
              El saldo real de transferencia debe coincidir con el importe disponible que verificás en la cuenta utilizada por el negocio. Faltantes o sobrantes se registran aparte de la rentabilidad.
            </p>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/[0.025] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-white/35">
                  Saldos pendientes
                </p>
                <p className="mt-1 text-[9px] leading-relaxed text-white/25">
                  Estas deudas siguen abiertas y pasan a la próxima actividad sin volver a contabilizar la venta.
                </p>
              </div>

              {pendingReceivableItems.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setShowReceivables(
                      (current) => !current
                    )
                  }
                  className="shrink-0 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[9px] font-extrabold text-white/50"
                >
                  {showReceivables
                    ? "Ocultar deudas"
                    : "Ver deudas"}
                </button>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat
                label="Cuentas por cobrar"
                value={money(
                  preview.receivables
                    ?.pendingAmount
                )}
              />
              <Stat
                label="Cuentas por pagar"
                value={money(
                  preview.payables
                    ?.pendingAmount
                )}
              />
              <Stat
                label="Deuda de mercadería"
                value={money(
                  preview.payables
                    ?.pendingPurchaseAmount
                )}
              />
            </div>

            {pendingReceivableItems.length === 0 ? (
              <p className="mt-3 text-[9px] leading-relaxed text-white/25">
                No hay deudas por cobrar abiertas para trasladar a la próxima actividad.
              </p>
            ) : (
              showReceivables && (
                <div className="mt-3 space-y-2">
                  {pendingReceivableItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-white/10 bg-[#171B23] px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-white/80">
                            {item.clienteNombre || "Cliente"}
                          </p>
                          <p className="mt-1 text-[10px] text-white/35">
                            {item.concepto || "Deuda"}
                            {item.vencimiento
                              ? ` · Vence ${formatDate(item.vencimiento)}`
                              : ""}
                          </p>
                        </div>
                        <strong className="shrink-0 text-sm font-black text-[#FFC61A]">
                          {money(
                            item.saldoPendiente
                          )}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            <p className="mt-3 text-[9px] leading-relaxed text-white/25">
              Cuentas por cobrar y por pagar son saldos nominales. Pendiente de recuperar es capital de costo que aún no volvió mediante cobros reales y nunca se calcula restando directamente las deudas de clientes.
            </p>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/[0.025] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#FFC61A]">
                  Reposición pendiente
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                  Se conserva para la siguiente actividad y no descuenta fondos hasta confirmar la compra.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowRestock(
                    (current) =>
                      !current
                  )
                }
                disabled={
                  pendingItems.length === 0
                }
                className="shrink-0 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[9px] font-extrabold text-white/50 disabled:opacity-35"
              >
                {showRestock
                  ? "Ocultar"
                  : "Ver detalle"}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Productos"
                value={
                  preview.pendingRestock
                    ?.pendingCount || 0
                }
              />
              <Stat
                label="Cantidad total"
                value={formatQuantity(
                  preview.pendingRestock
                    ?.totalQuantity
                )}
              />
              <Stat
                label="Monto estimado"
                value={money(
                  preview.pendingRestock
                    ?.estimatedTotal
                )}
              />
              <Stat
                label="Cobertura"
                value={formatPercent(
                  preview.pendingRestock
                    ?.coverage
                )}
                highlight={
                  toNumber(
                    preview.pendingRestock
                      ?.coverage
                  ) >= 100
                }
              />
            </div>

            {showRestock &&
              pendingItems.length > 0 && (
                <div className="mt-3 space-y-2">
                  {pendingItems.map(
                    (item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-white/10 bg-[#171B23] px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black text-white/80">
                              {item.concepto}
                            </p>
                            <p className="mt-1 text-[10px] text-white/35">
                              Cantidad: {formatQuantity(
                                item.cantidad
                              )}
                              {item.proveedor
                                ? ` · ${item.proveedor}`
                                : ""}
                            </p>
                            {item.conceptoCosto && (
                              <p className="mt-1 text-[9px] text-white/25">
                                {item.conceptoCosto}
                              </p>
                            )}
                          </div>

                          <strong className="shrink-0 text-sm font-black text-[#FFC61A]">
                            {item.hasEstimate
                              ? money(
                                  item.costoEstimado
                                )
                              : "Sin estimar"}
                          </strong>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
          </div>

          <div className="rounded-[22px] border border-[#FFC61A]/20 bg-[#FFC61A]/[0.05] p-3.5">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#FFC61A]">
              Continúa en Actividad #{nextActivityNumber}
            </p>

            <div className="mt-3 space-y-2">
              {carrySummary.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-3 text-[10px]"
                >
                  <span className="text-white/40">
                    {item.label}
                  </span>
                  <strong className="text-white/80">
                    {item.value}
                  </strong>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[9px] leading-relaxed text-white/25">
              La lista de compras y las cuentas pendientes no se borran. El nuevo período empieza sin volver a contabilizar ventas ni ganancias anteriores.
            </p>
          </div>

          {closedClosure ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  downloadClosurePdf()
                }
                className="w-full rounded-2xl bg-[#FFC61A] px-4 py-3.5 text-sm font-extrabold text-black transition hover:bg-[#FFD248]"
              >
                Descargar cierre PDF
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-sm font-extrabold text-white/70 transition hover:bg-white/[0.07]"
              >
                Finalizar
              </button>
            </div>
          ) : (
            <>
              {blockers.length === 0 && !actualBalancesValid && (
                <Notice>
                  Ingresá el efectivo real y el saldo real de transferencia para completar la conciliación final.
                </Notice>
              )}

              {blockers.length === 0 && actualBalancesValid && (
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3.5">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) =>
                      setConfirmed(
                        event.target.checked
                      )
                    }
                    disabled={closing}
                    className="mt-0.5 h-4 w-4 accent-[#FFC61A]"
                  />
                  <span className="text-[10px] leading-relaxed text-white/50">
                    Confirmo que revisé los saldos reales y sus diferencias. El cierre guardará la conciliación definitiva y abrirá automáticamente la Actividad #{nextActivityNumber}.
                  </span>
                </label>
              )}

              <button
                type="button"
                onClick={submitClose}
                disabled={!canClose}
                className="w-full rounded-2xl bg-[#FFC61A] px-4 py-3.5 text-sm font-extrabold text-black transition disabled:cursor-not-allowed disabled:opacity-35"
              >
                {closing
                  ? "Cerrando actividad..."
                  : blockers.length > 0
                    ? "Resolvé los pendientes para cerrar"
                    : !actualBalancesValid
                      ? "Ingresá los saldos reales"
                      : `Cerrar Actividad #${activityNumber}`}
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
