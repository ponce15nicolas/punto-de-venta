// src/components/MoreDrawer.jsx
// Panel lateral Liquid Glass con accesos secundarios del POS.

import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";

import { useOperator } from "./OperatorGate";
import UserManagementModal from "./UserManagementModal";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const DESKTOP_MEDIA_QUERY = "(min-width: 900px)";

function getDesktopLayout() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

export default function MoreDrawer({
  open,
  onClose,
  shopName = "Mi Negocio",
  onNavigate,
  currentTab,
  openSession,
  allowOperatorChangeWithOpenSession = false,
  deviceId = null,
  theme = "dark",
  onToggleTheme,
  onLogout,
}) {
  const {
    operador,
    esAdministrador,
    cerrarSesionInterna,
  } = useOperator();

  const reduceMotion = useReducedMotion();
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);

  const [showUsers, setShowUsers] = useState(false);
  const [changingUser, setChangingUser] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [isDesktop, setIsDesktop] = useState(getDesktopLayout);

  const visible = open || isDesktop;

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const sync = () => setIsDesktop(media.matches);

    sync();
    media.addEventListener?.("change", sync);

    return () => {
      media.removeEventListener?.("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!open || isDesktop || typeof document === "undefined") {
      return undefined;
    }

    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, reduceMotion ? 0 : 80);

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusable = Array.from(
        panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
      ).filter((element) => !element.hasAttribute("disabled"));

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;

      const previousFocus = previousFocusRef.current;
      if (previousFocus && typeof previousFocus.focus === "function") {
        window.setTimeout(() => previousFocus.focus(), 0);
      }
    };
  }, [isDesktop, open, onClose, reduceMotion]);

  function navigate(tab) {
    onNavigate?.(tab);

    if (!isDesktop) {
      onClose?.();
    }
  }

  function openUsers() {
    setShowUsers(true);

    if (!isDesktop) {
      onClose?.();
    }
  }

  async function handleChangeUser() {
    if (changingUser) {
      return;
    }

    if (openSession && !allowOperatorChangeWithOpenSession) {
      window.alert(
        "No es posible cambiar de usuario mientras la caja está abierta. Cerrá la caja primero."
      );
      return;
    }

    setChangingUser(true);

    try {
      if (!isDesktop) {
        onClose?.();
      }

      await cerrarSesionInterna();
    } catch (error) {
      console.error("Error cerrando sesión interna:", error);
      setChangingUser(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);

    try {
      await onLogout?.();
    } finally {
      setLoggingOut(false);
    }
  }

  const drawer = (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={`pos-more-overlay ${isDesktop ? "is-desktop" : ""}`}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}
          onMouseDown={(event) => {
            if (!isDesktop && event.target === event.currentTarget) {
              onClose?.();
            }
          }}
        >
          <motion.aside
            id="pos-more-drawer"
            ref={panelRef}
            role={isDesktop ? "navigation" : "dialog"}
            aria-modal={isDesktop ? undefined : "true"}
            aria-labelledby="pos-more-title"
            className={`pos-more-drawer ${isDesktop ? "is-desktop" : ""}`}
            initial={reduceMotion || isDesktop ? false : { x: "100%", opacity: 0.88 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion || isDesktop ? { opacity: 0 } : { x: "100%", opacity: 0.88 }}
            transition={{
              duration: reduceMotion ? 0 : 0.27,
              ease: [0.22, 1, 0.36, 1],
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="pos-more-drawer__shine" aria-hidden="true" />

            <header className="pos-more-drawer__header">
              <div className="pos-more-brand">
                <span className="pos-more-brand__icon">
                  <CartIcon className="h-6 w-6" />
                </span>

                <span className="min-w-0">
                  <span className="pos-more-drawer__eyebrow">
                    {isDesktop ? "Punto de venta" : "Más opciones"}
                  </span>
                  {isDesktop && (
                    <strong className="pos-more-brand__name">
                      {shopName}
                    </strong>
                  )}
                </span>

                <h2 id="pos-more-title" className="sr-only">
                  {isDesktop ? "Navegación principal" : "Menú de opciones"}
                </h2>
              </div>

              {!isDesktop && (
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={onClose}
                  className="pos-more-close"
                  aria-label="Cerrar menú Más"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              )}
            </header>

            <div className="pos-more-drawer__scroll">
              <nav
                className="pos-more-desktop-primary"
                aria-label="Navegación principal"
              >
                <DrawerRow
                  icon={ReceiptIcon}
                  label="Vender"
                  active={currentTab === "vender"}
                  onClick={() => navigate("vender")}
                />
                <DrawerRow
                  icon={BoxIcon}
                  label="Stock"
                  active={currentTab === "inventario"}
                  onClick={() => navigate("inventario")}
                />
                <DrawerRow
                  icon={WalletIcon}
                  label="Caja"
                  active={currentTab === "caja"}
                  onClick={() => navigate("caja")}
                />
              </nav>

              <div className="pos-more-desktop-divider" aria-hidden="true" />

              <section className="pos-more-user-card" aria-label="Usuario activo">
                <span className="pos-more-user-card__avatar">
                  <UserIcon className="h-6 w-6" />
                </span>

                <span className="min-w-0">
                  <strong className="pos-more-user-card__name">
                    {operador?.nombre || "Operador"}
                  </strong>
                  <span className="pos-more-user-card__role">
                    {esAdministrador ? "Administrador" : "Encargado"}
                  </span>
                </span>
              </section>

              <nav className="pos-more-list" aria-label="Opciones secundarias">
                {esAdministrador && (
                  <DrawerRow
                    icon={UsersIcon}
                    label="Gestión de usuarios"
                    onClick={openUsers}
                  />
                )}

                <DrawerRow
                  icon={ProfitIcon}
                  label="Ganancias"
                  active={currentTab === "ganancias"}
                  onClick={() => navigate("ganancias")}
                />

                <DrawerRow
                  icon={ActivityIcon}
                  label="Actividad"
                  active={currentTab === "actividad"}
                  onClick={() => navigate("actividad")}
                />

                <DrawerRow
                  icon={HistoryIcon}
                  label="Historial"
                  active={currentTab === "historial"}
                  onClick={() => navigate("historial")}
                />

                <DrawerRow
                  icon={PurchaseIcon}
                  label="Compras"
                  active={currentTab === "compras"}
                  onClick={() => navigate("compras")}
                />

                <DrawerRow
                  icon={SwitchUserIcon}
                  label={changingUser ? "Cambiando usuario..." : "Cambio de usuario"}
                  disabled={changingUser}
                  onClick={handleChangeUser}
                />
              </nav>

              <button
                type="button"
                role="switch"
                aria-checked={theme === "light"}
                onClick={onToggleTheme}
                className="pos-more-theme-row"
              >
                <span className="pos-more-row__icon">
                  {theme === "light" ? (
                    <SunIcon className="h-5 w-5" />
                  ) : (
                    <MoonIcon className="h-5 w-5" />
                  )}
                </span>

                <span className="pos-more-row__label">Modo claro / oscuro</span>

                <span className={`pos-more-switch ${theme === "light" ? "is-on" : ""}`} aria-hidden="true">
                  <span className="pos-more-switch__thumb" />
                </span>
              </button>

              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="pos-more-logout"
              >
                <span className="pos-more-logout__icon">
                  <LogoutIcon className="h-5 w-5" />
                </span>
                <span>{loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}</span>
              </button>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return (
    <>
      {createPortal(drawer, document.body)}
      <UserManagementModal
        open={showUsers}
        deviceId={deviceId}
        onClose={() => setShowUsers(false)}
      />
    </>
  );
}

function DrawerRow({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={`pos-more-row ${active ? "is-active" : ""}`}
    >
      <span className="pos-more-row__icon">
        <Icon className="h-5 w-5" />
      </span>
      <span className="pos-more-row__label">{label}</span>
      <ChevronIcon className="pos-more-row__chevron h-4 w-4" />
    </button>
  );
}

function IconBase({ className, children, strokeWidth = 2 }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function CloseIcon({ className = "" }) {
  return (
    <IconBase className={className} strokeWidth={2.2}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </IconBase>
  );
}

function CartIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M3 4h2l2.5 11h10.5l2-7H7" />
    </IconBase>
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

function UserIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </IconBase>
  );
}

function UsersIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </IconBase>
  );
}

function ProfitIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M5 19V9" />
      <path d="M12 19V5" />
      <path d="M19 19v-7" />
    </IconBase>
  );
}

function ActivityIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </IconBase>
  );
}

function HistoryIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </IconBase>
  );
}

function PurchaseIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M6 8h12l1 12H5L6 8Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </IconBase>
  );
}

function SwitchUserIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M7 7h11l-3-3" />
      <path d="m18 7-3 3" />
      <path d="M17 17H6l3 3" />
      <path d="m6 17 3-3" />
    </IconBase>
  );
}

function SunIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </IconBase>
  );
}

function MoonIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </IconBase>
  );
}

function LogoutIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
    </IconBase>
  );
}

function ChevronIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  );
}
