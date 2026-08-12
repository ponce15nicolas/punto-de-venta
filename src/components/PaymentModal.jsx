import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { money } from "../lib/format";
import Modal from "./Modal";

const METHODS = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "qr", label: "QR" },
  { id: "tarjeta", label: "Tarjeta" },
];

export default function PaymentModal({ open, onClose, total, onConfirm }) {
  const [method, setMethod] = useState("efectivo");
  const [received, setReceived] = useState("");

  useEffect(() => {
    if (open) {
      setMethod("efectivo");
      setReceived("");
    }
  }, [open]);

  const receivedNum = parseFloat(received);
  const change = method === "efectivo" && !isNaN(receivedNum) ? receivedNum - total : 0;
  const canConfirm = method !== "efectivo" || (!isNaN(receivedNum) && receivedNum >= total);

  return (
    <Modal open={open} onClose={onClose} title="Cobrar venta">
      <div className="mb-4">
        <div className="font-mono text-[11px] uppercase tracking-wide text-cream-dim mb-1">Total a cobrar</div>
        <div className="font-mono text-3xl font-bold text-amber">{money(total)}</div>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-cream-dim mb-2">Método de pago</label>
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={
                "flex items-center gap-2 rounded-lg px-3 py-3 border text-sm font-semibold transition-colors " +
                (method === m.id
                  ? "bg-amber text-amber-ink border-amber"
                  : "bg-surface-2 text-cream border-line")
              }
            >
              <span className="text-base">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {method === "efectivo" && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-4 overflow-hidden">
          <label className="block text-xs text-cream-dim mb-1.5">Monto recibido</label>
          <input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-lg"
            placeholder="0.00"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
          />
          <div className="flex justify-between items-center mt-3 bg-surface-2 rounded-lg px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-cream-dim">Vuelto</span>
            <span className={"font-mono text-lg font-bold " + (change < 0 ? "text-brick" : "text-leaf")}>
              {isNaN(receivedNum) ? "—" : money(Math.max(change, change < 0 ? change : 0))}
            </span>
          </div>
        </motion.div>
      )}

      <button
        className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold disabled:opacity-40"
        disabled={!canConfirm}
        onClick={() => onConfirm({ method, received: method === "efectivo" ? receivedNum : total })}
      >
        Confirmar cobro
      </button>
    </Modal>
  );
}
