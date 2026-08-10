import { useCallback, useEffect, useState } from "react";
import { storeGet, storeSet } from "../lib/storage";
import { uid } from "../lib/format";

export function usePosData() {
  const [catalog, setCatalog] = useState({});
  const [sales, setSales] = useState([]);
  const [cashSessions, setCashSessions] = useState([]);
  const [shopName, setShopNameState] = useState("Mi Negocio");
  const [cart, setCart] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [toastMsg, setToastMsg] = useState(null); // {text, error}

  useEffect(() => {
    setCatalog(storeGet("catalog", {}));
    setSales(storeGet("sales", []));
    setCashSessions(storeGet("cashSessions", []));
    setShopNameState(storeGet("shopName", "Mi Negocio"));
    setLoaded(true);
  }, []);

  const showToast = useCallback((text, error = false) => {
    setToastMsg({ text, error, key: uid() });
  }, []);

  const persistCatalog = useCallback((next) => {
    setCatalog(next);
    storeSet("catalog", next);
  }, []);
  const persistSales = useCallback((next) => {
    setSales(next);
    storeSet("sales", next);
  }, []);
  const persistCashSessions = useCallback((next) => {
    setCashSessions(next);
    storeSet("cashSessions", next);
  }, []);
  const setShopName = useCallback((name) => {
    setShopNameState(name);
    storeSet("shopName", name);
  }, []);

  const openSession = cashSessions.find((s) => s.status === "open") || null;

  // ---- Products ----
  const upsertProduct = useCallback(
    (product, isEdit) => {
      if (!isEdit && catalog[product.barcode]) {
        showToast("Ya existe un producto con ese código", true);
        return false;
      }
      persistCatalog({ ...catalog, [product.barcode]: product });
      showToast(isEdit ? "Producto actualizado" : "Producto agregado");
      return true;
    },
    [catalog, persistCatalog, showToast]
  );

  const deleteProduct = useCallback(
    (barcode) => {
      const next = { ...catalog };
      delete next[barcode];
      persistCatalog(next);
      showToast("Producto eliminado");
    },
    [catalog, persistCatalog, showToast]
  );

  const restock = useCallback(
    (barcode, add) => {
      const p = catalog[barcode];
      if (!p) return;
      persistCatalog({ ...catalog, [barcode]: { ...p, stock: p.stock + add } });
      showToast("Stock actualizado");
    },
    [catalog, persistCatalog, showToast]
  );

  // ---- Cart ----
  const addToCartByBarcode = useCallback(
    (code) => {
      const p = catalog[code];
      if (!p) {
        showToast("Producto no encontrado. Cargalo en Stock.", true);
        return;
      }
      if (p.stock <= 0) {
        showToast("Sin stock disponible", true);
        return;
      }
      setCart((prev) => {
        const existing = prev.find((i) => i.barcode === code);
        if (existing) {
          if (existing.qty >= p.stock) {
            showToast("No hay más stock disponible", true);
            return prev;
          }
          return prev.map((i) => (i.barcode === code ? { ...i, qty: i.qty + 1 } : i));
        }
        return [...prev, { barcode: code, name: p.name, price: p.price, qty: 1 }];
      });
      showToast(p.name + " agregado");
    },
    [catalog, showToast]
  );

  const changeCartQty = useCallback(
    (idx, delta) => {
      setCart((prev) => {
        const item = prev[idx];
        if (!item) return prev;
        const p = catalog[item.barcode];
        const nextQty = item.qty + delta;
        if (delta > 0 && p && nextQty > p.stock) {
          showToast("No hay más stock disponible", true);
          return prev;
        }
        if (nextQty <= 0) return prev.filter((_, i) => i !== idx);
        return prev.map((i, ix) => (ix === idx ? { ...i, qty: nextQty } : i));
      });
    },
    [catalog, showToast]
  );

  const removeFromCart = useCallback((idx) => {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const checkout = useCallback(() => {
    if (!openSession) {
      showToast("Abrí la caja primero", true);
      return;
    }
    if (cart.length === 0) return;
    for (const item of cart) {
      const p = catalog[item.barcode];
      if (!p || p.stock < item.qty) {
        showToast("Stock insuficiente para " + item.name, true);
        return;
      }
    }
    const total = cart.reduce((a, i) => a + i.qty * i.price, 0);
    const sale = {
      id: uid(),
      timestamp: new Date().toISOString(),
      items: cart.map((i) => ({ barcode: i.barcode, name: i.name, price: i.price, qty: i.qty })),
      total,
      sessionId: openSession.id,
    };
    const nextCatalog = { ...catalog };
    cart.forEach((i) => {
      nextCatalog[i.barcode] = { ...nextCatalog[i.barcode], stock: nextCatalog[i.barcode].stock - i.qty };
    });
    persistSales([...sales, sale]);
    persistCatalog(nextCatalog);
    setCart([]);
    showToast("Venta registrada · " + total.toFixed(2));
  }, [openSession, cart, catalog, sales, persistSales, persistCatalog, showToast]);

  // ---- Cash sessions ----
  const openCashSession = useCallback(
    (openAmount) => {
      const session = {
        id: uid(),
        openTime: new Date().toISOString(),
        openAmount,
        closeTime: null,
        closeAmount: null,
        expectedAmount: null,
        counted: null,
        diff: null,
        totalSales: null,
        salesCount: null,
        status: "open",
      };
      persistCashSessions([...cashSessions, session]);
      showToast("Caja abierta");
    },
    [cashSessions, persistCashSessions, showToast]
  );

  const closeCashSession = useCallback(
    (counted) => {
      if (!openSession) return;
      const sessSales = sales.filter((s) => s.sessionId === openSession.id);
      const totalSales = sessSales.reduce((a, s) => a + s.total, 0);
      const expected = openSession.openAmount + totalSales;
      const diff = counted - expected;
      const next = cashSessions.map((s) =>
        s.id === openSession.id
          ? {
              ...s,
              closeTime: new Date().toISOString(),
              expectedAmount: expected,
              counted,
              diff,
              totalSales,
              salesCount: sessSales.length,
              status: "closed",
            }
          : s
      );
      persistCashSessions(next);
      showToast("Caja cerrada · diferencia " + diff.toFixed(2));
    },
    [openSession, sales, cashSessions, persistCashSessions, showToast]
  );

  return {
    loaded,
    catalog,
    sales,
    cashSessions,
    shopName,
    setShopName,
    cart,
    openSession,
    toastMsg,
    showToast,
    upsertProduct,
    deleteProduct,
    restock,
    addToCartByBarcode,
    changeCartQty,
    removeFromCart,
    clearCart,
    checkout,
    openCashSession,
    closeCashSession,
  };
}
