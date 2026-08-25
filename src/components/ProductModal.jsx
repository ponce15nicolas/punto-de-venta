// src/components/ProductModal.jsx

import { useEffect, useState } from "react";
import Modal from "./Modal";

const EMPTY_FORM = {
  barcode: "",
  name: "",
  price: "",
  cost: "0",
  stock: "0",
  expiry: "",
  tipoVenta: "unidad",
  unidadMedida: "kg",
};

const TIPOS_VENTA = [
  {
    id: "unidad",
    label: "Por unidad",
    description: "Productos con precio fijo por unidad.",
    icon: UnitIcon,
  },
  {
    id: "peso",
    label: "Por peso",
    description: "Frutas, verduras, carne, fiambre y similares.",
    icon: ScaleIcon,
  },
  {
    id: "precio-libre",
    label: "Importe libre",
    description: "El precio se ingresa directamente al vender.",
    icon: MoneyIcon,
  },
];

export default function ProductModal({
  open,
  onClose,
  product,
  onSave,
  onScan,
  scannedCode,
}) {
  const editing = !!product;

  const [form, setForm] =
    useState(EMPTY_FORM);

  /* =========================================================
     CARGAR PRODUCTO
  ========================================================= */

  useEffect(() => {
    if (!open) return;

    if (product) {
      setForm({
        barcode:
          product.barcode || "",

        name:
          product.name || "",

        price:
          String(
            product.price ?? ""
          ),

        cost:
          String(
            product.cost ?? 0
          ),

        stock:
          String(
            product.stock ?? 0
          ),

        expiry:
          product.expiry || "",

        tipoVenta:
          product.tipoVenta ||
          "unidad",

        unidadMedida:
          product.unidadMedida ||
          "kg",
      });

      return;
    }

    setForm({
      ...EMPTY_FORM,
    });
  }, [
    open,
    product,
  ]);

  /* =========================================================
     CÓDIGO ESCANEADO
  ========================================================= */

  useEffect(() => {
    if (!scannedCode) {
      return;
    }

    setForm((current) => ({
      ...current,
      barcode: scannedCode,
    }));
  }, [
    scannedCode,
  ]);

  /* =========================================================
     SET FIELD
  ========================================================= */

  function set(
    field,
    value
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  /* =========================================================
     CAMBIAR TIPO DE VENTA
  ========================================================= */

  function cambiarTipoVenta(
    tipo
  ) {
    setForm((current) => {
      const next = {
        ...current,
        tipoVenta: tipo,
      };

      /*
       * Un producto de precio libre no necesita
       * precio base ni stock para poder venderse.
       */
      if (
        tipo ===
        "precio-libre"
      ) {
        next.price = "0";
        next.cost = "0";
        next.stock = "0";
      }

      /*
       * Al volver a unidad mantenemos valores seguros.
       */
      if (
        tipo === "unidad" &&
        Number(next.stock) < 0
      ) {
        next.stock = "0";
      }

      return next;
    });
  }

  /* =========================================================
     GENERAR CÓDIGO INTERNO
  ========================================================= */

  function generarCodigoInterno() {
    const random =
      Math.random()
        .toString(36)
        .slice(2, 8);

    return `manual-${Date.now()}-${random}`;
  }

  /* =========================================================
     GUARDAR
  ========================================================= */

  function save() {
    const name =
      form.name.trim();

    const tipoVenta =
      form.tipoVenta ||
      "unidad";

    const precioLibre =
      tipoVenta ===
      "precio-libre";

    const ventaPorPeso =
      tipoVenta ===
      "peso";

    let barcode =
      form.barcode.trim();

    /*
     * Pan, verduras y otros productos pueden
     * no tener código de barras.
     *
     * Generamos un identificador interno para
     * mantener compatibilidad con el catálogo.
     */
    if (!barcode) {
      barcode =
        product?.barcode ||
        generarCodigoInterno();
    }

    const price =
      precioLibre
        ? 0
        : parseFloat(
            form.price
          );

    const cost =
      precioLibre
        ? 0
        : parseFloat(
            form.cost
          );

    const stock =
      precioLibre
        ? 0
        : ventaPorPeso
          ? parseFloat(
              form.stock
            )
          : parseInt(
              form.stock,
              10
            );

    if (!name) {
      onSave(
        null,
        "Ingresá el nombre del producto"
      );

      return;
    }

    if (
      !precioLibre &&
      (
        Number.isNaN(
          price
        ) ||
        price < 0
      )
    ) {
      onSave(
        null,
        ventaPorPeso
          ? "Ingresá un precio por kg válido"
          : "Ingresá un precio de venta válido"
      );

      return;
    }

    if (
      !precioLibre &&
      (
        Number.isNaN(
          cost
        ) ||
        cost < 0
      )
    ) {
      onSave(
        null,
        ventaPorPeso
          ? "Ingresá un costo por kg válido"
          : "Ingresá un costo de mercadería válido"
      );

      return;
    }

    if (
      !precioLibre &&
      (
        Number.isNaN(
          stock
        ) ||
        stock < 0
      )
    ) {
      onSave(
        null,
        ventaPorPeso
          ? "Ingresá un stock en kg válido"
          : "Ingresá un stock válido"
      );

      return;
    }

    onSave(
      {
        barcode,
        name,

        price,

        cost,

        stock,

        expiry:
          form.expiry ||
          null,

        tipoVenta,

        unidadMedida:
          ventaPorPeso
            ? form.unidadMedida ||
              "kg"
            : null,
      },
      null
    );
  }

  /* =========================================================
     DATOS PREVIEW
  ========================================================= */

  const ventaPorPeso =
    form.tipoVenta ===
    "peso";

  const precioLibre =
    form.tipoVenta ===
    "precio-libre";

  const priceNumero =
    parseFloat(
      form.price
    );

  const costNumero =
    parseFloat(
      form.cost
    );

  const stockNumero =
    ventaPorPeso
      ? parseFloat(
          form.stock
        )
      : parseInt(
          form.stock,
          10
        );

  const tipoActual =
    TIPOS_VENTA.find(
      (tipo) =>
        tipo.id ===
        form.tipoVenta
    ) ||
    TIPOS_VENTA[0];

  /* =========================================================
     UI
  ========================================================= */

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        editing
          ? "Editar producto"
          : "Nuevo producto"
      }
    >
      <div>
        {/* =================================================
            RESUMEN
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
                <ProductTypeIcon
                  tipo={
                    form.tipoVenta
                  }
                  className="h-5 w-5"
                />
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
                  {editing
                    ? "Editando producto"
                    : "Alta de producto"}
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
                  {form.name.trim() ||
                    "Producto sin nombre"}
                </h3>

                <p
                  className="
                    mt-1
                    text-xs
                    font-medium
                    text-black/40
                  "
                >
                  {
                    tipoActual.label
                  }
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
                  {precioLibre
                    ? "Precio"
                    : ventaPorPeso
                      ? "Stock"
                      : "Stock"}
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
                  {precioLibre
                    ? "Libre"
                    : ventaPorPeso
                      ? `${formatDecimal(
                          stockNumero
                        )} kg`
                      : Number.isNaN(
                            stockNumero
                          )
                        ? "0"
                        : stockNumero}
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
            FORMA DE VENTA
        ================================================= */}

        <Field label="Forma de venta">
          <div
            className="
              grid
              grid-cols-1
              gap-2
            "
          >
            {TIPOS_VENTA.map(
              (tipo) => {
                const active =
                  form.tipoVenta ===
                  tipo.id;

                const Icon =
                  tipo.icon;

                return (
                  <button
                    key={
                      tipo.id
                    }
                    type="button"
                    onClick={() =>
                      cambiarTipoVenta(
                        tipo.id
                      )
                    }
                    className={
                      `
                        flex
                        w-full
                        items-center
                        gap-3
                        rounded-2xl
                        border
                        px-3.5
                        py-3
                        text-left
                        transition
                        active:scale-[0.99]
                      ` +
                      (
                        active
                          ? `
                            border-[#FFC61A]/60
                            bg-[#FFC61A]/10
                          `
                          : `
                            border-white/10
                            bg-[#171B23]
                            hover:border-white/20
                          `
                      )
                    }
                  >
                    <div
                      className={
                        `
                          grid
                          h-10
                          w-10
                          shrink-0
                          place-items-center
                          rounded-xl
                          transition
                        ` +
                        (
                          active
                            ? `
                              bg-[#FFC61A]
                              text-black
                            `
                            : `
                              bg-white/5
                              text-white/40
                            `
                        )
                      }
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </div>

                    <div
                      className="
                        min-w-0
                        flex-1
                      "
                    >
                      <div
                        className="
                          flex
                          items-center
                          gap-2
                        "
                      >
                        <span
                          className={
                            `
                              text-sm
                              font-extrabold
                            ` +
                            (
                              active
                                ? " text-[#FFC61A]"
                                : " text-white"
                            )
                          }
                        >
                          {
                            tipo.label
                          }
                        </span>

                        {active && (
                          <CheckIcon
                            className="
                              h-4
                              w-4
                              text-[#FFC61A]
                            "
                          />
                        )}
                      </div>

                      <p
                        className="
                          mt-0.5
                          text-[11px]
                          leading-relaxed
                          text-white/35
                        "
                      >
                        {
                          tipo.description
                        }
                      </p>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </Field>

        {/* =================================================
            CÓDIGO DE BARRAS
        ================================================= */}

        <Field label="Código de barras (opcional)">
          <div className="flex gap-2">
            <div
              className="
                relative
                min-w-0
                flex-1
              "
            >
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
                className={`
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
                `}
                disabled={
                  editing
                }
                value={
                  form.barcode
                }
                onChange={(
                  event
                ) =>
                  set(
                    "barcode",
                    event.target
                      .value
                  )
                }
                placeholder="Escanear, escribir o dejar vacío"
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
              disabled={
                editing
              }
              onClick={
                onScan
              }
              aria-label="Escanear código de barras"
            >
              <CameraIcon className="h-5 w-5" />
            </button>
          </div>

          <p
            className="
              mt-1.5
              text-[11px]
              leading-relaxed
              text-white/30
            "
          >
            {editing
              ? "El código no se puede modificar al editar."
              : "Si el producto no tiene código, el sistema generará uno interno automáticamente."}
          </p>
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
              value={
                form.name
              }
              onChange={(
                event
              ) =>
                set(
                  "name",
                  event.target
                    .value
                )
              }
              placeholder={
                ventaPorPeso
                  ? "Ej: Tomate"
                  : precioLibre
                    ? "Ej: Pan"
                    : "Ej: Coca-Cola 500ml"
              }
            />
          </div>
        </Field>

        {/* =================================================
            PRECIO LIBRE
        ================================================= */}

        {precioLibre && (
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
                  Importe al momento de vender
                </p>

                <p
                  className="
                    mt-1
                    text-xs
                    leading-relaxed
                    text-white/45
                  "
                >
                  Este producto no tendrá un precio fijo. Al agregarlo a una venta se ingresará directamente el importe cobrado.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* =================================================
            PRECIO + STOCK
        ================================================= */}

        {!precioLibre && (
          <div
            className="
              grid
              grid-cols-1
              gap-2.5
              min-[420px]:grid-cols-3
            "
          >
            <Field
              label={
                ventaPorPeso
                  ? "Precio por kg"
                  : "Precio de venta"
              }
            >
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
                  value={
                    form.price
                  }
                  onChange={(
                    event
                  ) =>
                    set(
                      "price",
                      event.target
                        .value
                    )
                  }
                  placeholder="0.00"
                />
              </div>
            </Field>

            <Field
              label={
                ventaPorPeso
                  ? "Costo por kg"
                  : "Costo mercadería"
              }
            >
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
                  value={form.cost}
                  onChange={(event) =>
                    set(
                      "cost",
                      event.target.value
                    )
                  }
                  placeholder="0.00"
                />
              </div>
            </Field>

            <Field
              label={
                ventaPorPeso
                  ? editing
                    ? "Stock actual (kg)"
                    : "Stock inicial (kg)"
                  : editing
                    ? "Stock actual"
                    : "Stock inicial"
              }
            >
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
                  step={
                    ventaPorPeso
                      ? "0.001"
                      : "1"
                  }
                  min="0"
                  inputMode={
                    ventaPorPeso
                      ? "decimal"
                      : "numeric"
                  }
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
                  value={
                    form.stock
                  }
                  onChange={(
                    event
                  ) =>
                    set(
                      "stock",
                      event.target
                        .value
                    )
                  }
                />
              </div>
            </Field>
          </div>
        )}

        {/* =================================================
            INFO PESO
        ================================================= */}

        {ventaPorPeso && (
          <div
            className="
              mb-4
              rounded-[22px]
              border
              border-white/10
              bg-[#151A22]
              p-3.5
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
                  h-9
                  w-9
                  shrink-0
                  place-items-center
                  rounded-xl
                  bg-white/5
                  text-[#FFC61A]
                "
              >
                <ScaleIcon className="h-4 w-4" />
              </div>

              <div>
                <p
                  className="
                    text-xs
                    font-extrabold
                    text-white/75
                  "
                >
                  Venta por kilogramo
                </p>

                <p
                  className="
                    mt-1
                    text-[11px]
                    leading-relaxed
                    text-white/35
                  "
                >
                  El stock admite decimales. Por ejemplo: 15,500 kg. Al vender podrás ingresar el peso o el importe.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* =================================================
            VENCIMIENTO
        ================================================= */}

        {!precioLibre && (
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
                value={
                  form.expiry ||
                  ""
                }
                onChange={(
                  event
                ) =>
                  set(
                    "expiry",
                    event.target
                      .value
                  )
                }
              />
            </div>
          </Field>
        )}

        {/* =================================================
            PREVIEW
        ================================================= */}

        <div
          className="
            mb-4
            grid
            grid-cols-3
            gap-2.5
            rounded-[22px]
            border
            border-white/10
            bg-[#151A22]
            p-3.5
          "
        >
          <PreviewBox
            label={
              ventaPorPeso
                ? "Precio / kg"
                : "Precio"
            }
            value={
              precioLibre
                ? "Importe libre"
                : Number.isNaN(
                      priceNumero
                    )
                  ? "$ 0,00"
                  : priceNumero.toLocaleString(
                      "es-AR",
                      {
                        style:
                          "currency",
                        currency:
                          "ARS",
                        minimumFractionDigits: 2,
                      }
                    )
            }
          />

          <PreviewBox
            label="Costo"
            value={
              precioLibre
                ? "No aplica"
                : Number.isNaN(
                      costNumero
                    )
                  ? "$ 0,00"
                  : costNumero.toLocaleString(
                      "es-AR",
                      {
                        style: "currency",
                        currency: "ARS",
                        minimumFractionDigits: 2,
                      }
                    )
            }
          />

          <PreviewBox
            label={
              precioLibre
                ? "Tipo"
                : "Stock"
            }
            value={
              precioLibre
                ? "Manual"
                : ventaPorPeso
                  ? `${formatDecimal(
                      stockNumero
                    )} kg`
                  : Number.isNaN(
                        stockNumero
                      )
                    ? "0"
                    : stockNumero
            }
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
          onClick={
            save
          }
        >
          {editing ? (
            <SaveIcon className="h-4 w-4" />
          ) : (
            <PlusIcon className="h-4 w-4" />
          )}

          {editing
            ? "Guardar cambios"
            : "Agregar producto"}
        </button>
      </div>
    </Modal>
  );
}

/* =========================================================
   HELPERS
========================================================= */

function formatDecimal(
  value
) {
  if (
    Number.isNaN(value)
  ) {
    return "0";
  }

  return Number(
    value
  ).toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }
  );
}

/* =========================================================
   PRODUCT TYPE ICON
========================================================= */

function ProductTypeIcon({
  tipo,
  className = "",
}) {
  if (
    tipo === "peso"
  ) {
    return (
      <ScaleIcon
        className={
          className
        }
      />
    );
  }

  if (
    tipo ===
    "precio-libre"
  ) {
    return (
      <MoneyIcon
        className={
          className
        }
      />
    );
  }

  return (
    <UnitIcon
      className={
        className
      }
    />
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

function UnitIcon({
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

function BarcodeIcon({
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
      aria-hidden="true"
    >
      <path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14" />
    </svg>
  );
}

function CameraIcon({
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
      <path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9H3V9a2 2 0 0 1 2-2Z" />
      <circle
        cx="12"
        cy="13"
        r="3"
      />
    </svg>
  );
}

function TagIcon({
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
      <path d="M20 13 11 22 2 13V4h9l9 9Z" />
      <circle
        cx="7"
        cy="9"
        r="1"
      />
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
    </svg>
  );
}

function CalendarIcon({
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
      <path d="M6 3v3M18 3v3M4 8h16" />
      <path d="M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function SaveIcon({
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
      <path d="M5 4h12l2 2v14H5V4Z" />
      <path d="M8 4v6h8V4" />
      <path d="M8 20v-6h8v6" />
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
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}