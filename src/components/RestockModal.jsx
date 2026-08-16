// src/components/RestockModal.jsx
// Modal para sumar stock a un producto.
// Rediseñado con la misma identidad visual del POS.
// Mantiene la lógica original y reutiliza el componente Modal existente.

import { useEffect, useState } from "react";
import Modal from "./Modal";

export default function RestockModal({
  open,
  onClose,
  product,
  onConfirm,
}) {
  const [add, setAdd] = useState("1");

  useEffect(() => {
    if (open) {
      setAdd("1");
    }
  }, [open]);

  if (!product) return null;

  const cantidad = parseInt(add, 10);
  const cantidadValida = !isNaN(cantidad) && cantidad > 0;
  const stockActual = Number(product.stock || 0);
  const stockFinal = cantidadValida
    ? stockActual + cantidad
    : stockActual;

  const confirmar = () => {
    if (!cantidadValida) return;

    onConfirm(cantidad);
  };

  const sumarUno = () => {
    const actual = parseInt(add, 10);

    setAdd(
      String(
        isNaN(actual)
          ? 1
          : actual + 1
      )
    );
  };

  const restarUno = () => {
    const actual = parseInt(add, 10);

    if (isNaN(actual) || actual <= 1) {
      setAdd("1");
      return;
    }

    setAdd(String(actual - 1));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sumar stock"
    >
      <div>

        {/* PRODUCTO */}

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
                  Producto
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
                  {product.name}
                </h3>

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
                  {stockActual}
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

        {/* CANTIDAD */}

        <div className="mb-4">

          <label
            htmlFor="restock-amount"
            className="
              mb-2
              block
              text-xs
              font-bold
              text-white/55
            "
          >
            Cantidad a sumar
          </label>

          <div
            className="
              flex
              items-center
              gap-2
            "
          >

            <button
              type="button"
              onClick={restarUno}
              className="
                grid
                h-12
                w-12
                shrink-0
                place-items-center
                rounded-2xl
                border
                border-white/10
                bg-[#171B23]
                text-white
                transition
                hover:bg-[#202630]
                active:scale-[0.97]
              "
              aria-label="Restar una unidad"
            >
              <MinusIcon className="h-4 w-4" />
            </button>

            <input
              id="restock-amount"
              type="number"
              step="1"
              min="1"
              inputMode="numeric"
              className="
                min-w-0
                flex-1
                rounded-2xl
                border
                border-white/10
                bg-[#171B23]
                px-4
                py-3
                text-center
                text-base
                font-extrabold
                text-white
                outline-none
                transition
                placeholder:text-white/25
                focus:border-[#FFC61A]
                focus:ring-2
                focus:ring-[#FFC61A]/10
              "
              value={add}
              onChange={(e) =>
                setAdd(e.target.value)
              }
              placeholder="1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  confirmar();
                }
              }}
            />

            <button
              type="button"
              onClick={sumarUno}
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
              "
              aria-label="Sumar una unidad"
            >
              <PlusIcon className="h-4 w-4" />
            </button>

          </div>
        </div>

        {/* PREVISUALIZACIÓN */}

        <div
          className="
            mb-4
            grid
            grid-cols-[1fr_auto_1fr]
            items-center
            gap-2
            rounded-[22px]
            border
            border-white/10
            bg-[#151A22]
            p-3.5
          "
        >

          <StockPreview
            label="Actual"
            value={stockActual}
          />

          <ArrowIcon
            className="
              h-4
              w-4
              text-white/25
            "
          />

          <StockPreview
            label="Nuevo stock"
            value={stockFinal}
            highlight
          />

        </div>

        {/* VALIDACIÓN */}

        {!cantidadValida && add !== "" && (
          <div
            className="
              mb-3
              flex
              items-start
              gap-2
              rounded-2xl
              border
              border-red-400/20
              bg-red-500/10
              px-3.5
              py-3
              text-sm
              text-red-200
            "
          >
            <AlertIcon
              className="
                mt-0.5
                h-4
                w-4
                shrink-0
              "
            />

            La cantidad debe ser mayor a 0.
          </div>
        )}

        {/* CONFIRMAR */}

        <button
          type="button"
          onClick={confirmar}
          disabled={!cantidadValida}
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
          <StockIcon className="h-4 w-4" />

          Sumar al stock
        </button>

      </div>
    </Modal>
  );
}

/* =========================================================
   PREVISUALIZACIÓN DE STOCK
========================================================= */

function StockPreview({
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
            text-xl
            font-black
          ` +
          (
            highlight
              ? "text-[#FFC61A]"
              : "text-white"
          )
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

function MinusIcon({
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
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon({
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
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function ArrowIcon({
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
      <path d="M5 12h14" />
      <path d="m15 8 4 4-4 4" />
    </svg>
  );
}

function StockIcon({
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
      <path d="M4 7h16v13H4z" />
      <path d="M8 7V4h8v3" />
      <path d="M12 11v5" />
      <path d="M9.5 13.5h5" />
    </svg>
  );
}

function AlertIcon({
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
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}