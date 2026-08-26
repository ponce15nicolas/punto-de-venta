// src/components/BottomNav.jsx
// Navegación principal Liquid Glass: 3 accesos + menú Más.

import { motion, useReducedMotion } from "motion/react";

const MAIN_TABS = [
  { id: "vender", label: "Vender", icon: ReceiptIcon },
  { id: "inventario", label: "Stock", icon: BoxIcon },
  { id: "caja", label: "Caja", icon: WalletIcon },
];

const SECONDARY_TABS = new Set([
  "compras",
  "ganancias",
  "historial",
  "actividad",
]);

export default function BottomNav({
  tab,
  setTab,
  moreOpen = false,
  onMore,
}) {
  const reduceMotion = useReducedMotion();
  const moreActive = moreOpen || SECONDARY_TABS.has(tab);

  return (
    <motion.nav
      className="pos-bottom-nav"
      aria-label="Navegación principal"
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 14, scale: 0.985 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
    >
      <div className="pos-bottom-nav__inner">
        {MAIN_TABS.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={tab === item.id}
            onClick={() => setTab(item.id)}
          />
        ))}

        <button
          type="button"
          onClick={onMore}
          aria-label="Más opciones"
          aria-expanded={moreOpen}
          aria-controls="pos-more-drawer"
          aria-current={moreActive ? "page" : undefined}
          className={`pos-bottom-nav__button ${moreActive ? "is-active" : ""}`}
        >
          <span className="pos-bottom-nav__icon">
            <MoreIcon className="h-[20px] w-[20px]" />
          </span>
          <span className="pos-bottom-nav__label">Más</span>
          {moreActive && <span className="pos-bottom-nav__dot" aria-hidden="true" />}
        </button>
      </div>
    </motion.nav>
  );
}

function NavButton({ item, active, onClick }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`pos-bottom-nav__button ${active ? "is-active" : ""}`}
    >
      <span className="pos-bottom-nav__icon">
        <Icon className="h-[20px] w-[20px]" />
      </span>
      <span className="pos-bottom-nav__label">{item.label}</span>
      {active && <span className="pos-bottom-nav__dot" aria-hidden="true" />}
    </button>
  );
}

function IconBase({ className, children }) {
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
      {children}
    </svg>
  );
}

function ReceiptIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.2V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </IconBase>
  );
}

function BoxIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </IconBase>
  );
}

function WalletIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5Z" />
      <path d="M4 8h16" />
      <path d="M16 13h4v3h-4a1.5 1.5 0 0 1 0-3Z" />
    </IconBase>
  );
}

function MoreIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}
