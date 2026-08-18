// src/App.jsx
//
// Estructura principal del POS.
// useLicenseCheck se ejecuta una sola vez para evitar
// listeners, registros de sesión y heartbeats duplicados.

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { usePosData } from "./hooks/usePosData";
import { useLicenseCheck } from "./hooks/useLicenseCheck";

import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
import Toast from "./components/Toast";
import LicenseGate from "./components/LicenseGate";
import AdminRoute from "./components/AdminRoute";

import Vender from "./pages/Vender";
import Inventario from "./pages/Inventario";
import Caja from "./pages/Caja";
import Historial from "./pages/Historial";

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
   * Pasamos clienteId al POS para que todos los datos
   * operativos queden aislados por cliente en Firestore.
   *
   * deviceId queda disponible para migraciones, auditoría
   * y futuras funciones multidispositivo.
   *
   * usePosData actualmente puede ignorar este objeto sin
   * romper compatibilidad. Lo utilizaremos en el siguiente paso.
   */
  const pos = usePosData({
    clienteId: license.clienteId,
    deviceId: license.deviceId,
  });

  const [tab, setTab] = useState("vender");
  const [invFilter, setInvFilter] = useState("all");

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
    const confirmar = window.confirm(
      "¿Cerrar sesión?"
    );

    if (!confirmar) {
      return;
    }

    try {
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

        <div
          className="
            mb-3
            flex
            min-h-9
            items-center
            justify-between
            gap-3
          "
        >
          <PageLabel tab={tab} />

          <button
            type="button"
            onClick={handleCerrarSesion}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="
              inline-flex
              shrink-0
              items-center
              gap-1.5
              rounded-xl
              border
              border-white/10
              bg-white/[0.04]
              px-2.5
              py-2
              text-[10px]
              font-extrabold
              text-white/45
              transition
              hover:border-[#FFC61A]/30
              hover:bg-[#FFC61A]/10
              hover:text-[#FFC61A]
              active:scale-[0.97]
              sm:px-3
            "
          >
            <LogoutIcon className="h-3.5 w-3.5" />

            <span className="hidden sm:inline">
              Cerrar sesión
            </span>
          </button>
        </div>

        {/* ===================================================
            PÁGINAS
        =================================================== */}

        <AnimatePresence
          mode="wait"
          initial={false}
        >
          <motion.div
            key={tab}
            initial={{
              opacity: 0,
              x: 10,
              y: 2,
            }}
            animate={{
              opacity: 1,
              x: 0,
              y: 0,
            }}
            exit={{
              opacity: 0,
              x: -10,
              y: 1,
            }}
            transition={{
              duration: 0.16,
              ease: "easeOut",
            }}
          >
            {tab === "vender" && (
              <Vender
                pos={pos}
                goInventario={goInventario}
              />
            )}

            {tab === "inventario" && (
              <Inventario
                pos={pos}
                filter={invFilter}
                setFilter={setInvFilter}
              />
            )}

            {tab === "caja" && (
              <Caja pos={pos} />
            )}

            {tab === "historial" && (
              <Historial pos={pos} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* =====================================================
          NAVEGACIÓN INFERIOR
      ===================================================== */}

      <BottomNav
        tab={tab}
        setTab={setTab}
      />

      {/* =====================================================
          TOAST
      ===================================================== */}

      <Toast
        toast={pos.toastMsg}
        onDone={pos.clearToast}
      />
    </div>
  );
}

/* =========================================================
   ETIQUETA DE SECCIÓN
========================================================= */

function PageLabel({ tab }) {
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

    historial: {
      eyebrow: "Reportes",
      label: "Historial",
      icon: HistoryIcon,
    },
  };

  const current =
    pages[tab] || pages.vender;

  const Icon = current.icon;

  return (
    <motion.div
      key={tab}
      initial={{
        opacity: 0,
        x: -4,
      }}
      animate={{
        opacity: 1,
        x: 0,
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

function LogoutIcon({
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
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
    </svg>
  );
}

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