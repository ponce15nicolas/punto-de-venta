// src/pages/Caja.jsx
// Pantalla de caja rediseñada con la misma identidad visual del POS.
// Mantiene toda la lógica original de apertura, cierre, desglose de pagos
// y ventas del turno. No requiere librerías de iconos externas.

import { useState } from "react";
import { motion } from "motion/react";
import { money, fmtDateTime, fmtTime } from "../lib/format";
import Modal from "../components/Modal";

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
];

const METHOD_LABEL = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  qr: "QR",
  tarjeta: "Tarjeta",
};

export default function Caja({ pos }) {
  const {
    openSession,
    openCashSession,
    closeCashSession,
    paymentBreakdown,
  } = pos;

  const [openAmount, setOpenAmount] = useState("");
  const [closeModal, setCloseModal] = useState(false);
  const [counted, setCounted] = useState("");

  /* =========================================================
     CAJA CERRADA
  ========================================================= */

  if (!openSession) {
    const montoInicial = parseFloat(openAmount);
    const puedeAbrir =
      !isNaN(montoInicial) &&
      montoInicial >= 0;

    const abrirCaja = () => {
      if (!puedeAbrir) return;

      openCashSession(montoInicial);
      setOpenAmount("");
    };

    return (
      <div className="pb-3">
        <section
          className="
            overflow-hidden
            rounded-[28px]
            bg-white
            text-[#111318]
            shadow-[0_18px_50px_rgba(0,0,0,0.18)]
          "
        >
          <div className="p-4 sm:p-5">
            {/* Cabecera */}

            <div className="flex items-start gap-3">
              <div
                className="
                  grid
                  h-12
                  w-12
                  shrink-0
                  place-items-center
                  rounded-2xl
                  bg-[#FFF5CC]
                  text-[#9A7100]
                "
              >
                <RegisterIcon className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="
                    text-[10px]
                    font-extrabold
                    uppercase
                    tracking-[0.16em]
                    text-[#B98700]
                  "
                >
                  Inicio de turno
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
                  Abrir caja
                </h2>

                <p
                  className="
                    mt-1
                    text-sm
                    leading-relaxed
                    text-black/45
                  "
                >
                  Contá el efectivo disponible antes de comenzar a vender.
                </p>
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

            {/* Monto inicial */}

            <label
              htmlFor="open-cash-amount"
              className="
                mb-2
                block
                text-xs
                font-bold
                text-black/50
              "
            >
              Monto inicial en caja
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
                  text-[#B98700]
                "
              >
                $
              </span>

              <input
                id="open-cash-amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                className="
                  w-full
                  rounded-2xl
                  border
                  border-black/10
                  bg-[#F4F5F7]
                  py-3.5
                  pl-9
                  pr-4
                  text-lg
                  font-black
                  text-[#111318]
                  outline-none
                  transition
                  placeholder:text-black/25
                  focus:border-[#FFC61A]
                  focus:ring-2
                  focus:ring-[#FFC61A]/15
                "
                placeholder="0.00"
                value={openAmount}
                onChange={(e) =>
                  setOpenAmount(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    abrirCaja();
                  }
                }}
              />
            </div>

            <div
              className="
                mt-3
                flex
                items-start
                gap-2
                rounded-2xl
                bg-[#F4F5F7]
                px-3.5
                py-3
              "
            >
              <InfoIcon
                className="
                  mt-0.5
                  h-4
                  w-4
                  shrink-0
                  text-black/35
                "
              />

              <p
                className="
                  text-xs
                  leading-relaxed
                  text-black/45
                "
              >
                Este importe se utilizará para calcular el efectivo esperado al
                cerrar el turno.
              </p>
            </div>

            <button
              type="button"
              disabled={!puedeAbrir}
              onClick={abrirCaja}
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
              <UnlockIcon className="h-4 w-4" />
              Abrir caja
            </button>
          </div>
        </section>
      </div>
    );
  }

  /* =========================================================
     CAJA ABIERTA
  ========================================================= */

  const {
    sessSales,
    totals,
    totalSales,
  } = paymentBreakdown(openSession.id);

  const safeTotals = {
    efectivo: Number(totals?.efectivo || 0),
    transferencia: Number(totals?.transferencia || 0),
    qr: Number(totals?.qr || 0),
    tarjeta: Number(totals?.tarjeta || 0),
  };

  const openAmountNumber =
    Number(openSession.openAmount || 0);

  const expectedCash =
    openAmountNumber +
    safeTotals.efectivo;

  const countedNum = parseFloat(counted);

  const difference =
    !isNaN(countedNum)
      ? countedNum - expectedCash
      : null;

  const puedeCerrar =
    !isNaN(countedNum) &&
    countedNum >= 0;

  const confirmarCierre = () => {
    if (!puedeCerrar) return;

    closeCashSession(countedNum);
    setCounted("");
    setCloseModal(false);
  };

  return (
    <div className="pb-3">
      {/* =====================================================
          RESUMEN DEL TURNO
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
          {/* Cabecera */}

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
                Caja abierta
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
                Turno en curso
              </h2>

              <div
                className="
                  mt-2
                  inline-flex
                  items-center
                  gap-2
                  rounded-full
                  bg-emerald-50
                  px-2.5
                  py-1.5
                  text-[10px]
                  font-extrabold
                  text-emerald-600
                "
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Desde {fmtDateTime(openSession.openTime)}
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
              <RegisterIcon className="h-5 w-5" />
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

          {/* Estadísticas */}

          <div className="grid grid-cols-2 gap-2.5">
            <Stat
              label="Apertura"
              value={money(openAmountNumber)}
              icon={<OpenCashIcon className="h-4 w-4" />}
            />

            <Stat
              label="Ventas totales"
              value={money(totalSales)}
              icon={<SalesIcon className="h-4 w-4" />}
              highlight
            />

            <Stat
              label="Tickets"
              value={sessSales.length}
              icon={<ReceiptIcon className="h-4 w-4" />}
            />

            <Stat
              label="Efectivo esperado"
              value={money(expectedCash)}
              icon={<CashIcon className="h-4 w-4" />}
              highlight
            />
          </div>

          {/* Métodos de pago */}

          <div className="mt-4">
            <p
              className="
                mb-2
                text-[10px]
                font-extrabold
                uppercase
                tracking-[0.14em]
                text-black/35
              "
            >
              Cobros por método
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              {METHODS.map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.id}
                    className="
                      flex
                      min-w-0
                      items-center
                      gap-2.5
                      rounded-2xl
                      bg-[#F4F5F7]
                      px-3
                      py-3
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
                        bg-white
                        text-[#8C6700]
                      "
                    >
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <span
                        className="
                          block
                          truncate
                          text-[10px]
                          font-bold
                          text-black/40
                        "
                      >
                        {item.label}
                      </span>

                      <span
                        className="
                          mt-0.5
                          block
                          truncate
                          text-sm
                          font-black
                          text-[#111318]
                        "
                      >
                        {money(safeTotals[item.id])}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cerrar caja */}

          <button
            type="button"
            onClick={() => setCloseModal(true)}
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
              py-3.5
              text-sm
              font-extrabold
              text-black
              shadow-[0_12px_30px_rgba(255,198,26,0.18)]
              transition
              hover:bg-[#FFD248]
              active:scale-[0.99]
            "
          >
            <LockIcon className="h-4 w-4" />
            Cerrar caja
          </button>
        </div>
      </section>

      {/* =====================================================
          VENTAS DEL TURNO
      ===================================================== */}

      {sessSales.length > 0 && (
        <section>
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
                Movimiento
              </p>

              <h3
                className="
                  mt-1
                  text-lg
                  font-black
                  text-white
                "
              >
                Ventas de este turno
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
              {sessSales.length}{" "}
              {sessSales.length === 1 ? "ticket" : "tickets"}
            </span>
          </div>

          <div className="space-y-2.5">
            {sessSales
              .slice()
              .reverse()
              .map((sale, index) => {
                const method =
                  sale.payment?.method ||
                  "efectivo";

                const paymentMeta =
                  METHODS.find(
                    (item) => item.id === method
                  ) || METHODS[0];

                const MethodIcon =
                  paymentMeta.icon;

                const itemCount =
                  sale.items.reduce(
                    (acc, item) =>
                      acc + Number(item.qty || 0),
                    0
                  );

                return (
                  <motion.article
                    key={sale.id}
                    initial={{
                      opacity: 0,
                      y: 6,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    transition={{
                      delay: Math.min(index * 0.03, 0.18),
                    }}
                    className="
                      rounded-[22px]
                      border
                      border-white/10
                      bg-[#151A22]
                      p-3.5
                      shadow-[0_12px_30px_rgba(0,0,0,0.14)]
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
                          <ReceiptIcon className="h-[18px] w-[18px]" />
                        </div>

                        <div className="min-w-0">
                          <p
                            className="
                              text-sm
                              font-extrabold
                              text-white
                            "
                          >
                            {itemCount}{" "}
                            {itemCount === 1
                              ? "ítem"
                              : "ítems"}
                          </p>

                          <div
                            className="
                              mt-1
                              flex
                              items-center
                              gap-1.5
                              text-[10px]
                              font-semibold
                              text-white/40
                            "
                          >
                            <MethodIcon className="h-3.5 w-3.5" />

                            <span>
                              {METHOD_LABEL[method] ||
                                paymentMeta.label}
                            </span>

                            {method === "efectivo" &&
                              sale.payment?.change > 0 && (
                                <>
                                  <span>·</span>
                                  <span>
                                    Vuelto{" "}
                                    {money(
                                      sale.payment.change
                                    )}
                                  </span>
                                </>
                              )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <span
                          className="
                            block
                            text-[10px]
                            font-bold
                            text-white/35
                          "
                        >
                          {fmtTime(sale.timestamp)}
                        </span>

                        <span
                          className="
                            mt-1
                            block
                            text-sm
                            font-black
                            text-[#FFC61A]
                          "
                        >
                          {money(sale.total)}
                        </span>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
          </div>
        </section>
      )}

      {/* =====================================================
          MODAL CIERRE DE CAJA
      ===================================================== */}

      <Modal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        title="Cerrar caja"
      >
        <div>
          {/* Resumen */}

          <div className="mb-4 grid grid-cols-2 gap-2.5">
            <DarkStat
              label="Apertura"
              value={money(openAmountNumber)}
            />

            <DarkStat
              label="Ventas en efectivo"
              value={money(safeTotals.efectivo)}
              highlight
            />
          </div>

          {/* Efectivo esperado */}

          <div className="mb-4">
            <label
              className="
                mb-1.5
                block
                text-xs
                font-bold
                text-white/55
              "
            >
              Efectivo esperado en caja
            </label>

            <div
              className="
                flex
                items-center
                justify-between
                gap-3
                rounded-[22px]
                border
                border-[#FFC61A]/20
                bg-[#FFC61A]/10
                px-4
                py-3.5
              "
            >
              <div className="flex items-center gap-2.5">
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
                  <CashIcon className="h-4 w-4" />
                </div>

                <span
                  className="
                    text-xs
                    font-semibold
                    text-white/55
                  "
                >
                  Caja física
                </span>
              </div>

              <span
                className="
                  text-lg
                  font-black
                  text-[#FFC61A]
                "
              >
                {money(expectedCash)}
              </span>
            </div>

            <p
              className="
                mt-2
                text-[11px]
                leading-relaxed
                text-white/35
              "
            >
              No incluye transferencia, QR ni tarjeta porque esos medios no
              ingresan a la caja física.
            </p>
          </div>

          {/* Efectivo contado */}

          <div className="mb-4">
            <label
              htmlFor="counted-cash"
              className="
                mb-1.5
                block
                text-xs
                font-bold
                text-white/55
              "
            >
              Efectivo contado
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
                id="counted-cash"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
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
                value={counted}
                onChange={(e) =>
                  setCounted(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    confirmarCierre();
                  }
                }}
              />
            </div>
          </div>

          {/* Diferencia */}

          {difference !== null && (
            <div
              className={
                `
                  mb-4
                  flex
                  items-center
                  justify-between
                  gap-3
                  rounded-[22px]
                  border
                  px-3.5
                  py-3
                ` +
                (difference === 0
                  ? `
                    border-emerald-400/20
                    bg-emerald-500/10
                  `
                  : difference > 0
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
                  Diferencia
                </span>

                <span
                  className="
                    mt-0.5
                    block
                    text-xs
                    font-semibold
                    text-white/50
                  "
                >
                  {difference === 0
                    ? "Caja exacta"
                    : difference > 0
                      ? "Sobrante"
                      : "Faltante"}
                </span>
              </div>

              <span
                className={
                  `
                    text-lg
                    font-black
                  ` +
                  (difference === 0
                    ? "text-emerald-400"
                    : difference > 0
                      ? "text-[#FFC61A]"
                      : "text-red-400")
                }
              >
                {money(difference)}
              </span>
            </div>
          )}

          {/* Confirmar */}

          <button
            type="button"
            disabled={!puedeCerrar}
            onClick={confirmarCierre}
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
            <CheckIcon className="h-4 w-4" />
            Confirmar cierre
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* =========================================================
   TARJETA ESTADÍSTICA CLARA
========================================================= */

function Stat({
  label,
  value,
  icon,
  highlight = false,
}) {
  return (
    <div
      className="
        rounded-2xl
        bg-[#F4F5F7]
        p-3
      "
    >
      <div
        className="
          mb-2
          flex
          items-center
          gap-1.5
          text-black/35
        "
      >
        {icon}

        <span
          className="
            text-[9px]
            font-bold
            uppercase
            tracking-[0.1em]
          "
        >
          {label}
        </span>
      </div>

      <div
        className={
          `
            truncate
            text-base
            font-black
          ` +
          (highlight
            ? "text-[#9A7100]"
            : "text-[#111318]")
        }
      >
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   TARJETA ESTADÍSTICA OSCURA
========================================================= */

function DarkStat({
  label,
  value,
  highlight = false,
}) {
  return (
    <div
      className="
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
        className={
          `
            mt-1
            block
            truncate
            text-base
            font-black
          ` +
          (highlight
            ? "text-[#FFC61A]"
            : "text-white")
        }
      >
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   ICONOS INLINE
========================================================= */

function RegisterIcon({ className = "" }) {
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

function UnlockIcon({ className = "" }) {
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
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M9 10V7a4 4 0 0 1 7.5-2" />
    </svg>
  );
}

function LockIcon({ className = "" }) {
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
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function InfoIcon({ className = "" }) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function OpenCashIcon({ className = "" }) {
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
      <path d="M4 7h16v12H4z" />
      <path d="M8 7V4h8v3" />
      <path d="M8 13h8" />
    </svg>
  );
}

function SalesIcon({ className = "" }) {
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