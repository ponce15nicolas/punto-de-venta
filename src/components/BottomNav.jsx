// src/components/BottomNav.jsx
// Navegación inferior rediseñada con la identidad visual del POS.
// Mantiene la animación con motion/react y elimina emojis.
// No requiere librerías de iconos externas.

import { motion } from "motion/react";

const TABS = [
  { id: "vender", label: "Vender", icon: ReceiptIcon },
  { id: "inventario", label: "Stock", icon: BoxIcon },
  { id: "caja", label: "Caja", icon: WalletIcon },
  { id: "compras", label: "Compras", icon: PurchaseIcon },
  { id: "ganancias", label: "Ganancias", icon: ProfitIcon },
  { id: "historial", label: "Historial", icon: ChartIcon },
  { id: "actividad", label: "Actividad", icon: ActivityIcon },
];

export default function BottomNav({ tab, setTab }) {
  return (
    <nav
      className="
        pos-bottom-nav
        fixed bottom-0 left-0 right-0 z-30
        border-t border-white/10
        bg-[#0B0D12]/95 backdrop-blur-xl
        pb-[env(safe-area-inset-bottom)]
        shadow-[0_-18px_50px_rgba(0,0,0,0.28)]
      "
    >
      <div className="mx-auto flex w-full max-w-[960px] items-stretch px-1 sm:px-3">
        {TABS.map((t) => {
          const activo = tab === t.id;
          const Icon = t.icon;

          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-label={t.label}
              aria-current={activo ? "page" : undefined}
              className="
                group relative flex min-w-0 flex-1 flex-col
                items-center justify-center gap-1 bg-transparent
                px-0.5 pb-2.5 pt-3 outline-none transition
                active:scale-[0.97] sm:px-1
              "
            >
              {activo && (
                <motion.div
                  layoutId="nav-indicator"
                  className="
                    absolute left-1/2 top-0 h-[3px] w-9
                    -translate-x-1/2 rounded-full bg-[#FFC61A]
                    shadow-[0_0_18px_rgba(255,198,26,0.55)]
                    sm:w-10
                  "
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 35,
                  }}
                />
              )}

              <div
                className={
                  `
                    grid h-8 w-8 place-items-center rounded-xl
                    transition-all duration-200 sm:h-9 sm:w-9
                  ` +
                  (activo
                    ? " bg-[#FFC61A] text-black shadow-[0_8px_24px_rgba(255,198,26,0.18)]"
                    : " bg-transparent text-white/45 group-hover:bg-white/5 group-hover:text-white/70")
                }
              >
                <Icon className="h-[18px] w-[18px] sm:h-[19px] sm:w-[19px]" />
              </div>

              <span
                className={
                  `
                    max-w-full truncate text-[7px] font-extrabold
                    uppercase tracking-[0.025em] transition-colors
                    min-[360px]:text-[8px] min-[430px]:text-[9px] sm:text-[10px]
                    sm:tracking-[0.07em]
                  ` +
                  (activo
                    ? " text-[#FFC61A]"
                    : " text-white/40 group-hover:text-white/65")
                }
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function ReceiptIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.2V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function BoxIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function WalletIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5Z" />
      <path d="M4 8h16" />
      <path d="M16 13h4v3h-4a1.5 1.5 0 0 1 0-3Z" />
    </svg>
  );
}

function PurchaseIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M3 4h2l2.5 11h10.5l2-7H7" />
    </svg>
  );
}

function ProfitIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 4-4 3 2 5-6" />
      <path d="M16 7h3v3" />
    </svg>
  );
}

function ChartIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V9" />
      <path d="M10 19V5" />
      <path d="M16 19v-7" />
      <path d="M22 19V3" />
    </svg>
  );
}

function ActivityIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
      <circle cx="7" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </svg>
  );
}
