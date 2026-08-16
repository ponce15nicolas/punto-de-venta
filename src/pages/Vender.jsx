import {
  useMemo,
  useState,
} from "react";
import {
  AnimatePresence,
  motion,
} from "motion/react";
import {
  money,
  daysUntil,
} from "../lib/format";
import Scanner from "../components/Scanner";
import PaymentModal from "../components/PaymentModal";

export default function Vender({
  pos,
  goInventario,
}) {
  const {
    catalog,
    cart,
    openSession,
    addToCartByBarcode,
    changeCartQty,
    removeFromCart,
    clearCart,
    checkout,
    showToast,
  } = pos;

  /*
   * Este campo ahora sirve tanto para:
   * - código de barras
   * - nombre del producto
   */
  const [search, setSearch] =
    useState("");

  const [scanOpen, setScanOpen] =
    useState(false);

  const [payOpen, setPayOpen] =
    useState(false);

  const [searchFocused, setSearchFocused] =
    useState(false);

  /* =========================================================
     ALERTAS
  ========================================================= */

  const products =
    Object.values(catalog);

  const lowStock =
    products.filter(
      (product) =>
        Number(product.stock || 0) <= 5
    );

  const expiring =
    products.filter(
      (product) => {
        const days =
          daysUntil(
            product.expiry
          );

        return (
          days !== null &&
          days <= 7
        );
      }
    );

  /* =========================================================
     BUSCAR PRODUCTOS
  ========================================================= */

  const searchResults =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return [];
      }

      return Object.values(catalog)
        .filter((product) => {
          const name =
            String(
              product.name || ""
            ).toLowerCase();

          const barcode =
            String(
              product.barcode || ""
            ).toLowerCase();

          return (
            name.includes(query) ||
            barcode.includes(query)
          );
        })
        .sort((a, b) => {
          /*
           * Primero mostramos coincidencias exactas.
           */
          const aBarcode =
            String(
              a.barcode || ""
            ).toLowerCase();

          const bBarcode =
            String(
              b.barcode || ""
            ).toLowerCase();

          const aName =
            String(
              a.name || ""
            ).toLowerCase();

          const bName =
            String(
              b.name || ""
            ).toLowerCase();

          const aExact =
            aBarcode === query ||
            aName === query;

          const bExact =
            bBarcode === query ||
            bName === query;

          if (
            aExact &&
            !bExact
          ) {
            return -1;
          }

          if (
            !aExact &&
            bExact
          ) {
            return 1;
          }

          /*
           * Después priorizamos nombres que empiezan
           * por lo escrito.
           */
          const aStarts =
            aName.startsWith(query);

          const bStarts =
            bName.startsWith(query);

          if (
            aStarts &&
            !bStarts
          ) {
            return -1;
          }

          if (
            !aStarts &&
            bStarts
          ) {
            return 1;
          }

          return aName.localeCompare(
            bName,
            "es"
          );
        })
        .slice(0, 8);
    }, [
      catalog,
      search,
    ]);

  /* =========================================================
     TOTALES
  ========================================================= */

  const total =
    cart.reduce(
      (acc, item) =>
        acc +
        Number(item.qty || 0) *
        Number(item.price || 0),
      0
    );

  const itemCount =
    cart.reduce(
      (acc, item) =>
        acc +
        Number(item.qty || 0),
      0
    );

  /* =========================================================
     AGREGAR PRODUCTO
  ========================================================= */

  function agregarProducto(
    product
  ) {
    if (!product) {
      return;
    }

    addToCartByBarcode(
      product.barcode
    );

    setSearch("");
    setSearchFocused(false);
  }

  /* =========================================================
     ENTER EN BUSCADOR
  ========================================================= */

  function handleSearchSubmit() {
    if (!openSession) {
      return;
    }

    const value =
      search.trim();

    if (!value) {
      return;
    }

    /*
     * 1. Mantiene exactamente el funcionamiento
     *    anterior para código de barras.
     */
    const exactBarcode =
      catalog[value];

    if (exactBarcode) {
      agregarProducto(
        exactBarcode
      );

      return;
    }

    /*
     * 2. Buscar un nombre exactamente igual.
     */
    const normalized =
      value.toLowerCase();

    const exactName =
      Object.values(
        catalog
      ).find(
        (product) =>
          String(
            product.name || ""
          )
            .trim()
            .toLowerCase() ===
          normalized
      );

    if (exactName) {
      agregarProducto(
        exactName
      );

      return;
    }

    /*
     * 3. Si la búsqueda genera solamente
     *    un resultado, Enter lo agrega.
     */
    if (
      searchResults.length === 1
    ) {
      agregarProducto(
        searchResults[0]
      );

      return;
    }

    /*
     * 4. Si no hay coincidencias.
     */
    if (
      searchResults.length === 0
    ) {
      showToast(
        "Producto no encontrado",
        true
      );

      return;
    }

    /*
     * Si hay varias coincidencias dejamos abierto
     * el listado para que el usuario elija.
     */
    showToast(
      "Seleccioná un producto de la lista"
    );
  }

  const showSearchResults =
    openSession &&
    searchFocused &&
    search.trim().length > 0;

  return (
    <div className="pb-3">

      {/* =====================================================
          ALERTA CAJA CERRADA
      ===================================================== */}

      {!openSession && (
        <Banner
          tone="danger"
          icon={
            <RegisterIcon className="h-4 w-4" />
          }
        >
          Abrí la caja en la pestaña Caja para empezar a vender.
        </Banner>
      )}

      {/* =====================================================
          ALERTA VENCIMIENTOS
      ===================================================== */}

      {expiring.length > 0 && (
        <Banner
          tone="warning"
          icon={
            <ClockIcon className="h-4 w-4" />
          }
          onClick={() =>
            goInventario(
              "expiring"
            )
          }
        >
          {expiring.length}{" "}
          producto
          {expiring.length !== 1
            ? "s"
            : ""}{" "}
          por vencer o vencido
          {expiring.length !== 1
            ? "s"
            : ""}
          .
        </Banner>
      )}

      {/* =====================================================
          ALERTA STOCK BAJO
      ===================================================== */}

      {lowStock.length > 0 && (
        <Banner
          tone="danger"
          icon={
            <StockAlertIcon className="h-4 w-4" />
          }
          onClick={() =>
            goInventario(
              "low"
            )
          }
        >
          {lowStock.length}{" "}
          producto
          {lowStock.length !== 1
            ? "s"
            : ""}{" "}
          con stock bajo.
        </Banner>
      )}

      {/* =====================================================
          BUSCADOR + SCANNER
      ===================================================== */}

      <div
        className="
          relative
          z-20
          mb-4
        "
      >
        <div className="flex gap-2.5">

          <div
            className="
              relative
              min-w-0
              flex-1
            "
          >
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
                pr-10
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
                disabled:opacity-40
              "
              placeholder="Buscar por nombre o código..."
              disabled={
                !openSession
              }
              value={search}
              autoComplete="off"
              onFocus={() =>
                setSearchFocused(
                  true
                )
              }
              onChange={(e) => {
                setSearch(
                  e.target.value
                );

                setSearchFocused(
                  true
                );
              }}
              onKeyDown={(e) => {
                if (
                  e.key ===
                  "Enter"
                ) {
                  e.preventDefault();

                  handleSearchSubmit();
                }

                if (
                  e.key ===
                  "Escape"
                ) {
                  setSearch("");
                  setSearchFocused(
                    false
                  );
                }
              }}
            />

            {search && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onMouseDown={(e) =>
                  e.preventDefault()
                }
                onClick={() => {
                  setSearch("");
                  setSearchFocused(
                    true
                  );
                }}
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
                  text-white/30
                  transition
                  hover:bg-white/5
                  hover:text-white
                "
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* SCANNER */}

          <button
            type="button"
            disabled={
              !openSession
            }
            onClick={() =>
              setScanOpen(true)
            }
            aria-label="Escanear código de barras"
            className="
              grid
              h-[50px]
              w-[54px]
              shrink-0
              place-items-center
              rounded-2xl
              bg-[#FFC61A]
              text-black
              shadow-[0_10px_28px_rgba(255,198,26,0.18)]
              transition
              hover:bg-[#FFD248]
              active:scale-[0.97]
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
          >
            <CameraIcon className="h-5 w-5" />
          </button>

        </div>

        {/* ===================================================
            RESULTADOS DE BÚSQUEDA
        =================================================== */}

        <AnimatePresence>
          {showSearchResults && (
            <motion.div
              initial={{
                opacity: 0,
                y: -5,
                scale: 0.99,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: -4,
                scale: 0.99,
              }}
              transition={{
                duration: 0.15,
              }}
              className="
                absolute
                left-0
                right-[64px]
                top-[58px]
                overflow-hidden
                rounded-[22px]
                border
                border-white/10
                bg-[#151A22]
                shadow-[0_22px_55px_rgba(0,0,0,0.48)]
                backdrop-blur-xl
              "
            >
              {searchResults.length ===
                0 ? (
                <div
                  className="
                    flex
                    items-center
                    gap-3
                    px-4
                    py-4
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
                      bg-red-500/10
                      text-red-400
                    "
                  >
                    <SearchIcon className="h-4 w-4" />
                  </div>

                  <div>
                    <p
                      className="
                        text-xs
                        font-extrabold
                        text-white
                      "
                    >
                      Sin resultados
                    </p>

                    <p
                      className="
                        mt-0.5
                        text-[10px]
                        text-white/35
                      "
                    >
                      Probá con otro nombre o código.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="
                      flex
                      items-center
                      justify-between
                      border-b
                      border-white/10
                      px-3.5
                      py-2.5
                    "
                  >
                    <span
                      className="
                        text-[9px]
                        font-extrabold
                        uppercase
                        tracking-[0.12em]
                        text-white/30
                      "
                    >
                      Productos encontrados
                    </span>

                    <span
                      className="
                        text-[9px]
                        font-bold
                        text-[#FFC61A]
                      "
                    >
                      {searchResults.length}
                    </span>
                  </div>

                  <div
                    className="
                      max-h-[310px]
                      overflow-y-auto
                    "
                  >
                    {searchResults.map(
                      (
                        product,
                        index
                      ) => {
                        const stock =
                          Number(
                            product.stock ||
                            0
                          );

                        return (
                          <motion.button
                            key={
                              product.barcode
                            }
                            type="button"
                            initial={{
                              opacity:
                                0,
                              y: 4,
                            }}
                            animate={{
                              opacity:
                                1,
                              y: 0,
                            }}
                            transition={{
                              delay:
                                index *
                                0.02,
                            }}
                            onMouseDown={(
                              e
                            ) =>
                              e.preventDefault()
                            }
                            onClick={() =>
                              agregarProducto(
                                product
                              )
                            }
                            className="
                              group
                              flex
                              w-full
                              items-center
                              gap-3
                              border-b
                              border-white/[0.06]
                              px-3.5
                              py-3
                              text-left
                              transition
                              last:border-b-0
                              hover:bg-white/[0.045]
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
                                bg-[#FFC61A]/10
                                text-[#FFC61A]
                              "
                            >
                              <BoxIcon className="h-[18px] w-[18px]" />
                            </div>

                            <div
                              className="
                                min-w-0
                                flex-1
                              "
                            >
                              <p
                                className="
                                  truncate
                                  text-sm
                                  font-extrabold
                                  text-white
                                "
                              >
                                {
                                  product.name
                                }
                              </p>

                              <div
                                className="
                                  mt-1
                                  flex
                                  items-center
                                  gap-2
                                  text-[10px]
                                  text-white/35
                                "
                              >
                                <span className="truncate">
                                  {
                                    product.barcode
                                  }
                                </span>

                                <span>
                                  ·
                                </span>

                                <span
                                  className={
                                    stock <=
                                      5
                                      ? "text-red-400"
                                      : "text-emerald-400"
                                  }
                                >
                                  Stock{" "}
                                  {
                                    stock
                                  }
                                </span>
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <span
                                className="
                                  block
                                  text-sm
                                  font-black
                                  text-[#FFC61A]
                                "
                              >
                                {money(
                                  product.price
                                )}
                              </span>

                              <span
                                className="
                                  mt-0.5
                                  block
                                  text-[9px]
                                  font-bold
                                  text-white/25
                                "
                              >
                                Agregar
                              </span>
                            </div>

                            <PlusIcon
                              className="
                                h-4
                                w-4
                                shrink-0
                                text-white/25
                                transition
                                group-hover:text-[#FFC61A]
                              "
                            />
                          </motion.button>
                        );
                      }
                    )}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* =====================================================
          TICKET
      ===================================================== */}

      <section
        className="
          overflow-hidden
          rounded-[28px]
          bg-white
          text-[#111318]
          shadow-[0_20px_55px_rgba(0,0,0,0.2)]
        "
      >
        <div className="p-4 sm:p-5">

          {/* CABECERA */}

          <div
            className="
              flex
              items-center
              justify-between
              gap-3
            "
          >
            <div
              className="
                flex
                min-w-0
                items-center
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
                  rounded-2xl
                  bg-[#FFF5CC]
                  text-[#9A7100]
                "
              >
                <ReceiptIcon className="h-[18px] w-[18px]" />
              </div>

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
                  Venta actual
                </p>

                <h2
                  className="
                    mt-0.5
                    text-lg
                    font-black
                    tracking-[-0.02em]
                    text-[#111318]
                  "
                >
                  Ticket actual
                </h2>
              </div>
            </div>

            <span
              className="
                shrink-0
                rounded-full
                bg-[#F4F5F7]
                px-3
                py-1.5
                text-[10px]
                font-extrabold
                text-black/45
              "
            >
              {itemCount}{" "}
              {itemCount === 1
                ? "ítem"
                : "ítems"}
            </span>
          </div>

          <div
            className="
              my-4
              h-[3px]
              rounded-full
              bg-[#FFC61A]
            "
          />

          {/* TICKET VACÍO */}

          {cart.length === 0 ? (
            <div
              className="
                flex
                min-h-[180px]
                flex-col
                items-center
                justify-center
                px-4
                py-6
                text-center
              "
            >
              <div
                className="
                  mb-3
                  grid
                  h-12
                  w-12
                  place-items-center
                  rounded-2xl
                  bg-[#F4F5F7]
                  text-black/30
                "
              >
                <BarcodeIcon className="h-5 w-5" />
              </div>

              <h3
                className="
                  text-sm
                  font-extrabold
                  text-[#111318]
                "
              >
                El ticket está vacío
              </h3>

              <p
                className="
                  mt-1
                  max-w-[270px]
                  text-xs
                  leading-relaxed
                  text-black/40
                "
              >
                Buscá por nombre, ingresá un código o escaneá el producto.
              </p>
            </div>
          ) : (
            <div>
              <AnimatePresence
                initial={false}
              >
                {cart.map(
                  (
                    item,
                    index
                  ) => (
                    <motion.div
                      key={
                        item.barcode
                      }
                      layout
                      initial={{
                        opacity: 0,
                        height: 0,
                        y: 5,
                      }}
                      animate={{
                        opacity: 1,
                        height:
                          "auto",
                        y: 0,
                      }}
                      exit={{
                        opacity: 0,
                        height: 0,
                        y: -4,
                      }}
                      transition={{
                        duration:
                          0.18,
                      }}
                      className="
                        overflow-hidden
                        border-b
                        border-black/8
                        py-3
                        last:border-b-0
                      "
                    >
                      <div
                        className="
                          flex
                          items-center
                          gap-2.5
                        "
                      >
                        <div
                          className="
                            min-w-0
                            flex-1
                          "
                        >
                          <p
                            className="
                              truncate
                              text-sm
                              font-extrabold
                              text-[#111318]
                            "
                          >
                            {
                              item.name
                            }
                          </p>

                          <p
                            className="
                              mt-0.5
                              text-[10px]
                              font-semibold
                              text-black/40
                            "
                          >
                            {money(
                              item.price
                            )}{" "}
                            c/u
                          </p>
                        </div>

                        {/* CANTIDAD */}

                        <div
                          className="
                            flex
                            shrink-0
                            items-center
                            gap-1.5
                          "
                        >
                          <button
                            type="button"
                            aria-label={`Restar una unidad de ${item.name}`}
                            onClick={() =>
                              changeCartQty(
                                index,
                                -1
                              )
                            }
                            className="
                              grid
                              h-8
                              w-8
                              place-items-center
                              rounded-xl
                              border
                              border-black/10
                              bg-[#F4F5F7]
                              text-[#111318]
                              transition
                              hover:bg-[#EDEEF1]
                              active:scale-[0.96]
                            "
                          >
                            <MinusIcon className="h-3.5 w-3.5" />
                          </button>

                          <span
                            className="
                              min-w-[24px]
                              text-center
                              text-sm
                              font-black
                              text-[#111318]
                            "
                          >
                            {
                              item.qty
                            }
                          </span>

                          <button
                            type="button"
                            aria-label={`Sumar una unidad de ${item.name}`}
                            onClick={() =>
                              changeCartQty(
                                index,
                                1
                              )
                            }
                            className="
                              grid
                              h-8
                              w-8
                              place-items-center
                              rounded-xl
                              bg-[#FFC61A]
                              text-black
                              transition
                              hover:bg-[#FFD248]
                              active:scale-[0.96]
                            "
                          >
                            <PlusIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* SUBTOTAL */}

                        <div
                          className="
                            min-w-[78px]
                            shrink-0
                            text-right
                            text-sm
                            font-black
                            text-[#111318]
                          "
                        >
                          {money(
                            item.price *
                            item.qty
                          )}
                        </div>

                        {/* ELIMINAR */}

                        <button
                          type="button"
                          aria-label={`Eliminar ${item.name}`}
                          onClick={() =>
                            removeFromCart(
                              index
                            )
                          }
                          className="
                            grid
                            h-8
                            w-8
                            shrink-0
                            place-items-center
                            rounded-xl
                            text-red-500
                            transition
                            hover:bg-red-50
                            active:scale-[0.96]
                          "
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </motion.div>
                  )
                )}
              </AnimatePresence>
            </div>
          )}

          {/* =================================================
              TOTAL
          ================================================= */}

          <div
            className="
              mt-3
              flex
              items-center
              justify-between
              gap-3
              border-t
              border-black/10
              pt-4
            "
          >
            <div>
              <span
                className="
                  block
                  text-[10px]
                  font-extrabold
                  uppercase
                  tracking-[0.14em]
                  text-black/35
                "
              >
                Total
              </span>

              <span
                className="
                  mt-0.5
                  block
                  text-xs
                  font-semibold
                  text-black/40
                "
              >
                {itemCount}{" "}
                {itemCount === 1
                  ? "unidad"
                  : "unidades"}
              </span>
            </div>

            <motion.div
              key={total}
              initial={{
                scale: 1.06,
              }}
              animate={{
                scale: 1,
              }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 24,
              }}
              className="
                rounded-2xl
                bg-[#FFC61A]
                px-4
                py-2.5
                text-right
                text-2xl
                font-black
                tracking-[-0.04em]
                text-black
              "
            >
              {money(total)}
            </motion.div>
          </div>

        </div>
      </section>

      {/* =====================================================
          COBRAR
      ===================================================== */}

      <button
        type="button"
        disabled={
          !openSession ||
          cart.length === 0
        }
        onClick={() =>
          setPayOpen(true)
        }
        className="
          mt-4
          inline-flex
          w-full
          items-center
          justify-center
          gap-2
          rounded-2xl
          bg-[#FFC61A]
          px-4
          py-4
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
        <PaymentIcon className="h-4 w-4" />

        Cobrar venta ·{" "}
        {money(total)}
      </button>

      {/* =====================================================
          VACIAR
      ===================================================== */}

      {cart.length > 0 && (
        <button
          type="button"
          onClick={clearCart}
          className="
            mt-2.5
            inline-flex
            w-full
            items-center
            justify-center
            gap-2
            rounded-2xl
            border
            border-white/10
            bg-[#151A22]
            px-4
            py-3.5
            text-sm
            font-bold
            text-white/65
            transition
            hover:border-white/20
            hover:text-white
            active:scale-[0.99]
          "
        >
          <ClearIcon className="h-4 w-4" />

          Vaciar ticket
        </button>
      )}

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

          addToCartByBarcode(
            value
          );
        }}
      />

      {/* =====================================================
          PAGO
      ===================================================== */}

      <PaymentModal
        open={payOpen}
        total={total}
        onClose={() =>
          setPayOpen(false)
        }
        onConfirm={(
          payment
        ) => {
          const ok =
            checkout(
              payment
            );

          if (ok) {
            setPayOpen(
              false
            );
          }
        }}
      />
    </div>
  );
}

/* =========================================================
   BANNER
========================================================= */

function Banner({
  tone,
  children,
  onClick,
  icon,
}) {
  const styles = {
    warning: {
      container:
        "border-[#FFC61A]/25 bg-[#FFC61A]/10 text-[#F3CD62]",
      icon:
        "bg-[#FFC61A]/15 text-[#FFC61A]",
    },

    danger: {
      container:
        "border-red-400/20 bg-red-500/10 text-red-200",
      icon:
        "bg-red-500/15 text-red-400",
    },
  };

  const style =
    styles[tone] ||
    styles.warning;

  return (
    <motion.div
      initial={{
        opacity: 0,
        y: -6,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      onClick={
        onClick
      }
      role={
        onClick
          ? "button"
          : "status"
      }
      tabIndex={
        onClick
          ? 0
          : undefined
      }
      onKeyDown={(e) => {
        if (
          onClick &&
          (e.key ===
            "Enter" ||
            e.key ===
            " ")
        ) {
          onClick();
        }
      }}
      className={`
        mb-2.5
        flex
        items-center
        gap-2.5
        rounded-2xl
        border
        px-3.5
        py-3
        text-sm
        font-semibold
        ${style.container}
        ${onClick
          ? "cursor-pointer transition hover:brightness-110 active:scale-[0.995]"
          : ""
        }
      `}
    >
      <span
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
      </span>

      <span
        className="
          min-w-0
          flex-1
          leading-snug
        "
      >
        {children}
      </span>

      {onClick && (
        <ChevronIcon className="h-4 w-4 shrink-0 opacity-50" />
      )}
    </motion.div>
  );
}

/* =========================================================
   ICONOS
========================================================= */

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

function ReceiptIcon({
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
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.2V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
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

function PaymentIcon({
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
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

function ClearIcon({
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
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  );
}

function RegisterIcon({
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
      <path d="M4 10h16v10H4z" />
      <path d="M7 10V5h10v5" />
      <path d="M8 14h3" />
      <path d="M15 14h1" />
      <path d="M15 17h1" />
      <path d="M8 17h3" />
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

function StockAlertIcon({
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

function ChevronIcon({
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
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}