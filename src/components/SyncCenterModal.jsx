import { useMemo, useState } from "react";
import Modal from "./Modal";
import { money } from "../lib/format";

const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  qr: "QR",
  tarjeta: "Tarjeta",
  cuenta: "A cuenta",
  mixto: "Pago combinado",
};

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function saleLabel(saleId) {
  const value = String(saleId || "").trim();
  return value ? `Venta · ${value.slice(-8)}` : "Venta offline";
}

export default function SyncCenterModal({
  open,
  onClose,
  pos,
}) {
  const [retrying, setRetrying] = useState(false);
  const [clearing, setClearing] = useState(false);

  const online = pos?.isOnline !== false;
  const state = String(pos?.offlineSyncState || "idle");
  const pending = Math.max(0, Number(pos?.pendingOfflineCount || 0));
  const attention = Math.max(0, Number(pos?.offlineAttentionCount || 0));
  const queueItems = Array.isArray(pos?.offlineQueueItems)
    ? pos.offlineQueueItems
    : [];
  const history = Array.isArray(pos?.offlineSyncHistory)
    ? pos.offlineSyncHistory
    : [];

  const status = useMemo(() => {
    if (!online) {
      return {
        tone: "amber",
        title: "Modo offline activo",
        text: pending > 0
          ? `${pending} ${pending === 1 ? "venta está" : "ventas están"} protegida${pending === 1 ? "" : "s"} en este dispositivo.`
          : "Podés seguir vendiendo. Las nuevas ventas quedarán guardadas localmente.",
      };
    }

    if (state === "syncing") {
      return {
        tone: "blue",
        title: "Sincronizando",
        text: "Estamos confirmando las operaciones pendientes en la nube.",
      };
    }

    if (attention > 0) {
      return {
        tone: "red",
        title: "Revisión necesaria",
        text: "Hay operaciones que no pudieron confirmarse automáticamente. No se eliminaron del dispositivo.",
      };
    }

    if (pending > 0) {
      return {
        tone: "amber",
        title: "Pendientes de sincronización",
        text: "La conexión está disponible. Podés reintentar la confirmación ahora.",
      };
    }

    return {
      tone: "green",
      title: "Todo al día",
      text: "No hay ventas pendientes en este dispositivo.",
    };
  }, [attention, online, pending, state]);

  async function handleRetry() {
    if (!online || retrying) return;
    setRetrying(true);
    try {
      await pos?.retryOfflineSync?.();
    } finally {
      setRetrying(false);
    }
  }

  async function handleClearHistory() {
    if (clearing || history.length === 0) return;

    const confirmed = window.confirm(
      "¿Limpiar el historial local de sincronización? Esto no elimina ventas ni datos guardados en Firebase."
    );

    if (!confirmed) return;

    setClearing(true);
    try {
      await pos?.clearOfflineHistory?.();
    } finally {
      setClearing(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sincronización"
    >
      <div className="pos-sync-center space-y-3.5">
        <section className={`pos-sync-hero pos-sync-hero--${status.tone}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="pos-sync-dot" aria-hidden="true" />
                <strong className="text-sm font-black">{status.title}</strong>
              </div>
              <p className="mt-1.5 text-[11px] font-semibold leading-5 opacity-80">
                {status.text}
              </p>
            </div>

            <span className="pos-sync-online-badge">
              {online ? "Online" : "Offline"}
            </span>
          </div>
        </section>

        <section className="grid grid-cols-3 gap-2">
          <SyncMetric
            label="Pendientes"
            value={pending}
            tone={pending > 0 ? "amber" : "neutral"}
          />
          <SyncMetric
            label="Revisión"
            value={attention}
            tone={attention > 0 ? "red" : "neutral"}
          />
          <SyncMetric
            label="Última sync"
            value={pos?.offlineLastSyncAt ? formatDateTime(pos.offlineLastSyncAt) : "—"}
            small
          />
        </section>

        {(pending > 0 || attention > 0) && (
          <section className="pos-sync-section">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div>
                <span className="pos-sync-eyebrow">Cola local</span>
                <h3 className="mt-0.5 text-sm font-black">Ventas pendientes</h3>
              </div>
              <span className="pos-sync-count">{queueItems.length}</span>
            </div>

            <div className="space-y-2">
              {queueItems.map((item) => (
                <article
                  key={item.id}
                  className={`pos-sync-item ${item.status === "attention" ? "is-attention" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-xs font-black">
                        {saleLabel(item.saleId)}
                      </strong>
                      <span className="mt-1 block text-[10px] font-semibold opacity-55">
                        {formatDateTime(item.createdAt)} · {PAYMENT_LABELS[item.paymentMethod] || "Cobro"}
                      </span>
                    </div>
                    <strong className="shrink-0 text-xs font-black">
                      {money(item.total || 0)}
                    </strong>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.08em]">
                    <span className={`pos-sync-state ${item.status === "attention" ? "is-red" : "is-amber"}`}>
                      {item.status === "attention" ? "Revisión" : "Pendiente"}
                    </span>
                    <span className="opacity-45">
                      {item.itemCount} {item.itemCount === 1 ? "producto" : "productos"}
                    </span>
                    {item.attempts > 0 && (
                      <span className="opacity-45">
                        {item.attempts} {item.attempts === 1 ? "intento" : "intentos"}
                      </span>
                    )}
                  </div>

                  {item.status === "attention" && item.lastError && (
                    <p className="pos-sync-error mt-2 text-[10px] font-semibold leading-4">
                      {item.lastError}
                    </p>
                  )}
                </article>
              ))}
            </div>

            <p className="mt-2.5 text-[10px] font-semibold leading-4 opacity-45">
              Las ventas pendientes no se pueden borrar desde este panel.
            </p>
          </section>
        )}

        <section className="pos-sync-section">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div>
              <span className="pos-sync-eyebrow">Este dispositivo</span>
              <h3 className="mt-0.5 text-sm font-black">Historial reciente</h3>
            </div>

            {history.length > 0 && (
              <button
                type="button"
                onClick={handleClearHistory}
                disabled={clearing}
                className="pos-sync-link"
              >
                {clearing ? "Limpiando…" : "Limpiar"}
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="pos-sync-empty">
              Las ventas sincronizadas en modo offline aparecerán acá.
            </div>
          ) : (
            <div className="space-y-2">
              {history.slice(0, 12).map((item) => (
                <article key={item.id} className="pos-sync-history-item">
                  <span className="pos-sync-history-check" aria-hidden="true">✓</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[11px] font-black">
                      {saleLabel(item.saleId)}
                    </strong>
                    <span className="mt-0.5 block text-[9px] font-semibold opacity-50">
                      Sincronizada {formatDateTime(item.createdAt)}
                    </span>
                  </span>
                  <strong className="shrink-0 text-[11px] font-black">
                    {money(item.total || 0)}
                  </strong>
                </article>
              ))}
            </div>
          )}
        </section>

        <button
          type="button"
          onClick={handleRetry}
          disabled={!online || retrying || state === "syncing" || (pending === 0 && attention === 0)}
          className="pos-sync-primary"
        >
          {!online
            ? "Sin conexión"
            : retrying || state === "syncing"
              ? "Sincronizando…"
              : pending === 0 && attention === 0
                ? "Todo sincronizado"
                : "Sincronizar ahora"}
        </button>
      </div>
    </Modal>
  );
}

function SyncMetric({ label, value, tone = "neutral", small = false }) {
  return (
    <div className={`pos-sync-metric pos-sync-metric--${tone}`}>
      <span className="block text-[8px] font-extrabold uppercase tracking-[0.08em] opacity-50">
        {label}
      </span>
      <strong className={`${small ? "text-[10px]" : "text-base"} mt-1 block font-black leading-tight`}>
        {value}
      </strong>
    </div>
  );
}
