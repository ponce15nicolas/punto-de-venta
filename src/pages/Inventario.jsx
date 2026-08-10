import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { money, fmtDate, daysUntil } from "../lib/format";
import ProductModal from "../components/ProductModal";
import RestockModal from "../components/RestockModal";
import Scanner from "../components/Scanner";

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "low", label: "Stock bajo" },
  { id: "expiring", label: "Por vencer" },
];

export default function Inventario({ pos, filter, setFilter }) {
  const { catalog, upsertProduct, deleteProduct, restock, showToast } = pos;
  const [search, setSearch] = useState("");
  const [productModal, setProductModal] = useState({ open: false, product: null });
  const [restockModal, setRestockModal] = useState({ open: false, product: null });
  const [scanOpen, setScanOpen] = useState(false);
  const [scannedCode, setScannedCode] = useState(null);

  useEffect(() => {
    if (filter) setFilter(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let list = Object.values(catalog);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(q) || p.barcode.includes(q));
  }
  if (filter === "low") list = list.filter((p) => p.stock <= 5);
  if (filter === "expiring")
    list = list.filter((p) => {
      const d = daysUntil(p.expiry);
      return d !== null && d <= 7;
    });
  list.sort((a, b) => {
    const da = daysUntil(a.expiry),
      db = daysUntil(b.expiry);
    if (da === null && db === null) return a.name.localeCompare(b.name);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  return (
    <div>
      <input
        className="w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-cream text-sm font-mono mb-3"
        placeholder="Buscar producto o código..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex gap-1.5 mb-3.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={
              "font-mono text-[11px] px-2.5 py-1.5 rounded-full border " +
              (filter === f.id
                ? "bg-amber text-amber-ink border-amber"
                : "bg-surface text-cream-dim border-line")
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      <button
        className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold mb-3.5"
        onClick={() => setProductModal({ open: true, product: null })}
      >
        + Nuevo producto
      </button>

      {list.length === 0 ? (
        <div className="text-center py-10 px-2.5 text-cream-dim">
          <div className="text-3xl mb-2">📭</div>
          No hay productos{search || filter !== "all" ? " que coincidan" : ""}.
        </div>
      ) : (
        list.map((p) => {
          const d = daysUntil(p.expiry);
          let expTag = (
            <Tag tone="ok">{p.expiry ? fmtDate(p.expiry) : "Sin vencimiento"}</Tag>
          );
          if (d !== null && d < 0) expTag = <Tag tone="over">Vencido</Tag>;
          else if (d !== null && d <= 7) expTag = <Tag tone="soon">Vence en {d}d</Tag>;

          return (
            <motion.div
              key={p.barcode}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-surface border border-line rounded-xl px-3.5 py-3 mb-2"
            >
              <div className="flex justify-between gap-2.5 items-start">
                <div>
                  <div className="font-bold text-[14.5px]">{p.name}</div>
                  <div className="font-mono text-[10.5px] text-cream-dim mt-0.5">{p.barcode}</div>
                </div>
                <div className="font-mono font-bold text-[15px] text-amber whitespace-nowrap">{money(p.price)}</div>
              </div>
              <div className="flex gap-2.5 mt-2.5 flex-wrap text-[11.5px]">
                {p.stock <= 5 ? <Tag tone="stockLow">Stock: {p.stock}</Tag> : <Tag tone="stockOk">Stock: {p.stock}</Tag>}
                {expTag}
              </div>
              <div className="flex gap-2 mt-2.5">
                <SmallBtn onClick={() => setProductModal({ open: true, product: p })}>Editar</SmallBtn>
                <SmallBtn onClick={() => setRestockModal({ open: true, product: p })}>+ Stock</SmallBtn>
                <SmallBtn
                  danger
                  onClick={() => {
                    if (confirm(`¿Eliminar ${p.name} del catálogo?`)) deleteProduct(p.barcode);
                  }}
                >
                  Eliminar
                </SmallBtn>
              </div>
            </motion.div>
          );
        })
      )}

      <ProductModal
        open={productModal.open}
        product={productModal.product}
        scannedCode={scannedCode}
        onScan={() => setScanOpen(true)}
        onClose={() => {
          setProductModal({ open: false, product: null });
          setScannedCode(null);
        }}
        onSave={(product, error) => {
          if (error) {
            showToast(error, true);
            return;
          }
          const ok = upsertProduct(product, !!productModal.product);
          if (ok) {
            setProductModal({ open: false, product: null });
            setScannedCode(null);
          }
        }}
      />
      <RestockModal
        open={restockModal.open}
        product={restockModal.product}
        onClose={() => setRestockModal({ open: false, product: null })}
        onConfirm={(n) => {
          restock(restockModal.product.barcode, n);
          setRestockModal({ open: false, product: null });
        }}
      />
      <Scanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={(v) => {
          setScanOpen(false);
          setScannedCode(v);
        }}
      />
    </div>
  );
}

function Tag({ tone, children }) {
  const map = {
    ok: "bg-cream/5 text-cream-dim",
    soon: "bg-amber/15 text-[#F0C480]",
    over: "bg-brick/20 text-[#E58579]",
    stockOk: "bg-leaf/15 text-leaf",
    stockLow: "bg-brick/15 text-[#E58579]",
  };
  return <span className={`font-mono px-2 py-1 rounded-md ${map[tone]}`}>{children}</span>;
}

function SmallBtn({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={
        "text-xs px-2.5 py-1.5 rounded-md font-semibold " +
        (danger ? "bg-transparent text-brick border border-brick/40" : "bg-surface-2 text-cream")
      }
    >
      {children}
    </button>
  );
}
