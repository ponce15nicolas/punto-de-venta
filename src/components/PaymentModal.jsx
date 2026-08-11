import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { money } from "../lib/format";
import Modal from "./Modal";
import TransferCapture from "./TransferCapture";

const METHODS = [
  { id: "efectivo", label: "Efectivo", icon: "💵" },
  { id: "transferencia", label: "Transferencia", icon: "🏦" },
  { id: "qr", label: "QR", icon: "🔳" },
  { id: "tarjeta", label: "Tarjeta", icon: "💳" },
];

const emptyTransfer = { name: "", dni: "", date: "", amount: "", coelsaId: "" };

export default function PaymentModal({ open, onClose, total, onConfirm }) {
  const [method, setMethod] = useState("efectivo");
  const [received, setReceived] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [transferData, setTransferData] = useState(emptyTransfer);
  const [scanStatus, setScanStatus] = useState("idle"); // idle | scanned

  useEffect(() => {
    if (open) {
      setMethod("efectivo");
      setReceived("");
      setTransferData(emptyTransfer);
      setScanStatus("idle");
    }
  }, [open]);

  const receivedNum = parseFloat(received);
  const change = method === "efectivo" && !isNaN(receivedNum) ? receivedNum - total : 0;
  const canConfirm = method !== "efectivo" || (!isNaN(receivedNum) && receivedNum >= total);

  function updateTransferField(field, value) {
    setTransferData((prev) => ({ ...prev, [field]: value }));
  }

  function handleCapture(parsed) {
    setTransferData({
      name: parsed.name || "",
      dni: parsed.dni || "",
      date: parsed.date || "",
      amount: parsed.amount || total.toFixed(2),
      coelsaId: parsed.coelsaId || "",
    });
    setScanStatus("scanned");
    setCaptureOpen(false);
  }

  return (
    <>
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

        {/* Efectivo section */}
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

        {/* Transferencia section */}
        <AnimatePresence>
          {method === "transferencia" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 overflow-hidden"
            >
              {/* Scan button */}
              <button
                className={
                  "w-full flex items-center justify-center gap-2 rounded-lg px-3 py-3 font-semibold text-sm mb-3 transition-colors border " +
                  (scanStatus === "scanned"
                    ? "bg-leaf/15 border-leaf/40 text-leaf"
                    : "bg-surface-2 border-line text-cream hover:border-amber hover:text-amber")
                }
                onClick={() => setCaptureOpen(true)}
              >
                {scanStatus === "scanned" ? (
                  <>✓ Datos escaneados · Toca para re-escanear</>
                ) : (
                  <>📷 Escanear comprobante</>
                )}
              </button>

              {/* Transfer fields */}
              <div className="space-y-2.5">
                <TransferField
                  label="Nombre completo"
                  value={transferData.name}
                  onChange={(v) => updateTransferField("name", v)}
                  placeholder="Juan Pérez"
                />
                <TransferField
                  label="DNI"
                  value={transferData.dni}
                  onChange={(v) => updateTransferField("dni", v)}
                  placeholder="12345678"
                  inputMode="numeric"
                />
                <TransferField
                  label="Fecha y hora"
                  value={transferData.date}
                  onChange={(v) => updateTransferField("date", v)}
                  placeholder="11/08/2026 13:00"
                />
                <TransferField
                  label="Monto"
                  value={transferData.amount}
                  onChange={(v) => updateTransferField("amount", v)}
                  placeholder={total.toFixed(2)}
                  inputMode="decimal"
                  prefix="$"
                />
                <TransferField
                  label="ID Coelsa"
                  value={transferData.coelsaId}
                  onChange={(v) => updateTransferField("coelsaId", v)}
                  placeholder="ABC12345"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold disabled:opacity-40"
          disabled={!canConfirm}
          onClick={() =>
            onConfirm({
              method,
              received: method === "efectivo" ? receivedNum : total,
              ...(method === "transferencia" ? { transferData } : {}),
            })
          }
        >
          Confirmar cobro
        </button>
      </Modal>

      <TransferCapture
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onResult={handleCapture}
        total={total}
      />
    </>
  );
}

function TransferField({ label, value, onChange, placeholder, inputMode, prefix }) {
  return (
    <div>
      <label className="block text-[11px] text-cream-dim mb-1 font-mono uppercase tracking-wide">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-dim font-mono text-sm pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          type="text"
          inputMode={inputMode || "text"}
          className={
            "w-full bg-surface-2 border border-line rounded-lg py-2.5 text-cream font-mono text-sm " +
            (prefix ? "pl-7 pr-3" : "px-3")
          }
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
