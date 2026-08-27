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
import Modal from "./Modal";

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
  pendingOfflineCount = 0,
  deviceId = null,
  theme = "dark",
  onToggleTheme,
  effectsMode = "complete",
  onEffectsModeChange,
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
  const [showSettings, setShowSettings] = useState(false);
  const [changingUser, setChangingUser] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [isDesktop, setIsDesktop] = useState(getDesktopLayout);

  const visible = open || isDesktop;
  const reduceEffects =
    reduceMotion ||
    effectsMode === "performance";

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
    }, reduceEffects ? 0 : 80);

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
  }, [isDesktop, open, onClose, reduceEffects]);

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

  function openSettings() {
    setShowSettings(true);

    if (!isDesktop) {
      onClose?.();
    }
  }

  async function handleChangeUser() {
    if (changingUser) {
      return;
    }

    if (
      Number(pendingOfflineCount) >
      0
    ) {
      window.alert(
        "Hay ventas pendientes de sincronización. Esperá a que se confirmen antes de cambiar de usuario."
      );
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
          initial={reduceEffects ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceEffects ? 0 : 0.24, ease: "easeOut" }}
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
            initial={reduceEffects || isDesktop ? false : { x: "100%", opacity: 0.88 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceEffects || isDesktop ? { opacity: 0 } : { x: "100%", opacity: 0.88 }}
            transition={{
              duration: reduceEffects ? 0 : 0.27,
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
                  shortcut="Num 1"
                  active={currentTab === "vender"}
                  onClick={() => navigate("vender")}
                />
                <DrawerRow
                  icon={BoxIcon}
                  label="Stock"
                  shortcut="Num 2"
                  active={currentTab === "inventario"}
                  onClick={() => navigate("inventario")}
                />
                <DrawerRow
                  icon={WalletIcon}
                  label="Caja"
                  shortcut="Num 3"
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
                  icon={PurchaseIcon}
                  label="Compras"
                  shortcut="Num 4"
                  active={currentTab === "compras"}
                  onClick={() => navigate("compras")}
                />

                <DrawerRow
                  icon={ProfitIcon}
                  label="Ganancias"
                  shortcut="Num 5"
                  active={currentTab === "ganancias"}
                  onClick={() => navigate("ganancias")}
                />

                <DrawerRow
                  icon={HistoryIcon}
                  label="Historial"
                  shortcut="Num 6"
                  active={currentTab === "historial"}
                  onClick={() => navigate("historial")}
                />

                <DrawerRow
                  icon={ActivityIcon}
                  label="Actividad"
                  shortcut="Num 7"
                  active={currentTab === "actividad"}
                  onClick={() => navigate("actividad")}
                />

                <DrawerRow
                  icon={SwitchUserIcon}
                  label={changingUser ? "Cambiando usuario..." : "Cambio de usuario"}
                  disabled={changingUser}
                  onClick={handleChangeUser}
                />
              </nav>

              <DrawerRow
                icon={SettingsIcon}
                label="Configuración"
                onClick={openSettings}
              />

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

      <SettingsModal
        open={showSettings}
        effectsMode={effectsMode}
        onEffectsModeChange={onEffectsModeChange}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}


function SettingsModal({
  open,
  effectsMode,
  onEffectsModeChange,
  onClose,
}) {
  const options = [
    {
      id: "complete",
      label: "Completo",
      badge: "Liquid Glass",
      description:
        "Desenfoque, transparencias, sombras y animaciones completas.",
      icon: SparklesIcon,
    },
    {
      id: "balanced",
      label: "Equilibrado",
      badge: "Recomendado",
      description:
        "Conserva el estilo Glass con menos desenfoque y composición gráfica.",
      icon: BalanceIcon,
    },
    {
      id: "performance",
      label: "Rendimiento",
      badge: "Más fluido",
      description:
        "Elimina el blur dinámico pesado y reduce efectos sin cambiar el diseño.",
      icon: BoltIcon,
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configuración"
    >
      <section className="space-y-3">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.035] p-3.5">
          <span className="block text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#FFC61A]">
            Rendimiento visual
          </span>
          <h3 className="mt-1 text-base font-black text-white">
            Efectos visuales
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">
            Podés cambiar el nivel en cualquier momento. La opción queda guardada en este dispositivo.
          </p>
        </div>

        <div
          className="grid gap-2.5"
          role="radiogroup"
          aria-label="Nivel de efectos visuales"
        >
          {options.map((option) => {
            const active =
              effectsMode === option.id;
            const Icon = option.icon;

            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() =>
                  onEffectsModeChange?.(
                    option.id
                  )
                }
                className={
                  `relative w-full rounded-[20px] border p-3.5 text-left transition ` +
                  (active
                    ? "border-[#FFC61A]/45 bg-[#FFC61A]/10 shadow-[0_10px_28px_rgba(255,198,26,0.08)]"
                    : "border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.055]")
                }
              >
                <div className="flex items-start gap-3">
                  <span
                    className={
                      `grid h-10 w-10 shrink-0 place-items-center rounded-2xl border ` +
                      (active
                        ? "border-[#FFC61A]/35 bg-[#FFC61A] text-black"
                        : "border-white/10 bg-white/5 text-white/60")
                    }
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong
                        className={
                          active
                            ? "text-sm font-black text-white"
                            : "text-sm font-black text-white/80"
                        }
                      >
                        {option.label}
                      </strong>

                      <span
                        className={
                          `rounded-full px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.10em] ` +
                          (active
                            ? "bg-[#FFC61A]/15 text-[#FFC61A]"
                            : "bg-white/5 text-white/35")
                        }
                      >
                        {option.badge}
                      </span>
                    </span>

                    <span className="mt-1.5 block text-[11px] leading-relaxed text-white/40">
                      {option.description}
                    </span>
                  </span>

                  <span
                    className={
                      `mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border ` +
                      (active
                        ? "border-[#FFC61A] bg-[#FFC61A]"
                        : "border-white/20 bg-transparent")
                    }
                    aria-hidden="true"
                  >
                    {active && (
                      <span className="h-1.5 w-1.5 rounded-full bg-black" />
                    )}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-[#FFC61A]/15 bg-[#FFC61A]/[0.06] px-3.5 py-3">
          <p className="text-[10px] leading-relaxed text-white/45">
            <strong className="text-[#FFC61A]">
              Consejo:
            </strong>{" "}
            si una PC se siente lenta, probá primero Equilibrado. Rendimiento prioriza fluidez y mantiene colores, tamaños y estructura del POS.
          </p>
        </div>
      </section>
    </Modal>
  );
}

function DrawerRow({
  icon: Icon,
  label,
  shortcut = null,
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
      {shortcut && (
        <kbd className="pos-more-row__shortcut" aria-label={`Atajo ${shortcut}`}>
          {shortcut}
        </kbd>
      )}
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


function SettingsIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1a1.7 1.7 0 0 0 1.1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.35.7.6 1 .3.26.68.4 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z" />
    </IconBase>
  );
}

function SparklesIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3Z" />
      <path d="m18.5 14 0.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
      <path d="m5 13 .7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />
    </IconBase>
  );
}

function BalanceIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M12 3v18" />
      <path d="M5 6h14" />
      <path d="m5 6-3 6h6L5 6Z" />
      <path d="m19 6-3 6h6l-3-6Z" />
      <path d="M8 21h8" />
    </IconBase>
  );
}

function BoltIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path d="M13 2 4.5 13H11l-1 9L19.5 10H13l0-8Z" />
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
