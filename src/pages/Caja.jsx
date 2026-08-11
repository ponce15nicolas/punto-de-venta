import { useState } from "react";
import { motion } from "motion/react";
import { money, fmtDateTime, fmtTime } from "../lib/format";
import Modal from "../components/Modal";

const METHOD_LABEL = { efectivo: "Efectivo", transferencia: "Transferencia", qr: "QR", tarjeta: "Tarjeta" };
const METHOD_ICON = { efectivo: "💵", transferencia: "🏦", qr: "🔳", tarjeta: "💳" };

export default function Caja({ pos }) {
  const { openSession, openCashSession, closeCashSession, paymentBreakdown } = pos;
  const [openAmount, setOpenAmount] = useState("");
  const [closeModal, setCloseModal] = useState(false);
  const [counted, setCounted] = useState("");

  if (!openSession) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-4">
        <div className="font-display text-[15px] mb-1">Abrir caja</div>
        <p className="text-[13px] text-cream-dim -mt-0.5 mb-3">
          Contá el efectivo con el que arrancás el turno.
        </p>
        <div className="mb-3">
          <label className="block text-xs text-cream-dim mb-1.5">Monto inicial en caja</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm"
            placeholder="0.00"
            value={openAmount}
            onChange={(e) => setOpenAmount(e.target.value)}
          />
        </div>
        <button
          className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold"
          onClick={() => {
            const v = parseFloat(openAmount);
            if (isNaN(v) || v < 0) return;
            openCashSession(v);
            setOpenAmount("");
          }}
        >
          Abrir caja
        </button>
      </div>
    );
  }

  const { sessSales, totals, totalSales } = paymentBreakdown(openSession.id);
  const expectedCash = openSession.openAmount + totals.efectivo;

  return (
    <div>
      <div className="bg-surface border border-line rounded-2xl p-4 mb-4">
        <div className="font-display text-[15px] mb-3 flex items-center justify-between">
          <span>Turno en curso</span>
          <span className="font-mono text-[10px] text-cream-dim uppercase tracking-wide">
            desde {fmtDateTime(openSession.openTime)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Apertura" value={money(openSession.openAmount)} />
          <Stat label="Ventas totales" value={money(totalSales)} />
          <Stat label="Tickets" value={sessSales.length} />
          <Stat label="Efectivo esperado" value={money(expectedCash)} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {Object.keys(METHOD_LABEL).map((m) => (
            <div key={m} className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2">
              <span className="text-xs text-cream-dim flex items-center gap-1.5">
                <span>{METHOD_ICON[m]}</span>
                {METHOD_LABEL[m]}
              </span>
              <span className="font-mono text-xs font-semibold">{money(totals[m])}</span>
            </div>
          ))}
        </div>

        <button
          className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold mt-3.5"
          onClick={() => setCloseModal(true)}
        >
          Cerrar caja
        </button>
      </div>

      {sessSales.length > 0 && (
        <>
          <div className="font-display text-[15px] mb-2.5 mt-5">Ventas de este turno</div>
          {sessSales
            .slice()
            .reverse()
            .map((sa) => (
              <motion.div
                key={sa.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-surface border border-line rounded-xl px-3.5 py-3 mb-2"
              >
                <div className="flex justify-between text-[13px]">
                  <span className="font-bold">{sa.items.reduce((a, i) => a + i.qty, 0)} ítems</span>
                  <span className="font-mono text-cream-dim text-[11px]">{fmtTime(sa.timestamp)}</span>
                </div>
                <div className="flex justify-between items-center mt-1.5">
                  <span className="font-mono text-[11.5px] text-cream-dim">
                    {METHOD_ICON[sa.payment?.method || "efectivo"]} {METHOD_LABEL[sa.payment?.method || "efectivo"]}
                    {sa.payment?.method === "efectivo" && sa.payment?.change > 0
                      ? ` · vuelto ${money(sa.payment.change)}`
                      : ""}
                  </span>
                  <span className="font-mono text-[13px] font-bold">{money(sa.total)}</span>
                </div>
              </motion.div>
            ))}
        </>
      )}

      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Cerrar caja">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Stat label="Apertura" value={money(openSession.openAmount)} />
          <Stat label="Ventas en efectivo" value={money(totals.efectivo)} />
        </div>
        <div className="mb-3">
          <label className="block text-xs text-cream-dim mb-1.5">Efectivo esperado en caja</label>
          <input
            disabled
            value={money(expectedCash)}
            className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm opacity-70"
          />
          <p className="text-[11px] text-cream-dim mt-1">
            No incluye ventas por transferencia, QR o tarjeta — esas no entran a la caja física.
          </p>
        </div>
        <div className="mb-3">
          <label className="block text-xs text-cream-dim mb-1.5">Efectivo contado</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm"
            placeholder="0.00"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
        </div>
        <button
          className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold"
          onClick={() => {
            const v = parseFloat(counted);
            if (isNaN(v) || v < 0) return;
            closeCashSession(v);
            setCounted("");
            setCloseModal(false);
          }}
        >
          Confirmar cierre
        </button>
      </Modal>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-cream-dim">{label}</div>
      <div className="font-mono text-[19px] font-bold mt-1">{value}</div>
    </div>
  );
}
