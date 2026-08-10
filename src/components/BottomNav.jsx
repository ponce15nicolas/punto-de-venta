import { motion } from "motion/react";

const TABS = [
  { id: "vender", icon: "🧾", label: "Vender" },
  { id: "inventario", icon: "📦", label: "Stock" },
  { id: "caja", icon: "💵", label: "Caja" },
  { id: "historial", icon: "📊", label: "Historial" },
];

export default function BottomNav({ tab, setTab }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-line flex z-30 pb-[env(safe-area-inset-bottom)]">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={
            "relative flex-1 bg-transparent border-none pt-2.5 pb-2 flex flex-col items-center gap-0.5 cursor-pointer " +
            (tab === t.id ? "text-amber" : "text-cream-dim")
          }
        >
          {tab === t.id && (
            <motion.div
              layoutId="nav-indicator"
              className="absolute top-0 left-3 right-3 h-0.5 bg-amber rounded-full"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
          <span className="text-lg leading-none">{t.icon}</span>
          <span className="text-[10px] font-mono uppercase tracking-wide">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
