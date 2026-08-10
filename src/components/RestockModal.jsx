import { useEffect, useState } from "react";
import Modal from "./Modal";

export default function RestockModal({ open, onClose, product, onConfirm }) {
  const [add, setAdd] = useState("1");
  useEffect(() => {
    if (open) setAdd("1");
  }, [open]);
  if (!product) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Sumar stock · ${product.name}`}>
      <div className="mb-3">
        <label className="block text-xs text-cream-dim mb-1.5">Stock actual: {product.stock}</label>
        <input
          type="number"
          step="1"
          min="1"
          className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          placeholder="Cantidad a sumar"
        />
      </div>
      <button
        className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold"
        onClick={() => {
          const n = parseInt(add, 10);
          if (isNaN(n) || n <= 0) return;
          onConfirm(n);
        }}
      >
        Sumar al stock
      </button>
    </Modal>
  );
}
