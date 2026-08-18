// src/pages/Inventario.jsx

import {
  useMemo,
  useRef,
  useState,
} from "react";

import { motion } from "motion/react";

import {
  money,
  fmtDate,
  daysUntil,
} from "../lib/format";

import ProductModal from "../components/ProductModal";
import RestockModal from "../components/RestockModal";
import Scanner from "../components/Scanner";

/* =========================================================
   FILTROS
========================================================= */

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

/* =========================================================
   HELPERS
========================================================= */

function getTipoVenta(product) {
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
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function roundWeight(value) {
  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * 1000
    ) / 1000
  );
}

function formatWeight(value) {
  return roundWeight(
    value
  ).toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }
  );
}

function formatStock(product) {
  const tipoVenta =
    getTipoVenta(
      product
    );

  if (
    tipoVenta ===
    "precio-libre"
  ) {
    return "Sin control";
  }

  const stock =
    toNumber(
      product?.stock
    );

  if (
    tipoVenta === "peso"
  ) {
    return `${formatWeight(
      stock
    )} kg`;
  }

  return `${Math.trunc(
    stock
  ).toLocaleString(
    "es-AR"
  )} u.`;
}

function formatBarcode(
  barcode
) {
  const value =
    String(
      barcode || ""
    ).trim();

  if (
    !value ||
    value.startsWith(
      "manual-"
    )
  ) {
    return "Código interno";
  }

  return value;
}

function isLowStock(
  product
) {
  const tipoVenta =
    getTipoVenta(
      product
    );

  if (
    tipoVenta ===
    "precio-libre"
  ) {
    return false;
  }

  return (
    toNumber(
      product?.stock
    ) <= 5
  );
}

function getTypeLabel(
  tipoVenta
) {
  if (
    tipoVenta === "peso"
  ) {
    return "Por peso";
  }

  if (
    tipoVenta ===
    "precio-libre"
  ) {
    return "Importe libre";
  }

  return "Por unidad";
}

function getPriceLabel(
  product
) {
  const tipoVenta =
    getTipoVenta(
      product
    );

  if (
    tipoVenta ===
    "precio-libre"
  ) {
    return "Importe libre";
  }

  if (
    tipoVenta === "peso"
  ) {
    return `${money(
      product?.price
    )}/kg`;
  }

  return money(
    product?.price
  );
}

/* =========================================================
   COMPONENTE
========================================================= */

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

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    productModal,
    setProductModal,
  ] = useState({
    open: false,
    product: null,
  });

  const [
    restockModal,
    setRestockModal,
  ] = useState({
    open: false,
    product: null,
  });

  const [
    scanOpen,
    setScanOpen,
  ] = useState(false);

  const [
    scannedCode,
    setScannedCode,
  ] = useState(null);

  /*
   * Evitan disparar dos veces una operación
   * mientras Firestore todavía está respondiendo.
   *
   * useRef permite bloquear inmediatamente sin
   * depender de un ciclo adicional de render.
   */
  const savingProductRef =
    useRef(false);

  const restockingRef =
    useRef(false);

  const deletingProductsRef =
    useRef(new Set());

  /* =========================================================
     FILTRO ACTIVO
  ========================================================= */

  const activeFilter =
    FILTERS.some(
      (item) =>
        item.id === filter
    )
      ? filter
      : "all";

  /* =========================================================
     PRODUCTOS
  ========================================================= */

  const allProducts =
    useMemo(
      () =>
        Object.values(
          catalog || {}
        ).filter(Boolean),
      [
        catalog,
      ]
    );

  const list =
    useMemo(() => {
      let products = [
        ...allProducts,
      ];

      const query =
        String(
          search || ""
        )
          .trim()
          .toLowerCase();

      if (query) {
        products =
          products.filter(
            (product) => {
              const name =
                String(
                  product?.name ||
                    ""
                ).toLowerCase();

              const barcode =
                String(
                  product?.barcode ||
                    ""
                ).toLowerCase();

              return (
                name.includes(
                  query
                ) ||
                barcode.includes(
                  query
                )
              );
            }
          );
      }

      if (
        activeFilter ===
        "low"
      ) {
        products =
          products.filter(
            isLowStock
          );
      }

      if (
        activeFilter ===
        "expiring"
      ) {
        products =
          products.filter(
            (product) => {
              const days =
                daysUntil(
                  product?.expiry
                );

              return (
                days !== null &&
                days <= 7
              );
            }
          );
      }

      products.sort(
        (a, b) => {
          const daysA =
            daysUntil(
              a?.expiry
            );

          const daysB =
            daysUntil(
              b?.expiry
            );

          if (
            daysA !== null &&
            daysB !== null &&
            daysA !== daysB
          ) {
            return (
              daysA -
              daysB
            );
          }

          if (
            daysA !== null &&
            daysB === null
          ) {
            return -1;
          }

          if (
            daysA === null &&
            daysB !== null
          ) {
            return 1;
          }

          return String(
            a?.name || ""
          ).localeCompare(
            String(
              b?.name ||
                ""
            ),
            "es",
            {
              sensitivity:
                "base",
            }
          );
        }
      );

      return products;
    }, [
      allProducts,
      search,
      activeFilter,
    ]);

  /* =========================================================
     RESUMEN
  ========================================================= */

  const totalProducts =
    allProducts.length;

  const lowStockCount =
    useMemo(
      () =>
        allProducts.filter(
          isLowStock
        ).length,
      [
        allProducts,
      ]
    );

  const expiringCount =
    useMemo(
      () =>
        allProducts.filter(
          (product) => {
            const days =
              daysUntil(
                product?.expiry
              );

            return (
              days !== null &&
              days <= 7
            );
          }
        ).length,
      [
        allProducts,
      ]
    );

  /* =========================================================
     PRODUCTO
  ========================================================= */

  function openNewProduct() {
    setScannedCode(
      null
    );

    setProductModal({
      open: true,
      product: null,
    });
  }

  function openEditProduct(
    product
  ) {
    setScannedCode(
      null
    );

    setProductModal({
      open: true,
      product,
    });
  }

  function closeProductModal() {
    setProductModal({
      open: false,
      product: null,
    });

    setScannedCode(
      null
    );
  }

  async function handleProductSave(
    product,
    error
  ) {
    if (error) {
      showToast(
        error,
        true
      );

      return;
    }

    if (!product) {
      showToast(
        "Datos del producto inválidos",
        true
      );

      return;
    }

    if (
      savingProductRef.current
    ) {
      return;
    }

    const editing =
      Boolean(
        productModal.product
      );

    /*
     * Necesario para Firestore si durante
     * una edición cambia el código.
     *
     * El usePosData local actual ignora
     * este tercer argumento sin romperse.
     */
    const previousBarcode =
      productModal.product
        ?.barcode ||
      null;

    savingProductRef.current =
      true;

    try {
      const ok =
        await Promise.resolve(
          upsertProduct(
            product,
            editing,
            previousBarcode
          )
        );

      if (!ok) {
        return;
      }

      closeProductModal();
    } catch (errorSave) {
      console.error(
        "Error guardando producto:",
        errorSave
      );

      showToast(
        "No se pudo guardar el producto",
        true
      );
    } finally {
      savingProductRef.current =
        false;
    }
  }

  /* =========================================================
     REPOSICIÓN
  ========================================================= */

  function openRestockModal(
    product
  ) {
    if (
      getTipoVenta(
        product
      ) === "precio-libre"
    ) {
      showToast(
        "Este producto no utiliza stock",
        true
      );

      return;
    }

    setRestockModal({
      open: true,
      product,
    });
  }

  function closeRestockModal() {
    setRestockModal({
      open: false,
      product: null,
    });
  }

  async function handleRestock(
    amount
  ) {
    const product =
      restockModal.product;

    if (
      !product ||
      restockingRef.current
    ) {
      return;
    }

    restockingRef.current =
      true;

    try {
      const ok =
        await Promise.resolve(
          restock(
            product.barcode,
            amount
          )
        );

      if (ok) {
        closeRestockModal();
      }
    } catch (error) {
      console.error(
        "Error reponiendo stock:",
        error
      );

      showToast(
        "No se pudo actualizar el stock",
        true
      );
    } finally {
      restockingRef.current =
        false;
    }
  }

  /* =========================================================
     ELIMINAR
  ========================================================= */

  async function handleDeleteProduct(
    product
  ) {
    if (!product) {
      return;
    }

    const barcode =
      String(
        product.barcode ||
          ""
      ).trim();

    if (!barcode) {
      showToast(
        "El producto no tiene un código válido",
        true
      );

      return;
    }

    if (
      deletingProductsRef.current.has(
        barcode
      )
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `¿Eliminar ${
          product.name ||
          "este producto"
        } del catálogo?`
      );

    if (!confirmed) {
      return;
    }

    deletingProductsRef.current.add(
      barcode
    );

    try {
      const ok =
        await Promise.resolve(
          deleteProduct(
            barcode
          )
        );

      if (ok === false) {
        return;
      }
    } catch (error) {
      console.error(
        "Error eliminando producto:",
        error
      );

      showToast(
        "No se pudo eliminar el producto",
        true
      );
    } finally {
      deletingProductsRef.current.delete(
        barcode
      );
    }
  }

  /* =========================================================
     SCANNER
  ========================================================= */

  function handleScannerResult(
    value
  ) {
    const code =
      String(
        value || ""
      ).trim();

    setScanOpen(
      false
    );

    if (!code) {
      return;
    }

    setScannedCode(
      code
    );
  }

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div className="pb-3">
      {/* =====================================================
          CABECERA
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
              value={
                totalProducts
              }
              icon={
                <BoxIcon className="h-4 w-4" />
              }
            />

            <SummaryStat
              label="Stock bajo"
              value={
                lowStockCount
              }
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
              value={
                expiringCount
              }
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
            type="search"
            autoComplete="off"
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
            value={
              search
            }
            onChange={(
              event
            ) =>
              setSearch(
                event.target.value
              )
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
                active:scale-[0.96]
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
        {FILTERS.map(
          (item) => {
            const active =
              activeFilter ===
              item.id;

            const Icon =
              item.icon;

            return (
              <button
                key={
                  item.id
                }
                type="button"
                onClick={() =>
                  setFilter?.(
                    item.id
                  )
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
          }
        )}
      </div>

      {/* =====================================================
          NUEVO PRODUCTO
      ===================================================== */}

      <button
        type="button"
        onClick={
          openNewProduct
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
          LISTADO
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
            activeFilter !== "all"
              ? "No encontramos productos que coincidan con tu búsqueda o filtro."
              : "Agregá tu primer producto para empezar a controlar el stock."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(
            (
              product,
              index
            ) => {
              const tipoVenta =
                getTipoVenta(
                  product
                );

              const precioLibre =
                tipoVenta ===
                "precio-libre";

              const ventaPorPeso =
                tipoVenta ===
                "peso";

              const lowStock =
                isLowStock(
                  product
                );

              const days =
                daysUntil(
                  product?.expiry
                );

              const expiryInfo =
                getExpiryInfo(
                  product?.expiry,
                  days
                );

              const stockInfo =
                getStockInfo(
                  product,
                  lowStock
                );

              return (
                <motion.article
                  key={
                    product.barcode ||
                    `${product.name}-${index}`
                  }
                  layout
                  initial={{
                    opacity: 0,
                    y: 8,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  transition={{
                    duration: 0.18,
                    delay: Math.min(
                      index * 0.025,
                      0.15
                    ),
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
                          <ProductTypeIcon
                            tipo={
                              tipoVenta
                            }
                            className="h-5 w-5"
                          />
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
                            {getTypeLabel(
                              tipoVenta
                            )}
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
                            {
                              product.name
                            }
                          </h3>

                          <div
                            className="
                              mt-1
                              flex
                              min-w-0
                              items-center
                              gap-1.5
                              text-[10px]
                              font-semibold
                              text-black/35
                            "
                          >
                            <BarcodeIcon className="h-3.5 w-3.5 shrink-0" />

                            <span className="truncate">
                              {formatBarcode(
                                product.barcode
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div
                        className="
                          max-w-[130px]
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
                          {ventaPorPeso
                            ? "Precio / kg"
                            : "Precio"}
                        </span>

                        <span
                          className="
                            mt-0.5
                            block
                            truncate
                            text-sm
                            font-black
                            text-black
                          "
                        >
                          {getPriceLabel(
                            product
                          )}
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

                    <div className="grid grid-cols-2 gap-2.5">
                      <StatusCard
                        label={
                          precioLibre
                            ? "Inventario"
                            : "Stock"
                        }
                        value={
                          stockInfo.value
                        }
                        icon={
                          precioLibre ? (
                            <MoneyIcon className="h-4 w-4" />
                          ) : ventaPorPeso ? (
                            <ScaleIcon className="h-4 w-4" />
                          ) : (
                            <StockIcon className="h-4 w-4" />
                          )
                        }
                        tone={
                          stockInfo.tone
                        }
                        helper={
                          stockInfo.helper
                        }
                      />

                      <StatusCard
                        label="Vencimiento"
                        value={
                          expiryInfo.value
                        }
                        icon={
                          <CalendarIcon className="h-4 w-4" />
                        }
                        tone={
                          expiryInfo.tone
                        }
                        helper={
                          expiryInfo.helper
                        }
                      />
                    </div>

                    <div
                      className={
                        precioLibre
                          ? "mt-4 grid grid-cols-1 gap-2"
                          : "mt-4 grid grid-cols-2 gap-2"
                      }
                    >
                      <SmallBtn
                        onClick={() =>
                          openEditProduct(
                            product
                          )
                        }
                        icon={
                          <EditIcon className="h-4 w-4" />
                        }
                      >
                        Editar
                      </SmallBtn>

                      {!precioLibre && (
                        <SmallBtn
                          primary
                          onClick={() =>
                            openRestockModal(
                              product
                            )
                          }
                          icon={
                            ventaPorPeso ? (
                              <ScalePlusIcon className="h-4 w-4" />
                            ) : (
                              <PlusStockIcon className="h-4 w-4" />
                            )
                          }
                        >
                          {ventaPorPeso
                            ? "Sumar peso"
                            : "Sumar stock"}
                        </SmallBtn>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        handleDeleteProduct(
                          product
                        )
                      }
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
            }
          )}
        </div>
      )}

      {/* =====================================================
          MODALES
      ===================================================== */}

      <ProductModal
        open={
          productModal.open
        }
        product={
          productModal.product
        }
        scannedCode={
          scannedCode
        }
        onScan={() =>
          setScanOpen(
            true
          )
        }
        onClose={
          closeProductModal
        }
        onSave={
          handleProductSave
        }
      />

      <RestockModal
        open={
          restockModal.open
        }
        product={
          restockModal.product
        }
        onClose={
          closeRestockModal
        }
        onConfirm={
          handleRestock
        }
      />

      <Scanner
        open={
          scanOpen
        }
        onClose={() =>
          setScanOpen(
            false
          )
        }
        onResult={
          handleScannerResult
        }
      />
    </div>
  );
}

/* =========================================================
   INFORMACIÓN DE STOCK
========================================================= */

function getStockInfo(
  product,
  lowStock
) {
  const tipoVenta =
    getTipoVenta(
      product
    );

  if (
    tipoVenta ===
    "precio-libre"
  ) {
    return {
      value:
        "Sin control",

      helper:
        "Importe manual",

      tone:
        "neutral",
    };
  }

  return {
    value:
      formatStock(
        product
      ),

    helper:
      lowStock
        ? tipoVenta ===
            "peso"
          ? "Poco peso disponible"
          : "Stock bajo"
        : "Disponible",

    tone:
      lowStock
        ? "danger"
        : "success",
  };
}

/* =========================================================
   INFORMACIÓN DE VENCIMIENTO
========================================================= */

function getExpiryInfo(
  expiry,
  days
) {
  if (!expiry) {
    return {
      value:
        "Sin fecha",

      helper:
        "Sin vencimiento",

      tone:
        "neutral",
    };
  }

  if (
    days !== null &&
    days < 0
  ) {
    return {
      value:
        "Vencido",

      helper:
        fmtDate(
          expiry
        ),

      tone:
        "danger",
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

      helper:
        fmtDate(
          expiry
        ),

      tone:
        "warning",
    };
  }

  return {
    value:
      fmtDate(
        expiry
      ),

    helper:
      "Vigente",

    tone:
      "success",
  };
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
   ESTADO
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
      box:
        "bg-emerald-50",

      icon:
        "bg-emerald-100 text-emerald-600",

      value:
        "text-emerald-700",
    },

    warning: {
      box:
        "bg-[#FFF8DD]",

      icon:
        "bg-[#FFF1B6] text-[#9A7100]",

      value:
        "text-[#9A7100]",
    },

    danger: {
      box:
        "bg-red-50",

      icon:
        "bg-red-100 text-red-600",

      value:
        "text-red-600",
    },

    neutral: {
      box:
        "bg-[#F4F5F7]",

      icon:
        "bg-white text-black/35",

      value:
        "text-[#111318]",
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
   BOTÓN
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
      onClick={
        onClick
      }
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
   ICONO SEGÚN TIPO
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
    <BoxIcon
      className={
        className
      }
    />
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
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" />
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

function ScalePlusIcon({
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
      <path d="M12 7v13" />
      <path d="M8 20h8" />
      <path d="M17 12v6" />
      <path d="M14 15h6" />
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