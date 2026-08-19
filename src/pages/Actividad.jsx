// src/pages/Actividad.jsx

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { motion } from "motion/react";

import {
  subscribeAuditEvents,
} from "../services/pos/auditoriaFirestore";

const ACTIONS = [
  { id: "all", label: "Todo" },
  { id: "apertura-caja", label: "Aperturas" },
  { id: "cierre-caja", label: "Cierres" },
  { id: "venta-realizada", label: "Ventas" },
  { id: "reposicion-stock", label: "Stock" },
  { id: "edicion-producto", label: "Ediciones" },
  { id: "alta-producto", label: "Altas" },
  { id: "eliminacion-producto", label: "Bajas" },
  { id: "eliminacion-cierre-historico", label: "Cierres eliminados" },
];

const ACTION_META = {
  "apertura-caja": {
    title: "Apertura de caja",
    eyebrow: "Caja",
    icon: CashOpenIcon,
  },
  "cierre-caja": {
    title: "Cierre de caja",
    eyebrow: "Caja",
    icon: CashCloseIcon,
  },
  "venta-realizada": {
    title: "Venta realizada",
    eyebrow: "Ventas",
    icon: SaleIcon,
  },
  "reposicion-stock": {
    title: "Reposición de stock",
    eyebrow: "Inventario",
    icon: StockIcon,
  },
  "edicion-producto": {
    title: "Edición de producto",
    eyebrow: "Catálogo",
    icon: EditIcon,
  },
  "alta-producto": {
    title: "Producto agregado",
    eyebrow: "Inventario",
    icon: StockIcon,
  },
  "eliminacion-producto": {
    title: "Producto eliminado",
    eyebrow: "Inventario",
    icon: TrashIcon,
  },
  "eliminacion-cierre-historico": {
    title: "Eliminación de cierre",
    eyebrow: "Historial",
    icon: TrashIcon,
  },
};

export default function Actividad({ clienteId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [operatorFilter, setOperatorFilter] = useState("all");

  useEffect(() => {
    if (!clienteId) {
      setEvents([]);
      setLoading(false);
      setError("No se encontró el cliente activo.");
      return undefined;
    }

    setLoading(true);
    setError("");

    const unsubscribe =
      subscribeAuditEvents(
        clienteId,
        (nextEvents) => {
          setEvents(nextEvents);
          setLoading(false);
        },
        (subscriptionError) => {
          console.error(
            "Error cargando actividad:",
            subscriptionError
          );

          setError(
            "No se pudo cargar la actividad."
          );
          setLoading(false);
        }
      );

    return () => {
      unsubscribe?.();
    };
  }, [clienteId]);

  const operators =
    useMemo(() => {
      const map = new Map();

      for (const event of events) {
        if (!event.operadorId) continue;

        if (!map.has(event.operadorId)) {
          map.set(event.operadorId, {
            id: event.operadorId,
            name: event.operadorNombre || "Operador",
          });
        }
      }

      return [...map.values()].sort((a, b) =>
        a.name.localeCompare(b.name, "es")
      );
    }, [events]);

  const filteredEvents =
    useMemo(
      () =>
        events.filter((event) => {
          const actionOk =
            actionFilter === "all" ||
            event.accion === actionFilter;

          const operatorOk =
            operatorFilter === "all" ||
            event.operadorId === operatorFilter;

          return actionOk && operatorOk;
        }),
      [
        events,
        actionFilter,
        operatorFilter,
      ]
    );

  return (
    <section className="space-y-3">
      <div
        className="
          rounded-[22px] border border-white/10
          bg-[#11151C] p-3.5
          shadow-[0_18px_40px_rgba(0,0,0,0.18)]
          sm:p-4
        "
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p
              className="
                text-[9px] font-extrabold uppercase
                tracking-[0.16em] text-[#FFC61A]
              "
            >
              Control interno
            </p>

            <h2
              className="
                mt-1 text-lg font-black
                tracking-[-0.03em] text-white
              "
            >
              Actividad reciente
            </h2>

            <p className="mt-1 max-w-[360px] text-xs leading-5 text-white/45">
              Revisá quién realizó cambios importantes
              dentro del punto de venta.
            </p>
          </div>

          <div
            className="
              grid h-10 w-10 shrink-0 place-items-center
              rounded-2xl border border-[#FFC61A]/20
              bg-[#FFC61A]/10 text-[#FFC61A]
            "
          >
            <ActivityIcon className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <StatCard label="Eventos cargados" value={events.length} />
          <StatCard label="Operadores" value={operators.length} />
        </div>
      </div>

      <div
        className="
          rounded-[22px] border border-white/10
          bg-[#11151C] p-3 sm:p-3.5
        "
      >
        <div
          className="
            flex gap-2 overflow-x-auto pb-1
            [scrollbar-width:none]
            [&::-webkit-scrollbar]:hidden
          "
        >
          {ACTIONS.map((action) => {
            const active =
              actionFilter === action.id;

            return (
              <button
                key={action.id}
                type="button"
                onClick={() =>
                  setActionFilter(action.id)
                }
                className={
                  `
                    shrink-0 rounded-xl border px-3 py-2
                    text-[10px] font-extrabold uppercase
                    tracking-[0.08em] transition
                  ` +
                  (active
                    ? " border-[#FFC61A]/35 bg-[#FFC61A] text-black"
                    : " border-white/8 bg-white/[0.035] text-white/45 hover:border-white/15 hover:text-white/70")
                }
              >
                {action.label}
              </button>
            );
          })}
        </div>

        <label className="mt-3 block">
          <span
            className="
              mb-1.5 block text-[9px] font-extrabold
              uppercase tracking-[0.12em] text-white/35
            "
          >
            Operador
          </span>

          <select
            value={operatorFilter}
            onChange={(event) =>
              setOperatorFilter(event.target.value)
            }
            className="
              w-full rounded-xl border border-white/10
              bg-[#171B23] px-3 py-2.5 text-sm
              font-bold text-white outline-none transition
              focus:border-[#FFC61A]/45
            "
          >
            <option value="all">
              Todos los operadores
            </option>

            {operators.map((operator) => (
              <option
                key={operator.id}
                value={operator.id}
              >
                {operator.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <LoadingState />}

      {!loading && error && (
        <EmptyState
          title="No se pudo cargar"
          text={error}
        />
      )}

      {!loading &&
        !error &&
        filteredEvents.length === 0 && (
          <EmptyState
            title="Sin actividad"
            text="No hay movimientos para los filtros seleccionados."
          />
        )}

      {!loading &&
        !error &&
        filteredEvents.length > 0 && (
          <div className="space-y-2.5">
            {filteredEvents.map((event) => (
              <ActivityCard
                key={event.id}
                event={event}
              />
            ))}
          </div>
        )}
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div
      className="
        rounded-2xl border border-white/8
        bg-white/[0.035] px-3 py-2.5
      "
    >
      <span
        className="
          block text-[9px] font-extrabold uppercase
          tracking-[0.12em] text-white/35
        "
      >
        {label}
      </span>

      <strong className="mt-0.5 block text-xl font-black text-white">
        {value}
      </strong>
    </div>
  );
}

function ActivityCard({ event }) {
  const meta =
    ACTION_META[event.accion] || {
      title: "Actividad",
      eyebrow: "Sistema",
      icon: ActivityIcon,
    };

  const Icon = meta.icon;
  const details = getEventDetails(event);

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="
        rounded-[20px] border border-white/10
        bg-[#11151C] p-3.5
        shadow-[0_12px_30px_rgba(0,0,0,0.14)]
      "
    >
      <div className="flex items-start gap-3">
        <div
          className="
            grid h-10 w-10 shrink-0 place-items-center
            rounded-2xl border border-[#FFC61A]/15
            bg-[#FFC61A]/10 text-[#FFC61A]
          "
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span
                className="
                  block text-[8px] font-extrabold uppercase
                  tracking-[0.15em] text-[#FFC61A]/75
                "
              >
                {meta.eyebrow}
              </span>

              <h3 className="mt-0.5 truncate text-sm font-black text-white">
                {meta.title}
              </h3>
            </div>

            <time
              className="
                shrink-0 text-right text-[10px]
                font-bold leading-4 text-white/35
              "
            >
              {formatDateTime(event.fecha)}
            </time>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className="
                rounded-lg bg-white/[0.055]
                px-2 py-1 text-[10px] font-extrabold
                text-white/65
              "
            >
              {event.operadorNombre || "Operador"}
            </span>

            {event.operadorRol && (
              <span
                className="
                  rounded-lg border border-white/8
                  px-2 py-1 text-[9px] font-bold uppercase
                  tracking-[0.08em] text-white/35
                "
              >
                {formatRole(event.operadorRol)}
              </span>
            )}
          </div>

          {details.length > 0 && (
            <div className="mt-3 grid gap-1.5">
              {details.map((detail) => (
                <div
                  key={detail.label}
                  className="
                    flex items-start justify-between gap-3
                    rounded-xl bg-white/[0.025]
                    px-2.5 py-2
                  "
                >
                  <span className="text-[10px] font-bold text-white/35">
                    {detail.label}
                  </span>

                  <strong
                    className="
                      max-w-[62%] text-right
                      text-[11px] font-extrabold text-white/75
                    "
                  >
                    {detail.value}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function getEventDetails(event) {
  const d = event.detalle || {};

  switch (event.accion) {
    case "apertura-caja":
      return compactDetails([
        {
          label: "Monto inicial",
          value: formatMoney(d.montoInicial),
        },
      ]);

    case "cierre-caja":
      return compactDetails([
        {
          label: "Efectivo esperado",
          value: formatMoney(d.efectivoEsperado),
        },
        {
          label: "Efectivo contado",
          value: formatMoney(d.efectivoContado),
        },
        {
          label: "Diferencia",
          value: formatSignedMoney(d.diferencia),
        },
        {
          label: "Ventas",
          value: finiteString(d.cantidadVentas),
        },
      ]);

    case "venta-realizada":
      return compactDetails([
        {
          label: "Venta",
          value: d.ventaId,
        },
        {
          label: "Total",
          value: formatMoney(d.total),
        },
        {
          label: "Medio de pago",
          value: d.metodoPago,
        },
        {
          label: "Ítems",
          value: finiteString(d.cantidadItems),
        },
      ]);

    case "reposicion-stock":
      return compactDetails([
        {
          label: "Producto",
          value: d.productoNombre || d.barcode,
        },
        {
          label: "Agregado",
          value: formatStockChange(
            d.cantidadAgregada,
            d.tipoVenta
          ),
        },
        {
          label: "Stock",
          value: formatStockTransition(
            d.stockAnterior,
            d.stockNuevo,
            d.tipoVenta
          ),
        },
      ]);

    case "edicion-producto":
      return compactDetails([
        {
          label: "Producto",
          value:
            d.nombreNuevo ||
            d.nombreAnterior ||
            d.barcodeNuevo ||
            d.barcodeAnterior,
        },
        ...(different(d.precioAnterior, d.precioNuevo)
          ? [{
              label: "Precio",
              value:
                `${formatMoney(d.precioAnterior)} → ${formatMoney(d.precioNuevo)}`,
            }]
          : []),
        ...(different(d.stockAnterior, d.stockNuevo)
          ? [{
              label: "Stock",
              value:
                `${formatNumber(d.stockAnterior)} → ${formatNumber(d.stockNuevo)}`,
            }]
          : []),
        ...(d.barcodeAnterior &&
        d.barcodeNuevo &&
        d.barcodeAnterior !== d.barcodeNuevo
          ? [{
              label: "Código",
              value:
                `${d.barcodeAnterior} → ${d.barcodeNuevo}`,
            }]
          : []),
      ]);

    case "alta-producto":
      return compactDetails([
        {
          label: "Producto",
          value:
            d.productoNombre ||
            d.barcode,
        },
        {
          label: "Código",
          value: d.barcode,
        },
        {
          label: "Precio",
          value:
            d.tipoVenta === "precio-libre"
              ? "Importe libre"
              : formatMoney(d.precio),
        },
        {
          label: "Stock inicial",
          value:
            d.tipoVenta === "precio-libre"
              ? "Sin control"
              : formatStockValue(
                  d.stock,
                  d.tipoVenta
                ),
        },
      ]);

    case "eliminacion-producto":
      return compactDetails([
        {
          label: "Producto",
          value:
            d.productoNombre ||
            d.barcode,
        },
        {
          label: "Código",
          value: d.barcode,
        },
        {
          label: "Stock al eliminar",
          value:
            d.tipoVenta === "precio-libre"
              ? "Sin control"
              : formatStockValue(
                  d.stock,
                  d.tipoVenta
                ),
        },
      ]);

    case "eliminacion-cierre-historico":
      return compactDetails([
        {
          label: "Caja eliminada",
          value: d.cajaId,
        },
        {
          label: "Ventas eliminadas",
          value: finiteString(d.ventasEliminadas),
        },
      ]);

    default:
      return [];
  }
}

function compactDetails(details) {
  return details.filter(
    (detail) =>
      detail.value !== null &&
      detail.value !== undefined &&
      detail.value !== ""
  );
}

function different(a, b) {
  if (
    a === undefined ||
    b === undefined
  ) {
    return false;
  }

  return String(a) !== String(b);
}

function finiteString(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? String(number)
    : null;
}

function formatDateTime(value) {
  if (
    !value ||
    Number.isNaN(value.getTime?.())
  ) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(value);
}

function formatMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return new Intl.NumberFormat(
    "es-AR",
    {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 2,
    }
  ).format(number);
}

function formatSignedMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  const formatted =
    formatMoney(Math.abs(number));

  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return formatted;
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return new Intl.NumberFormat(
    "es-AR",
    {
      maximumFractionDigits: 3,
    }
  ).format(number);
}

function formatStockValue(value, tipoVenta) {
  const formatted = formatNumber(value);

  if (!formatted) {
    return null;
  }

  return tipoVenta === "peso"
    ? `${formatted} kg`
    : formatted;
}

function formatStockChange(value, tipoVenta) {
  const formatted = formatNumber(value);

  if (!formatted) {
    return null;
  }

  return tipoVenta === "peso"
    ? `+${formatted} kg`
    : `+${formatted}`;
}

function formatStockTransition(from, to, tipoVenta) {
  const first = formatNumber(from);
  const second = formatNumber(to);

  if (!first || !second) {
    return null;
  }

  const suffix =
    tipoVenta === "peso"
      ? " kg"
      : "";

  return `${first}${suffix} → ${second}${suffix}`;
}

function formatRole(role) {
  if (role === "administrador") return "Administrador";
  if (role === "encargado") return "Encargado";
  return role;
}

function LoadingState() {
  return (
    <div
      className="
        rounded-[20px] border border-white/10
        bg-[#11151C] px-4 py-8 text-center
      "
    >
      <div
        className="
          mx-auto h-7 w-7 animate-spin rounded-full
          border-2 border-white/10 border-t-[#FFC61A]
        "
      />

      <p className="mt-3 text-xs font-bold text-white/40">
        Cargando actividad...
      </p>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div
      className="
        rounded-[20px] border border-dashed
        border-white/10 bg-[#11151C]
        px-5 py-9 text-center
      "
    >
      <div
        className="
          mx-auto grid h-11 w-11 place-items-center
          rounded-2xl bg-white/[0.04] text-white/35
        "
      >
        <ActivityIcon className="h-5 w-5" />
      </div>

      <h3 className="mt-3 text-sm font-black text-white/75">
        {title}
      </h3>

      <p className="mx-auto mt-1 max-w-[300px] text-xs leading-5 text-white/35">
        {text}
      </p>
    </div>
  );
}

function ActivityIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
      <circle cx="7" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </svg>
  );
}

function CashOpenIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h16v11H4z" />
      <path d="M8 8V5h8v3" />
      <path d="M12 12v4" />
      <path d="m10 14 2-2 2 2" />
    </svg>
  );
}

function CashCloseIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h16v11H4z" />
      <path d="M8 8V5h8v3" />
      <path d="M12 12v4" />
      <path d="m10 14 2 2 2-2" />
    </svg>
  );
}

function SaleIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16v12H4z" />
      <path d="M8 10h8" />
      <path d="M8 14h5" />
      <path d="M16 14h.01" />
    </svg>
  );
}

function StockIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
      <path d="M18 3v5" />
      <path d="M15.5 5.5h5" />
    </svg>
  );
}

function EditIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}
