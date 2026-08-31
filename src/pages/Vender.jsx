// src/pages/Vender.jsx

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AnimatePresence,
  motion,
} from "motion/react";

import {
  daysUntil,
  money,
} from "../lib/format";

import Modal from "../components/Modal";
import PaymentModal from "../components/PaymentModal";
import Scanner from "../components/Scanner";
import PromotionSaleModal from "../components/PromotionSaleModal";
import SaleTicketModal from "../components/SaleTicketModal";
import { useOperator } from "../components/OperatorGate";

/* =========================================================
   HELPERS
========================================================= */

function getTipoVenta(product) {
  const tipo = product?.tipoVenta;

  if (
    tipo === "peso" ||
    tipo === "precio-libre"
  ) {
    return tipo;
  }

  return "unidad";
}

function toNumber(value, fallback = 0) {
  const normalized =
    typeof value === "string"
      ? value.replace(",", ".")
      : value;

  const number = Number(normalized);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function roundMoney(value) {
  return (
    Math.round(
      (toNumber(value) + Number.EPSILON) * 100
    ) / 100
  );
}

function roundQuantity(value) {
  return (
    Math.round(
      (toNumber(value) + Number.EPSILON) * 1000
    ) / 1000
  );
}

function formatQuantity(value) {
  return roundQuantity(value).toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }
  );
}

function getItemSubtotal(item) {
  const stored = Number(item?.subtotal);

  if (Number.isFinite(stored)) {
    return roundMoney(stored);
  }

  return roundMoney(
    toNumber(item?.qty) *
      toNumber(item?.price)
  );
}

function displayBarcode(barcode) {
  const value = String(barcode || "").trim();

  if (
    !value ||
    value.startsWith("manual-")
  ) {
    return "Código interno";
  }

  return value;
}

function getCartLineKey(item, index) {
  if (item?.cartLineId) {
    return String(item.cartLineId);
  }

  const barcode = String(item?.barcode || "line");
  const tipo = getTipoVenta(item);

  if (tipo === "unidad") {
    return `unit:${barcode}`;
  }

  return `${tipo}:${barcode}:${index}`;
}

/* =========================================================
   COMPONENTE
========================================================= */

export default function Vender({
  pos,
  goInventario,
  ticketEnabled = false,
}) {
  const {
    operador,
  } = useOperator();

  const {
    catalog,
    cart,
    openSession,
    addProductToCart,
    changeCartQty,
    updateCartAmount,
    removeFromCart,
    clearCart,
    cartPricing,
    checkout,
    showToast,
  } = pos;

  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const [scanOpen, setScanOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);

  useEffect(() => {
    if (!ticketEnabled) {
      setTicketOpen(false);
      setLastTicket(null);
    }
  }, [ticketEnabled]);

  const [saleProduct, setSaleProduct] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);

  const [weightInput, setWeightInput] = useState("");
  const [amountInput, setAmountInput] = useState("");

  const [selectedLineKey, setSelectedLineKey] = useState(null);
  const [quantityEditor, setQuantityEditor] = useState(null);
  const [searchResultIndex, setSearchResultIndex] = useState(0);

  const checkoutInFlightRef = useRef(false);
  const searchInputRef = useRef(null);
  const cartRowRefs = useRef(new Map());
  const pendingSelectBarcodeRef = useRef(null);
  const notebookShortcutTimerRef = useRef(null);
  const scannerSequenceActiveRef = useRef(false);
  const quickQuantityArmedRef = useRef(false);
  const quickQuantityTimerRef = useRef(null);

  /*
   * Los lectores USB comunes se presentan como teclado (HID).
   * Guardamos un buffer independiente para poder escanear desde
   * cualquier punto de la pantalla sin enfocar el buscador.
   */
  const usbScannerBufferRef = useRef("");
  const usbScannerLastKeyRef = useRef(0);
  const usbScannerResetTimerRef = useRef(null);

  /* =========================================================
     PRODUCTOS
  ========================================================= */

  const products = useMemo(
    () =>
      Object.values(
        catalog || {}
      ).filter(Boolean),
    [catalog]
  );

  /* =========================================================
     ALERTAS
  ========================================================= */

  const lowStock = useMemo(
    () =>
      products.filter((product) => {
        if (
          getTipoVenta(product) ===
          "precio-libre"
        ) {
          return false;
        }

        return toNumber(product?.stock) <= 5;
      }),
    [products]
  );

  const expiring = useMemo(
    () =>
      products.filter((product) => {
        const days = daysUntil(
          product?.expiry
        );

        return (
          days !== null &&
          days <= 7
        );
      }),
    [products]
  );

  /* =========================================================
     BÚSQUEDA
  ========================================================= */

  const searchResults = useMemo(() => {
    const query = search
      .trim()
      .toLowerCase();

    if (!query) {
      return [];
    }

    return products
      .filter((product) => {
        const name = String(
          product?.name || ""
        ).toLowerCase();

        const barcode = String(
          product?.barcode || ""
        ).toLowerCase();

        return (
          name.includes(query) ||
          barcode.includes(query)
        );
      })
      .sort((a, b) => {
        const aName = String(
          a?.name || ""
        ).toLowerCase();

        const bName = String(
          b?.name || ""
        ).toLowerCase();

        const aBarcode = String(
          a?.barcode || ""
        ).toLowerCase();

        const bBarcode = String(
          b?.barcode || ""
        ).toLowerCase();

        const aExact =
          aName === query ||
          aBarcode === query;

        const bExact =
          bName === query ||
          bBarcode === query;

        if (aExact && !bExact) {
          return -1;
        }

        if (!aExact && bExact) {
          return 1;
        }

        const aStarts =
          aName.startsWith(query);

        const bStarts =
          bName.startsWith(query);

        if (aStarts && !bStarts) {
          return -1;
        }

        if (!aStarts && bStarts) {
          return 1;
        }

        return aName.localeCompare(
          bName,
          "es"
        );
      })
      .slice(0, 8);
  }, [products, search]);

  const showSearchResults =
    Boolean(openSession) &&
    searchFocused &&
    search.trim().length > 0;


  useEffect(() => {
    if (searchResults.length === 0) {
      setSearchResultIndex(0);
      return;
    }

    setSearchResultIndex((current) =>
      Math.min(current, searchResults.length - 1)
    );
  }, [searchResults]);

  /* =========================================================
     SELECCIÓN DEL TICKET — TECLADO / LECTOR
  ========================================================= */

  useEffect(() => {
    if (cart.length === 0) {
      setSelectedLineKey(null);
      setQuantityEditor(null);
      pendingSelectBarcodeRef.current = null;
      return;
    }

    const pendingBarcode = pendingSelectBarcodeRef.current;

    if (pendingBarcode) {
      for (let index = cart.length - 1; index >= 0; index -= 1) {
        const item = cart[index];

        if (String(item?.barcode || "") === String(pendingBarcode)) {
          setSelectedLineKey(getCartLineKey(item, index));
          pendingSelectBarcodeRef.current = null;
          return;
        }
      }
    }

    const selectedStillExists = cart.some(
      (item, index) => getCartLineKey(item, index) === selectedLineKey
    );

    if (!selectedStillExists) {
      const lastIndex = cart.length - 1;
      setSelectedLineKey(getCartLineKey(cart[lastIndex], lastIndex));
      setQuantityEditor(null);
    }
  }, [cart, selectedLineKey]);

  useEffect(() => {
    if (!selectedLineKey || typeof window === "undefined") {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      cartRowRefs.current
        .get(selectedLineKey)
        ?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "auto",
        });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedLineKey]);

  /* =========================================================
     TOTALES
  ========================================================= */

  const total =
    roundMoney(
      cartPricing?.total ??
      cart.reduce(
        (accumulator, item) =>
          accumulator +
          getItemSubtotal(item),
        0
      )
    );

  const promotionDiscountTotal =
    roundMoney(
      cartPricing?.discountTotal
    );

  const promotionApplications =
    Array.isArray(
      cartPricing?.applications
    )
      ? cartPricing.applications
      : [];

  const itemCount = cart.length;

  /* =========================================================
     PRODUCTO ESPECIAL
  ========================================================= */

  function disarmQuickQuantity() {
    quickQuantityArmedRef.current = false;

    if (quickQuantityTimerRef.current !== null) {
      window.clearTimeout(quickQuantityTimerRef.current);
      quickQuantityTimerRef.current = null;
    }
  }

  function armQuickQuantity() {
    disarmQuickQuantity();
    quickQuantityArmedRef.current = true;

    quickQuantityTimerRef.current = window.setTimeout(() => {
      quickQuantityArmedRef.current = false;
      quickQuantityTimerRef.current = null;
    }, 2200);
  }

  useEffect(() => {
    return () => {
      if (quickQuantityTimerRef.current !== null) {
        window.clearTimeout(quickQuantityTimerRef.current);
      }
    };
  }, []);

  function closeSaleModal() {
    setSaleProduct(null);
    setEditingIndex(null);
    setWeightInput("");
    setAmountInput("");
  }

  function agregarProducto(product) {
    if (!product || !openSession) {
      return;
    }

    const tipo =
      getTipoVenta(product);

    if (tipo === "unidad") {
      const ok =
        addProductToCart(
          product
        );

      if (ok) {
        pendingSelectBarcodeRef.current = product.barcode;
        setQuantityEditor(null);
        armQuickQuantity();
        setSearch("");
        setSearchFocused(false);
      }

      return;
    }

    setSaleProduct(product);
    setEditingIndex(null);
    setWeightInput("");
    setAmountInput("");

    setSearch("");
    setSearchFocused(false);
  }

  /* =========================================================
     LECTOR USB / HID GLOBAL
  ========================================================= */

  useEffect(() => {
    const MAX_GAP_MS = 110;
    const RESET_AFTER_MS = 260;
    const MIN_CODE_LENGTH = 3;

    function clearUsbBuffer() {
      usbScannerBufferRef.current = "";
      usbScannerLastKeyRef.current = 0;
      scannerSequenceActiveRef.current = false;

      if (usbScannerResetTimerRef.current) {
        window.clearTimeout(
          usbScannerResetTimerRef.current
        );

        usbScannerResetTimerRef.current = null;
      }
    }

    function isEditableTarget(target) {
      if (!(target instanceof Element)) {
        return false;
      }

      return Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"]'
        )
      );
    }

    function handleUsbScannerKeyDown(event) {
      /*
       * Cuando el usuario está escribiendo en un campo dejamos
       * trabajar al control normalmente. El buscador ya acepta
       * un código exacto + Enter, por lo que el lector también
       * funciona si ese campo quedó enfocado.
       */
      if (isEditableTarget(event.target)) {
        clearUsbBuffer();
        return;
      }

      if (
        !openSession ||
        scanOpen ||
        payOpen ||
        promotionOpen ||
        ticketOpen ||
        saleProduct ||
        checkoutInFlightRef.current
      ) {
        clearUsbBuffer();
        return;
      }

      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat
      ) {
        clearUsbBuffer();
        return;
      }

      /*
       * El Numpad queda reservado para cantidades/atajos del POS.
       * Los lectores HID estándar envían Digit0-9, no Numpad0-9.
       */
      if (event.code.startsWith("Numpad")) {
        clearUsbBuffer();
        return;
      }

      const key = event.key;

      if (key === "Enter" || key === "Tab") {
        const code = String(
          usbScannerBufferRef.current || ""
        ).trim();

        clearUsbBuffer();

        if (code.length < MIN_CODE_LENGTH) {
          return;
        }

        event.preventDefault();

        const product =
          catalog?.[code] ||
          products.find(
            (item) =>
              String(
                item?.barcode || ""
              ).trim() === code
          );

        if (!product) {
          showToast(
            `Código ${code}: producto no encontrado`,
            true
          );
          return;
        }

        agregarProducto(product);
        return;
      }

      if (key.length !== 1) {
        return;
      }

      const now = Date.now();
      const last =
        usbScannerLastKeyRef.current;

      const rapidSequence =
        last > 0 &&
        now - last <= MAX_GAP_MS &&
        usbScannerBufferRef.current.length > 0;

      if (rapidSequence) {
        scannerSequenceActiveRef.current = true;

        if (notebookShortcutTimerRef.current !== null) {
          window.clearTimeout(notebookShortcutTimerRef.current);
          notebookShortcutTimerRef.current = null;
        }
      }

      /*
       * Si entre caracteres pasa demasiado tiempo, lo tratamos
       * como escritura humana y comenzamos una lectura nueva.
       */
      if (
        last > 0 &&
        now - last > MAX_GAP_MS
      ) {
        usbScannerBufferRef.current = "";
        scannerSequenceActiveRef.current = false;
      }

      usbScannerBufferRef.current += key;
      usbScannerLastKeyRef.current = now;

      if (usbScannerResetTimerRef.current) {
        window.clearTimeout(
          usbScannerResetTimerRef.current
        );
      }

      usbScannerResetTimerRef.current =
        window.setTimeout(
          clearUsbBuffer,
          RESET_AFTER_MS
        );
    }

    window.addEventListener(
      "keydown",
      handleUsbScannerKeyDown,
      true
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleUsbScannerKeyDown,
        true
      );

      clearUsbBuffer();
    };
  }, [
    catalog,
    openSession,
    payOpen,
    promotionOpen,
    ticketOpen,
    products,
    saleProduct,
    scanOpen,
    showToast,
  ]);

  function getSelectedCartIndex() {
    if (cart.length === 0) {
      return -1;
    }

    const index = cart.findIndex(
      (item, itemIndex) =>
        getCartLineKey(item, itemIndex) === selectedLineKey
    );

    return index >= 0 ? index : cart.length - 1;
  }

  function selectTicketRelative(direction) {
    if (cart.length === 0) {
      return;
    }

    const currentIndex = getSelectedCartIndex();
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.min(
      cart.length - 1,
      Math.max(0, baseIndex + direction)
    );

    setSelectedLineKey(
      getCartLineKey(cart[nextIndex], nextIndex)
    );
    setQuantityEditor(null);
  }

  function beginQuantityEdit(initialValue = null) {
    const index = getSelectedCartIndex();

    if (index < 0) {
      return false;
    }

    const item = cart[index];

    if (getTipoVenta(item) !== "unidad") {
      showToast(
        getTipoVenta(item) === "peso"
          ? "Este producto se edita por peso"
          : "Este producto usa importe libre"
      );
      return false;
    }

    const key = getCartLineKey(item, index);
    const value =
      initialValue === null
        ? String(Math.max(1, Math.trunc(toNumber(item.qty, 1))))
        : String(initialValue);

    setSelectedLineKey(key);
    setQuantityEditor({ key, value });
    return true;
  }

  function appendQuantityDigit(digit) {
    const index = getSelectedCartIndex();

    if (index < 0 || getTipoVenta(cart[index]) !== "unidad") {
      return;
    }

    const key = getCartLineKey(cart[index], index);

    setSelectedLineKey(key);
    setQuantityEditor((current) => {
      if (!current || current.key !== key) {
        return { key, value: String(digit) };
      }

      const next = `${current.value}${digit}`.replace(/^0+(?=\d)/, "");
      return { key, value: next.slice(0, 5) };
    });
  }

  function confirmQuantityEditor() {
    if (!quantityEditor) {
      return false;
    }

    const index = cart.findIndex(
      (item, itemIndex) =>
        getCartLineKey(item, itemIndex) === quantityEditor.key
    );

    if (index < 0) {
      setQuantityEditor(null);
      return false;
    }

    const item = cart[index];
    const targetQty = Math.trunc(Number(quantityEditor.value));

    if (!Number.isFinite(targetQty) || targetQty <= 0) {
      showToast("Ingresá una cantidad mayor a cero", true);
      return true;
    }

    const currentQty = Math.max(1, Math.trunc(toNumber(item.qty, 1)));
    const delta = targetQty - currentQty;

    if (delta === 0) {
      setQuantityEditor(null);
      return true;
    }

    const ok = changeCartQty(index, delta);

    if (ok !== false) {
      disarmQuickQuantity();
      setQuantityEditor(null);
    }

    return true;
  }

  function adjustSelectedQuantity(delta) {
    const index = getSelectedCartIndex();

    if (index < 0) {
      return;
    }

    const item = cart[index];

    if (getTipoVenta(item) !== "unidad") {
      return;
    }

    setQuantityEditor(null);
    changeCartQty(index, delta);
  }

  function deleteSelectedLine() {
    const index = getSelectedCartIndex();

    if (index < 0) {
      return;
    }

    removeFromCart(index);
    setQuantityEditor(null);
  }

  /* =========================================================
     ATAJOS DE VENTA — PC + NOTEBOOK + LECTOR HID

     /                 -> buscar producto
     Q                 -> editar cantidad exacta
     ↑ / ↓             -> seleccionar línea del ticket
     + / -             -> ajustar una unidad
     Delete/Backspace  -> eliminar línea seleccionada
     Shift + Delete    -> vaciar ticket con confirmación
     Enter             -> confirmar cantidad / cobrar
     Esc               -> cancelar edición / búsqueda

     Se conservan F2, F4 y Numpad Enter para teclado completo.
  ========================================================= */

  useEffect(() => {
    const NOTEBOOK_ACTION_DELAY_MS = 145;

    function isEditableShortcutTarget(target) {
      if (!(target instanceof Element)) {
        return false;
      }

      return Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"]'
        )
      );
    }

    function hasExternalDialog() {
      return Boolean(
        document.querySelector(
          '[role="dialog"][aria-modal="true"]'
        )
      );
    }

    function clearNotebookTimer() {
      if (notebookShortcutTimerRef.current !== null) {
        window.clearTimeout(notebookShortcutTimerRef.current);
        notebookShortcutTimerRef.current = null;
      }
    }

    function scheduleNotebookAction(callback) {
      clearNotebookTimer();

      notebookShortcutTimerRef.current = window.setTimeout(() => {
        notebookShortcutTimerRef.current = null;

        if (
          scannerSequenceActiveRef.current ||
          hasExternalDialog() ||
          isEditableShortcutTarget(document.activeElement)
        ) {
          return;
        }

        callback();
      }, NOTEBOOK_ACTION_DELAY_MS);
    }

    function openSearch() {
      if (!openSession) {
        return;
      }

      disarmQuickQuantity();
      setQuantityEditor(null);
      setSearchFocused(true);

      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }

    function handleSaleShortcut(event) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !window.matchMedia("(min-width: 760px), (pointer: fine)").matches
      ) {
        return;
      }

      const editable = isEditableShortcutTarget(event.target);
      const externalDialogOpen = hasExternalDialog();
      const code = event.code;
      const key = event.key;

      /* Modal.jsx resuelve ESC de cualquier modal en capture. */
      if (key === "Escape") {
        if (externalDialogOpen || checkoutInFlightRef.current) {
          return;
        }

        if (quantityEditor) {
          event.preventDefault();
          setQuantityEditor(null);
          return;
        }

        if (editable) {
          if (event.target === searchInputRef.current) {
            event.preventDefault();
            setSearch("");
            setSearchFocused(false);
            searchInputRef.current?.blur();
          }
          return;
        }

        if (search || searchFocused) {
          event.preventDefault();
          setSearch("");
          setSearchFocused(false);
          searchInputRef.current?.blur();
        }

        return;
      }

      if (
        editable ||
        externalDialogOpen ||
        checkoutInFlightRef.current
      ) {
        return;
      }

      if (code === "F2") {
        event.preventDefault();
        openSearch();
        return;
      }

      if (code === "F4") {
        if (cart.length > 0) {
          event.preventDefault();
          handleClearTicket();
        }
        return;
      }

      if (key === "/" && !event.shiftKey) {
        event.preventDefault();
        scheduleNotebookAction(openSearch);
        return;
      }

      if (code === "KeyQ" && !event.shiftKey) {
        event.preventDefault();
        scheduleNotebookAction(() => {
          disarmQuickQuantity();
          beginQuantityEdit();
        });
        return;
      }

      if (code.startsWith("Numpad") && /^Numpad\d$/.test(code)) {
        if (quantityEditor || quickQuantityArmedRef.current) {
          const digit = code.slice(-1);
          event.preventDefault();
          disarmQuickQuantity();
          appendQuantityDigit(digit);
        }
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        disarmQuickQuantity();
        selectTicketRelative(-1);
        return;
      }

      if (key === "ArrowDown") {
        event.preventDefault();
        disarmQuickQuantity();
        selectTicketRelative(1);
        return;
      }

      if (code === "NumpadAdd" || key === "+") {
        event.preventDefault();
        disarmQuickQuantity();
        adjustSelectedQuantity(1);
        return;
      }

      if (code === "NumpadSubtract" || key === "-") {
        event.preventDefault();
        disarmQuickQuantity();
        adjustSelectedQuantity(-1);
        return;
      }

      if (key === "Delete" && event.shiftKey) {
        if (cart.length > 0) {
          event.preventDefault();
          handleClearTicket();
        }
        return;
      }

      if ((key === "Delete" || key === "Backspace") && !event.shiftKey) {
        if (cart.length > 0) {
          event.preventDefault();
          disarmQuickQuantity();
          deleteSelectedLine();
        }
        return;
      }

      if (key === "Enter" || code === "NumpadEnter") {
        if (scannerSequenceActiveRef.current) {
          return;
        }

        if (quantityEditor) {
          event.preventDefault();
          confirmQuantityEditor();
          return;
        }

        if (!openSession || cart.length === 0) {
          return;
        }

        event.preventDefault();
        disarmQuickQuantity();
        setPayOpen(true);
      }
    }

    window.addEventListener("keydown", handleSaleShortcut, true);

    return () => {
      window.removeEventListener("keydown", handleSaleShortcut, true);
      clearNotebookTimer();
    };
  }, [
    cart,
    openSession,
    quantityEditor,
    search,
    searchFocused,
    selectedLineKey,
  ]);

  function editarItem(item, index) {
    const tipo =
      getTipoVenta(item);

    if (tipo === "unidad") {
      return;
    }

    const product =
      catalog?.[item.barcode] ||
      item;

    setSaleProduct(product);
    setEditingIndex(index);

    if (tipo === "peso") {
      setWeightInput(
        String(
          roundQuantity(
            item.qty
          )
        )
      );

      setAmountInput(
        String(
          getItemSubtotal(item)
        )
      );
    } else {
      setWeightInput("");

      setAmountInput(
        String(
          getItemSubtotal(item)
        )
      );
    }
  }

  function handleWeightChange(value) {
    setWeightInput(value);

    const weight = toNumber(
      value,
      0
    );

    const price = toNumber(
      saleProduct?.price,
      0
    );

    if (
      !value ||
      weight <= 0 ||
      price <= 0
    ) {
      setAmountInput("");
      return;
    }

    setAmountInput(
      String(
        roundMoney(
          weight * price
        )
      )
    );
  }

  function handleAmountChange(value) {
    setAmountInput(value);

    if (
      getTipoVenta(
        saleProduct
      ) !== "peso"
    ) {
      return;
    }

    const amount = toNumber(
      value,
      0
    );

    const price = toNumber(
      saleProduct?.price,
      0
    );

    if (
      !value ||
      amount <= 0 ||
      price <= 0
    ) {
      setWeightInput("");
      return;
    }

    setWeightInput(
      String(
        roundQuantity(
          amount / price
        )
      )
    );
  }

  function confirmarProductoEspecial() {
    if (!saleProduct) {
      return;
    }

    const tipo =
      getTipoVenta(
        saleProduct
      );

    const amount =
      roundMoney(
        toNumber(
          amountInput,
          0
        )
      );

    /* -----------------------------------------------------
       IMPORTE LIBRE
    ----------------------------------------------------- */

    if (
      tipo ===
      "precio-libre"
    ) {
      if (amount <= 0) {
        showToast(
          "Ingresá un importe válido",
          true
        );

        return;
      }

      if (
        editingIndex !== null
      ) {
        const ok =
          updateCartAmount(
            editingIndex,
            amount
          );

        if (ok) {
          closeSaleModal();
        }

        return;
      }

      const ok =
        addProductToCart(
          saleProduct,
          {
            amount,
          }
        );

      if (ok) {
        pendingSelectBarcodeRef.current = saleProduct.barcode;
        closeSaleModal();
      }

      return;
    }

    /* -----------------------------------------------------
       PESO
    ----------------------------------------------------- */

    const weight =
      roundQuantity(
        toNumber(
          weightInput,
          0
        )
      );

    if (weight <= 0) {
      showToast(
        "Ingresá un peso válido",
        true
      );

      return;
    }

    if (amount <= 0) {
      showToast(
        "El importe debe ser mayor a cero",
        true
      );

      return;
    }

    if (
      editingIndex !== null
    ) {
      const ok =
        updateCartAmount(
          editingIndex,
          amount
        );

      if (ok) {
        closeSaleModal();
      }

      return;
    }

    const ok =
      addProductToCart(
        saleProduct,
        {
          quantity: weight,
          amount,
        }
      );

    if (ok) {
      pendingSelectBarcodeRef.current = saleProduct.barcode;
      closeSaleModal();
    }
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
     * 1. Código exacto.
     */
    const exactBarcode =
      catalog?.[value];

    if (exactBarcode) {
      agregarProducto(
        exactBarcode
      );

      return;
    }

    /*
     * 2. Nombre exacto.
     */
    const normalized =
      value.toLowerCase();

    const exactName =
      products.find(
        (product) =>
          String(
            product?.name ||
              ""
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
     * 3. Un único resultado.
     */
    if (
      searchResults.length ===
      1
    ) {
      agregarProducto(
        searchResults[0]
      );

      return;
    }

    /*
     * 4. Ninguna coincidencia.
     */
    if (
      searchResults.length ===
      0
    ) {
      showToast(
        "Producto no encontrado",
        true
      );

      return;
    }

    showToast(
      "Seleccioná un producto de la lista"
    );
  }

  /* =========================================================
     SCANNER
  ========================================================= */

  function handleScannerResult(value) {
    setScanOpen(false);

    const code =
      String(
        value || ""
      ).trim();

    if (!code) {
      return;
    }

    const product =
      catalog?.[code];

    if (!product) {
      showToast(
        "Producto no encontrado. Cargalo en Stock.",
        true
      );

      return;
    }

    agregarProducto(product);
  }

  /* =========================================================
     CHECKOUT ASYNC
  ========================================================= */

  async function handlePaymentConfirm(
    payment
  ) {
    if (
      checkoutInFlightRef.current
    ) {
      return;
    }

    /*
     * Guardamos una foto del ticket antes del checkout porque
     * usePosData vacía el carrito cuando la venta se confirma.
     */
    const cartSnapshot =
      ticketEnabled
        ? cart.map((item) => ({
            ...item,
          }))
        : [];

    const totalSnapshot =
      total;

    const discountSnapshot =
      promotionDiscountTotal;

    checkoutInFlightRef.current =
      true;
    setCheckoutPending(true);

    try {
      const result =
        await Promise.resolve(
          checkout(payment)
        );

      if (result) {
        const sale =
          typeof result === "object"
            ? result
            : {
                id: `local-${Date.now()}`,
                timestamp: new Date().toISOString(),
                items: cartSnapshot,
                total: totalSnapshot,
                promotionDiscountTotal: discountSnapshot,
                payment,
              };

        setPayOpen(false);

        if (ticketEnabled) {
          setLastTicket({
            sale: {
              ...sale,
              items:
                Array.isArray(sale?.items) &&
                sale.items.length > 0
                  ? sale.items
                  : cartSnapshot,
              total:
                Number.isFinite(Number(sale?.total))
                  ? Number(sale.total)
                  : totalSnapshot,
              promotionDiscountTotal:
                Number.isFinite(
                  Number(
                    sale?.promotionDiscountTotal
                  )
                )
                  ? Number(
                      sale.promotionDiscountTotal
                    )
                  : discountSnapshot,
              payment:
                sale?.payment ||
                payment,
            },
            shopName:
              pos?.shopName ||
              "Mi Negocio",
            operatorName:
              operador?.nombre ||
              "Operador",
          });
          setTicketOpen(true);
        }
      }
    } catch (error) {
      console.error(
        "Error registrando venta:",
        error
      );

      showToast(
        "No se pudo registrar la venta",
        true
      );
    } finally {
      checkoutInFlightRef.current =
        false;
      setCheckoutPending(false);
    }
  }

  function handleClearTicket() {
    if (cart.length === 0) {
      return;
    }

    const confirmar = window.confirm(
      "¿Vaciar el ticket actual?"
    );

    if (confirmar) {
      disarmQuickQuantity();
      setQuantityEditor(null);
      clearCart();
    }
  }

  /* =========================================================
     MODAL
  ========================================================= */

  const modalTipo =
    getTipoVenta(
      saleProduct
    );

  const modalPrice =
    toNumber(
      saleProduct?.price
    );

  const modalStock =
    toNumber(
      saleProduct?.stock
    );

  const modalWeight =
    toNumber(
      weightInput
    );

  const modalAmount =
    toNumber(
      amountInput
    );

  const exceedsStock =
    modalTipo === "peso" &&
    modalWeight > modalStock;

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div className="pb-3">
      {/* =====================================================
          CAJA CERRADA
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
          VENCIMIENTOS
      ===================================================== */}

      {expiring.length > 0 && (
        <Banner
          tone="warning"
          icon={
            <ClockIcon className="h-4 w-4" />
          }
          onClick={() =>
            goInventario?.(
              "expiring"
            )
          }
        >
          {expiring.length} producto
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
          STOCK BAJO
      ===================================================== */}

      {lowStock.length > 0 && (
        <Banner
          tone="danger"
          icon={
            <StockAlertIcon className="h-4 w-4" />
          }
          onClick={() =>
            goInventario?.(
              "low"
            )
          }
        >
          {lowStock.length} producto
          {lowStock.length !== 1
            ? "s"
            : ""}{" "}
          con stock bajo.
        </Banner>
      )}

      {/* =====================================================
          BUSCADOR
      ===================================================== */}

      <div
        className="pos-sale-shortcuts mb-2.5 hidden items-center gap-2 rounded-2xl border border-[#FFC61A]/15 bg-[#FFC61A]/[0.06] px-3.5 py-2.5 text-[11px] font-semibold text-white/45 lg:flex"
      >
        <BarcodeIcon className="h-4 w-4 shrink-0 text-[#FFC61A]" />
        <span className="mr-auto">Lector USB listo</span>
        <span className="pos-sale-shortcuts__item">
          <kbd>/</kbd> Buscar
        </span>
        <span className="pos-sale-shortcuts__item">
          <kbd>Q</kbd> Cantidad
        </span>
        <span className="pos-sale-shortcuts__item">
          <kbd>↑↓</kbd> Línea
        </span>
        <span className="pos-sale-shortcuts__item">
          <kbd>Enter</kbd> Cobrar
        </span>
        <span className="pos-sale-shortcuts__item">
          <kbd>Esc</kbd> Cerrar
        </span>
        <span className="pos-sale-shortcuts__item">
          <kbd>V/S/C…</kbd> Secciones
        </span>
      </div>

      <div className="relative z-20 mb-4">
        <div className="flex gap-2.5">
          <div className="relative min-w-0 flex-1">
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
              ref={searchInputRef}
              type="search"
              autoComplete="off"
              placeholder="Buscar por nombre o código..."
              disabled={!openSession}
              value={search}
              onFocus={() =>
                setSearchFocused(
                  true
                )
              }
              onChange={(event) => {
                setSearch(
                  event.target.value
                );

                setSearchFocused(
                  true
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  if (searchResults.length > 0) {
                    event.preventDefault();
                    setSearchResultIndex((current) =>
                      Math.min(searchResults.length - 1, current + 1)
                    );
                  }
                  return;
                }

                if (event.key === "ArrowUp") {
                  if (searchResults.length > 0) {
                    event.preventDefault();
                    setSearchResultIndex((current) =>
                      Math.max(0, current - 1)
                    );
                  }
                  return;
                }

                if (event.key === "Enter") {
                  event.preventDefault();

                  const highlighted =
                    showSearchResults && searchResults.length > 0
                      ? searchResults[searchResultIndex]
                      : null;

                  if (highlighted) {
                    agregarProducto(highlighted);
                  } else {
                    handleSearchSubmit();
                  }
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setSearch("");
                  setSearchFocused(false);
                  searchInputRef.current?.blur();
                }
              }}
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
            />

            {search && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onMouseDown={(event) =>
                  event.preventDefault()
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

          <button
            type="button"
            disabled={!openSession}
            onClick={() =>
              setPromotionOpen(
                true
              )
            }
            aria-label="Ver promociones"
            className="
              inline-flex
              h-[50px]
              w-[54px]
              shrink-0
              items-center
              justify-center
              gap-2
              rounded-2xl
              border
              border-[#FFC61A]/20
              bg-[#FFC61A]/[0.08]
              text-[#FFC61A]
              transition
              hover:border-[#FFC61A]/35
              hover:bg-[#FFC61A]/12
              active:scale-[0.97]
              disabled:cursor-not-allowed
              disabled:opacity-40
              sm:w-auto
              sm:px-4
            "
          >
            <MoneyIcon className="h-5 w-5" />
            <span className="hidden text-xs font-extrabold sm:inline">Promos</span>
          </button>

          <button
            type="button"
            disabled={!openSession}
            onClick={() =>
              setScanOpen(
                true
              )
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
            RESULTADOS
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
              "
            >
              {searchResults.length === 0 ? (
                <div className="px-4 py-4">
                  <p className="text-xs font-extrabold text-white">
                    Sin resultados
                  </p>

                  <p className="mt-1 text-[10px] text-white/35">
                    Probá con otro nombre o código.
                  </p>
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

                    <span className="text-[9px] font-bold text-[#FFC61A]">
                      {
                        searchResults.length
                      }
                    </span>
                  </div>

                  <div className="max-h-[310px] overflow-y-auto">
                    {searchResults.map(
                      (
                        product,
                        index
                      ) => {
                        const tipo =
                          getTipoVenta(
                            product
                          );

                        const stock =
                          toNumber(
                            product?.stock
                          );

                        return (
                          <motion.button
                            key={
                              product.barcode ||
                              `${product.name}-${index}`
                            }
                            type="button"
                            initial={{
                              opacity: 0,
                              y: 4,
                            }}
                            animate={{
                              opacity: 1,
                              y: 0,
                            }}
                            transition={{
                              delay:
                                index *
                                0.02,
                            }}
                            onMouseDown={(event) =>
                              event.preventDefault()
                            }
                            onMouseEnter={() =>
                              setSearchResultIndex(index)
                            }
                            onClick={() =>
                              agregarProducto(
                                product
                              )
                            }
                            className={
                              `
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
                              ` +
                              (index === searchResultIndex
                                ? " bg-[#FFC61A]/[0.08] ring-1 ring-inset ring-[#FFC61A]/20"
                                : "")
                            }
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
                              <ProductTypeIcon
                                tipo={
                                  tipo
                                }
                                className="h-[18px] w-[18px]"
                              />
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-extrabold text-white">
                                {
                                  product.name
                                }
                              </p>

                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-white/35">
                                <span className="truncate">
                                  {displayBarcode(
                                    product.barcode
                                  )}
                                </span>

                                <span>
                                  ·
                                </span>

                                {tipo ===
                                "precio-libre" ? (
                                  <span className="text-[#FFC61A]">
                                    Importe libre
                                  </span>
                                ) : tipo ===
                                  "peso" ? (
                                  <span
                                    className={
                                      stock <= 5
                                        ? "text-red-400"
                                        : "text-emerald-400"
                                    }
                                  >
                                    {formatQuantity(
                                      stock
                                    )}{" "}
                                    kg disponibles
                                  </span>
                                ) : (
                                  <span
                                    className={
                                      stock <= 5
                                        ? "text-red-400"
                                        : "text-emerald-400"
                                    }
                                  >
                                    Stock{" "}
                                    {
                                      stock
                                    }
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <span className="block text-sm font-black text-[#FFC61A]">
                                {tipo ===
                                "precio-libre"
                                  ? "Libre"
                                  : money(
                                      product.price
                                    )}
                              </span>

                              <span className="mt-0.5 block text-[9px] font-bold text-white/25">
                                {tipo ===
                                "peso"
                                  ? "por kg"
                                  : "Agregar"}
                              </span>
                            </div>

                            <PlusIcon className="h-4 w-4 shrink-0 text-white/25 transition group-hover:text-[#FFC61A]" />
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
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#FFF5CC] text-[#9A7100]">
                <ReceiptIcon className="h-[18px] w-[18px]" />
              </div>

              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#B98700]">
                  Venta actual
                </p>

                <h2 className="mt-0.5 text-lg font-black tracking-[-0.02em] text-[#111318]">
                  Ticket actual
                </h2>
              </div>
            </div>

            <span className="shrink-0 rounded-full bg-[#F4F5F7] px-3 py-1.5 text-[10px] font-extrabold text-black/45">
              {itemCount}{" "}
              {itemCount === 1
                ? "ítem"
                : "ítems"}
            </span>
          </div>

          <div className="my-4 h-[3px] rounded-full bg-[#FFC61A]" />

          {cart.length === 0 ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center px-4 py-6 text-center">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#F4F5F7] text-black/30">
                <BarcodeIcon className="h-5 w-5" />
              </div>

              <h3 className="text-sm font-extrabold text-[#111318]">
                El ticket está vacío
              </h3>

              <p className="mt-1 max-w-[270px] text-xs leading-relaxed text-black/40">
                Buscá por nombre, ingresá un código o escaneá el producto.
              </p>
            </div>
          ) : (
            <div>
              <AnimatePresence
                initial={
                  false
                }
              >
                {cart.map(
                  (
                    item,
                    index
                  ) => {
                    const tipo =
                      getTipoVenta(
                        item
                      );

                    const baseSubtotal =
                      getItemSubtotal(
                        item
                      );

                    const promotionDiscount =
                      tipo === "unidad"
                        ? roundMoney(
                            Math.min(
                              baseSubtotal,
                              Math.max(
                                0,
                                toNumber(
                                  cartPricing
                                    ?.discountByBarcode
                                    ?.[item.barcode]
                                )
                              )
                            )
                          )
                        : 0;

                    const subtotal =
                      roundMoney(
                        baseSubtotal -
                        promotionDiscount
                      );

                    const lineKey =
                      getCartLineKey(
                        item,
                        index
                      );

                    const selected =
                      lineKey ===
                      selectedLineKey;

                    const editingQty =
                      quantityEditor?.key ===
                      lineKey;

                    return (
                      <motion.div
                        key={
                          item.cartLineId ||
                          `${item.barcode}-${index}`
                        }
                        ref={(element) => {
                          if (element) {
                            cartRowRefs.current.set(lineKey, element);
                          } else {
                            cartRowRefs.current.delete(lineKey);
                          }
                        }}
                        onMouseDown={() => {
                          setSelectedLineKey(lineKey);
                          if (!editingQty) {
                            setQuantityEditor(null);
                          }
                        }}
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
                        className={
                          `overflow-hidden border-b border-black/8 py-3 transition last:border-b-0 ` +
                          (selected
                            ? "rounded-2xl bg-[#FFF8DE] px-2 ring-2 ring-inset ring-[#FFC61A]/45"
                            : "")
                        }
                      >
                        <div className="flex items-start gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FFF5CC] text-[#9A7100]">
                            <ProductTypeIcon
                              tipo={
                                tipo
                              }
                              className="h-4 w-4"
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-extrabold text-[#111318]">
                              {
                                item.name
                              }
                            </p>

                            {tipo ===
                            "peso" ? (
                              <p className="mt-0.5 text-[10px] font-semibold text-black/40">
                                {formatQuantity(
                                  item.qty
                                )}{" "}
                                kg ×{" "}
                                {money(
                                  item.price
                                )}
                                /kg
                              </p>
                            ) : tipo ===
                              "precio-libre" ? (
                              <p className="mt-0.5 text-[10px] font-semibold text-black/40">
                                Importe manual
                              </p>
                            ) : (
                              <p className="mt-0.5 text-[10px] font-semibold text-black/40">
                                {money(
                                  item.price
                                )}{" "}
                                c/u
                              </p>
                            )}

                            {promotionDiscount > 0 && (
                              <p className="mt-1 text-[10px] font-extrabold text-emerald-600">
                                Promoción · -{money(promotionDiscount)}
                              </p>
                            )}
                          </div>

                          <div className="shrink-0 text-right text-sm font-black text-[#111318]">
                            {money(
                              subtotal
                            )}
                          </div>

                          <button
                            type="button"
                            aria-label={`Eliminar ${item.name}`}
                            onClick={() =>
                              removeFromCart(
                                index
                              )
                            }
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-red-500 transition hover:bg-red-50 active:scale-[0.96]"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>

                        {tipo ===
                        "unidad" ? (
                          <div className="mt-2.5 flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              aria-label={`Restar una unidad de ${item.name}`}
                              onClick={() =>
                                changeCartQty(
                                  index,
                                  -1
                                )
                              }
                              className="grid h-8 w-8 place-items-center rounded-xl border border-black/10 bg-[#F4F5F7] text-[#111318] transition hover:bg-[#EDEEF1] active:scale-[0.96]"
                            >
                              <MinusIcon className="h-3.5 w-3.5" />
                            </button>

                            {editingQty ? (
                              <input
                                autoFocus
                                type="text"
                                inputMode="numeric"
                                aria-label={`Cantidad de ${item.name}`}
                                value={quantityEditor?.value || ""}
                                onChange={(event) => {
                                  const next = event.target.value
                                    .replace(/\D/g, "")
                                    .slice(0, 5);

                                  setQuantityEditor({
                                    key: lineKey,
                                    value: next,
                                  });
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    confirmQuantityEditor();
                                    return;
                                  }

                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    setQuantityEditor(null);
                                    return;
                                  }

                                  if (event.key === "ArrowUp") {
                                    event.preventDefault();
                                    setQuantityEditor(null);
                                    selectTicketRelative(-1);
                                    return;
                                  }

                                  if (event.key === "ArrowDown") {
                                    event.preventDefault();
                                    setQuantityEditor(null);
                                    selectTicketRelative(1);
                                  }
                                }}
                                className="h-8 w-[64px] rounded-xl border-2 border-[#FFC61A] bg-white px-2 text-center text-sm font-black text-[#111318] outline-none ring-2 ring-[#FFC61A]/15"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => beginQuantityEdit()}
                                className={
                                  `min-w-[42px] rounded-xl px-2 py-1 text-center text-sm font-black transition ` +
                                  (selected
                                    ? "bg-[#FFC61A]/20 text-[#7A5900]"
                                    : "text-[#111318]")
                                }
                                title="Editar cantidad (Q)"
                              >
                                {item.qty}
                              </button>
                            )}

                            <button
                              type="button"
                              aria-label={`Sumar una unidad de ${item.name}`}
                              onClick={() =>
                                changeCartQty(
                                  index,
                                  1
                                )
                              }
                              className="grid h-8 w-8 place-items-center rounded-xl bg-[#FFC61A] text-black transition hover:bg-[#FFD248] active:scale-[0.96]"
                            >
                              <PlusIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2.5 flex justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                editarItem(
                                  item,
                                  index
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 bg-[#F4F5F7] px-3 py-2 text-[10px] font-extrabold text-black/55 transition hover:bg-[#EDEEF1] hover:text-black active:scale-[0.98]"
                            >
                              <EditIcon className="h-3.5 w-3.5" />

                              {tipo ===
                              "peso"
                                ? "Editar peso"
                                : "Editar importe"}
                            </button>
                          </div>
                        )}
                      </motion.div>
                    );
                  }
                )}
              </AnimatePresence>
            </div>
          )}

          {promotionApplications.length > 0 && (
            <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-emerald-700">
                  Promociones aplicadas
                </span>
                <strong className="text-xs font-black text-emerald-700">
                  Ahorrás {money(promotionDiscountTotal)}
                </strong>
              </div>

              <div className="mt-2 space-y-1.5">
                {promotionApplications.map((application) => (
                  <div
                    key={application.id}
                    className="flex items-center justify-between gap-3 text-[10px]"
                  >
                    <span className="min-w-0 truncate font-bold text-emerald-800/70">
                      {application.name}
                      {application.count > 1 ? ` ×${application.count}` : ""}
                    </span>
                    <span className="shrink-0 font-black text-emerald-700">
                      {Number(application.discount || 0) > 0
                        ? `-${money(application.discount)}`
                        : "Ahorro $0"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* =================================================
              TOTAL
          ================================================= */}

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/10 pt-4">
            <div>
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.14em] text-black/35">
                Total
              </span>

              <span className="mt-0.5 block text-xs font-semibold text-black/40">
                {promotionDiscountTotal > 0
                  ? `Antes ${money(cartPricing?.baseTotal || total)} · ahorro ${money(promotionDiscountTotal)}`
                  : `${itemCount} ${itemCount === 1 ? "producto" : "productos"}`}
              </span>
            </div>

            <motion.div
              key={
                total
              }
              initial={{
                scale: 1.06,
              }}
              animate={{
                scale: 1,
              }}
              transition={{
                type:
                  "spring",
                stiffness:
                  400,
                damping:
                  24,
              }}
              className="rounded-2xl bg-[#FFC61A] px-4 py-2.5 text-right text-2xl font-black tracking-[-0.04em] text-black"
            >
              {money(
                total
              )}
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
          setPayOpen(
            true
          )
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
        {money(
          total
        )}
      </button>

      {/* =====================================================
          VACIAR
      ===================================================== */}

      {cart.length > 0 && (
        <button
          type="button"
          onClick={
            handleClearTicket
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

      <PromotionSaleModal
        open={
          promotionOpen
        }
        pos={
          pos
        }
        onClose={() =>
          setPromotionOpen(
            false
          )
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

      {/* =====================================================
          PAGO
      ===================================================== */}

      <PaymentModal
        open={
          payOpen
        }
        total={
          total
        }
        processing={
          checkoutPending
        }
        onClose={() => {
          if (
            checkoutInFlightRef.current ||
            checkoutPending
          ) {
            return;
          }

          setPayOpen(
            false
          );
        }}
        onConfirm={
          handlePaymentConfirm
        }
      />

      {ticketEnabled && (
        <SaleTicketModal
          open={
            ticketOpen
          }
          ticket={
            lastTicket
          }
          onClose={() => {
            setTicketOpen(false);
          }}
        />
      )}

      {/* =====================================================
          PESO / IMPORTE LIBRE
      ===================================================== */}

      <Modal
        open={
          Boolean(
            saleProduct
          )
        }
        onClose={
          closeSaleModal
        }
        title={
          modalTipo === "peso"
            ? "Venta por peso"
            : "Importe de venta"
        }
      >
        {saleProduct && (
          <div>
            {/* PRODUCTO */}

            <div className="mb-4 overflow-hidden rounded-[22px] bg-white text-[#111318]">
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFF5CC] text-[#9A7100]">
                    <ProductTypeIcon
                      tipo={
                        modalTipo
                      }
                      className="h-5 w-5"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#B98700]">
                      {editingIndex !==
                      null
                        ? "Editar producto"
                        : "Agregar al ticket"}
                    </p>

                    <h3 className="mt-1 truncate text-lg font-black text-[#111318]">
                      {
                        saleProduct.name
                      }
                    </h3>

                    <p className="mt-1 text-xs font-semibold text-black/40">
                      {modalTipo ===
                      "peso"
                        ? `${money(
                            modalPrice
                          )} por kg`
                        : "Importe definido al vender"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 h-[3px] rounded-full bg-[#FFC61A]" />
              </div>
            </div>

            {/* =================================================
                PESO
            ================================================= */}

            {modalTipo ===
              "peso" && (
              <>
                <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#151A22] px-3.5 py-3">
                  <div>
                    <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">
                      Disponible
                    </span>

                    <span className="mt-0.5 block text-sm font-black text-white">
                      {formatQuantity(
                        modalStock
                      )}{" "}
                      kg
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">
                      Precio
                    </span>

                    <span className="mt-0.5 block text-sm font-black text-[#FFC61A]">
                      {money(
                        modalPrice
                      )}
                      /kg
                    </span>
                  </div>
                </div>

                <FieldLabel
                  htmlFor="sale-weight"
                  label="Peso"
                >
                  <div className="relative">
                    <ScaleIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />

                    <input
                      id="sale-weight"
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      autoFocus
                      value={
                        weightInput
                      }
                      onChange={(event) =>
                        handleWeightChange(
                          event.target.value
                        )
                      }
                      placeholder="Ej: 0.650"
                      className="
                        w-full
                        rounded-2xl
                        border
                        border-white/10
                        bg-[#171B23]
                        py-3.5
                        pl-11
                        pr-12
                        text-lg
                        font-black
                        text-white
                        outline-none
                        transition
                        placeholder:text-white/20
                        focus:border-[#FFC61A]
                        focus:ring-2
                        focus:ring-[#FFC61A]/10
                      "
                    />

                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-extrabold text-white/35">
                      kg
                    </span>
                  </div>
                </FieldLabel>

                <div className="mb-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-white/10" />

                  <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-white/25">
                    o ingresar importe
                  </span>

                  <div className="h-px flex-1 bg-white/10" />
                </div>
              </>
            )}

            {/* =================================================
                IMPORTE
            ================================================= */}

            <FieldLabel
              htmlFor="sale-amount"
              label={
                modalTipo ===
                "peso"
                  ? "Importe"
                  : "Importe a cobrar"
              }
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-black text-[#FFC61A]">
                  $
                </span>

                <input
                  id="sale-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus={
                    modalTipo ===
                    "precio-libre"
                  }
                  value={
                    amountInput
                  }
                  onChange={(event) =>
                    handleAmountChange(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      confirmarProductoEspecial();
                    }
                  }}
                  placeholder="0.00"
                  className="
                    w-full
                    rounded-2xl
                    border
                    border-white/10
                    bg-[#171B23]
                    py-3.5
                    pl-9
                    pr-4
                    text-lg
                    font-black
                    text-white
                    outline-none
                    transition
                    placeholder:text-white/20
                    focus:border-[#FFC61A]
                    focus:ring-2
                    focus:ring-[#FFC61A]/10
                  "
                />
              </div>
            </FieldLabel>

            {/* =================================================
                RESULTADO PESO
            ================================================= */}

            {modalTipo ===
              "peso" && (
              <div
                className={
                  exceedsStock
                    ? "mb-4 grid grid-cols-2 gap-2.5 rounded-[22px] border border-red-400/25 bg-red-500/10 p-3.5"
                    : "mb-4 grid grid-cols-2 gap-2.5 rounded-[22px] border border-white/10 bg-[#151A22] p-3.5"
                }
              >
                <SaleStat
                  label="Peso"
                  value={`${formatQuantity(
                    modalWeight
                  )} kg`}
                  danger={
                    exceedsStock
                  }
                />

                <SaleStat
                  label="Subtotal"
                  value={money(
                    modalAmount
                  )}
                  highlight={
                    !exceedsStock
                  }
                  danger={
                    exceedsStock
                  }
                />
              </div>
            )}

            {exceedsStock && (
              <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-3.5 py-3 text-xs font-semibold text-red-200">
                El peso ingresado supera el stock disponible.
              </div>
            )}

            {/* =================================================
                CONFIRMAR
            ================================================= */}

            <button
              type="button"
              disabled={
                modalAmount <= 0 ||
                (
                  modalTipo ===
                    "peso" &&
                  (
                    modalWeight <=
                      0 ||
                    exceedsStock
                  )
                )
              }
              onClick={
                confirmarProductoEspecial
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
              {editingIndex !==
              null ? (
                <EditIcon className="h-4 w-4" />
              ) : (
                <PlusIcon className="h-4 w-4" />
              )}

              {editingIndex !==
              null
                ? "Guardar cambios"
                : "Agregar al ticket"}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* =========================================================
   COMPONENTES AUXILIARES
========================================================= */

function FieldLabel({
  htmlFor,
  label,
  children,
}) {
  return (
    <div className="mb-4">
      <label
        htmlFor={
          htmlFor
        }
        className="mb-1.5 block text-xs font-bold text-white/55"
      >
        {label}
      </label>

      {children}
    </div>
  );
}

function SaleStat({
  label,
  value,
  highlight = false,
  danger = false,
}) {
  return (
    <div className="text-center">
      <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">
        {label}
      </span>

      <span
        className={
          danger
            ? "mt-1 block truncate text-base font-black text-red-400"
            : highlight
              ? "mt-1 block truncate text-base font-black text-[#FFC61A]"
              : "mt-1 block truncate text-base font-black text-white"
        }
      >
        {value}
      </span>
    </div>
  );
}

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

function Banner({
  tone,
  children,
  onClick,
  icon,
}) {
  const warning =
    "border-[#FFC61A]/25 bg-[#FFC61A]/10 text-[#F3CD62]";

  const danger =
    "border-red-400/20 bg-red-500/10 text-red-200";

  const style =
    tone === "danger"
      ? danger
      : warning;

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
      onKeyDown={(event) => {
        if (
          onClick &&
          (
            event.key ===
              "Enter" ||
            event.key ===
              " "
          )
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
        ${style}
        ${
          onClick
            ? "cursor-pointer transition hover:brightness-110 active:scale-[0.995]"
            : ""
        }
      `}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[0.06]">
        {icon}
      </span>

      <span className="min-w-0 flex-1 leading-snug">
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

function IconBase({
  className,
  children,
  strokeWidth = 2,
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={
        strokeWidth
      }
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SearchIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <circle
        cx="11"
        cy="11"
        r="7"
      />

      <path d="m20 20-3.5-3.5" />
    </IconBase>
  );
}

function CloseIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
      strokeWidth={
        2.2
      }
    >
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </IconBase>
  );
}

function BoxIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </IconBase>
  );
}

function ScaleIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M12 3v4" />
      <path d="M5 7h14" />
      <path d="m7 7-4 7h8L7 7Z" />
      <path d="m17 7-4 7h8l-4-7Z" />
      <path d="M12 7v13" />
      <path d="M8 20h8" />
    </IconBase>
  );
}

function MoneyIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
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
    </IconBase>
  );
}

function BarcodeIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M3 5v14" />
      <path d="M7 5v14" />
      <path d="M10 5v14" />
      <path d="M14 5v14" />
      <path d="M17 5v14" />
      <path d="M21 5v14" />
    </IconBase>
  );
}

function CameraIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9H3V9a2 2 0 0 1 2-2Z" />

      <circle
        cx="12"
        cy="13"
        r="3"
      />
    </IconBase>
  );
}

function ReceiptIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.2V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </IconBase>
  );
}

function MinusIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
      strokeWidth={
        2.4
      }
    >
      <path d="M5 12h14" />
    </IconBase>
  );
}

function PlusIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
      strokeWidth={
        2.4
      }
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

function EditIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M12 20h9" />

      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z" />
    </IconBase>
  );
}

function TrashIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 14h10l1-14" />
    </IconBase>
  );
}

function PaymentIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
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
    </IconBase>
  );
}

function ClearIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </IconBase>
  );
}

function RegisterIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M4 10h16v10H4z" />
      <path d="M7 10V5h10v5" />
      <path d="M8 14h3" />
      <path d="M15 14h1" />
      <path d="M15 17h1" />
      <path d="M8 17h3" />
    </IconBase>
  );
}

function ClockIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <circle
        cx="12"
        cy="12"
        r="9"
      />

      <path d="M12 7v5l3 2" />
    </IconBase>
  );
}

function StockAlertIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
    >
      <path d="M4 7h16v13H4z" />
      <path d="M8 7V4h8v3" />
      <path d="M12 11v4" />
      <path d="M12 18h.01" />
    </IconBase>
  );
}

function ChevronIcon({
  className = "",
}) {
  return (
    <IconBase
      className={
        className
      }
      strokeWidth={
        2.2
      }
    >
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  );
}