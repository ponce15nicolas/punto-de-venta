import { motion } from "motion/react";
import { fmtTime } from "../lib/format";

export default function Header({ shopName, onRename, openSession }) {
  return (
    <header className="sticky top-0 z-20 bg-bg/95 backdrop-blur border-b border-line px-3.5 pt-4 pb-2.5">
      <div className="max-w-[520px] mx-auto flex items-center justify-between gap-2.5">
        <button className="flex flex-col items-start text-left" onClick={onRename}>
          <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-amber">
            Punto de venta
          </span>
          <h1 className="font-display font-bold text-xl text-cream mt-0.5">{shopName}</h1>
        </button>
        <motion.div
          key={openSession ? "open" : "closed"}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={
            "font-mono text-[11px] px-2.5 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap border " +
            (openSession
              ? "bg-leaf/15 text-leaf border-leaf/40"
              : "bg-brick/15 text-[#E58579] border-brick/40")
          }
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          <span>{openSession ? `Caja abierta · ${fmtTime(openSession.openTime)}` : "Caja cerrada"}</span>
        </motion.div>
      </div>
    </header>
  );
}
