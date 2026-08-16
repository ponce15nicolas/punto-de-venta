// src/pages/Inventario.jsx
// Inventario rediseñado con la misma identidad visual del POS.
// Mantiene la lógica original, filtros, búsqueda, edición, reposición,
// escáner y eliminación de productos.
// No requiere librerías de iconos externas.

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { money, fmtDate, daysUntil } from "../lib/format";
import ProductModal from "../components/ProductModal";
import RestockModal from "../components/RestockModal";
import Scanner from "../components/Scanner";

const FILTERS = [
  {
    id: "all",
    label: "Todos",
    icon: GridIcon,
  },
  {
    id: "low",
    label: "Stock bajo",
    icon: AlertStockIcon,
  },
  {
    id: "expiring",
    label: "Por vencer",
    icon: ClockIcon,
  },
];

export default function Inventario({
  pos,
  filter,
  setFilter,
}) {
  const {
    catalog,
    upsertProduct,
    deleteProduct,
    restock,
    showToast,
  } = pos;

  const [search, setSearch] = useState("");

  const [productModal, setProductModal] =
    useState({
      open: false,
      product: null,
    });

  const [restockModal, setRestockModal] =
    useState({
      open: false,
      product: null,
    });

  const [scanOpen, setScanOpen] =
    useState(false);

  const [scannedCode, setScannedCode] =
    useState(null);

  useEffect(() => {
    if (filter) {
      setFilter(filter);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =========================================================
     LISTADO FILTRADO
  ========================================================= */

  const list = useMemo(() => {
    let products = Object.values(catalog);

    if (search.trim()) {
      const q = search
        .trim()
        .toLowerCase();

      products = products.filter(
        (product) =>
          product.name
            .toLowerCase()
            .includes(q) ||
          String(product.barcode || "")
            .toLowerCase()
            .includes(q)
      );
    }

    if (filter === "low") {
      products = products.filter(
        (product) =>
          Number(product.stock || 0) <= 5
      );
    }

    if (filter === "expiring") {
      products = products.filter(
        (product) => {
          const days = daysUntil(
            product.expiry
          );

          return (
            days !== null &&
            days <= 7
          );
        }
      );
    }

    products.sort((a, b) => {
      const da = daysUntil(a.expiry);
      const db = daysUntil(b.expiry);

      if (
        da === null &&
        db === null
      ) {
        return a.name.localeCompare(
          b.name
        );
      }

      if (da === null) return 1;
      if (db === null) return -1;

      return da - db;
    });

    return products;
  }, [
    catalog,
    search,
    filter,
  ]);

  /* =========================================================
     RESUMEN
  ========================================================= */

  const allProducts =
    Object.values(catalog);

  const totalProducts =
    allProducts.length;

  const lowStockCount =
    allProducts.filter(
      (product) =>
        Number(product.stock || 0) <= 5
    ).length;

  const expiringCount =
    allProducts.filter(
      (product) => {
        const days = daysUntil(
          product.expiry
        );

        return (
          days !== null &&
          days <= 7
        );
      }
    ).length;

  return (
    <div className="pb-3">

      {/* =====================================================
          CABECERA / RESUMEN
      ===================================================== */}

      <section
        className="
          mb-5
          overflow-hidden
          rounded-[28px]
          bg-white
          text-[#111318]
          shadow-[0_18px_50px_rgba(0,0,0,0.18)]
        "
      >
        <div className="p-4 sm:p-5">

          <div
            className="
              flex
              items-start
              justify-between
              gap-3
            "
          >
            <div className="min-w-0">

              <p
                className="
                  text-[10px]
                  font-extrabold
                  uppercase
                  tracking-[0.16em]
                  text-[#B98700]
                "
              >
                Inventario
              </p>

              <h2
                className="
                  mt-1
                  text-xl
                  font-black
                  tracking-[-0.02em]
                  text-[#111318]
                "
              >
                Control de stock
              </h2>

              <p
                className="
                  mt-1
                  text-sm
                  leading-relaxed
                  text-black/45
                "
              >
                Administrá productos, stock y vencimientos desde un solo lugar.
              </p>

            </div>

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

          </div>

          <div
            className="
              my-5
              h-[3px]
              rounded-full
              bg-[#FFC61A]
            "
          />

          <div className="grid grid-cols-3 gap-2.5">

            <SummaryStat
              label="Productos"
              value={totalProducts}
              icon={
                <BoxIcon className="h-4 w-4" />
              }
            />

            <SummaryStat
              label="Stock bajo"
              value={lowStockCount}
              icon={
                <AlertStockIcon className="h-4 w-4" />
              }
              tone={
                lowStockCount > 0
                  ? "text-red-600"
                  : "text-[#111318]"
              }
            />

            <SummaryStat
              label="Por vencer"
              value={expiringCount}
              icon={
                <ClockIcon className="h-4 w-4" />
              }
              tone={
                expiringCount > 0
                  ? "text-[#9A7100]"
                  : "text-[#111318]"
              }
            />

          </div>

        </div>
      </section>

      {/* =====================================================
          BUSCADOR
      ===================================================== */}

      <div className="mb-3">

        <div className="relative">

          <SearchIcon
            className="
              pointer-events-none
              absolute
              left-4
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
              bg-[#151A22]
              py-3.5
              pl-11
              pr-11
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
            placeholder="Buscar producto o código..."
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
          />

          {search && (
            <button
              type="button"
              onClick={() =>
                setSearch("")
              }
              aria-label="Limpiar búsqueda"
              className="
                absolute
                right-2.5
                top-1/2
                grid
                h-8
                w-8
                -translate-y-1/2
                place-items-center
                rounded-xl
                text-white/35
                transition
                hover:bg-white/5
                hover:text-white/70
              "
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          )}

        </div>

      </div>

      {/* =====================================================
          FILTROS
      ===================================================== */}

      <div
        className="
          mb-3.5
          flex
          flex-wrap
          gap-2
        "
      >
        {FILTERS.map((item) => {
          const active =
            filter === item.id;

          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                setFilter(item.id)
              }
              className={
                `
                  inline-flex
                  items-center
                  gap-1.5
                  rounded-2xl
                  border
                  px-3.5
                  py-2
                  text-xs
                  font-extrabold
                  transition
                  active:scale-[0.98]
                ` +
                (
                  active
                    ? `
                      border-[#FFC61A]
                      bg-[#FFC61A]
                      text-black
                      shadow-[0_8px_22px_rgba(255,198,26,0.14)]
                    `
                    : `
                      border-white/10
                      bg-[#151A22]
                      text-white/55
                      hover:border-white/20
                      hover:text-white
                    `
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />

              {item.label}
            </button>
          );
        })}
      </div>

      {/* =====================================================
          NUEVO PRODUCTO
      ===================================================== */}

      <button
        type="button"
        onClick={() =>
          setProductModal({
            open: true,
            product: null,
          })
        }
        className="
          mb-4
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
      >
        <PlusIcon className="h-4 w-4" />

        Nuevo producto
      </button>

      {/* =====================================================
          ESTADO VACÍO
      ===================================================== */}

      {list.length === 0 ? (
        <div
          className="
            rounded-[28px]
            border
            border-white/10
            bg-[#151A22]
            px-5
            py-12
            text-center
          "
        >
          <div
            className="
              mx-auto
              mb-4
              grid
              h-14
              w-14
              place-items-center
              rounded-2xl
              bg-[#FFC61A]/10
              text-[#FFC61A]
            "
          >
            <InboxIcon className="h-6 w-6" />
          </div>

          <h3
            className="
              text-lg
              font-black
              text-white
            "
          >
            No hay productos
          </h3>

          <p
            className="
              mx-auto
              mt-1.5
              max-w-[300px]
              text-sm
              leading-relaxed
              text-white/45
            "
          >
            {search ||
              filter !== "all"
              ? "No encontramos productos que coincidan con tu búsqueda o filtro."
              : "Agregá tu primer producto para empezar a controlar el stock."}
          </p>

        </div>
      ) : (
        <div className="space-y-3">

          {list.map((product) => {
            const days =
              daysUntil(
                product.expiry
              );

            const stock =
              Number(
                product.stock || 0
              );

            const lowStock =
              stock <= 5;

            const expiryInfo =
              getExpiryInfo(
                product.expiry,
                days
              );

            return (
              <motion.article
                key={product.barcode}
                layout
                initial={{
                  opacity: 0,
                  y: 8,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                className="
                  overflow-hidden
                  rounded-[28px]
                  bg-white
                  text-[#111318]
                  shadow-[0_18px_50px_rgba(0,0,0,0.18)]
                "
              >
                <div className="p-4 sm:p-5">

                  {/* PRODUCTO */}

                  <div
                    className="
                      flex
                      items-start
                      justify-between
                      gap-3
                    "
                  >
                    <div
                      className="
                        flex
                        min-w-0
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
                        <BoxIcon className="h-5 w-5" />
                      </div>

                      <div className="min-w-0">

                        <p
                          className="
                            text-[10px]
                            font-extrabold
                            uppercase
                            tracking-[0.14em]
                            text-[#B98700]
                          "
                        >
                          Producto
                        </p>

                        <h3
                          className="
                            mt-1
                            truncate
                            text-[16px]
                            font-black
                            tracking-[-0.01em]
                            text-[#111318]
                          "
                        >
                          {product.name}
                        </h3>

                        <div
                          className="
                            mt-1
                            flex
                            items-center
                            gap-1.5
                            text-[10px]
                            font-semibold
                            text-black/35
                          "
                        >
                          <BarcodeIcon className="h-3.5 w-3.5" />

                          <span className="truncate">
                            {product.barcode}
                          </span>
                        </div>

                      </div>
                    </div>

                    <div
                      className="
                        shrink-0
                        rounded-2xl
                        bg-[#FFC61A]
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
                          tracking-[0.08em]
                          text-black/45
                        "
                      >
                        Precio
                      </span>

                      <span
                        className="
                          mt-0.5
                          block
                          text-sm
                          font-black
                          text-black
                        "
                      >
                        {money(product.price)}
                      </span>
                    </div>

                  </div>

                  <div
                    className="
                      my-4
                      h-[3px]
                      rounded-full
                      bg-[#FFC61A]
                    "
                  />

                  {/* ESTADOS */}

                  <div className="grid grid-cols-2 gap-2.5">

                    <StatusCard
                      label="Stock"
                      value={`${stock} u.`}
                      icon={
                        <StockIcon className="h-4 w-4" />
                      }
                      tone={
                        lowStock
                          ? "danger"
                          : "success"
                      }
                      helper={
                        lowStock
                          ? "Stock bajo"
                          : "Disponible"
                      }
                    />

                    <StatusCard
                      label="Vencimiento"
                      value={expiryInfo.value}
                      icon={
                        <CalendarIcon className="h-4 w-4" />
                      }
                      tone={expiryInfo.tone}
                      helper={
                        expiryInfo.helper
                      }
                    />

                  </div>

                  {/* ACCIONES */}

                  <div
                    className="
                      mt-4
                      grid
                      grid-cols-2
                      gap-2
                    "
                  >

                    <SmallBtn
                      onClick={() =>
                        setProductModal({
                          open: true,
                          product,
                        })
                      }
                      icon={
                        <EditIcon className="h-4 w-4" />
                      }
                    >
                      Editar
                    </SmallBtn>

                    <SmallBtn
                      primary
                      onClick={() =>
                        setRestockModal({
                          open: true,
                          product,
                        })
                      }
                      icon={
                        <PlusStockIcon className="h-4 w-4" />
                      }
                    >
                      Sumar stock
                    </SmallBtn>

                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `¿Eliminar ${product.name} del catálogo?`
                        )
                      ) {
                        deleteProduct(
                          product.barcode
                        );
                      }
                    }}
                    className="
                      mt-2.5
                      inline-flex
                      w-full
                      items-center
                      justify-center
                      gap-2
                      rounded-2xl
                      border
                      border-red-200
                      bg-red-50
                      px-4
                      py-3
                      text-xs
                      font-extrabold
                      text-red-600
                      transition
                      hover:bg-red-100
                      active:scale-[0.99]
                    "
                  >
                    <TrashIcon className="h-4 w-4" />

                    Eliminar producto
                  </button>

                </div>
              </motion.article>
            );
          })}

        </div>
      )}

      {/* =====================================================
          MODAL PRODUCTO
      ===================================================== */}

      <ProductModal
        open={productModal.open}
        product={productModal.product}
        scannedCode={scannedCode}
        onScan={() =>
          setScanOpen(true)
        }
        onClose={() => {
          setProductModal({
            open: false,
            product: null,
          });

          setScannedCode(null);
        }}
        onSave={(
          product,
          error
        ) => {
          if (error) {
            showToast(
              error,
              true
            );

            return;
          }

          const ok =
            upsertProduct(
              product,
              !!productModal.product
            );

          if (ok) {
            setProductModal({
              open: false,
              product: null,
            });

            setScannedCode(null);
          }
        }}
      />

      {/* =====================================================
          MODAL STOCK
      ===================================================== */}

      <RestockModal
        open={restockModal.open}
        product={restockModal.product}
        onClose={() =>
          setRestockModal({
            open: false,
            product: null,
          })
        }
        onConfirm={(n) => {
          restock(
            restockModal.product.barcode,
            n
          );

          setRestockModal({
            open: false,
            product: null,
          });
        }}
      />

      {/* =====================================================
          SCANNER
      ===================================================== */}

      <Scanner
        open={scanOpen}
        onClose={() =>
          setScanOpen(false)
        }
        onResult={(value) => {
          setScanOpen(false);
          setScannedCode(value);
        }}
      />

    </div>
  );
}

/* =========================================================
   RESUMEN
========================================================= */

function SummaryStat({
  label,
  value,
  icon,
  tone = "text-[#111318]",
}) {
  return (
    <div
      className="
        min-w-0
        rounded-2xl
        bg-[#F4F5F7]
        p-3
      "
    >

      <div
        className="
          mb-1.5
          flex
          items-center
          gap-1.5
          text-black/35
        "
      >
        {icon}

        <span
          className="
            truncate
            text-[8px]
            font-bold
            uppercase
            tracking-[0.08em]
            sm:text-[9px]
          "
        >
          {label}
        </span>
      </div>

      <span
        className={`
          block
          truncate
          text-base
          font-black
          ${tone}
        `}
      >
        {value}
      </span>

    </div>
  );
}

/* =========================================================
   ESTADO STOCK / VENCIMIENTO
========================================================= */

function StatusCard({
  label,
  value,
  helper,
  icon,
  tone,
}) {
  const styles = {
    success: {
      box: "bg-emerald-50",
      icon: "bg-emerald-100 text-emerald-600",
      value: "text-emerald-700",
    },

    warning: {
      box: "bg-[#FFF8DD]",
      icon: "bg-[#FFF1B6] text-[#9A7100]",
      value: "text-[#9A7100]",
    },

    danger: {
      box: "bg-red-50",
      icon: "bg-red-100 text-red-600",
      value: "text-red-600",
    },

    neutral: {
      box: "bg-[#F4F5F7]",
      icon: "bg-white text-black/35",
      value: "text-[#111318]",
    },
  };

  const style =
    styles[tone] ||
    styles.neutral;

  return (
    <div
      className={`
        min-w-0
        rounded-2xl
        p-3
        ${style.box}
      `}
    >

      <div
        className="
          flex
          items-start
          gap-2.5
        "
      >
        <div
          className={`
            grid
            h-8
            w-8
            shrink-0
            place-items-center
            rounded-xl
            ${style.icon}
          `}
        >
          {icon}
        </div>

        <div className="min-w-0">

          <span
            className="
              block
              truncate
              text-[8px]
              font-bold
              uppercase
              tracking-[0.08em]
              text-black/35
            "
          >
            {label}
          </span>

          <span
            className={`
              mt-0.5
              block
              truncate
              text-sm
              font-black
              ${style.value}
            `}
          >
            {value}
          </span>

          <span
            className="
              mt-0.5
              block
              truncate
              text-[9px]
              font-semibold
              text-black/35
            "
          >
            {helper}
          </span>

        </div>
      </div>

    </div>
  );
}

/* =========================================================
   BOTONES
========================================================= */

function SmallBtn({
  children,
  onClick,
  icon,
  primary = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        `
          inline-flex
          w-full
          items-center
          justify-center
          gap-2
          rounded-2xl
          px-3
          py-3
          text-xs
          font-extrabold
          transition
          active:scale-[0.98]
        ` +
        (
          primary
            ? `
              bg-[#FFC61A]
              text-black
              hover:bg-[#FFD248]
            `
            : `
              bg-[#11151C]
              text-white
              hover:bg-[#1A2029]
            `
        )
      }
    >
      {icon}

      {children}
    </button>
  );
}

/* =========================================================
   VENCIMIENTO
========================================================= */

function getExpiryInfo(
  expiry,
  days
) {
  if (!expiry) {
    return {
      value: "Sin fecha",
      helper: "Sin vencimiento",
      tone: "neutral",
    };
  }

  if (
    days !== null &&
    days < 0
  ) {
    return {
      value: "Vencido",
      helper: fmtDate(expiry),
      tone: "danger",
    };
  }

  if (
    days !== null &&
    days <= 7
  ) {
    return {
      value:
        days === 0
          ? "Vence hoy"
          : `En ${days}d`,
      helper: fmtDate(expiry),
      tone: "warning",
    };
  }

  return {
    value: fmtDate(expiry),
    helper: "Vigente",
    tone: "success",
  };
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

function SearchIcon({
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
      <circle
        cx="11"
        cy="11"
        r="7"
      />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CloseIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function GridIcon({
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
        x="4"
        y="4"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="14"
        y="4"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="4"
        y="14"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="14"
        y="14"
        width="6"
        height="6"
        rx="1"
      />
    </svg>
  );
}

function AlertStockIcon({
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
      <path d="M12 11v4" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function ClockIcon({
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
      <circle
        cx="12"
        cy="12"
        r="9"
      />
      <path d="M12 7v5l3 2" />
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

function InboxIcon({
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
      <path d="M4 4h16v16H4z" />
      <path d="M4 13h5l2 3h2l2-3h5" />
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
      <path d="M3 5v14" />
      <path d="M7 5v14" />
      <path d="M10 5v14" />
      <path d="M14 5v14" />
      <path d="M17 5v14" />
      <path d="M21 5v14" />
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
      <path d="M6 3v3" />
      <path d="M18 3v3" />
      <path d="M4 8h16" />
      <path d="M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function EditIcon({
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}

function PlusStockIcon({
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
      <path d="M4 8h16v12H4z" />
      <path d="M8 8V5h8v3" />
      <path d="M12 12v5" />
      <path d="M9.5 14.5h5" />
    </svg>
  );
}

function TrashIcon({
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
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 14h10l1-14" />
    </svg>
  );
}
