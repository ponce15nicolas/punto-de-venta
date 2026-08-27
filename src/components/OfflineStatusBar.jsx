// src/components/OfflineStatusBar.jsx
// Estado visible y persistente de la cola de ventas sin conexión.

export default function OfflineStatusBar({ pos }) {
  const pending = Math.max(0, Number(pos?.pendingOfflineCount || 0));
  const attention = Math.max(0, Number(pos?.offlineAttentionCount || 0));
  const state = String(pos?.offlineSyncState || "idle");
  const online = pos?.isOnline !== false;

  const hidden = online && pending === 0 && attention === 0 && ![
    "syncing",
    "synced",
    "storage-error",
  ].includes(state);

  if (hidden) {
    return null;
  }

  let title = "Sin conexión · Modo offline";
  let message = pending > 0
    ? `${pending} ${pending === 1 ? "venta está" : "ventas están"} guardada${pending === 1 ? "" : "s"} en este dispositivo. Todavía no ${pending === 1 ? "está confirmada" : "están confirmadas"} en la nube.`
    : "Podés seguir vendiendo. Las ventas se guardarán en este dispositivo y se confirmarán en la nube cuando vuelva Internet.";
  let tone = "amber";
  let showRetry = false;

  if (state === "syncing") {
    title = "Conexión restaurada";
    message = pending > 0
      ? `Sincronizando ${pending} ${pending === 1 ? "venta pendiente" : "ventas pendientes"}…`
      : "Sincronizando operaciones…";
    tone = "blue";
  } else if (state === "synced") {
    title = "Todo sincronizado";
    message = "Las ventas pendientes ya fueron confirmadas en la nube.";
    tone = "green";
  } else if (attention > 0) {
    title = "Revisión necesaria";
    message = `${attention} ${attention === 1 ? "venta necesita" : "ventas necesitan"} revisión antes de poder confirmarse en la nube. La venta local no se perdió.`;
    tone = "red";
    showRetry = online;
  } else if (state === "storage-error") {
    title = "No se pudo guardar offline";
    message = "No cierres ni vacíes el ticket. Revisá el almacenamiento del navegador e intentá nuevamente.";
    tone = "red";
    showRetry = online;
  } else if (online && pending > 0) {
    title = "Ventas pendientes";
    message = `${pending} ${pending === 1 ? "venta espera" : "ventas esperan"} confirmación en la nube.`;
    tone = "amber";
    showRetry = true;
  }

  return (
    <div className="relative z-30 mx-auto w-full max-w-[520px] px-3.5 pt-3 sm:px-4">
      <div
        className={`pos-offline-status pos-offline-status--${tone} rounded-[18px] border px-3.5 py-3`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-current" />
              <strong className="text-xs font-black">{title}</strong>
            </div>
            <p className="pos-offline-status__message mt-1 text-[11px] font-semibold leading-5">
              {message}
            </p>
          </div>

          {showRetry && (
            <button
              type="button"
              onClick={() => pos?.retryOfflineSync?.()}
              className="pos-offline-status__retry shrink-0 rounded-xl border px-3 py-2 text-[10px] font-black transition"
            >
              Reintentar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
