import { motion } from "motion/react";
import { money, fmtDate, fmtDateTime } from "../lib/format";

export default function Historial({ pos }) {
  const closed = pos.cashSessions.filter((s) => s.status === "closed").slice().reverse();

  if (closed.length === 0) {
    return (
      <div className="text-center py-10 px-2.5 text-cream-dim">
        <div className="text-3xl mb-2">🗂️</div>
        Todavía no cerraste ningún turno de caja.
      </div>
    );
  }

  return (
    <div>
      {closed.map((s) => {
        const diffClass = s.diff > 0 ? "text-leaf" : s.diff < 0 ? "text-brick" : "text-cream-dim";
        const diffLabel = s.diff > 0 ? `+ ${money(s.diff)}` : s.diff < 0 ? `− ${money(Math.abs(s.diff))}` : "sin diferencia";
        return (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-surface border border-line rounded-xl px-3.5 py-3 mb-2 cursor-pointer"
            onClick={() =>
              alert(
                `Turno ${fmtDate(s.openTime)}\n\nApertura: ${money(s.openAmount)}\nVentas: ${money(
                  s.totalSales
                )} (${s.salesCount} tickets)\nEsperado: ${money(s.expectedAmount)}\nContado: ${money(
                  s.counted
                )}\nDiferencia: ${money(s.diff)}`
              )
            }
          >
            <div className="flex justify-between text-[13px]">
              <span className="font-bold">{fmtDate(s.openTime)}</span>
              <span className="font-mono text-cream-dim text-[11px]">
                {fmtDateTime(s.openTime).split(" ")[1]} – {fmtDateTime(s.closeTime).split(" ")[1]}
              </span>
            </div>
            <div className="font-mono text-[11.5px] text-cream-dim mt-1.5 flex gap-3.5 flex-wrap">
              <span>Ventas: {money(s.totalSales)}</span>
              <span>Tickets: {s.salesCount}</span>
              <span className={diffClass}>Diferencia: {diffLabel}</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
