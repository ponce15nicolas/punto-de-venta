// src/components/RestockModal.jsx

import {
  useEffect,
  useState,
} from "react";

import Modal from "./Modal";

/* =========================================================
   HELPERS
========================================================= */

function getTipoVenta(
  product
) {
  const tipo =
    product?.tipoVenta;

  if (
    tipo === "peso" ||
    tipo === "precio-libre"
  ) {
    return tipo;
  }

  return "unidad";
}

function toNumber(
  value,
  fallback = 0
) {
  const normalized =
    typeof value === "string"
      ? value.replace(
          ",",
          "."
        )
      : value;

  const number =
    Number(
      normalized
    );

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}

function roundWeight(
  value
) {
  return (
    Math.round(
      (
        toNumber(
          value
        ) +
        Number.EPSILON
      ) * 1000
    ) / 1000
  );
}

function formatStock(
  value,
  tipoVenta
) {
  const number =
    toNumber(
      value
    );

  if (
    tipoVenta ===
    "peso"
  ) {
    return `${number.toLocaleString(
      "es-AR",
      {
        minimumFractionDigits:
          0,
        maximumFractionDigits:
          3,
      }
    )} kg`;
  }

  return Math.trunc(
    number
  ).toLocaleString(
    "es-AR"
  );
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function RestockModal({
  open,
  onClose,
  product,
  onConfirm,
}) {
  const [
    add,
    setAdd,
  ] = useState("1");

  const [
    unitCost,
    setUnitCost,
  ] = useState("0");

  /* =========================================================
     TIPO
  ========================================================= */

  const tipoVenta =
    getTipoVenta(
      product
    );

  const ventaPorPeso =
    tipoVenta ===
    "peso";

  const precioLibre =
    tipoVenta ===
    "precio-libre";

  /* =========================================================
     REINICIAR
  ========================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    setAdd(
      ventaPorPeso
        ? "1"
        : "1"
    );

    setUnitCost(
      String(
        product?.cost ??
        0
      )
    );
  }, [
    open,
    ventaPorPeso,
    product?.cost,
  ]);

  if (!product) {
    return null;
  }

  /* =========================================================
     CANTIDAD
  ========================================================= */

  const cantidad =
    ventaPorPeso
      ? roundWeight(
          toNumber(
            add,
            NaN
          )
        )
      : parseInt(
          add,
          10
        );

  const cantidadValida =
    Number.isFinite(
      cantidad
    ) &&
    cantidad > 0;

  const stockActual =
    toNumber(
      product.stock
    );

  const stockFinal =
    cantidadValida
      ? ventaPorPeso
        ? roundWeight(
            stockActual +
              cantidad
          )
        : Math.trunc(
            stockActual +
              cantidad
          )
      : stockActual;

  const costoUnitario =
    toNumber(
      unitCost,
      NaN
    );

  const costoValido =
    Number.isFinite(
      costoUnitario
    ) &&
    costoUnitario >= 0;

  /* =========================================================
     CONFIRMAR
  ========================================================= */

  function confirmar() {
    if (
      precioLibre ||
      !cantidadValida ||
      !costoValido
    ) {
      return;
    }

    onConfirm({
      amount:
        cantidad,
      unitCost:
        costoUnitario,
    });
  }

  /* =========================================================
     SUMAR
  ========================================================= */

  function sumar() {
    if (
      ventaPorPeso
    ) {
      const actual =
        toNumber(
          add,
          0
        );

      setAdd(
        String(
          roundWeight(
            actual +
              0.1
          )
        )
      );

      return;
    }

    const actual =
      parseInt(
        add,
        10
      );

    setAdd(
      String(
        Number.isFinite(
          actual
        )
          ? actual + 1
          : 1
      )
    );
  }

  /* =========================================================
     RESTAR
  ========================================================= */

  function restar() {
    if (
      ventaPorPeso
    ) {
      const actual =
        toNumber(
          add,
          0
        );

      const next =
        roundWeight(
          actual -
            0.1
        );

      setAdd(
        String(
          next > 0
            ? next
            : 0.1
        )
      );

      return;
    }

    const actual =
      parseInt(
        add,
        10
      );

    if (
      !Number.isFinite(
        actual
      ) ||
      actual <= 1
    ) {
      setAdd(
        "1"
      );

      return;
    }

    setAdd(
      String(
        actual - 1
      )
    );
  }

  /* =========================================================
     UI
  ========================================================= */

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        precioLibre
          ? "Stock no disponible"
          : ventaPorPeso
            ? "Sumar stock por peso"
            : "Sumar stock"
      }
    >
      <div>
        {/* =================================================
            PRODUCTO
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
                  h-11
                  w-11
                  shrink-0
                  place-items-center
                  rounded-2xl
                  bg-[#FFF5CC]
                  text-[#9A7100]
                "
              >
                {ventaPorPeso ? (
                  <ScaleIcon className="h-5 w-5" />
                ) : precioLibre ? (
                  <MoneyIcon className="h-5 w-5" />
                ) : (
                  <BoxIcon className="h-5 w-5" />
                )}
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
                  {
                    product.name
                  }
                </h3>

                <p
                  className="
                    mt-1
                    text-xs
                    font-semibold
                    text-black/40
                  "
                >
                  {precioLibre
                    ? "Importe libre"
                    : ventaPorPeso
                      ? "Venta por kilogramo"
                      : "Venta por unidad"}
                </p>
              </div>

              {!precioLibre && (
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
                    {formatStock(
                      stockActual,
                      tipoVenta
                    )}
                  </span>
                </div>
              )}
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
            PRECIO LIBRE
        ================================================= */}

        {precioLibre ? (
          <>
            <div
              className="
                mb-4
                rounded-[22px]
                border
                border-[#FFC61A]/20
                bg-[#FFC61A]/10
                p-4
              "
            >
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
                    h-10
                    w-10
                    shrink-0
                    place-items-center
                    rounded-xl
                    bg-[#FFC61A]
                    text-black
                  "
                >
                  <MoneyIcon className="h-4.5 w-4.5" />
                </div>

                <div>
                  <p
                    className="
                      text-sm
                      font-extrabold
                      text-white
                    "
                  >
                    Este producto no utiliza stock
                  </p>

                  <p
                    className="
                      mt-1
                      text-xs
                      leading-relaxed
                      text-white/45
                    "
                  >
                    Los productos configurados como importe libre registran solamente el monto vendido y no descuentan unidades del inventario.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={
                onClose
              }
              className="
                inline-flex
                w-full
                items-center
                justify-center
                rounded-2xl
                bg-[#FFC61A]
                px-4
                py-3.5
                text-sm
                font-extrabold
                text-black
                transition
                hover:bg-[#FFD248]
                active:scale-[0.99]
              "
            >
              Entendido
            </button>
          </>
        ) : (
          <>
            {/* ===============================================
                CANTIDAD / PESO
            =============================================== */}

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
                {ventaPorPeso
                  ? "Peso a sumar"
                  : "Cantidad a sumar"}
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
                  onClick={
                    restar
                  }
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
                  aria-label={
                    ventaPorPeso
                      ? "Restar 100 gramos"
                      : "Restar una unidad"
                  }
                >
                  <MinusIcon className="h-4 w-4" />
                </button>

                <div
                  className="
                    relative
                    min-w-0
                    flex-1
                  "
                >
                  <input
                    id="restock-amount"
                    type="number"
                    step={
                      ventaPorPeso
                        ? "0.001"
                        : "1"
                    }
                    min={
                      ventaPorPeso
                        ? "0.001"
                        : "1"
                    }
                    inputMode={
                      ventaPorPeso
                        ? "decimal"
                        : "numeric"
                    }
                    autoFocus
                    className="
                      w-full
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
                    value={
                      add
                    }
                    onChange={(
                      event
                    ) =>
                      setAdd(
                        event.target
                          .value
                      )
                    }
                    placeholder={
                      ventaPorPeso
                        ? "0.000"
                        : "1"
                    }
                    onKeyDown={(
                      event
                    ) => {
                      if (
                        event.key ===
                        "Enter"
                      ) {
                        confirmar();
                      }
                    }}
                  />

                  {ventaPorPeso && (
                    <span
                      className="
                        pointer-events-none
                        absolute
                        right-4
                        top-1/2
                        -translate-y-1/2
                        text-[10px]
                        font-extrabold
                        text-white/30
                      "
                    >
                      kg
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={
                    sumar
                  }
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
                  aria-label={
                    ventaPorPeso
                      ? "Sumar 100 gramos"
                      : "Sumar una unidad"
                  }
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>

              {ventaPorPeso && (
                <p
                  className="
                    mt-2
                    text-[11px]
                    leading-relaxed
                    text-white/30
                  "
                >
                  Podés ingresar hasta tres decimales. Por ejemplo: 0,650 kg o 12,350 kg.
                </p>
              )}
            </div>

            <div className="mb-4">
              <label
                htmlFor="restock-cost"
                className="mb-2 block text-xs font-bold text-white/55"
              >
                {ventaPorPeso
                  ? "Costo de compra por kg"
                  : "Costo de compra por unidad"}
              </label>

              <div className="relative">
                <span
                  className="
                    pointer-events-none absolute left-4 top-1/2
                    -translate-y-1/2 text-sm font-black text-[#FFC61A]
                  "
                >
                  $
                </span>

                <input
                  id="restock-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={unitCost}
                  onChange={(event) =>
                    setUnitCost(
                      event.target.value
                    )
                  }
                  className="
                    w-full rounded-2xl border border-white/10
                    bg-[#171B23] py-3 pl-9 pr-4 text-sm
                    font-extrabold text-white outline-none transition
                    focus:border-[#FFC61A] focus:ring-2 focus:ring-[#FFC61A]/10
                  "
                  placeholder="0.00"
                />
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-white/30">
                El sistema recalcula automáticamente el costo promedio del stock existente.
              </p>

              {!costoValido && unitCost !== "" && (
                <p className="mt-2 text-xs font-bold text-red-300">
                  Ingresá un costo igual o mayor a 0.
                </p>
              )}
            </div>

            {/* ===============================================
                PREVISUALIZACIÓN
            =============================================== */}

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
                value={formatStock(
                  stockActual,
                  tipoVenta
                )}
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
                value={formatStock(
                  stockFinal,
                  tipoVenta
                )}
                highlight
              />
            </div>

            {/* ===============================================
                VALIDACIÓN
            =============================================== */}

            {!cantidadValida &&
              add !== "" && (
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

                  {ventaPorPeso
                    ? "El peso debe ser mayor a 0."
                    : "La cantidad debe ser mayor a 0."}
                </div>
              )}

            {/* ===============================================
                CONFIRMAR
            =============================================== */}

            <button
              type="button"
              onClick={
                confirmar
              }
              disabled={
                !cantidadValida ||
                !costoValido
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
              <StockIcon className="h-4 w-4" />

              {ventaPorPeso
                ? "Sumar peso al stock"
                : "Sumar al stock"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

/* =========================================================
   PREVISUALIZACIÓN
========================================================= */

function StockPreview({
  label,
  value,
  highlight = false,
}) {
  return (
    <div className="min-w-0 text-center">
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
            text-lg
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

function ScaleIcon({
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
      <path d="M12 3v4" />
      <path d="M5 7h14" />
      <path d="m7 7-4 7h8L7 7Z" />
      <path d="m17 7-4 7h8l-4-7Z" />
      <path d="M12 7v13" />
      <path d="M8 20h8" />
    </svg>
  );
}

function MoneyIcon({
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

      <circle
        cx="12"
        cy="12"
        r="2.5"
      />

      <path d="M7 9h.01" />
      <path d="M17 15h.01" />
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