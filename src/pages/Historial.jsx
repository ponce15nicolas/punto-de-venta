// src/pages/Historial.jsx
//
// Historial de cierres de caja.
//
// Compatible con:
// - productos por unidad
// - productos por peso
// - productos con importe libre
//
// Incluye:
// - resumen histórico
// - detalle de cada turno
// - diferencias de caja
// - desglose por método de pago
// - detalle de cada transacción
// - productos vendidos dentro de cada ticket
// - descarga PDF del turno cerrado
//
// No requiere dependencias nuevas.

import {
  useMemo,
  useState,
} from "react";

import { motion } from "motion/react";

import {
  money,
  fmtDate,
  fmtDateTime,
  fmtTime,
} from "../lib/format";

import {
  downloadSessionPdf,
} from "../lib/pdf";

import Modal from "../components/Modal";
import { useOperator } from "../components/OperatorGate";

/* =========================================================
   MÉTODOS DE PAGO
========================================================= */

const METHOD_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  qr: "QR",
  tarjeta: "Tarjeta",
};

/* =========================================================
   HELPERS GENERALES
========================================================= */

function toNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function roundMoney(value) {
  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * 100
    ) / 100
  );
}

function roundQuantity(value) {
  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * 1000
    ) / 1000
  );
}

function getTipoVenta(item) {
  const tipo =
    item?.tipoVenta;

  if (
    tipo === "peso" ||
    tipo === "precio-libre"
  ) {
    return tipo;
  }

  /*
   * Ventas antiguas que no tengan tipoVenta
   * continúan considerándose por unidad.
   */
  return "unidad";
}

function formatQuantity(value) {
  return roundQuantity(
    value
  ).toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }
  );
}

function getItemSubtotal(item) {
  if (!item) {
    return 0;
  }

  const storedSubtotal =
    Number(
      item.subtotal
    );

  if (
    Number.isFinite(
      storedSubtotal
    )
  ) {
    return roundMoney(
      storedSubtotal
    );
  }

  return roundMoney(
    toNumber(
      item.qty
    ) *
      toNumber(
        item.price
      )
  );
}

function getSaleItemCount(sale) {
  if (
    !Array.isArray(
      sale?.items
    )
  ) {
    return 0;
  }

  /*
   * Cada línea cuenta como un producto.
   *
   * No sumamos qty porque 0,650 kg
   * no representan 0,65 productos.
   */
  return sale.items.length;
}

function normalizePaymentMethod(
  method
) {
  return METHOD_LABELS[
    method
  ]
    ? method
    : "efectivo";
}

function formatItemDetail(item) {
  const tipoVenta =
    getTipoVenta(
      item
    );

  if (
    tipoVenta === "peso"
  ) {
    return `${formatQuantity(
      item?.qty
    )} kg × ${money(
      item?.price
    )}/kg`;
  }

  if (
    tipoVenta ===
    "precio-libre"
  ) {
    return "Importe manual";
  }

  const qty =
    Math.max(
      0,
      Math.trunc(
        toNumber(
          item?.qty
        )
      )
    );

  return `${qty} × ${money(
    item?.price
  )}`;
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function Historial({
  pos,
}) {
  const {
    esAdministrador,
  } = useOperator();

  const [
    selectedSession,
    setSelectedSession,
  ] = useState(null);

  const [
    deleteCandidate,
    setDeleteCandidate,
  ] = useState(null);

  const [
    deletingSessionId,
    setDeletingSessionId,
  ] = useState(null);

  /* =========================================================
     DATOS SEGUROS
  ========================================================= */

  const cashSessions =
    Array.isArray(
      pos?.cashSessions
    )
      ? pos.cashSessions
      : [];

  const allSales =
    Array.isArray(
      pos?.sales
    )
      ? pos.sales
      : [];

  /* =========================================================
     TURNOS CERRADOS
  ========================================================= */

  const closed =
    useMemo(() => {
      return cashSessions
        .filter(
          (session) =>
            session?.status ===
            "closed"
        )
        .slice()
        .sort(
          (a, b) => {
            const aDate =
              new Date(
                a?.closeTime ||
                  a?.openTime ||
                  0
              ).getTime();

            const bDate =
              new Date(
                b?.closeTime ||
                  b?.openTime ||
                  0
              ).getTime();

            const safeA =
              Number.isFinite(
                aDate
              )
                ? aDate
                : 0;

            const safeB =
              Number.isFinite(
                bDate
              )
                ? bDate
                : 0;

            return (
              safeB -
              safeA
            );
          }
        );
    }, [
      cashSessions,
    ]);

  /* =========================================================
     VENTAS DEL TURNO SELECCIONADO
  ========================================================= */

  const selectedSales =
    useMemo(() => {
      if (
        !selectedSession
      ) {
        return [];
      }

      return allSales
        .filter(
          (sale) =>
            sale?.sessionId ===
            selectedSession.id
        )
        .slice()
        .sort(
          (a, b) => {
            const aTime =
              new Date(
                a?.timestamp ||
                  0
              ).getTime();

            const bTime =
              new Date(
                b?.timestamp ||
                  0
              ).getTime();

            return (
              (
                Number.isFinite(
                  aTime
                )
                  ? aTime
                  : 0
              ) -
              (
                Number.isFinite(
                  bTime
                )
                  ? bTime
                  : 0
              )
            );
          }
        );
    }, [
      allSales,
      selectedSession,
    ]);

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
        allSales.filter(
          (sale) =>
            sale?.sessionId ===
            session.id
        );

      downloadSessionPdf({
        session,

        sales:
          sessionSales,

        shopName:
          pos?.shopName ||
          "Mi Negocio",
      });

      pos?.showToast?.(
        "PDF descargado"
      );
    } catch (error) {
      console.error(
        "Error generando PDF:",
        error
      );

      pos?.showToast?.(
        "No se pudo generar el PDF",
        true
      );
    }
  }

  /* =========================================================
     ELIMINAR CIERRE
  ========================================================= */

  function handleRequestDelete(
    session
  ) {
    if (!esAdministrador) {
      return;
    }

    if (
      !session ||
      session.status !==
        "closed"
    ) {
      pos?.showToast?.(
        "Sólo podés eliminar cajas cerradas",
        true
      );

      return;
    }

    setDeleteCandidate(
      session
    );
  }

  async function handleConfirmDelete() {
    if (!esAdministrador) {
      setDeleteCandidate(
        null
      );

      return;
    }

    const session =
      deleteCandidate;

    if (
      !session ||
      deletingSessionId
    ) {
      return;
    }

    if (
      typeof pos?.deleteCashSession !==
        "function"
    ) {
      pos?.showToast?.(
        "La eliminación de historial no está disponible",
        true
      );

      return;
    }

    setDeletingSessionId(
      session.id
    );

    try {
      const ok =
        await pos.deleteCashSession(
          session.id
        );

      if (!ok) {
        return;
      }

      setDeleteCandidate(
        null
      );

      if (
        selectedSession?.id ===
        session.id
      ) {
        setSelectedSession(
          null
        );
      }
    } finally {
      setDeletingSessionId(
        null
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
          Todavía no hay turnos cerrados
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
          Cuando cierres una caja, el resumen del turno aparecerá automáticamente acá.
        </p>
      </div>
    );
  }

  /* =========================================================
     RESUMEN GENERAL
  ========================================================= */

  const totalVentasHistoricas =
    roundMoney(
      closed.reduce(
        (
          accumulator,
          session
        ) =>
          accumulator +
          toNumber(
            session?.totalSales
          ),
        0
      )
    );

  const totalTicketsHistoricos =
    closed.reduce(
      (
        accumulator,
        session
      ) =>
        accumulator +
        Math.max(
          0,
          Math.trunc(
            toNumber(
              session?.salesCount
            )
          )
        ),
      0
    );

  const totalDiferencia =
    roundMoney(
      closed.reduce(
        (
          accumulator,
          session
        ) =>
          accumulator +
          toNumber(
            session?.diff
          ),
        0
      )
    );

  /* =========================================================
     UI
  ========================================================= */

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
                Revisá los turnos cerrados y descargá sus reportes.
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
          CABECERA LISTADO
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
            shrink-0
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
          {closed.length ===
          1
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
                session.id ||
                `${session.openTime}-${index}`
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
          Boolean(
            selectedSession
          )
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
            onDelete={() =>
              handleRequestDelete(
                selectedSession
              )
            }
            deleting={
              deletingSessionId ===
              selectedSession.id
            }
            canDelete={
              esAdministrador
            }
          />
        )}
      </Modal>

      {/* =====================================================
          CONFIRMAR ELIMINACIÓN
      ===================================================== */}

      <Modal
        open={
          Boolean(
            esAdministrador &&
            deleteCandidate
          )
        }
        onClose={() => {
          if (
            deletingSessionId
          ) {
            return;
          }

          setDeleteCandidate(
            null
          );
        }}
        title="Eliminar cierre"
      >
        {deleteCandidate && (
          <DeleteCashSessionConfirm
            session={
              deleteCandidate
            }
            sales={
              allSales.filter(
                (sale) =>
                  sale?.sessionId ===
                  deleteCandidate.id
              )
            }
            deleting={
              deletingSessionId ===
              deleteCandidate.id
            }
            onCancel={() =>
              setDeleteCandidate(
                null
              )
            }
            onConfirm={
              handleConfirmDelete
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
    roundMoney(
      session?.diff
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
      onClick={
        onClick
      }
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
        <div
          className="
            flex
            min-w-0
            items-center
            gap-3
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
                session?.openTime
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
                session?.openTime
              )}
              {" - "}
              {getTime(
                session?.closeTime
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
            session?.totalSales
          )}
        />

        <MiniStat
          label="Tickets"
          value={
            Math.max(
              0,
              Math.trunc(
                toNumber(
                  session?.salesCount
                )
              )
            )
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
   DETALLE DEL TURNO
========================================================= */

function SessionDetail({
  session,
  sales,
  onDownload,
  onDelete,
  deleting = false,
  canDelete = false,
}) {
  const diff =
    roundMoney(
      session?.diff
    );

  const totals =
    getPaymentTotals(
      session,
      sales
    );

  const totalProductLines =
    sales.reduce(
      (
        accumulator,
        sale
      ) =>
        accumulator +
        getSaleItemCount(
          sale
        ),
      0
    );

  return (
    <div>
      {/* =====================================================
          CABECERA
      ===================================================== */}

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
                  session?.openTime
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
                  session?.openTime
                )}
                {" - "}
                {getTime(
                  session?.closeTime
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

      {/* =====================================================
          ESTADÍSTICAS
      ===================================================== */}

      <div className="grid grid-cols-2 gap-2.5">
        <DarkStat
          label="Apertura"
          value={money(
            session?.openAmount
          )}
        />

        <DarkStat
          label="Ventas"
          value={money(
            session?.totalSales
          )}
          highlight
        />

        <DarkStat
          label="Tickets"
          value={
            session?.salesCount ??
            sales.length
          }
        />

        <DarkStat
          label="Productos"
          value={
            totalProductLines
          }
        />

        <DarkStat
          label="Esperado"
          value={money(
            session?.expectedAmount
          )}
        />

        <DarkStat
          label="Contado"
          value={money(
            session?.counted
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

      {/* =====================================================
          RESULTADO
      ===================================================== */}

      <DifferenceCard
        diff={
          diff
        }
      />

      {/* =====================================================
          MÉTODOS DE PAGO
      ===================================================== */}

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
                key={
                  method
                }
                label={
                  label
                }
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

      {/* =====================================================
          TRANSACCIONES
      ===================================================== */}

      <div className="mt-5">
        <div
          className="
            mb-2.5
            flex
            items-end
            justify-between
            gap-3
          "
        >
          <div>
            <p
              className="
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.14em]
                text-[#FFC61A]
              "
            >
              Operaciones
            </p>

            <h4
              className="
                mt-1
                text-sm
                font-black
                text-white
              "
            >
              Transacciones del turno
            </h4>
          </div>

          <span
            className="
              shrink-0
              rounded-full
              border
              border-white/10
              bg-white/5
              px-2.5
              py-1
              text-[9px]
              font-bold
              text-white/40
            "
          >
            {sales.length}{" "}
            {sales.length === 1
              ? "venta"
              : "ventas"}
          </span>
        </div>

        {sales.length ===
        0 ? (
          <div
            className="
              rounded-[20px]
              border
              border-white/10
              bg-white/5
              px-4
              py-5
              text-center
            "
          >
            <ReceiptIcon
              className="
                mx-auto
                h-5
                w-5
                text-white/20
              "
            />

            <p
              className="
                mt-2
                text-xs
                font-semibold
                text-white/35
              "
            >
              No hay transacciones registradas para este turno.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {sales.map(
              (
                sale,
                index
              ) => (
                <SaleDetailCard
                  key={
                    sale.id ||
                    `${sale.timestamp}-${index}`
                  }
                  sale={
                    sale
                  }
                  index={
                    index
                  }
                />
              )
            )}
          </div>
        )}
      </div>

      {/* =====================================================
          INFORMACIÓN PDF
      ===================================================== */}

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
            {sales.length ===
            1
              ? "transacción"
              : "transacciones"}
            , productos, cantidades, métodos de pago y cierre de caja.
          </p>
        </div>
      </div>

      {/* =====================================================
          DESCARGAR PDF
      ===================================================== */}

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

      {/* =====================================================
          ELIMINAR CIERRE
      ===================================================== */}

      {canDelete && (
        <div
          className="
            mt-4
            border-t
            border-white/10
            pt-4
          "
        >
        <div
          className="
            mb-3
            flex
            items-start
            gap-3
            rounded-[20px]
            border
            border-red-400/15
            bg-red-500/[0.06]
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
              bg-red-500/10
              text-red-400
            "
          >
            <TrashIcon className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <p
              className="
                text-sm
                font-extrabold
                text-white
              "
            >
              Eliminar este cierre
            </p>

            <p
              className="
                mt-1
                text-xs
                leading-relaxed
                text-white/40
              "
            >
              También se eliminarán las ventas asociadas a este turno. Esta acción no se puede deshacer.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={
            onDelete
          }
          disabled={
            deleting
          }
          className="
            inline-flex
            w-full
            items-center
            justify-center
            gap-2
            rounded-2xl
            border
            border-red-400/20
            bg-red-500/10
            px-4
            py-3.5
            text-sm
            font-extrabold
            text-red-300
            transition
            hover:bg-red-500/15
            active:scale-[0.99]
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        >
          <TrashIcon className="h-[17px] w-[17px]" />

          {deleting
            ? "Eliminando..."
            : "Eliminar cierre"}
        </button>
      </div>
      )}
    </div>
  );
}

/* =========================================================
   CONFIRMAR ELIMINACIÓN DE CIERRE
========================================================= */

function DeleteCashSessionConfirm({
  session,
  sales,
  deleting,
  onCancel,
  onConfirm,
}) {
  const salesCount =
    Array.isArray(
      sales
    )
      ? sales.length
      : 0;

  return (
    <div>
      <div
        className="
          overflow-hidden
          rounded-[22px]
          border
          border-red-400/15
          bg-red-500/[0.06]
        "
      >
        <div className="p-4">
          <div
            className="
              flex
              items-start
              gap-3
            "
          >
            <div
              className="
                grid
                h-11
                w-11
                shrink-0
                place-items-center
                rounded-2xl
                bg-red-500/10
                text-red-400
              "
            >
              <TrashIcon className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <p
                className="
                  text-sm
                  font-black
                  text-white
                "
              >
                Esta acción es permanente
              </p>

              <p
                className="
                  mt-1
                  text-xs
                  leading-relaxed
                  text-white/45
                "
              >
                Vas a eliminar el cierre del {fmtDate(
                  session?.openTime
                )} y todas las ventas registradas dentro de ese turno.
              </p>
            </div>
          </div>

          <div
            className="
              mt-4
              grid
              grid-cols-2
              gap-2
            "
          >
            <DarkStat
              label="Ventas"
              value={money(
                session?.totalSales
              )}
            />

            <DarkStat
              label="Tickets"
              value={
                salesCount
              }
            />
          </div>

          <p
            className="
              mt-4
              rounded-2xl
              border
              border-white/10
              bg-white/5
              px-3.5
              py-3
              text-xs
              font-semibold
              leading-relaxed
              text-white/45
            "
          >
            El cierre y sus {salesCount}{" "}
            {salesCount === 1
              ? "venta asociada"
              : "ventas asociadas"} se eliminarán del historial en todos los dispositivos.
          </p>
        </div>
      </div>

      <div
        className="
          mt-4
          grid
          grid-cols-2
          gap-2.5
        "
      >
        <button
          type="button"
          onClick={
            onCancel
          }
          disabled={
            deleting
          }
          className="
            rounded-2xl
            border
            border-white/10
            bg-white/5
            px-4
            py-3.5
            text-sm
            font-extrabold
            text-white/70
            transition
            hover:bg-white/10
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        >
          Cancelar
        </button>

        <button
          type="button"
          onClick={
            onConfirm
          }
          disabled={
            deleting
          }
          className="
            inline-flex
            items-center
            justify-center
            gap-2
            rounded-2xl
            bg-red-500
            px-4
            py-3.5
            text-sm
            font-extrabold
            text-white
            transition
            hover:bg-red-400
            active:scale-[0.99]
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        >
          <TrashIcon className="h-4 w-4" />

          {deleting
            ? "Eliminando..."
            : "Eliminar"}
        </button>
      </div>
    </div>
  );
}


/* =========================================================
   DETALLE DE UNA VENTA
========================================================= */

function SaleDetailCard({
  sale,
  index,
}) {
  const method =
    normalizePaymentMethod(
      sale?.payment?.method
    );

  const items =
    Array.isArray(
      sale?.items
    )
      ? sale.items
      : [];

  const change =
    roundMoney(
      sale?.payment?.change
    );

  const received =
    roundMoney(
      sale?.payment?.received
    );

  const total =
    roundMoney(
      sale?.total
    );

  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 5,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      transition={{
        delay:
          Math.min(
            index * 0.025,
            0.15
          ),
      }}
      className="
        overflow-hidden
        rounded-[20px]
        border
        border-white/10
        bg-[#151A22]
      "
    >
      {/* CABECERA */}

      <div
        className="
          flex
          items-start
          justify-between
          gap-3
          border-b
          border-white/[0.07]
          px-3.5
          py-3
        "
      >
        <div
          className="
            flex
            min-w-0
            items-center
            gap-2.5
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
              bg-[#FFC61A]
              text-black
            "
          >
            <ReceiptIcon className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <p
              className="
                text-xs
                font-extrabold
                text-white
              "
            >
              Venta #{index + 1}
            </p>

            <p
              className="
                mt-0.5
                text-[10px]
                font-semibold
                text-white/35
              "
            >
              {getSafeTime(
                sale?.timestamp
              )}{" "}
              ·{" "}
              {
                METHOD_LABELS[
                  method
                ]
              }
            </p>
          </div>
        </div>

        <span
          className="
            shrink-0
            text-sm
            font-black
            text-[#FFC61A]
          "
        >
          {money(
            total
          )}
        </span>
      </div>

      {/* PRODUCTOS */}

      <div className="px-3.5">
        {items.length ===
        0 ? (
          <div
            className="
              py-3
              text-xs
              text-white/35
            "
          >
            Sin detalle de productos.
          </div>
        ) : (
          items.map(
            (
              item,
              itemIndex
            ) => (
              <SaleItemRow
                key={
                  `${sale?.id || index}-${item?.barcode || "item"}-${itemIndex}`
                }
                item={
                  item
                }
              />
            )
          )
        )}
      </div>

      {/* PAGO */}

      {method ===
        "efectivo" && (
        <div
          className="
            grid
            grid-cols-2
            gap-2
            border-t
            border-white/[0.07]
            px-3.5
            py-3
          "
        >
          <PaymentMiniStat
            label="Recibido"
            value={money(
              received ||
              total
            )}
          />

          <PaymentMiniStat
            label="Vuelto"
            value={money(
              change
            )}
            highlight={
              change > 0
            }
          />
        </div>
      )}
    </motion.div>
  );
}

/* =========================================================
   PRODUCTO DE UNA VENTA
========================================================= */

function SaleItemRow({
  item,
}) {
  const tipoVenta =
    getTipoVenta(
      item
    );

  const subtotal =
    getItemSubtotal(
      item
    );

  return (
    <div
      className="
        flex
        items-center
        gap-2.5
        border-b
        border-white/[0.06]
        py-3
        last:border-b-0
      "
    >
      <div
        className="
          grid
          h-8
          w-8
          shrink-0
          place-items-center
          rounded-xl
          bg-white/5
          text-[#FFC61A]
        "
      >
        <ProductTypeIcon
          tipo={
            tipoVenta
          }
          className="h-3.5 w-3.5"
        />
      </div>

      <div
        className="
          min-w-0
          flex-1
        "
      >
        <p
          className="
            truncate
            text-xs
            font-extrabold
            text-white
          "
        >
          {item?.name ||
            "Producto"}
        </p>

        <p
          className="
            mt-0.5
            truncate
            text-[10px]
            font-semibold
            text-white/35
          "
        >
          {formatItemDetail(
            item
          )}
        </p>
      </div>

      <span
        className="
          shrink-0
          text-xs
          font-black
          text-white
        "
      >
        {money(
          subtotal
        )}
      </span>
    </div>
  );
}

/* =========================================================
   PRODUCT TYPE ICON
========================================================= */

function ProductTypeIcon({
  tipo,
  className = "",
}) {
  if (
    tipo === "peso"
  ) {
    return (
      <ScaleIcon
        className={
          className
        }
      />
    );
  }

  if (
    tipo ===
    "precio-libre"
  ) {
    return (
      <MoneyIcon
        className={
          className
        }
      />
    );
  }

  return (
    <BoxIcon
      className={
        className
      }
    />
  );
}

/* =========================================================
   PAYMENT MINI STAT
========================================================= */

function PaymentMiniStat({
  label,
  value,
  highlight = false,
}) {
  return (
    <div
      className="
        min-w-0
        rounded-xl
        bg-white/5
        px-3
        py-2
      "
    >
      <span
        className="
          block
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
        className={
          `
            mt-0.5
            block
            truncate
            text-xs
            font-black
          ` +
          (
            highlight
              ? " text-[#FFC61A]"
              : " text-white"
          )
        }
      >
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   DESGLOSE DE PAGOS
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

  /*
   * Preferimos el resumen guardado
   * al cerrar la caja.
   */
  if (
    session?.paymentTotals &&
    typeof session.paymentTotals ===
      "object"
  ) {
    Object.keys(
      totals
    ).forEach(
      (method) => {
        totals[
          method
        ] =
          roundMoney(
            session
              .paymentTotals[
                method
              ]
          );
      }
    );

    return totals;
  }

  /*
   * Compatibilidad con cierres antiguos:
   * reconstruimos el desglose desde ventas.
   */
  sales.forEach(
    (sale) => {
      const method =
        normalizePaymentMethod(
          sale?.payment
            ?.method
        );

      totals[
        method
      ] =
        roundMoney(
          totals[
            method
          ] +
            toNumber(
              sale?.total
            )
        );
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
    roundMoney(
      value
    );

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
        (
          diff === 0
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
              `
        )
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
          (
            diff === 0
              ? " text-emerald-600"
              : diff > 0
                ? " text-[#9A7100]"
                : " text-red-600"
          )
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
        (
          diff === 0
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
              `
        )
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
          (
            diff === 0
              ? " bg-emerald-500/15 text-emerald-400"
              : diff > 0
                ? " bg-[#FFC61A] text-black"
                : " bg-red-500/15 text-red-400"
          )
        }
      >
        {diff ===
        0 ? (
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
          Diferencia entre el efectivo esperado y el contado.
        </span>
      </div>
    </div>
  );
}

/* =========================================================
   SUMMARY STAT
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
          (
            highlight
              ? " text-[#9A7100]"
              : " text-[#111318]"
          )
        }
      >
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   MINI STAT
========================================================= */

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

/* =========================================================
   DARK STAT
========================================================= */

function DarkStat({
  label,
  value,
  highlight = false,
  tone = "",
}) {
  const valueClass =
    tone ||
    (
      highlight
        ? "text-[#FFC61A]"
        : "text-white"
    );

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
          ${valueClass}
        `}
      >
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   HELPERS DE FECHA
========================================================= */

function getTime(value) {
  if (!value) {
    return "—";
  }

  /*
   * fmtTime ya existe en format.js y
   * evita depender del formato visual
   * completo de fmtDateTime.
   */
  const formatted =
    fmtTime(
      value
    );

  if (
    formatted &&
    formatted !== "—"
  ) {
    return formatted;
  }

  /*
   * Fallback para compatibilidad.
   */
  const full =
    fmtDateTime(
      value
    );

  if (
    !full ||
    full === "—"
  ) {
    return "—";
  }

  return full;
}

function getSafeTime(value) {
  return getTime(
    value
  );
}

function formatDifference(
  diff
) {
  const value =
    roundMoney(
      diff
    );

  if (value > 0) {
    return `+ ${money(
      value
    )}`;
  }

  if (value < 0) {
    return `- ${money(
      Math.abs(
        value
      )
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

function TrashIcon({
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
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
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

function BoxIcon({
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
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function ScaleIcon({
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
      <path d="M12 3v4" />
      <path d="M5 7h14" />
      <path d="m7 7-4 7h8L7 7Z" />
      <path d="m17 7-4 7h8l-4-7Z" />
      <path d="M12 7v13" />
      <path d="M8 20h8" />
    </svg>
  );
}

function MoneyIcon({
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
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
      />

      <circle
        cx="12"
        cy="12"
        r="2.5"
      />

      <path d="M7 9h.01" />
      <path d="M17 15h.01" />
    </svg>
  );
}