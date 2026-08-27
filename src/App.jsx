// src/App.jsx
//
// Estructura principal del POS.
// useLicenseCheck se ejecuta una sola vez para evitar
// listeners, registros de sesión y heartbeats duplicados.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { usePosData } from "./hooks/usePosData";
import { useLicenseCheck } from "./hooks/useLicenseCheck";
import { fmtTime } from "./lib/format";

import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
import MoreDrawer from "./components/MoreDrawer";
import Toast from "./components/Toast";
import UpdateNotice from "./components/UpdateNotice";
import OfflineStatusBar from "./components/OfflineStatusBar";
import LicenseGate from "./components/LicenseGate";
import { useOperator } from "./components/OperatorGate";
import AdminRoute from "./components/AdminRoute";

import Vender from "./pages/Vender";

/*
 * Vender queda en el bundle inicial porque es la pantalla crítica del POS.
 * Las secciones secundarias se cargan en chunks separados para reducir el
 * trabajo de parseo/ejecución durante el arranque.
 */
const Inventario = lazy(() => import("./pages/Inventario"));
const Caja = lazy(() => import("./pages/Caja"));
const Historial = lazy(() => import("./pages/Historial"));
const Actividad = lazy(() => import("./pages/Actividad"));
const Compras = lazy(() => import("./pages/Compras"));
const Ganancias = lazy(() => import("./pages/Ganancias"));

const THEME_STORAGE_KEY = "pos-theme";
const EFFECTS_STORAGE_KEY = "pos-effects";

const EFFECTS_MODES = new Set([
  "complete",
  "balanced",
  "performance",
]);

const DESKTOP_SHORTCUT_TABS = {
  Numpad1: "vender",
  Numpad2: "inventario",
  Numpad3: "caja",
  Numpad4: "compras",
  Numpad5: "ganancias",
  Numpad6: "historial",
  Numpad7: "actividad",
};

/*
 * Alternativa para notebook sin depender de F1-F12 ni de Numpad.
 * Las letras se ejecutan con una demora mínima para distinguir una
 * pulsación humana de la ráfaga rápida que envía un lector HID.
 */
const NOTEBOOK_SHORTCUT_TABS = {
  KeyV: "vender",
  KeyS: "inventario",
  KeyC: "caja",
  KeyP: "compras",
  KeyG: "ganancias",
  KeyH: "historial",
  KeyA: "actividad",
};

const NOTEBOOK_SHORTCUT_DELAY_MS = 145;
const SCANNER_KEY_GAP_MS = 95;
const SCANNER_IDLE_RESET_MS = 280;

function isEditableShortcutTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"]'
    )
  );
}

function hasOpenBlockingDialog() {
  if (typeof document === "undefined") {
    return false;
  }

  return Boolean(
    document.querySelector(
      '[role="dialog"][aria-modal="true"]'
    )
  );
}

function getCurrentTheme() {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = theme === "light" ? "light" : "dark";

  document.documentElement.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized;

  const themeColor = document.querySelector('meta[name="theme-color"]');

  if (themeColor) {
    themeColor.setAttribute(
      "content",
      normalized === "light" ? "#F4F1E8" : "#0B0D12"
    );
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    // La preferencia visual sigue funcionando aunque el navegador bloquee storage.
  }
}

function applyEffectsMode(mode) {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = EFFECTS_MODES.has(mode)
    ? mode
    : "complete";

  document.documentElement.dataset.effects = normalized;

  try {
    window.localStorage.setItem(
      EFFECTS_STORAGE_KEY,
      normalized
    );
  } catch {
    // La preferencia visual sigue funcionando aunque el navegador bloquee storage.
  }
}

function getCurrentEffectsMode() {
  if (
    typeof document === "undefined" ||
    typeof window === "undefined"
  ) {
    return "complete";
  }

  const fromDataset =
    document.documentElement.dataset.effects;

  if (EFFECTS_MODES.has(fromDataset)) {
    return fromDataset;
  }

  try {
    const stored =
      window.localStorage.getItem(
        EFFECTS_STORAGE_KEY
      );

    return EFFECTS_MODES.has(stored)
      ? stored
      : "complete";
  } catch {
    return "complete";
  }
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  const esRutaAdmin =
    window.location.pathname.startsWith("/admin");

  if (esRutaAdmin) {
    return <AdminRoute />;
  }

  return <PosRoute />;
}

/* =========================================================
   RUTA DEL POS
========================================================= */

function PosRoute() {
  /*
   * ÚNICA instancia del control de licencia.
   *
   * LicenseGate usa este objeto para decidir
   * si permite el acceso.
   *
   * PosApp reutiliza los datos de la misma licencia.
   */
  const license = useLicenseCheck();

  return (
    <LicenseGate license={license}>
      <PosApp license={license} />
    </LicenseGate>
  );
}

/* =========================================================
   POS
========================================================= */

function PosApp({ license }) {
  /*
   * OperatorGate ya validó la sesión interna antes de renderizar
   * este componente. Reutilizamos esa identidad para autorizar
   * operaciones sensibles en backend.
   */
  const {
    sesion: operadorSesion,
    esAdministrador:
      operadorEsAdministrador,
    cerrarSesionInterna,
  } = useOperator();

  /*
   * Pasamos clienteId, deviceId y la sesión interna al POS.
   *
   * La sesión interna no contiene la clave del operador:
   * sólo el id/token temporal emitido por Cloud Functions.
   */
  const pos = usePosData({
    clienteId: license.clienteId,
    deviceId: license.deviceId,
    deviceSessionId:
      license.sessionId,
    operadorSesion,
    operadorEsAdministrador,
  });

  const [tab, setTab] = useState("vender");
  const [invFilter, setInvFilter] = useState("all");
  const [theme, setTheme] = useState(getCurrentTheme);
  const [effectsMode, setEffectsMode] =
    useState(getCurrentEffectsMode);
  const [moreOpen, setMoreOpen] = useState(false);

  const notebookShortcutTimerRef = useRef(null);
  const notebookScannerIdleTimerRef = useRef(null);
  const notebookLastPrintableRef = useRef(0);
  const notebookScannerBurstRef = useRef(false);

  useEffect(() => {
    applyEffectsMode(effectsMode);
  }, [effectsMode]);

  /*
   * Precarga las pantallas secundarias cuando el navegador queda libre.
   * Así el primer render de Vender es más liviano sin agregar espera al
   * primer acceso posterior a Stock, Caja o Reportes.
   */
  useEffect(() => {
    if (!pos.loaded || typeof window === "undefined") {
      return undefined;
    }

    const preloadSecondaryPages = () => {
      void import("./pages/Inventario");
      void import("./pages/Caja");
      void import("./pages/Compras");
      void import("./pages/Ganancias");
      void import("./pages/Historial");
      void import("./pages/Actividad");
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(
        preloadSecondaryPages,
        { timeout: 1800 }
      );

      return () => {
        window.cancelIdleCallback?.(idleId);
      };
    }

    /*
     * En navegadores sin requestIdleCallback preferimos no forzar una
     * ráfaga de parseo en segundo plano. El chunk se cargará al entrar
     * por primera vez a esa sección.
     */
    return undefined;
  }, [pos.loaded]);

  /* =========================================================
     ATAJOS DE NAVEGACIÓN — PC + NOTEBOOK

     Teclado completo: Num 1-7
     Notebook: V / S / C / P / G / H / A

     Las letras se demoran ~145 ms. Si llegan más caracteres a
     velocidad de lector láser, se cancela el atajo y la ráfaga
     queda reservada para el scanner HID.
  ========================================================= */

  useEffect(() => {
    function clearPendingNotebookShortcut() {
      if (notebookShortcutTimerRef.current !== null) {
        window.clearTimeout(notebookShortcutTimerRef.current);
        notebookShortcutTimerRef.current = null;
      }
    }

    function resetScannerBurst() {
      notebookScannerBurstRef.current = false;
      notebookLastPrintableRef.current = 0;

      if (notebookScannerIdleTimerRef.current !== null) {
        window.clearTimeout(notebookScannerIdleTimerRef.current);
        notebookScannerIdleTimerRef.current = null;
      }
    }

    function navigateTo(nextTab) {
      if (!nextTab) {
        return;
      }

      if (nextTab === "inventario") {
        setInvFilter("all");
      }

      setMoreOpen(false);
      setTab(nextTab);
    }

    function handleNavigationShortcut(event) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableShortcutTarget(event.target) ||
        !window.matchMedia("(min-width: 760px), (pointer: fine)").matches ||
        hasOpenBlockingDialog()
      ) {
        return;
      }

      const numpadTab = DESKTOP_SHORTCUT_TABS[event.code];

      if (numpadTab && !event.shiftKey) {
        event.preventDefault();
        clearPendingNotebookShortcut();
        navigateTo(numpadTab);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        clearPendingNotebookShortcut();
        resetScannerBurst();
        return;
      }

      const printable =
        event.key.length === 1 &&
        !event.shiftKey;

      if (!printable) {
        return;
      }

      const now = performance.now();
      const previous = notebookLastPrintableRef.current;

      if (
        previous > 0 &&
        now - previous <= SCANNER_KEY_GAP_MS
      ) {
        notebookScannerBurstRef.current = true;
        clearPendingNotebookShortcut();
      }

      notebookLastPrintableRef.current = now;

      if (notebookScannerIdleTimerRef.current !== null) {
        window.clearTimeout(notebookScannerIdleTimerRef.current);
      }

      notebookScannerIdleTimerRef.current = window.setTimeout(
        resetScannerBurst,
        SCANNER_IDLE_RESET_MS
      );

      const nextTab = NOTEBOOK_SHORTCUT_TABS[event.code];

      if (!nextTab || notebookScannerBurstRef.current) {
        return;
      }

      clearPendingNotebookShortcut();

      notebookShortcutTimerRef.current = window.setTimeout(() => {
        notebookShortcutTimerRef.current = null;

        if (
          notebookScannerBurstRef.current ||
          hasOpenBlockingDialog() ||
          isEditableShortcutTarget(document.activeElement)
        ) {
          return;
        }

        navigateTo(nextTab);
      }, NOTEBOOK_SHORTCUT_DELAY_MS);
    }

    window.addEventListener("keydown", handleNavigationShortcut);

    return () => {
      window.removeEventListener("keydown", handleNavigationShortcut);
      clearPendingNotebookShortcut();
      resetScannerBurst();
    };
  }, []);

  function handleToggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }

  function handleEffectsModeChange(nextMode) {
    const normalized = EFFECTS_MODES.has(nextMode)
      ? nextMode
      : "complete";

    applyEffectsMode(normalized);
    setEffectsMode(normalized);
  }

  /* =========================================================
     NAVEGACIÓN
  ========================================================= */

  function goInventario(filter) {
    setInvFilter(filter);
    setTab("inventario");
  }

  /* =========================================================
     CERRAR SESIÓN
  ========================================================= */

  async function handleCerrarSesion() {
    if (
      pos.pendingOfflineCount >
      0
    ) {
      window.alert(
        "Hay ventas pendientes de sincronización. Esperá a que se confirmen antes de cerrar sesión."
      );
      return;
    }

    const confirmar = window.confirm(
      "¿Cerrar sesión?"
    );

    if (!confirmar) {
      return;
    }

    try {
      await cerrarSesionInterna();

      await license.cerrarSesion();
    } catch (error) {
      console.error(
        "Error cerrando sesión:",
        error
      );
    }
  }

  /* =========================================================
     RENOMBRAR NEGOCIO
  ========================================================= */

  function handleRename() {
    const name = window.prompt(
      "Nombre del negocio:",
      pos.shopName
    );

    if (name && name.trim()) {
      pos.setShopName(name.trim());
    }
  }

  /* =========================================================
     CARGANDO
  ========================================================= */

  if (!pos.loaded) {
    return <AppLoading />;
  }

  return (
    <div
      className="
        relative
        min-h-screen
        overflow-x-hidden
        pos-app-shell
        bg-[#0B0D12]
        pb-[calc(92px+env(safe-area-inset-bottom))]
        text-white
      "
    >
      {/* =====================================================
          FONDO AMBIENTAL
      ===================================================== */}

      <div
        className="
          pos-ambient-layer
          pointer-events-none
          fixed
          inset-0
          z-0
          overflow-hidden
        "
        aria-hidden="true"
      >
        <div
          className="
            pos-ambient-orb
            absolute
            -left-28
            -top-40
            h-[320px]
            w-[320px]
            rounded-full
            bg-[#FFC61A]/[0.045]
            blur-[90px]
          "
        />

        <div
          className="
            pos-ambient-orb
            absolute
            -right-32
            top-[32%]
            h-[300px]
            w-[300px]
            rounded-full
            bg-white/[0.025]
            blur-[100px]
          "
        />
      </div>

      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="relative z-20">
        <Header
          shopName={pos.shopName}
          openSession={pos.openSession}
          onRename={handleRename}
        />
      </div>

      <OfflineStatusBar
        pos={pos}
      />

      {/* =====================================================
          CONTENIDO
      ===================================================== */}

      <main
        className="
          relative
          z-10
          mx-auto
          w-full
          max-w-[520px]
          pos-main-content
          px-3.5
          pb-4
          pt-3
          sm:px-4
          sm:pt-4
        "
      >
        {/* ===================================================
            BARRA SECUNDARIA
        =================================================== */}

        <div className="pos-page-heading mb-3 flex min-h-9 items-center justify-between gap-3">
          <PageLabel tab={tab} effectsMode={effectsMode} />

          {tab === "vender" && pos.openSession && (
            <DesktopCashStatus openSession={pos.openSession} effectsMode={effectsMode} />
          )}
        </div>

        {/* ===================================================
            PÁGINAS
        =================================================== */}

        <motion.div
          key={tab}
          initial={
            effectsMode === "performance"
              ? false
              : {
                  opacity: 0,
                  x: effectsMode === "balanced" ? 5 : 8,
                  y: 1,
                }
          }
          animate={{
            opacity: 1,
            x: 0,
            y: 0,
          }}
          transition={{
            duration:
              effectsMode === "performance"
                ? 0
                : effectsMode === "balanced"
                  ? 0.07
                  : 0.13,
            ease: "easeOut",
          }}
        >
          <Suspense
            fallback={
              <div
                className="min-h-[180px]"
                aria-hidden="true"
              />
            }
          >
            {tab === "vender" && (
              <Vender
                pos={pos}
                goInventario={goInventario}
                effectsMode={effectsMode}
              />
            )}

            {tab === "inventario" && (
              <Inventario
                pos={pos}
                filter={invFilter}
                setFilter={setInvFilter}
                effectsMode={effectsMode}
              />
            )}

            {tab === "caja" && (
              <Caja
                pos={pos}
                effectsMode={effectsMode}
              />
            )}

            {tab === "compras" && (
              <Compras pos={pos} />
            )}

            {tab === "ganancias" && (
              <Ganancias pos={pos} />
            )}

            {tab === "historial" && (
              <Historial pos={pos} />
            )}

            {tab === "actividad" && (
              <Actividad
                clienteId={license.clienteId}
              />
            )}
          </Suspense>
        </motion.div>
      </main>

      {/* =====================================================
          NAVEGACIÓN INFERIOR
      ===================================================== */}

      <AnimatePresence initial={false}>
        {!moreOpen && (
          <BottomNav
            tab={tab}
            setTab={setTab}
            moreOpen={moreOpen}
            onMore={() => setMoreOpen(true)}
          />
        )}
      </AnimatePresence>

      <MoreDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        shopName={pos.shopName}
        onNavigate={setTab}
        currentTab={tab}
        openSession={pos.openSession}
        allowOperatorChangeWithOpenSession={pos.migrationNeedsAdmin}
        pendingOfflineCount={pos.pendingOfflineCount}
        deviceId={license.deviceId}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        effectsMode={effectsMode}
        onEffectsModeChange={handleEffectsModeChange}
        onLogout={handleCerrarSesion}
      />

      {/* =====================================================
          TOAST
      ===================================================== */}

      <Toast
        toast={pos.toastMsg}
        onDone={pos.clearToast}
      />

      <UpdateNotice />
    </div>
  );
}

/* =========================================================
   ETIQUETA DE SECCIÓN
========================================================= */

function PageLabel({ tab, effectsMode = "complete" }) {
  const pages = {
    vender: {
      eyebrow: "Operación",
      label: "Nueva venta",
      icon: ReceiptIcon,
    },

    inventario: {
      eyebrow: "Catálogo",
      label: "Inventario",
      icon: BoxIcon,
    },

    caja: {
      eyebrow: "Turno",
      label: "Caja",
      icon: RegisterIcon,
    },

    compras: {
      eyebrow: "Abastecimiento",
      label: "Compras",
      icon: PurchaseIcon,
    },

    ganancias: {
      eyebrow: "Rentabilidad",
      label: "Ganancias",
      icon: ProfitIcon,
    },

    historial: {
      eyebrow: "Reportes",
      label: "Historial",
      icon: HistoryIcon,
    },

    actividad: {
      eyebrow: "Control",
      label: "Actividad",
      icon: ActivityIcon,
    },
  };

  const current =
    pages[tab] || pages.vender;

  const Icon = current.icon;

  return (
    <motion.div
      key={tab}
      initial={
        effectsMode === "performance"
          ? false
          : {
              opacity: 0,
              x: -4,
            }
      }
      animate={{
        opacity: 1,
        x: 0,
      }}
      transition={{
        duration:
          effectsMode === "performance"
            ? 0
            : effectsMode === "balanced"
              ? 0.06
              : 0.12,
      }}
      className="
        flex
        min-w-0
        items-center
        gap-2
      "
    >
      <div
        className="
          grid
          h-8
          w-8
          shrink-0
          place-items-center
          rounded-xl
          border
          border-[#FFC61A]/15
          bg-[#FFC61A]/10
          text-[#FFC61A]
        "
      >
        <Icon className="h-3.5 w-3.5" />
      </div>

      <div className="min-w-0">
        <span
          className="
            block
            text-[8px]
            font-extrabold
            uppercase
            tracking-[0.16em]
            text-white/30
          "
        >
          {current.eyebrow}
        </span>

        <span
          className="
            mt-0.5
            block
            truncate
            text-xs
            font-extrabold
            text-white/70
          "
        >
          {current.label}
        </span>
      </div>
    </motion.div>
  );
}

function DesktopCashStatus({ openSession, effectsMode = "complete" }) {
  if (!openSession) {
    return null;
  }

  return (
    <motion.div
      key={openSession.openTime || "open-session"}
      initial={{ opacity: 0, y: -3, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      className="pos-desktop-cash-status"
      aria-label={`Caja abierta desde ${fmtTime(openSession.openTime)}`}
    >
      {effectsMode === "performance" ? (
        <span
          className="pos-desktop-cash-status__dot"
          aria-hidden="true"
        />
      ) : (
        <motion.span
          animate={{ scale: [1, 1.32, 1], opacity: [1, 0.68, 1] }}
          transition={{
            duration: effectsMode === "balanced" ? 2.6 : 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="pos-desktop-cash-status__dot"
          aria-hidden="true"
        />
      )}

      <span className="whitespace-nowrap">
        Caja abierta · {fmtTime(openSession.openTime)}
      </span>
    </motion.div>
  );
}

/* =========================================================
   LOADING
========================================================= */

function AppLoading() {
  return (
    <div
      className="
        relative
        flex
        min-h-screen
        items-center
        justify-center
        overflow-hidden
        bg-[#0B0D12]
        px-6
      "
    >
      <div
        className="
          pointer-events-none
          absolute
          left-1/2
          top-1/2
          h-[300px]
          w-[300px]
          -translate-x-1/2
          -translate-y-1/2
          rounded-full
          bg-[#FFC61A]/[0.05]
          blur-[90px]
        "
      />

      <motion.div
        initial={{
          opacity: 0,
          scale: 0.96,
        }}
        animate={{
          opacity: 1,
          scale: 1,
        }}
        className="
          relative
          z-10
          flex
          flex-col
          items-center
          text-center
        "
      >
        <motion.div
          animate={{
            scale: [
              1,
              1.06,
              1,
            ],
          }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="
            grid
            h-16
            w-16
            place-items-center
            rounded-[22px]
            bg-[#FFC61A]
            text-black
            shadow-[0_18px_45px_rgba(255,198,26,0.18)]
          "
        >
          <StoreIcon className="h-7 w-7" />
        </motion.div>

        <p
          className="
            mt-5
            text-[10px]
            font-extrabold
            uppercase
            tracking-[0.2em]
            text-[#FFC61A]
          "
        >
          Punto de venta
        </p>

        <h1
          className="
            mt-1
            text-xl
            font-black
            tracking-[-0.03em]
            text-white
          "
        >
          Mi Negocio
        </h1>

        <div
          className="
            mt-5
            h-1
            w-24
            overflow-hidden
            rounded-full
            bg-white/10
          "
        >
          <motion.div
            animate={{
              x: [
                "-100%",
                "100%",
              ],
            }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="
              h-full
              w-1/2
              rounded-full
              bg-[#FFC61A]
            "
          />
        </div>
      </motion.div>
    </div>
  );
}

/* =========================================================
   ICONOS
========================================================= */

function ReceiptIcon({
  className = "",
}) {
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
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.2V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function BoxIcon({
  className = "",
}) {
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
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function PurchaseIcon({
  className = "",
}) {
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
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M3 4h2l2.5 11h10.5l2-7H7" />
    </svg>
  );
}

function RegisterIcon({
  className = "",
}) {
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
      <path d="M4 10h16v10H4z" />
      <path d="M7 10V5h10v5" />
      <path d="M8 14h3" />
      <path d="M15 14h1" />
      <path d="M15 17h1" />
      <path d="M8 17h3" />
    </svg>
  );
}

function HistoryIcon({
  className = "",
}) {
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
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ProfitIcon({
  className = "",
}) {
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
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 4-4 3 2 5-6" />
      <path d="M16 7h3v3" />
    </svg>
  );
}

function ActivityIcon({
  className = "",
}) {
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
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
      <circle cx="7" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </svg>
  );
}

function StoreIcon({
  className = "",
}) {
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
      <path d="M4 10v10h16V10" />
      <path d="M3 10l2-6h14l2 6" />
      <path d="M8 20v-6h8v6" />
      <path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2" />
    </svg>
  );
}
