// src/pages/Historial.jsx
// Historial de cierres de caja.
//
// Incluye:
// - resumen histórico
// - detalle de cada turno
// - diferencias de caja
// - desglose por método de pago
// - descarga PDF del turno cerrado
// - detalle completo de transacciones dentro del PDF

import { useState } from "react";
import { motion } from "motion/react";
import {
  money,
  fmtDate,
  fmtDateTime,
} from "../lib/format";
import {
  downloadSessionPdf,
} from "../lib/pdf";
import Modal from "../components/Modal";

const METHOD_LABELS = {
  efectivo: "Efectivo",
  transferencia:
    "Transferencia",
  qr: "QR",
  tarjeta: "Tarjeta",
};

export default function Historial({
  pos,
}) {
  const [
    selectedSession,
    setSelectedSession,
  ] = useState(null);

  const closed =
    pos.cashSessions
      .filter(
        (session) =>
          session.status ===
          "closed"
      )
      .slice()
      .reverse();

  /* =========================================================
     TRANSACCIONES DEL TURNO SELECCIONADO
  ========================================================= */

  const selectedSales =
    selectedSession
      ? pos.sales
        .filter(
          (sale) =>
            sale.sessionId ===
            selectedSession.id
        )
        .slice()
        .sort((a, b) => {
          const aTime =
            new Date(
              a.timestamp
            ).getTime();

          const bTime =
            new Date(
              b.timestamp
            ).getTime();

          return aTime - bTime;
        })
      : [];

  /* =========================================================
     DESCARGAR PDF
  ========================================================= */

  function handleDownload(
    session
  ) {
    if (!session) {
      return;
    }

    try {
      const sessionSales =
        pos.sales.filter(
          (sale) =>
            sale.sessionId ===
            session.id
        );

      downloadSessionPdf({
        session,
        sales:
          sessionSales,
        shopName:
          pos.shopName ||
          "Mi Negocio",
      });

      pos.showToast?.(
        "PDF descargado"
      );
    } catch (error) {
      console.error(
        "Error generando PDF:",
        error
      );

      pos.showToast?.(
        "No se pudo generar el PDF",
        true
      );
    }
  }

  /* =========================================================
     ESTADO VACÍO
  ========================================================= */

  if (
    closed.length === 0
  ) {
    return (
      <div
        className="
          rounded-[28px]
          border
          border-white/10
          bg-[#151A22]
          px-5
          py-12
          text-center
          shadow-[0_18px_50px_rgba(0,0,0,0.16)]
        "
      >
        <div
          className="
            mx-auto
            mb-4
            grid
            h-14
            w-14
            place-items-center
            rounded-2xl
            bg-[#FFC61A]/10
            text-[#FFC61A]
          "
        >
          <HistoryIcon className="h-6 w-6" />
        </div>

        <p
          className="
            text-[10px]
            font-extrabold
            uppercase
            tracking-[0.16em]
            text-[#FFC61A]
          "
        >
          Historial de caja
        </p>

        <h2
          className="
            mt-2
            text-lg
            font-black
            text-white
          "
        >
          Todavía no hay
          turnos cerrados
        </h2>

        <p
          className="
            mx-auto
            mt-1.5
            max-w-[300px]
            text-sm
            leading-relaxed
            text-white/45
          "
        >
          Cuando cierres una
          caja, el resumen del
          turno aparecerá
          automáticamente acá.
        </p>
      </div>
    );
  }

  /* =========================================================
     RESUMEN GENERAL
  ========================================================= */

  const totalVentasHistoricas =
    closed.reduce(
      (
        acc,
        session
      ) =>
        acc +
        Number(
          session.totalSales ||
          0
        ),
      0
    );

  const totalTicketsHistoricos =
    closed.reduce(
      (
        acc,
        session
      ) =>
        acc +
        Number(
          session.salesCount ||
          0
        ),
      0
    );

  const totalDiferencia =
    closed.reduce(
      (
        acc,
        session
      ) =>
        acc +
        Number(
          session.diff || 0
        ),
      0
    );

  return (
    <div className="pb-3">

      {/* =====================================================
          RESUMEN
      ===================================================== */}

      <section
        className="
          mb-5
          overflow-hidden
          rounded-[28px]
          bg-white
          text-[#111318]
          shadow-[0_18px_50px_rgba(0,0,0,0.18)]
        "
      >
        <div className="p-4 sm:p-5">

          <div
            className="
              flex
              items-start
              justify-between
              gap-3
            "
          >
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
                Historial
              </p>

              <h2
                className="
                  mt-1
                  text-xl
                  font-black
                  tracking-[-0.02em]
                  text-[#111318]
                "
              >
                Cierres de caja
              </h2>

              <p
                className="
                  mt-1
                  text-sm
                  leading-relaxed
                  text-black/45
                "
              >
                Revisá los
                turnos cerrados
                y descargá sus
                reportes.
              </p>
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
              <HistoryIcon className="h-5 w-5" />
            </div>
          </div>

          <div
            className="
              my-5
              h-[3px]
              rounded-full
              bg-[#FFC61A]
            "
          />

          <div className="grid grid-cols-3 gap-2.5">
            <SummaryStat
              label="Turnos"
              value={
                closed.length
              }
              icon={
                <CalendarIcon className="h-4 w-4" />
              }
            />

            <SummaryStat
              label="Tickets"
              value={
                totalTicketsHistoricos
              }
              icon={
                <ReceiptIcon className="h-4 w-4" />
              }
            />

            <SummaryStat
              label="Ventas"
              value={money(
                totalVentasHistoricas
              )}
              icon={
                <SalesIcon className="h-4 w-4" />
              }
              highlight
            />
          </div>

          <DifferenceSummary
            value={
              totalDiferencia
            }
          />
        </div>
      </section>

      {/* =====================================================
          CABECERA DEL LISTADO
      ===================================================== */}

      <div
        className="
          mb-3
          flex
          items-end
          justify-between
          gap-3
        "
      >
        <div>
          <p
            className="
              text-[10px]
              font-extrabold
              uppercase
              tracking-[0.16em]
              text-[#FFC61A]
            "
          >
            Turnos anteriores
          </p>

          <h3
            className="
              mt-1
              text-lg
              font-black
              text-white
            "
          >
            Historial completo
          </h3>
        </div>

        <span
          className="
            rounded-full
            border
            border-white/10
            bg-white/5
            px-2.5
            py-1.5
            text-[10px]
            font-bold
            text-white/45
          "
        >
          {closed.length}{" "}
          {closed.length === 1
            ? "turno"
            : "turnos"}
        </span>
      </div>

      {/* =====================================================
          LISTADO
      ===================================================== */}

      <div className="space-y-2.5">
        {closed.map(
          (
            session,
            index
          ) => (
            <SessionCard
              key={
                session.id
              }
              session={
                session
              }
              index={
                index
              }
              onClick={() =>
                setSelectedSession(
                  session
                )
              }
            />
          )
        )}
      </div>

      {/* =====================================================
          MODAL DETALLE
      ===================================================== */}

      <Modal
        open={
          !!selectedSession
        }
        onClose={() =>
          setSelectedSession(
            null
          )
        }
        title="Detalle del turno"
      >
        {selectedSession && (
          <SessionDetail
            session={
              selectedSession
            }
            sales={
              selectedSales
            }
            onDownload={() =>
              handleDownload(
                selectedSession
              )
            }
          />
        )}
      </Modal>
    </div>
  );
}

/* =========================================================
   CARD DEL TURNO
========================================================= */

function SessionCard({
  session,
  index,
  onClick,
}) {
  const diff =
    Number(
      session.diff || 0
    );

  const diffTone =
    diff > 0
      ? "text-[#FFC61A]"
      : diff < 0
        ? "text-red-400"
        : "text-emerald-400";

  const diffBg =
    diff > 0
      ? "bg-[#FFC61A]/10 border-[#FFC61A]/20"
      : diff < 0
        ? "bg-red-500/10 border-red-400/20"
        : "bg-emerald-500/10 border-emerald-400/20";

  return (
    <motion.button
      type="button"
      initial={{
        opacity: 0,
        y: 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      transition={{
        delay:
          Math.min(
            index * 0.035,
            0.2
          ),
      }}
      onClick={onClick}
      className="
        group
        w-full
        rounded-[22px]
        border
        border-white/10
        bg-[#151A22]
        p-3.5
        text-left
        shadow-[0_12px_30px_rgba(0,0,0,0.14)]
        transition
        hover:border-white/20
        hover:bg-[#1A2029]
        active:scale-[0.995]
      "
    >
      <div
        className="
          flex
          items-start
          justify-between
          gap-3
        "
      >
        <div className="flex min-w-0 items-center gap-3">

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
            <RegisterIcon className="h-[18px] w-[18px]" />
          </div>

          <div className="min-w-0">
            <p
              className="
                truncate
                text-sm
                font-extrabold
                text-white
              "
            >
              {fmtDate(
                session.openTime
              )}
            </p>

            <p
              className="
                mt-1
                truncate
                text-[10px]
                font-semibold
                text-white/40
              "
            >
              {getTime(
                session.openTime
              )}
              {" - "}
              {getTime(
                session.closeTime
              )}
            </p>
          </div>
        </div>

        <ChevronIcon
          className="
            mt-2
            h-4
            w-4
            shrink-0
            text-white/20
            transition
            group-hover:translate-x-0.5
            group-hover:text-[#FFC61A]
          "
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat
          label="Ventas"
          value={money(
            session.totalSales
          )}
        />

        <MiniStat
          label="Tickets"
          value={
            session.salesCount ??
            0
          }
        />

        <div
          className={`
            min-w-0
            rounded-xl
            border
            px-2.5
            py-2
            ${diffBg}
          `}
        >
          <span
            className="
              block
              truncate
              text-[8px]
              font-bold
              uppercase
              tracking-[0.09em]
              text-white/35
            "
          >
            Diferencia
          </span>

          <span
            className={`
              mt-0.5
              block
              truncate
              text-xs
              font-black
              ${diffTone}
            `}
          >
            {formatDifference(
              diff
            )}
          </span>
        </div>
      </div>
    </motion.button>
  );
}

/* =========================================================
   DETALLE
========================================================= */

function SessionDetail({
  session,
  sales,
  onDownload,
}) {
  const diff =
    Number(
      session.diff || 0
    );

  const totals =
    getPaymentTotals(
      session,
      sales
    );

  return (
    <div>

      {/* CABECERA */}

      <div
        className="
          mb-4
          overflow-hidden
          rounded-[22px]
          bg-white
          text-[#111318]
        "
      >
        <div className="p-4">
          <div
            className="
              flex
              items-start
              justify-between
              gap-3
            "
          >
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
                Turno cerrado
              </p>

              <h3
                className="
                  mt-1
                  text-lg
                  font-black
                  text-[#111318]
                "
              >
                {fmtDate(
                  session.openTime
                )}
              </h3>

              <p
                className="
                  mt-1
                  text-xs
                  font-semibold
                  text-black/40
                "
              >
                {getTime(
                  session.openTime
                )}
                {" - "}
                {getTime(
                  session.closeTime
                )}
              </p>
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
              <RegisterIcon className="h-5 w-5" />
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

      {/* ESTADÍSTICAS */}

      <div className="grid grid-cols-2 gap-2.5">
        <DarkStat
          label="Apertura"
          value={money(
            session.openAmount
          )}
        />

        <DarkStat
          label="Ventas"
          value={money(
            session.totalSales
          )}
          highlight
        />

        <DarkStat
          label="Tickets"
          value={
            session.salesCount ??
            sales.length
          }
        />

        <DarkStat
          label="Esperado"
          value={money(
            session.expectedAmount
          )}
        />

        <DarkStat
          label="Contado"
          value={money(
            session.counted
          )}
        />

        <DarkStat
          label="Diferencia"
          value={formatDifference(
            diff
          )}
          tone={
            diff > 0
              ? "text-[#FFC61A]"
              : diff < 0
                ? "text-red-400"
                : "text-emerald-400"
          }
        />
      </div>

      {/* RESULTADO */}

      <DifferenceCard
        diff={diff}
      />

      {/* MÉTODOS DE PAGO */}

      <div className="mt-4">
        <p
          className="
            mb-2
            text-[9px]
            font-extrabold
            uppercase
            tracking-[0.14em]
            text-white/35
          "
        >
          Métodos de pago
        </p>

        <div className="grid grid-cols-2 gap-2">
          {Object.entries(
            METHOD_LABELS
          ).map(
            ([
              method,
              label,
            ]) => (
              <DarkStat
                key={method}
                label={label}
                value={money(
                  totals[
                  method
                  ]
                )}
                highlight={
                  method ===
                  "efectivo"
                }
              />
            )
          )}
        </div>
      </div>

      {/* INFORMACIÓN PDF */}

      <div
        className="
          mt-4
          flex
          items-start
          gap-3
          rounded-[20px]
          border
          border-white/10
          bg-white/5
          p-3.5
        "
      >
        <div
          className="
            grid
            h-9
            w-9
            shrink-0
            place-items-center
            rounded-xl
            bg-[#FFC61A]/10
            text-[#FFC61A]
          "
        >
          <DocumentIcon className="h-4 w-4" />
        </div>

        <div className="min-w-0">
          <p
            className="
              text-sm
              font-extrabold
              text-white
            "
          >
            Reporte completo
          </p>

          <p
            className="
              mt-1
              text-xs
              leading-relaxed
              text-white/40
            "
          >
            El PDF incluye las{" "}
            {sales.length}{" "}
            {sales.length === 1
              ? "transacción"
              : "transacciones"}
            , productos, cantidades,
            métodos de pago y
            cierre de caja.
          </p>
        </div>
      </div>

      {/* DESCARGAR */}

      <button
        type="button"
        onClick={
          onDownload
        }
        className="
          mt-4
          inline-flex
          w-full
          items-center
          justify-center
          gap-2
          rounded-2xl
          bg-[#FFC61A]
          px-4
          py-4
          text-sm
          font-extrabold
          text-black
          shadow-[0_12px_30px_rgba(255,198,26,0.18)]
          transition
          hover:bg-[#FFD248]
          active:scale-[0.99]
        "
      >
        <DownloadIcon className="h-[18px] w-[18px]" />

        Descargar reporte PDF
      </button>
    </div>
  );
}

/* =========================================================
   DESGLOSE
========================================================= */

function getPaymentTotals(
  session,
  sales
) {
  const totals = {
    efectivo: 0,
    transferencia: 0,
    qr: 0,
    tarjeta: 0,
  };

  if (
    session.paymentTotals &&
    typeof session.paymentTotals ===
    "object"
  ) {
    Object.keys(
      totals
    ).forEach(
      (method) => {
        totals[method] =
          Number(
            session
              .paymentTotals[
            method
            ] || 0
          );
      }
    );

    return totals;
  }

  sales.forEach(
    (sale) => {
      const method =
        sale.payment?.method ||
        "efectivo";

      if (
        totals[method] !==
        undefined
      ) {
        totals[method] +=
          Number(
            sale.total || 0
          );
      }
    }
  );

  return totals;
}

/* =========================================================
   BALANCE GENERAL
========================================================= */

function DifferenceSummary({
  value,
}) {
  const diff =
    Number(value || 0);

  return (
    <div
      className={
        `
          mt-2.5
          flex
          items-center
          justify-between
          gap-3
          rounded-2xl
          border
          px-3.5
          py-3
        ` +
        (diff === 0
          ? `
            border-emerald-200
            bg-emerald-50
          `
          : diff > 0
            ? `
            border-[#F2D675]
            bg-[#FFF8DD]
          `
            : `
            border-red-200
            bg-red-50
          `)
      }
    >
      <div>
        <span
          className="
            block
            text-[9px]
            font-bold
            uppercase
            tracking-[0.11em]
            text-black/35
          "
        >
          Balance acumulado
        </span>

        <span
          className="
            mt-0.5
            block
            text-xs
            font-semibold
            text-black/45
          "
        >
          {diff === 0
            ? "Sin diferencias"
            : diff > 0
              ? "Sobrante acumulado"
              : "Faltante acumulado"}
        </span>
      </div>

      <span
        className={
          `
            shrink-0
            text-base
            font-black
          ` +
          (diff === 0
            ? "text-emerald-600"
            : diff > 0
              ? "text-[#9A7100]"
              : "text-red-600")
        }
      >
        {formatDifference(
          diff
        )}
      </span>
    </div>
  );
}

/* =========================================================
   RESULTADO DEL CIERRE
========================================================= */

function DifferenceCard({
  diff,
}) {
  return (
    <div
      className={
        `
          mt-4
          flex
          items-center
          gap-3
          rounded-[22px]
          border
          px-3.5
          py-3
        ` +
        (diff === 0
          ? `
            border-emerald-400/20
            bg-emerald-500/10
          `
          : diff > 0
            ? `
            border-[#FFC61A]/20
            bg-[#FFC61A]/10
          `
            : `
            border-red-400/20
            bg-red-500/10
          `)
      }
    >
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
          (diff === 0
            ? "bg-emerald-500/15 text-emerald-400"
            : diff > 0
              ? "bg-[#FFC61A] text-black"
              : "bg-red-500/15 text-red-400")
        }
      >
        {diff === 0 ? (
          <CheckIcon className="h-4 w-4" />
        ) : (
          <BalanceIcon className="h-4 w-4" />
        )}
      </div>

      <div>
        <span
          className="
            block
            text-sm
            font-extrabold
            text-white
          "
        >
          {diff === 0
            ? "Caja exacta"
            : diff > 0
              ? "Sobrante de caja"
              : "Faltante de caja"}
        </span>

        <span
          className="
            mt-0.5
            block
            text-xs
            text-white/40
          "
        >
          Diferencia entre el
          efectivo esperado y
          el contado.
        </span>
      </div>
    </div>
  );
}

/* =========================================================
   STATS
========================================================= */

function SummaryStat({
  label,
  value,
  icon,
  highlight = false,
}) {
  return (
    <div
      className="
        min-w-0
        rounded-2xl
        bg-[#F4F5F7]
        p-3
      "
    >
      <div
        className="
          mb-1.5
          flex
          items-center
          gap-1.5
          text-black/35
        "
      >
        {icon}

        <span
          className="
            truncate
            text-[8px]
            font-bold
            uppercase
            tracking-[0.08em]
            sm:text-[9px]
          "
        >
          {label}
        </span>
      </div>

      <span
        className={
          `
            block
            truncate
            text-sm
            font-black
            sm:text-base
          ` +
          (highlight
            ? "text-[#9A7100]"
            : "text-[#111318]")
        }
      >
        {value}
      </span>
    </div>
  );
}

function MiniStat({
  label,
  value,
}) {
  return (
    <div
      className="
        min-w-0
        rounded-xl
        bg-white/5
        px-2.5
        py-2
      "
    >
      <span
        className="
          block
          truncate
          text-[8px]
          font-bold
          uppercase
          tracking-[0.09em]
          text-white/30
        "
      >
        {label}
      </span>

      <span
        className="
          mt-0.5
          block
          truncate
          text-xs
          font-black
          text-white
        "
      >
        {value}
      </span>
    </div>
  );
}

function DarkStat({
  label,
  value,
  highlight = false,
  tone = "",
}) {
  return (
    <div
      className="
        min-w-0
        rounded-2xl
        border
        border-white/10
        bg-[#171B23]
        p-3.5
      "
    >
      <span
        className="
          block
          truncate
          text-[9px]
          font-bold
          uppercase
          tracking-[0.1em]
          text-white/35
        "
      >
        {label}
      </span>

      <span
        className={`
          mt-1
          block
          truncate
          text-base
          font-black
          ${tone ||
          (highlight
            ? "text-[#FFC61A]"
            : "text-white")
          }
        `}
      >
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   HELPERS
========================================================= */

function getTime(value) {
  const formatted =
    fmtDateTime(value);

  if (
    !formatted ||
    formatted === "—"
  ) {
    return "—";
  }

  const parts =
    String(
      formatted
    ).split(" ");

  return (
    parts[1] ||
    formatted
  );
}

function formatDifference(
  diff
) {
  const value =
    Number(diff || 0);

  if (value > 0) {
    return `+ ${money(
      value
    )}`;
  }

  if (value < 0) {
    return `- ${money(
      Math.abs(value)
    )}`;
  }

  return "Sin diferencia";
}

/* =========================================================
   ICONOS
========================================================= */

function HistoryIcon({
  className = "",
}) {
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
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CalendarIcon({
  className = "",
}) {
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
      <path d="M6 3v3M18 3v3M4 8h16" />
      <path d="M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function ReceiptIcon({
  className = "",
}) {
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

function SalesIcon({
  className = "",
}) {
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
      <path d="M4 18V9" />
      <path d="M10 18V5" />
      <path d="M16 18v-6" />
      <path d="M22 18V3" />
    </svg>
  );
}

function RegisterIcon({
  className = "",
}) {
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
      <path d="M4 10h16v10H4z" />
      <path d="M7 10V5h10v5" />
      <path d="M8 14h3" />
      <path d="M15 14h1" />
      <path d="M15 17h1" />
      <path d="M8 17h3" />
    </svg>
  );
}

function ChevronIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function CheckIcon({
  className = "",
}) {
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

function BalanceIcon({
  className = "",
}) {
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
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="m7 7-3 6h6L7 7Z" />
      <path d="m17 7-3 6h6l-3-6Z" />
      <path d="M8 21h8" />
    </svg>
  );
}

function DownloadIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function DocumentIcon({
  className = "",
}) {
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
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v5h5" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}