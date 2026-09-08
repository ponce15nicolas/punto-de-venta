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

function toNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
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
  const [closeRequestId, setCloseRequestId] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    if (!open) {
      setPreview(null);
      setLoading(false);
      setClosing(false);
      setConfirmed(false);
      setShowRestock(false);
      setCloseRequestId("");
      return undefined;
    }

    const requestId = uid();
    setCloseRequestId(requestId);
    setLoading(true);
    setConfirmed(false);
    setShowRestock(false);

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
  }, [open, pos]);

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
  const canClose = Boolean(
    preview &&
    blockers.length === 0 &&
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
        label: "Costo pendiente de recuperar",
        value: money(
          preview?.receivables
            ?.pendingCostBasisTotal
        ),
      },
      {
        label: "Cuentas por cobrar",
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
          closeRequestId
        );

      if (result) {
        onClosed?.(result);
        onClose?.();
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
                      ?.closingPreviewAt
                  )}
                </p>
              </div>

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
              Transferencia refleja movimientos registrados en el POS. No compara automáticamente el saldo de una cuenta bancaria externa.
            </p>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/[0.025] p-3.5">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-white/35">
              Saldos pendientes
            </p>

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
                label="Costo pendiente recuperar"
                value={money(
                  preview.receivables
                    ?.pendingCostBasisTotal
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

          {blockers.length === 0 && (
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
                Confirmo que revisé la conciliación. El cierre guardará un snapshot definitivo de la actividad y abrirá automáticamente la Actividad #{nextActivityNumber}.
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
                : `Cerrar Actividad #${activityNumber}`}
          </button>
        </div>
      )}
    </Modal>
  );
}
