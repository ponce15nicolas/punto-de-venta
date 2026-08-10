import { useState } from "react";
import { motion } from "motion/react";
import { money, fmtDateTime } from "../lib/format";
import Modal from "../components/Modal";

export default function Caja({ pos }) {
  const { openSession, sales, openCashSession, closeCashSession } = pos;
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

  const sessSales = sales.filter((s) => s.sessionId === openSession.id);
  const totalSales = sessSales.reduce((a, s) => a + s.total, 0);
  const expected = openSession.openAmount + totalSales;

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
          <Stat label="Ventas del turno" value={money(totalSales)} />
          <Stat label="Tickets" value={sessSales.length} />
          <Stat label="Efectivo esperado" value={money(expected)} />
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
                  <span className="font-mono text-cream-dim text-[11px]">{fmtDateTime(sa.timestamp)}</span>
                </div>
                <div className="font-mono text-[11.5px] text-cream-dim mt-1.5">{money(sa.total)}</div>
              </motion.div>
            ))}
        </>
      )}

      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Cerrar caja">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Stat label="Apertura" value={money(openSession.openAmount)} />
          <Stat label="Ventas" value={money(totalSales)} />
        </div>
        <div className="mb-3">
          <label className="block text-xs text-cream-dim mb-1.5">Efectivo esperado</label>
          <input
            disabled
            value={money(expected)}
            className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm opacity-70"
          />
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
