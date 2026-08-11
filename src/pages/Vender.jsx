import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { money, daysUntil } from "../lib/format";
import Scanner from "../components/Scanner";
import PaymentModal from "../components/PaymentModal";

export default function Vender({ pos, goInventario }) {
  const { catalog, cart, openSession, addToCartByBarcode, changeCartQty, removeFromCart, clearCart, checkout } = pos;
  const [code, setCode] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const lowStock = Object.values(catalog).filter((p) => p.stock <= 5);
  const expiring = Object.values(catalog).filter((p) => {
    const d = daysUntil(p.expiry);
    return d !== null && d <= 7;
  });
  const total = cart.reduce((a, i) => a + i.qty * i.price, 0);
  const itemCount = cart.reduce((a, i) => a + i.qty, 0);

  return (
    <div>
      {!openSession && (
        <Banner tone="low">⚠️ Abrí la caja en la pestaña Caja para empezar a vender.</Banner>
      )}
      {expiring.length > 0 && (
        <Banner tone="expiring" onClick={() => goInventario("expiring")}>
          ⏳ {expiring.length} producto{expiring.length > 1 ? "s" : ""} por vencer o vencido{expiring.length > 1 ? "s" : ""}.
        </Banner>
      )}
      {lowStock.length > 0 && (
        <Banner tone="low" onClick={() => goInventario("low")}>
          📉 {lowStock.length} producto{lowStock.length > 1 ? "s" : ""} con stock bajo.
        </Banner>
      )}

      <div className="flex gap-2 mb-3.5">
        <input
          className="flex-1 min-w-0 bg-surface border border-line rounded-lg px-3 py-3 text-cream font-mono text-sm disabled:opacity-40"
          inputMode="numeric"
          placeholder="Código de barras"
          disabled={!openSession}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.trim()) {
              addToCartByBarcode(code.trim());
              setCode("");
            }
          }}
        />
        <button
          className="bg-amber text-amber-ink rounded-lg px-4 font-semibold disabled:opacity-40"
          disabled={!openSession}
          onClick={() => setScanOpen(true)}
        >
          📷
        </button>
      </div>

      <div className="ticket-edge relative bg-paper text-ink rounded-xl px-3.5 py-4 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim border-b border-dashed border-paper-line pb-2 mb-2 flex justify-between">
          <span>Ticket actual</span>
          <span>
            {itemCount} ítem{itemCount !== 1 ? "s" : ""}
          </span>
        </div>

        {cart.length === 0 ? (
          <div className="text-center py-6 px-1.5 text-ink-dim font-mono text-xs">
            Escaneá o ingresá un código
            <br />
            para agregar productos
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {cart.map((item, idx) => (
              <motion.div
                key={item.barcode}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 py-2.5 border-b border-dashed border-paper-line last:border-none overflow-hidden"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold truncate">{item.name}</div>
                  <div className="font-mono text-[11px] text-ink-dim">{money(item.price)} c/u</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    className="w-6 h-6 rounded-md border border-paper-line bg-white text-ink text-sm leading-none"
                    onClick={() => changeCartQty(idx, -1)}
                  >
                    −
                  </button>
                  <span className="font-mono text-[13px] min-w-[16px] text-center">{item.qty}</span>
                  <button
                    className="w-6 h-6 rounded-md border border-paper-line bg-white text-ink text-sm leading-none"
                    onClick={() => changeCartQty(idx, 1)}
                  >
                    +
                  </button>
                </div>
                <div className="font-mono text-[13px] font-bold min-w-[64px] text-right">
                  {money(item.price * item.qty)}
                </div>
                <button className="text-brick text-base px-1" onClick={() => removeFromCart(idx)}>
                  ✕
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        <div className="flex justify-between items-baseline pt-2.5 mt-1.5 border-t border-paper-line">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-dim">Total</span>
          <motion.span
            key={total}
            initial={{ scale: 1.08 }}
            animate={{ scale: 1 }}
            className="font-mono text-2xl font-bold"
          >
            {money(total)}
          </motion.span>
        </div>
      </div>

      <button
        className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold mt-3.5 disabled:opacity-40"
        disabled={!openSession || cart.length === 0}
        onClick={() => setPayOpen(true)}
      >
        Cobrar venta · {money(total)}
      </button>
      {cart.length > 0 && (
        <button
          className="w-full bg-transparent border border-line text-cream rounded-lg py-3 font-semibold mt-2"
          onClick={clearCart}
        >
          Vaciar ticket
        </button>
      )}

      <Scanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={(v) => {
          setScanOpen(false);
          addToCartByBarcode(v);
        }}
      />

      <PaymentModal
        open={payOpen}
        total={total}
        onClose={() => setPayOpen(false)}
        onConfirm={(payment) => {
          const ok = checkout(payment);
          if (ok) setPayOpen(false);
        }}
      />
    </div>
  );
}

function Banner({ tone, children, onClick }) {
  const toneClasses = {
    expiring: "bg-amber/10 border-amber/35 text-[#F0C480]",
    low: "bg-brick/10 border-brick/35 text-[#E58579]",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg mb-2 text-sm border ${toneClasses[tone]} ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      {children}
    </motion.div>
  );
}
