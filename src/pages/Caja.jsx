// src/pages/Caja.jsx
//
// Pantalla de caja.
//
// Compatible con:
// - productos por unidad
// - productos por peso
// - productos con importe libre
//
// No suma los kg como cantidad de ítems.
// Cada línea vendida cuenta como un producto.
//
// No requiere dependencias nuevas.

import { useState } from "react";
import { motion } from "motion/react";

import {
  money,
  fmtDateTime,
  fmtTime,
} from "../lib/format";

import Modal from "../components/Modal";

import CuentasPorCobrar, {
  getAccountsReceivableSummary,
} from "./CuentasPorCobrar";

/* =========================================================
   MÉTODOS DE PAGO
========================================================= */

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

const ACCOUNT_METHOD = {
  id: "cuenta",
  label: "A cuenta",
  icon: DebtIcon,
};

const SALE_METHODS = [
  ...METHODS,
  ACCOUNT_METHOD,
];

const METHOD_LABEL = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  qr: "QR",
  tarjeta: "Tarjeta",
  cuenta: "A cuenta",
};

/* =========================================================
   HELPERS
========================================================= */

function toNumber(
  value,
  fallback = 0
) {
  const normalized =
    typeof value === "string"
      ? value.replace(",", ".")
      : value;

  const number =
    Number(normalized);

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

function getSaleItemCount(
  sale
) {
  if (
    !Array.isArray(
      sale?.items
    )
  ) {
    return 0;
  }

  /*
   * Importante:
   *
   * No sumamos qty.
   *
   * Una venta de 0,650 kg de tomate
   * representa un producto del ticket,
   * no 0,65 ítems.
   */
  return sale.items.length;
}

function getPaymentMethod(
  sale
) {
  const method =
    sale?.payment?.method;

  return METHOD_LABEL[
    method
  ]
    ? method
    : "efectivo";
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function Caja({
  pos,
}) {
  const {
    openSession,
    openCashSession,
    closeCashSession,
    paymentBreakdown,
  } = pos;

  const [
    openAmount,
    setOpenAmount,
  ] = useState("");

  const [
    closeModal,
    setCloseModal,
  ] = useState(false);

  const [
    counted,
    setCounted,
  ] = useState("");

  const [
    openingCash,
    setOpeningCash,
  ] = useState(false);

  const [
    closingCash,
    setClosingCash,
  ] = useState(false);

  const [
    section,
    setSection,
  ] = useState("cash");

  const receivablesSummary =
    getAccountsReceivableSummary(
      pos?.accountsReceivable
    );

  if (section === "receivables") {
    return (
      <CuentasPorCobrar
        pos={pos}
        onBack={() =>
          setSection("cash")
        }
      />
    );
  }

  /* =========================================================
     CAJA CERRADA
  ========================================================= */

  if (!openSession) {
    const montoInicial =
      toNumber(
        openAmount,
        NaN
      );

    const puedeAbrir =
      Number.isFinite(
        montoInicial
      ) &&
      montoInicial >= 0;

    async function abrirCaja() {
      if (
        !puedeAbrir ||
        openingCash
      ) {
        return;
      }

      setOpeningCash(true);

      try {
        /*
         * Compatible tanto con el usePosData local actual
         * como con la próxima versión asincrónica de Firestore.
         */
        const ok =
          await Promise.resolve(
            openCashSession(
              montoInicial
            )
          );

        if (ok) {
          setOpenAmount(
            ""
          );
        }
      } catch (error) {
        console.error(
          "Error abriendo caja:",
          error
        );

        pos?.showToast?.(
          "No se pudo abrir la caja",
          true
        );
      } finally {
        setOpeningCash(false);
      }
    }

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
            {/* ===============================================
                CABECERA
            =============================================== */}

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

              <div
                className="
                  min-w-0
                  flex-1
                "
              >
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

            {/* ===============================================
                MONTO INICIAL
            =============================================== */}

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
                autoComplete="off"
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
                value={
                  openAmount
                }
                disabled={
                  openingCash
                }
                onChange={(
                  event
                ) =>
                  setOpenAmount(
                    event.target
                      .value
                  )
                }
                onKeyDown={(
                  event
                ) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    event.preventDefault();

                    abrirCaja();
                  }
                }}
              />
            </div>

            {/* ===============================================
                INFORMACIÓN
            =============================================== */}

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
                Este importe se utilizará para calcular el efectivo esperado al cerrar el turno.
              </p>
            </div>

            {/* ===============================================
                ABRIR
            =============================================== */}

            <button
              type="button"
              disabled={
                !puedeAbrir ||
                openingCash
              }
              onClick={
                abrirCaja
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
              {openingCash ? (
                <LoadingIcon className="h-4 w-4" />
              ) : (
                <UnlockIcon className="h-4 w-4" />
              )}

              {openingCash
                ? "Abriendo caja..."
                : "Abrir caja"}
            </button>
          </div>
        </section>

        <AccountsReceivableAccess
          summary={receivablesSummary}
          onOpen={() =>
            setSection("receivables")
          }
        />
      </div>
    );
  }

  /* =========================================================
     CAJA ABIERTA
  ========================================================= */

  const breakdown =
    paymentBreakdown(
      openSession.id
    ) || {};

  const sessSales =
    Array.isArray(
      breakdown.sessSales
    )
      ? breakdown.sessSales
      : [];

  const totals =
    breakdown.totals ||
    {};

  const saleTotals =
    breakdown.saleTotals ||
    totals;

  const receivableTotals =
    breakdown.receivableTotals ||
    {};

  const payableTotals =
    breakdown.payableTotals ||
    {};

  const totalSales =
    roundMoney(
      breakdown.totalSales
    );

  const totalReceivablePayments =
    roundMoney(
      breakdown
        .totalReceivablePayments
    );

  const totalCreditSales =
    roundMoney(
      breakdown
        .totalCreditSales
    );

  const safeSaleTotals = {
    efectivo:
      roundMoney(
        saleTotals.efectivo
      ),

    transferencia:
      roundMoney(
        saleTotals.transferencia
      ),

    qr:
      roundMoney(
        saleTotals.qr
      ),

    tarjeta:
      roundMoney(
        saleTotals.tarjeta
      ),
  };

  const safeReceivableTotals = {
    efectivo:
      roundMoney(
        receivableTotals.efectivo
      ),

    transferencia:
      roundMoney(
        receivableTotals.transferencia
      ),

    qr:
      roundMoney(
        receivableTotals.qr
      ),

    tarjeta:
      roundMoney(
        receivableTotals.tarjeta
      ),
  };

  const safePayableTotals = {
    efectivo:
      roundMoney(
        payableTotals.efectivo
      ),

    transferencia:
      roundMoney(
        payableTotals.transferencia
      ),

    qr:
      roundMoney(
        payableTotals.qr
      ),

    tarjeta:
      roundMoney(
        payableTotals.tarjeta
      ),
  };

  const safeTotals = {
    efectivo:
      roundMoney(
        totals.efectivo
      ),

    transferencia:
      roundMoney(
        totals.transferencia
      ),

    qr:
      roundMoney(
        totals.qr
      ),

    tarjeta:
      roundMoney(
        totals.tarjeta
      ),
  };

  const openAmountNumber =
    roundMoney(
      openSession.openAmount
    );

  /*
   * Solamente el efectivo se suma
   * a la caja física.
   */
  const expectedCash =
    roundMoney(
      openAmountNumber +
        safeTotals.efectivo -
        safePayableTotals.efectivo
    );

  const countedNum =
    toNumber(
      counted,
      NaN
    );

  const difference =
    Number.isFinite(
      countedNum
    )
      ? roundMoney(
          countedNum -
            expectedCash
        )
      : null;

  const puedeCerrar =
    Number.isFinite(
      countedNum
    ) &&
    countedNum >= 0;

  /* =========================================================
     CERRAR MODAL
  ========================================================= */

  function cerrarModalCaja() {
    if (closingCash) {
      return;
    }

    setCloseModal(
      false
    );

    setCounted(
      ""
    );
  }

  /* =========================================================
     CONFIRMAR CIERRE
  ========================================================= */

  async function confirmarCierre() {
    if (
      !puedeCerrar ||
      closingCash
    ) {
      return;
    }

    setClosingCash(true);

    try {
      /*
       * Esperamos la confirmación real de la operación antes
       * de cerrar el modal. Esto evita falsos positivos cuando
       * usePosData pase a trabajar con Firestore.
       */
      const ok =
        await Promise.resolve(
          closeCashSession(
            countedNum
          )
        );

      if (ok) {
        setCounted(
          ""
        );

        setCloseModal(
          false
        );
      }
    } catch (error) {
      console.error(
        "Error cerrando caja:",
        error
      );

      pos?.showToast?.(
        "No se pudo cerrar la caja",
        true
      );
    } finally {
      setClosingCash(false);
    }
  }

  /* =========================================================
     UI CAJA ABIERTA
  ========================================================= */

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
          {/* CABECERA */}

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
                <span
                  className="
                    h-1.5
                    w-1.5
                    rounded-full
                    bg-emerald-500
                  "
                />

                Desde{" "}
                {fmtDateTime(
                  openSession.openTime
                )}
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

          {/* ===============================================
              ESTADÍSTICAS
          =============================================== */}

          <div className="grid grid-cols-2 gap-2.5">
            <Stat
              label="Apertura"
              value={money(
                openAmountNumber
              )}
              icon={
                <OpenCashIcon className="h-4 w-4" />
              }
            />

            <Stat
              label="Ventas totales"
              value={money(
                totalSales
              )}
              icon={
                <SalesIcon className="h-4 w-4" />
              }
              highlight
            />

            <Stat
              label="Tickets"
              value={
                sessSales.length
              }
              icon={
                <ReceiptIcon className="h-4 w-4" />
              }
            />

            <Stat
              label="Efectivo esperado"
              value={money(
                expectedCash
              )}
              icon={
                <CashIcon className="h-4 w-4" />
              }
              highlight
            />
          </div>

          {/* ===============================================
              MÉTODOS DE PAGO
          =============================================== */}

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
              {METHODS.map(
                (item) => {
                  const Icon =
                    item.icon;

                  return (
                    <div
                      key={
                        item.id
                      }
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

                      <div
                        className="
                          min-w-0
                          flex-1
                        "
                      >
                        <span
                          className="
                            block
                            truncate
                            text-[10px]
                            font-bold
                            text-black/40
                          "
                        >
                          {
                            item.label
                          }
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
                          {money(
                            safeTotals[
                              item.id
                            ]
                          )}
                        </span>
                      </div>
                    </div>
                  );
                }
              )}
            </div>

            {totalReceivablePayments >
              0 && (
              <div
                className="
                  mt-2.5
                  rounded-2xl
                  border
                  border-[#FFC61A]/15
                  bg-[#FFF8DD]
                  px-3.5
                  py-3
                  text-[11px]
                  font-semibold
                  leading-relaxed
                  text-[#765600]
                "
              >
                Incluye {money(
                  totalReceivablePayments
                )} cobrados de cuentas por cobrar durante este turno.
              </div>
            )}

            {totalCreditSales >
              0 && (
              <div
                className="
                  mt-2.5
                  rounded-2xl
                  border
                  border-white/10
                  bg-[#F4F5F7]
                  px-3.5
                  py-3
                  text-[11px]
                  font-semibold
                  leading-relaxed
                  text-black/50
                "
              >
                Ventas a cuenta: {money(
                  totalCreditSales
                )}. Forman parte de las ventas del turno, pero no ingresan dinero a caja hasta que se cobren.
              </div>
            )}
          </div>

          {/* ===============================================
              CERRAR CAJA
          =============================================== */}

          <button
            type="button"
            onClick={() => {
              setCounted(
                ""
              );

              setCloseModal(
                true
              );
            }}
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

      <AccountsReceivableAccess
        summary={receivablesSummary}
        onOpen={() =>
          setSection("receivables")
        }
      />

      {/* =====================================================
          VENTAS DEL TURNO
      ===================================================== */}

      {sessSales.length >
        0 && (
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
              {
                sessSales.length
              }{" "}
              {sessSales.length ===
              1
                ? "ticket"
                : "tickets"}
            </span>
          </div>

          <div className="space-y-2.5">
            {sessSales
              .slice()
              .reverse()
              .map(
                (
                  sale,
                  index
                ) => {
                  const method =
                    getPaymentMethod(
                      sale
                    );

                  const paymentMeta =
                    SALE_METHODS.find(
                      (item) =>
                        item.id ===
                        method
                    ) ||
                    METHODS[0];

                  const MethodIcon =
                    paymentMeta.icon;

                  const itemCount =
                    getSaleItemCount(
                      sale
                    );

                  const saleTotal =
                    roundMoney(
                      sale?.total
                    );

                  const change =
                    roundMoney(
                      sale?.payment
                        ?.change
                    );

                  return (
                    <motion.article
                      key={
                        sale.id ||
                        `${sale.timestamp}-${index}`
                      }
                      initial={{
                        opacity:
                          0,
                        y: 6,
                      }}
                      animate={{
                        opacity:
                          1,
                        y: 0,
                      }}
                      transition={{
                        delay:
                          Math.min(
                            index *
                              0.03,
                            0.18
                          ),
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
                              {itemCount ===
                              1
                                ? "producto"
                                : "productos"}
                            </p>

                            <div
                              className="
                                mt-1
                                flex
                                flex-wrap
                                items-center
                                gap-1.5
                                text-[10px]
                                font-semibold
                                text-white/40
                              "
                            >
                              <MethodIcon className="h-3.5 w-3.5 shrink-0" />

                              <span>
                                {METHOD_LABEL[
                                  method
                                ] ||
                                  paymentMeta.label}
                              </span>

                              {method ===
                                "efectivo" &&
                                change >
                                  0 && (
                                  <>
                                    <span>
                                      ·
                                    </span>

                                    <span>
                                      Vuelto{" "}
                                      {money(
                                        change
                                      )}
                                    </span>
                                  </>
                                )}
                            </div>
                          </div>
                        </div>

                        <div
                          className="
                            shrink-0
                            text-right
                          "
                        >
                          <span
                            className="
                              block
                              text-[10px]
                              font-bold
                              text-white/35
                            "
                          >
                            {fmtTime(
                              sale.timestamp
                            )}
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
                            {money(
                              saleTotal
                            )}
                          </span>
                        </div>
                      </div>
                    </motion.article>
                  );
                }
              )}
          </div>
        </section>
      )}

      {/* =====================================================
          MODAL CIERRE
      ===================================================== */}

      <Modal
        open={
          closeModal
        }
        onClose={
          cerrarModalCaja
        }
        title="Cerrar caja"
      >
        <div>
          {/* ===============================================
              RESUMEN
          =============================================== */}

          <div
            className="
              mb-4
              grid
              grid-cols-2
              gap-2.5
            "
          >
            <DarkStat
              label="Apertura"
              value={money(
                openAmountNumber
              )}
            />

            <DarkStat
              label="Ventas en efectivo"
              value={money(
                safeSaleTotals.efectivo
              )}
              highlight
            />
          </div>

          {safeReceivableTotals
            .efectivo > 0 && (
            <div className="mb-4">
              <DarkStat
                label="Cuentas por cobrar en efectivo"
                value={money(
                  safeReceivableTotals
                    .efectivo
                )}
                highlight
              />
            </div>
          )}

          {safePayableTotals
            .efectivo > 0 && (
            <div className="mb-4">
              <DarkStat
                label="Pagos de cuentas por pagar"
                value={`-${money(
                  safePayableTotals
                    .efectivo
                )}`}
              />
            </div>
          )}

          {/* ===============================================
              EFECTIVO ESPERADO
          =============================================== */}

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
              <div
                className="
                  flex
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
                {money(
                  expectedCash
                )}
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
              Incluye ventas y cobros de cuentas por cobrar en efectivo, menos los pagos de cuentas por pagar realizados en efectivo. Transferencia, QR y tarjeta no modifican la caja física.
            </p>
          </div>

          {/* ===============================================
              EFECTIVO CONTADO
          =============================================== */}

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
                autoComplete="off"
                autoFocus
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
                value={
                  counted
                }
                disabled={
                  closingCash
                }
                onChange={(
                  event
                ) =>
                  setCounted(
                    event.target
                      .value
                  )
                }
                onKeyDown={(
                  event
                ) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    event.preventDefault();

                    confirmarCierre();
                  }
                }}
              />
            </div>
          </div>

          {/* ===============================================
              DIFERENCIA
          =============================================== */}

          {difference !==
            null && (
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
                (
                  difference ===
                  0
                    ? `
                      border-emerald-400/20
                      bg-emerald-500/10
                    `
                    : difference >
                        0
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
                  {difference ===
                  0
                    ? "Caja exacta"
                    : difference >
                        0
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
                  (
                    difference ===
                    0
                      ? " text-emerald-400"
                      : difference >
                          0
                        ? " text-[#FFC61A]"
                        : " text-red-400"
                  )
                }
              >
                {money(
                  difference
                )}
              </span>
            </div>
          )}

          {/* ===============================================
              CONFIRMAR
          =============================================== */}

          <button
            type="button"
            disabled={
              !puedeCerrar ||
              closingCash
            }
            onClick={
              confirmarCierre
            }
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
            {closingCash ? (
              <LoadingIcon className="h-4 w-4" />
            ) : (
              <CheckIcon className="h-4 w-4" />
            )}

            {closingCash
              ? "Cerrando caja..."
              : "Confirmar cierre"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* =========================================================
   ACCESO A CUENTAS POR COBRAR
========================================================= */

function AccountsReceivableAccess({
  summary,
  onOpen,
}) {
  const totalPending =
    roundMoney(
      summary?.totalPending
    );

  const customers =
    Math.max(
      0,
      Math.trunc(
        toNumber(
          summary?.customers
        )
      )
    );

  const overdue =
    Math.max(
      0,
      Math.trunc(
        toNumber(
          summary?.overdue
        )
      )
    );

  return (
    <button
      type="button"
      onClick={onOpen}
      className="
        group
        mb-5
        mt-4
        w-full
        overflow-hidden
        rounded-[24px]
        border
        border-[#FFC61A]/20
        bg-[#151A22]
        p-4
        text-left
        shadow-[0_14px_35px_rgba(0,0,0,0.15)]
        transition
        hover:border-[#FFC61A]/35
        hover:bg-[#191E27]
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
              h-11
              w-11
              shrink-0
              place-items-center
              rounded-2xl
              bg-[#FFC61A]
              text-black
            "
          >
            <WalletIcon className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <p
              className="
                text-[10px]
                font-extrabold
                uppercase
                tracking-[0.14em]
                text-[#FFC61A]
              "
            >
              Gestión de cobros
            </p>

            <h3
              className="
                mt-0.5
                truncate
                text-sm
                font-black
                text-white
              "
            >
              Cuentas por cobrar
            </h3>
          </div>
        </div>

        <ChevronIcon
          className="
            mt-3
            h-4
            w-4
            shrink-0
            text-white/25
            transition
            group-hover:translate-x-0.5
            group-hover:text-[#FFC61A]
          "
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <ReceivableMiniStat
          label="Pendiente"
          value={money(
            totalPending
          )}
          highlight
        />

        <ReceivableMiniStat
          label="Clientes"
          value={customers}
        />

        <ReceivableMiniStat
          label="Vencidas"
          value={overdue}
          danger={overdue > 0}
        />
      </div>
    </button>
  );
}

function ReceivableMiniStat({
  label,
  value,
  highlight = false,
  danger = false,
}) {
  return (
    <div
      className="
        min-w-0
        rounded-xl
        border
        border-white/[0.07]
        bg-white/[0.04]
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
          tracking-[0.08em]
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
            danger
              ? " text-red-300"
              : highlight
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
   TARJETA ESTADÍSTICA
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
        min-w-0
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
            min-w-0
            truncate
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
          (
            highlight
              ? " text-[#9A7100]"
              : " text-[#111318]"
          )
        }
      >
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   TARJETA OSCURA
========================================================= */

function DarkStat({
  label,
  value,
  highlight = false,
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
        className={
          `
            mt-1
            block
            truncate
            text-base
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
   ICONOS
========================================================= */

function LoadingIcon({
  className = "",
}) {
  return (
    <svg
      className={`${className} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
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

function UnlockIcon({
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
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2"
      />

      <path d="M9 10V7a4 4 0 0 1 7.5-2" />
    </svg>
  );
}

function LockIcon({
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
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2"
      />

      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function InfoIcon({
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
      <circle
        cx="12"
        cy="12"
        r="9"
      />

      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function OpenCashIcon({
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
      <path d="M4 7h16v12H4z" />
      <path d="M8 7V4h8v3" />
      <path d="M8 13h8" />
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

function CashIcon({
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
        y="6"
        width="18"
        height="12"
        rx="2"
      />

      <circle
        cx="12"
        cy="12"
        r="2.5"
      />

      <path d="M7 9H6v1" />
      <path d="M17 15h1v-1" />
    </svg>
  );
}

function TransferIcon({
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
      <path d="M4 7h14" />
      <path d="m15 4 3 3-3 3" />
      <path d="M20 17H6" />
      <path d="m9 14-3 3 3 3" />
    </svg>
  );
}

function QrIcon({
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
      <path d="M4 4h6v6H4z" />
      <path d="M14 4h6v6h-6z" />
      <path d="M4 14h6v6H4z" />
      <path d="M14 14h2v2h-2z" />
      <path d="M18 14h2v6h-6v-2" />
    </svg>
  );
}

function CardIcon({
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

      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

function WalletIcon({
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
      <path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6.5A2.5 2.5 0 0 1 4.5 4H17" />
      <path d="M16 11h6v4h-6a2 2 0 0 1 0-4Z" />
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

function DebtIcon({
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
      <path d="M5 4h14v16H5z" />
      <path d="M8 8h8" />
      <path d="M8 12h5" />
      <path d="M8 16h3" />
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