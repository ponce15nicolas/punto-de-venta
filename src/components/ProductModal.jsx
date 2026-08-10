import { useEffect, useState } from "react";
import Modal from "./Modal";

const empty = { barcode: "", name: "", price: "", stock: "0", expiry: "" };

export default function ProductModal({ open, onClose, product, onSave, onScan, scannedCode }) {
  const editing = !!product;
  const [form, setForm] = useState(empty);

  useEffect(() => {
    if (open) setForm(product ? { ...product, price: String(product.price), stock: String(product.stock) } : empty);
  }, [open, product]);

  useEffect(() => {
    if (scannedCode) setForm((f) => ({ ...f, barcode: scannedCode }));
  }, [scannedCode]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function save() {
    const code = form.barcode.trim();
    const name = form.name.trim();
    const price = parseFloat(form.price);
    const stock = parseInt(form.stock, 10);
    if (!code || !name || isNaN(price) || price < 0 || isNaN(stock) || stock < 0) {
      onSave(null, "Completá código, nombre, precio y stock");
      return;
    }
    onSave({ barcode: code, name, price, stock, expiry: form.expiry || null }, null);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Editar producto" : "Nuevo producto"}>
      <Field label="Código de barras">
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm disabled:opacity-50"
            disabled={editing}
            value={form.barcode}
            onChange={(e) => set("barcode", e.target.value)}
            placeholder="Escanear o escribir"
          />
          <button
            className="bg-amber text-amber-ink rounded-lg px-4 font-semibold disabled:opacity-40"
            disabled={editing}
            onClick={onScan}
          >
            📷
          </button>
        </div>
      </Field>
      <Field label="Nombre del producto">
        <input
          className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream text-sm font-sans"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Ej: Coca-Cola 500ml"
        />
      </Field>
      <Field label="Precio de venta">
        <input
          type="number"
          step="0.01"
          min="0"
          className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm"
          value={form.price}
          onChange={(e) => set("price", e.target.value)}
          placeholder="0.00"
        />
      </Field>
      <Field label={editing ? "Stock actual" : "Stock inicial"}>
        <input
          type="number"
          step="1"
          min="0"
          className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm"
          value={form.stock}
          onChange={(e) => set("stock", e.target.value)}
        />
      </Field>
      <Field label="Fecha de vencimiento (opcional)">
        <input
          type="date"
          className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm [color-scheme:dark]"
          value={form.expiry || ""}
          onChange={(e) => set("expiry", e.target.value)}
        />
      </Field>
      <button className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold" onClick={save}>
        {editing ? "Guardar cambios" : "Agregar producto"}
      </button>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-cream-dim mb-1.5">{label}</label>
      {children}
    </div>
  );
}
