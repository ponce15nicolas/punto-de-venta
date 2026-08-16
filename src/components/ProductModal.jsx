// src/components/ProductModal.jsx
// Modal para crear o editar productos.
// Rediseñado con la misma identidad visual del POS.
// Mantiene la lógica original y reutiliza el componente Modal existente.

import { useEffect, useState } from "react";
import Modal from "./Modal";

const empty = {
  barcode: "",
  name: "",
  price: "",
  stock: "0",
  expiry: "",
};

export default function ProductModal({
  open,
  onClose,
  product,
  onSave,
  onScan,
  scannedCode,
}) {
  const editing = !!product;
  const [form, setForm] = useState(empty);

  useEffect(() => {
    if (open) {
      setForm(
        product
          ? {
            ...product,
            price: String(product.price),
            stock: String(product.stock),
          }
          : empty
      );
    }
  }, [open, product]);

  useEffect(() => {
    if (scannedCode) {
      setForm((f) => ({
        ...f,
        barcode: scannedCode,
      }));
    }
  }, [scannedCode]);

  function set(field, value) {
    setForm((f) => ({
      ...f,
      [field]: value,
    }));
  }

  function save() {
    const code = form.barcode.trim();
    const name = form.name.trim();
    const price = parseFloat(form.price);
    const stock = parseInt(form.stock, 10);

    if (
      !code ||
      !name ||
      isNaN(price) ||
      price < 0 ||
      isNaN(stock) ||
      stock < 0
    ) {
      onSave(
        null,
        "Completá código, nombre, precio y stock"
      );
      return;
    }

    onSave(
      {
        barcode: code,
        name,
        price,
        stock,
        expiry: form.expiry || null,
      },
      null
    );
  }

  const stockNumero = parseInt(form.stock, 10);
  const priceNumero = parseFloat(form.price);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Editar producto" : "Nuevo producto"}
    >
      <div>
        {/* =================================================
            RESUMEN DEL PRODUCTO
        ================================================= */}

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
            <div className="flex items-start gap-3">
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
                <BoxIcon className="h-5 w-5" />
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
                  {editing ? "Editando producto" : "Alta de producto"}
                </p>

                <h3
                  className="
                    mt-1
                    truncate
                    text-lg
                    font-black
                    tracking-[-0.02em]
                    text-[#111318]
                  "
                >
                  {form.name.trim() || "Producto sin nombre"}
                </h3>

                <p className="mt-1 text-xs font-medium text-black/40">
                  {form.barcode.trim() || "Sin código de barras"}
                </p>
              </div>

              <div
                className="
                  shrink-0
                  rounded-2xl
                  bg-[#F4F5F7]
                  px-3
                  py-2
                  text-right
                "
              >
                <span
                  className="
                    block
                    text-[9px]
                    font-bold
                    uppercase
                    tracking-[0.1em]
                    text-black/35
                  "
                >
                  Stock
                </span>

                <span
                  className="
                    mt-0.5
                    block
                    text-base
                    font-black
                    text-[#111318]
                  "
                >
                  {isNaN(stockNumero) ? 0 : stockNumero}
                </span>
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

        {/* =================================================
            CÓDIGO DE BARRAS
        ================================================= */}

        <Field label="Código de barras">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <BarcodeIcon
                className="
                  pointer-events-none
                  absolute
                  left-3.5
                  top-1/2
                  h-4
                  w-4
                  -translate-y-1/2
                  text-white/30
                "
              />

              <input
                className="
                  w-full
                  rounded-2xl
                  border
                  border-white/10
                  bg-[#171B23]
                  py-3
                  pl-10
                  pr-3.5
                  text-sm
                  font-semibold
                  text-white
                  outline-none
                  transition
                  placeholder:text-white/25
                  focus:border-[#FFC61A]
                  focus:ring-2
                  focus:ring-[#FFC61A]/10
                  disabled:cursor-not-allowed
                  disabled:opacity-45
                "
                disabled={editing}
                value={form.barcode}
                onChange={(e) =>
                  set("barcode", e.target.value)
                }
                placeholder="Escanear o escribir"
              />
            </div>

            <button
              type="button"
              className="
                grid
                h-12
                w-12
                shrink-0
                place-items-center
                rounded-2xl
                bg-[#FFC61A]
                text-black
                shadow-[0_8px_22px_rgba(255,198,26,0.16)]
                transition
                hover:bg-[#FFD248]
                active:scale-[0.97]
                disabled:cursor-not-allowed
                disabled:opacity-40
              "
              disabled={editing}
              onClick={onScan}
              aria-label="Escanear código de barras"
            >
              <CameraIcon className="h-5 w-5" />
            </button>
          </div>

          {editing && (
            <p className="mt-1.5 text-[11px] text-white/30">
              El código de barras no se puede modificar al editar.
            </p>
          )}
        </Field>

        {/* =================================================
            NOMBRE
        ================================================= */}

        <Field label="Nombre del producto">
          <div className="relative">
            <TagIcon
              className="
                pointer-events-none
                absolute
                left-3.5
                top-1/2
                h-4
                w-4
                -translate-y-1/2
                text-white/30
              "
            />

            <input
              className="
                w-full
                rounded-2xl
                border
                border-white/10
                bg-[#171B23]
                py-3
                pl-10
                pr-3.5
                text-sm
                font-semibold
                text-white
                outline-none
                transition
                placeholder:text-white/25
                focus:border-[#FFC61A]
                focus:ring-2
                focus:ring-[#FFC61A]/10
              "
              value={form.name}
              onChange={(e) =>
                set("name", e.target.value)
              }
              placeholder="Ej: Coca-Cola 500ml"
            />
          </div>
        </Field>

        {/* =================================================
            PRECIO + STOCK
        ================================================= */}

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Precio de venta">
            <div className="relative">
              <span
                className="
                  pointer-events-none
                  absolute
                  left-3.5
                  top-1/2
                  -translate-y-1/2
                  text-sm
                  font-extrabold
                  text-[#FFC61A]
                "
              >
                $
              </span>

              <input
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
                  py-3
                  pl-8
                  pr-3
                  text-sm
                  font-extrabold
                  text-white
                  outline-none
                  transition
                  placeholder:text-white/25
                  focus:border-[#FFC61A]
                  focus:ring-2
                  focus:ring-[#FFC61A]/10
                "
                value={form.price}
                onChange={(e) =>
                  set("price", e.target.value)
                }
                placeholder="0.00"
              />
            </div>
          </Field>

          <Field label={editing ? "Stock actual" : "Stock inicial"}>
            <div className="relative">
              <StockIcon
                className="
                  pointer-events-none
                  absolute
                  left-3.5
                  top-1/2
                  h-4
                  w-4
                  -translate-y-1/2
                  text-white/30
                "
              />

              <input
                type="number"
                step="1"
                min="0"
                inputMode="numeric"
                className="
                  w-full
                  rounded-2xl
                  border
                  border-white/10
                  bg-[#171B23]
                  py-3
                  pl-10
                  pr-3
                  text-sm
                  font-extrabold
                  text-white
                  outline-none
                  transition
                  focus:border-[#FFC61A]
                  focus:ring-2
                  focus:ring-[#FFC61A]/10
                "
                value={form.stock}
                onChange={(e) =>
                  set("stock", e.target.value)
                }
              />
            </div>
          </Field>
        </div>

        {/* =================================================
            VENCIMIENTO
        ================================================= */}

        <Field label="Fecha de vencimiento (opcional)">
          <div className="relative">
            <CalendarIcon
              className="
                pointer-events-none
                absolute
                left-3.5
                top-1/2
                h-4
                w-4
                -translate-y-1/2
                text-white/30
              "
            />

            <input
              type="date"
              className="
                w-full
                rounded-2xl
                border
                border-white/10
                bg-[#171B23]
                py-3
                pl-10
                pr-3.5
                text-sm
                font-semibold
                text-white
                outline-none
                transition
                [color-scheme:dark]
                focus:border-[#FFC61A]
                focus:ring-2
                focus:ring-[#FFC61A]/10
              "
              value={form.expiry || ""}
              onChange={(e) =>
                set("expiry", e.target.value)
              }
            />
          </div>
        </Field>

        {/* =================================================
            PREVISUALIZACIÓN
        ================================================= */}

        <div
          className="
            mb-4
            grid
            grid-cols-2
            gap-2.5
            rounded-[22px]
            border
            border-white/10
            bg-[#151A22]
            p-3.5
          "
        >
          <PreviewBox
            label="Precio"
            value={
              isNaN(priceNumero)
                ? "$ 0,00"
                : priceNumero.toLocaleString("es-AR", {
                  style: "currency",
                  currency: "ARS",
                  minimumFractionDigits: 2,
                })
            }
          />

          <PreviewBox
            label="Stock"
            value={isNaN(stockNumero) ? "0" : stockNumero}
            highlight
          />
        </div>

        {/* =================================================
            GUARDAR
        ================================================= */}

        <button
          type="button"
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
          "
          onClick={save}
        >
          {editing ? (
            <SaveIcon className="h-4 w-4" />
          ) : (
            <PlusIcon className="h-4 w-4" />
          )}

          {editing ? "Guardar cambios" : "Agregar producto"}
        </button>
      </div>
    </Modal>
  );
}

/* =========================================================
   FIELD
========================================================= */

function Field({
  label,
  children,
}) {
  return (
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
        {label}
      </label>

      {children}
    </div>
  );
}

/* =========================================================
   PREVIEW BOX
========================================================= */

function PreviewBox({
  label,
  value,
  highlight = false,
}) {
  return (
    <div className="text-center">
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

function BoxIcon({ className = "" }) {
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

function BarcodeIcon({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14" />
    </svg>
  );
}

function CameraIcon({ className = "" }) {
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
      <path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9H3V9a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function TagIcon({ className = "" }) {
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
      <path d="M20 13 11 22 2 13V4h9l9 9Z" />
      <circle cx="7" cy="9" r="1" />
    </svg>
  );
}

function StockIcon({ className = "" }) {
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
      <path d="M4 7h16v13H4z" />
      <path d="M8 7V4h8v3" />
    </svg>
  );
}

function CalendarIcon({ className = "" }) {
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

function SaveIcon({ className = "" }) {
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
      <path d="M5 4h12l2 2v14H5V4Z" />
      <path d="M8 4v6h8V4" />
      <path d="M8 20v-6h8v6" />
    </svg>
  );
}

function PlusIcon({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
