// src/components/AdminPanel.jsx
//
// Panel administrativo del POS.
//
// Funciones:
// - listar clientes
// - crear clientes
// - registrar pagos
// - activar/desactivar
// - restablecer contraseña
// - eliminar clientes
//
// Control de dispositivos:
// - ver dispositivos registrados
// - ver dispositivos activos
// - modificar límite permitido
// - cerrar un dispositivo
// - cerrar todas las sesiones
//
// No requiere librerías de iconos externas.

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  httpsCallable,
} from "firebase/functions";

import {
  signOut,
} from "firebase/auth";

import {
  auth,
  functions,
} from "../firebase/config";

import Modal from "./Modal";

/* =========================================================
   ESTADOS
========================================================= */

const ESTADO_STYLES = {
  activo: {
    dot: "bg-emerald-500",
    text: "text-emerald-600",
    badge:
      "bg-emerald-50 border-emerald-200",
    label: "Activo",
  },

  vencido: {
    dot: "bg-[#FFC61A]",
    text: "text-[#9A7100]",
    badge:
      "bg-[#FFF8DD] border-[#F4D35E]",
    label: "Vencido",
  },

  inactivo: {
    dot: "bg-red-500",
    text: "text-red-600",
    badge:
      "bg-red-50 border-red-200",
    label: "Inactivo",
  },
};

/* =========================================================
   CLOUD FUNCTIONS
========================================================= */

const fnListarClientes =
  httpsCallable(
    functions,
    "listarClientes"
  );

const fnCrearCliente =
  httpsCallable(
    functions,
    "crearCliente"
  );

const fnRegistrarPago =
  httpsCallable(
    functions,
    "registrarPago"
  );

const fnActivarCliente =
  httpsCallable(
    functions,
    "activarCliente"
  );

const fnDesactivarCliente =
  httpsCallable(
    functions,
    "desactivarCliente"
  );

const fnRestablecerPassword =
  httpsCallable(
    functions,
    "restablecerPassword"
  );

const fnEliminarCliente =
  httpsCallable(
    functions,
    "eliminarCliente"
  );

const fnListarDispositivos =
  httpsCallable(
    functions,
    "listarDispositivos"
  );

const fnActualizarLimite =
  httpsCallable(
    functions,
    "actualizarLimiteDispositivos"
  );

const fnCerrarDispositivo =
  httpsCallable(
    functions,
    "cerrarSesionDispositivo"
  );

const fnCerrarTodasSesiones =
  httpsCallable(
    functions,
    "cerrarTodasLasSesiones"
  );


const fnActualizarAsistenteIa =
  httpsCallable(
    functions,
    "actualizarAsistenteIa"
  );

const fnObtenerEstadoGlobalAsistenteIa =
  httpsCallable(
    functions,
    "obtenerEstadoGlobalAsistenteIa"
  );

const fnActualizarConfigGlobalAsistenteIa =
  httpsCallable(
    functions,
    "actualizarConfigGlobalAsistenteIa"
  );

const fnActualizarModuloArca =
  httpsCallable(
    functions,
    "actualizarModuloArca"
  );

const fnActualizarModuloTicket =
  httpsCallable(
    functions,
    "actualizarModuloTicket"
  );

/* =========================================================
   HELPERS
========================================================= */

function formatearFecha(
  fecha
) {
  if (!fecha) {
    return "—";
  }

  const d =
    fecha?.toDate
      ? fecha.toDate()
      : new Date(fecha);

  if (
    Number.isNaN(
      d.getTime()
    )
  ) {
    return "—";
  }

  return d.toLocaleDateString(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  );
}

function formatearFechaHora(
  fecha
) {
  if (!fecha) {
    return "—";
  }

  const d =
    fecha?.toDate
      ? fecha.toDate()
      : new Date(fecha);

  if (
    Number.isNaN(
      d.getTime()
    )
  ) {
    return "—";
  }

  return d.toLocaleString(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function tiempoRelativo(
  fecha
) {
  if (!fecha) {
    return "Sin actividad";
  }

  const date =
    new Date(fecha);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Sin actividad";
  }

  const diff =
    Date.now() -
    date.getTime();

  if (diff < 0) {
    return "Ahora";
  }

  const segundos =
    Math.floor(
      diff / 1000
    );

  if (segundos < 60) {
    return "Ahora";
  }

  const minutos =
    Math.floor(
      segundos / 60
    );

  if (minutos < 60) {
    return `Hace ${minutos} ${minutos === 1
        ? "minuto"
        : "minutos"
      }`;
  }

  const horas =
    Math.floor(
      minutos / 60
    );

  if (horas < 24) {
    return `Hace ${horas} ${horas === 1
        ? "hora"
        : "horas"
      }`;
  }

  const dias =
    Math.floor(
      horas / 24
    );

  return `Hace ${dias} ${dias === 1
      ? "día"
      : "días"
    }`;
}

function numeroSeguro(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}

function textoDispositivo(
  value
) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

function obtenerNombreDispositivo(
  device
) {
  const raw =
    device?.dispositivo;

  /*
   * Versiones anteriores podían guardar
   * "dispositivo" directamente como texto.
   */
  if (
    typeof raw ===
    "string"
  ) {
    return (
      raw.trim() ||
      "Dispositivo desconocido"
    );
  }

  /*
   * La versión actual guarda metadata:
   *
   * {
   *   navegador,
   *   plataforma,
   *   tipo,
   *   userAgent
   * }
   *
   * También aceptamos los campos en el nivel
   * superior por compatibilidad con registros
   * históricos.
   */
  const info =
    raw &&
    typeof raw ===
      "object" &&
    !Array.isArray(raw)
      ? raw
      : device || {};

  const navegador =
    textoDispositivo(
      info.navegador
    );

  const plataforma =
    textoDispositivo(
      info.plataforma
    );

  const tipo =
    textoDispositivo(
      info.tipo
    ).toLowerCase();

  const userAgent =
    textoDispositivo(
      info.userAgent
    );

  let equipo = "";

  if (
    /iPhone/i.test(
      userAgent
    ) ||
    (
      plataforma === "iOS" &&
      tipo === "movil"
    )
  ) {
    equipo = "iPhone";
  } else if (
    /iPad/i.test(
      userAgent
    ) ||
    (
      plataforma === "iOS" &&
      tipo === "tablet"
    )
  ) {
    equipo = "iPad";
  } else if (
    /Samsung|SM-[A-Z0-9-]+/i.test(
      userAgent
    )
  ) {
    equipo =
      "Samsung / Android";
  } else if (
    plataforma === "Android" ||
    /Android/i.test(
      userAgent
    )
  ) {
    equipo = "Android";
  } else if (
    plataforma === "Windows" ||
    /Windows/i.test(
      userAgent
    )
  ) {
    equipo = "Windows PC";
  } else if (
    plataforma === "macOS" ||
    /Macintosh|Mac OS/i.test(
      userAgent
    )
  ) {
    equipo = "Mac";
  } else if (
    plataforma === "Linux" ||
    /Linux/i.test(
      userAgent
    )
  ) {
    equipo = "Linux PC";
  } else if (
    tipo === "tablet"
  ) {
    equipo = "Tablet";
  } else if (
    tipo === "movil"
  ) {
    equipo = "Móvil";
  } else if (
    tipo === "escritorio"
  ) {
    equipo = "PC";
  } else if (
    plataforma &&
    plataforma !==
      "Desconocida"
  ) {
    equipo = plataforma;
  }

  const navegadorValido =
    navegador &&
    navegador !==
      "Navegador" &&
    navegador !==
      "Desconocido";

  if (
    equipo &&
    navegadorValido
  ) {
    return `${equipo} · ${navegador}`;
  }

  if (equipo) {
    return equipo;
  }

  if (navegadorValido) {
    return navegador;
  }

  return "Dispositivo desconocido";
}

const ADMIN_THEME_STORAGE_KEY = "pos-theme";

function getAdminTheme() {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

function applyAdminTheme(theme) {
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
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, normalized);
  } catch {
    // El tema sigue funcionando aunque el navegador bloquee storage.
  }
}

function mensajeError(
  error,
  fallback
) {
  const raw =
    error?.message ||
    fallback;

  return String(raw)
    .replace(
      /^Firebase:\s*/i,
      ""
    )
    .replace(
      /\(functions\/[^)]+\)\.?/g,
      ""
    )
    .trim();
}

/* =========================================================
   COMPONENTE PRINCIPAL
========================================================= */

export default function AdminPanel() {
  const [
    clientes,
    setClientes,
  ] = useState([]);

  const [
    cargando,
    setCargando,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    filtro,
    setFiltro,
  ] = useState("todos");

  const [
    clienteModal,
    setClienteModal,
  ] = useState(null);

  const [
    modo,
    setModo,
  ] = useState(null);

  const [
    mostrarCrear,
    setMostrarCrear,
  ] = useState(false);

  const [
    theme,
    setTheme,
  ] = useState(getAdminTheme);

  const [
    estadoIaGlobal,
    setEstadoIaGlobal,
  ] = useState(null);

  const [
    cargandoIaGlobal,
    setCargandoIaGlobal,
  ] = useState(true);

  const [
    errorIaGlobal,
    setErrorIaGlobal,
  ] = useState(null);

  const [
    mostrarConfigIaGlobal,
    setMostrarConfigIaGlobal,
  ] = useState(false);

  function handleToggleTheme() {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      applyAdminTheme(next);
      return next;
    });
  }

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    document.body.classList.add("pos-admin-active");

    return () => {
      document.body.classList.remove("pos-admin-active");
    };
  }, []);

  /* =======================================================
     CARGAR CLIENTES
  ======================================================= */

  const cargarClientes =
    useCallback(
      async (
        options = {}
      ) => {
        const silent =
          options?.silent ===
          true;

        if (!silent) {
          setCargando(true);
        }

        setError(null);

        try {
          const res =
            await fnListarClientes();

          const lista =
            Array.isArray(
              res?.data
                ?.clientes
            )
              ? res.data
                .clientes
              : [];

          setClientes(
            lista
          );

          /*
           * Si hay un cliente abierto en un modal,
           * actualizamos también sus datos.
           */
          setClienteModal(
            (
              current
            ) => {
              if (
                !current?.id
              ) {
                return current;
              }

              return (
                lista.find(
                  (
                    cliente
                  ) =>
                    cliente.id ===
                    current.id
                ) ||
                current
              );
            }
          );
        } catch (err) {
          console.error(
            "Error cargando clientes:",
            err
          );

          setError(
            mensajeError(
              err,
              "No se pudo cargar la lista de clientes."
            )
          );
        } finally {
          if (!silent) {
            setCargando(
              false
            );
          }
        }
      },
      []
    );

  const cargarEstadoIaGlobal =
    useCallback(
      async (
        options = {}
      ) => {
        const silent =
          options?.silent ===
          true;

        if (!silent) {
          setCargandoIaGlobal(
            true
          );
        }

        setErrorIaGlobal(null);

        try {
          const response =
            await fnObtenerEstadoGlobalAsistenteIa();

          setEstadoIaGlobal(
            response?.data ||
            null
          );
        } catch (err) {
          console.error(
            "Error cargando uso global de IA:",
            err
          );

          setErrorIaGlobal(
            mensajeError(
              err,
              "No se pudo cargar el uso global de IA."
            )
          );
        } finally {
          if (!silent) {
            setCargandoIaGlobal(
              false
            );
          }
        }
      },
      []
    );

  useEffect(() => {
    cargarClientes();

    const refrescar =
      () => {
        if (
          typeof document !==
            "undefined" &&
          document.visibilityState ===
            "hidden"
        ) {
          return;
        }

        cargarClientes({
          silent: true,
        });
      };

    const intervalId =
      window.setInterval(
        refrescar,
        5000
      );

    window.addEventListener(
      "focus",
      refrescar
    );

    return () => {
      window.clearInterval(
        intervalId
      );

      window.removeEventListener(
        "focus",
        refrescar
      );
    };
  }, [
    cargarClientes,
  ]);

  useEffect(() => {
    cargarEstadoIaGlobal();

    const refrescar =
      () => {
        if (
          typeof document !==
            "undefined" &&
          document.visibilityState ===
            "hidden"
        ) {
          return;
        }

        cargarEstadoIaGlobal({
          silent: true,
        });
      };

    const intervalId =
      window.setInterval(
        refrescar,
        15000
      );

    window.addEventListener(
      "focus",
      refrescar
    );

    return () => {
      window.clearInterval(
        intervalId
      );

      window.removeEventListener(
        "focus",
        refrescar
      );
    };
  }, [
    cargarEstadoIaGlobal,
  ]);

  /* =======================================================
     MODALES
  ======================================================= */

  function abrirModal(
    cliente,
    nextModo
  ) {
    setClienteModal(
      cliente
    );

    setModo(
      nextModo
    );
  }

  function cerrarModal() {
    setClienteModal(
      null
    );

    setModo(
      null
    );
  }

  /* =======================================================
     ACTIVAR RÁPIDO
  ======================================================= */

  async function activarRapido(
    cliente
  ) {
    if (!cliente?.id) {
      return;
    }

    setError(null);

    try {
      await fnActivarCliente(
        {
          clienteId:
            cliente.id,
        }
      );

      await cargarClientes({
        silent: true,
      });
    } catch (err) {
      console.error(
        "Error activando cliente:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo activar el cliente."
        )
      );
    }
  }

  /* =======================================================
     FILTROS
  ======================================================= */

  const clientesFiltrados =
    clientes.filter(
      (cliente) =>
        filtro ===
        "todos" ||
        cliente.estado ===
        filtro
    );

  /* =======================================================
     CONTADORES
  ======================================================= */

  const contador = {
    activo:
      clientes.filter(
        (cliente) =>
          cliente.estado ===
          "activo"
      ).length,

    vencido:
      clientes.filter(
        (cliente) =>
          cliente.estado ===
          "vencido"
      ).length,

    inactivo:
      clientes.filter(
        (cliente) =>
          cliente.estado ===
          "inactivo"
      ).length,
  };

  const totalDispositivos =
    clientes.reduce(
      (
        total,
        cliente
      ) =>
        total +
        numeroSeguro(
          cliente
            .dispositivosActivos,
          0
        ),
      0
    );

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div
      className="
        pos-admin-shell
        min-h-screen
        bg-gradient-to-b
        from-[#0B0D12]
        via-[#10141B]
        to-[#171B23]
        pb-12
        text-white
      "
    >
      {/* ===================================================
          HEADER
      =================================================== */}

      <header
        className="
          pos-admin-header
          sticky
          top-0
          z-20
          border-b
          border-white/10
          bg-[#0B0D12]/90
          backdrop-blur-xl
        "
      >
        <div
          className="
            mx-auto
            flex
            max-w-[960px]
            items-center
            justify-between
            gap-3
            px-4
            py-4
            sm:px-6
          "
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="
                grid
                h-11
                w-11
                shrink-0
                place-items-center
                rounded-2xl
                bg-[#FFC61A]
                text-black
                shadow-[0_10px_30px_rgba(255,198,26,0.18)]
              "
            >
              <CartIcon className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <span
                className="
                  block
                  text-[10px]
                  font-bold
                  uppercase
                  tracking-[0.22em]
                  text-[#FFC61A]
                "
              >
                Consola de licencias
              </span>

              <h1
                className="
                  mt-1
                  truncate
                  text-xl
                  font-extrabold
                  leading-none
                  text-white
                  sm:text-2xl
                "
              >
                Clientes del POS
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setMostrarCrear(
                  true
                )
              }
              className="
                pos-admin-button
                pos-admin-button--primary
                inline-flex
                items-center
                gap-2
                rounded-2xl
                bg-[#FFC61A]
                px-3.5
                py-2.5
                text-sm
                font-extrabold
                text-black
                transition
                hover:bg-[#FFD248]
                active:scale-[0.98]
                sm:px-4
              "
            >
              <PlusIcon className="h-4 w-4" />

              <span className="hidden sm:inline">
                Nuevo cliente
              </span>

              <span className="sm:hidden">
                Nuevo
              </span>
            </button>

            <button
              type="button"
              onClick={handleToggleTheme}
              className="
                pos-admin-button
                pos-admin-theme-toggle
                inline-flex
                h-[42px]
                items-center
                justify-center
                gap-2
                rounded-2xl
                border
                border-white/10
                bg-white/5
                px-3
                text-sm
                font-bold
                text-white/70
                transition
                hover:border-[#FFC61A]/45
                hover:text-[#FFC61A]
                active:scale-[0.98]
              "
              aria-label={
                theme === "light"
                  ? "Activar modo oscuro"
                  : "Activar modo claro"
              }
              title={
                theme === "light"
                  ? "Modo oscuro"
                  : "Modo claro"
              }
            >
              {theme === "light" ? (
                <MoonIcon className="h-4 w-4" />
              ) : (
                <SunIcon className="h-4 w-4" />
              )}

              <span className="hidden md:inline">
                {theme === "light" ? "Oscuro" : "Claro"}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                signOut(auth)
              }
              className="
                pos-admin-button
                pos-admin-button--outline
                inline-flex
                items-center
                gap-2
                rounded-2xl
                border
                border-[#FFC61A]/70
                bg-transparent
                px-3.5
                py-2.5
                text-sm
                font-bold
                text-[#FFC61A]
                transition
                hover:bg-[#FFC61A]/10
                active:scale-[0.98]
              "
            >
              <LogoutIcon className="h-4 w-4" />

              <span className="hidden sm:inline">
                Cerrar sesión
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* ===================================================
          CONTENIDO
      =================================================== */}

      <main
        className="
          mx-auto
          max-w-[960px]
          px-4
          pt-5
          sm:px-6
          sm:pt-6
        "
      >
        {/* =================================================
            RESUMEN
        ================================================= */}

        <section className="mb-5">
          <div className="mb-3">
            <p className="text-sm font-medium text-white/50">
              Resumen general
            </p>

            <h2
              className="
                mt-0.5
                text-2xl
                font-extrabold
                text-white
              "
            >
              Estado de tus clientes
            </h2>
          </div>

          <div
            className="
              grid
              grid-cols-2
              gap-2.5
              sm:grid-cols-4
              sm:gap-3
            "
          >
            <Stat
              label="Activos"
              value={
                contador.activo
              }
              accent="text-emerald-500"
              icon={
                <CheckIcon className="h-4 w-4" />
              }
            />

            <Stat
              label="Vencidos"
              value={
                contador.vencido
              }
              accent="text-[#B98700]"
              icon={
                <ClockIcon className="h-4 w-4" />
              }
            />

            <Stat
              label="Inactivos"
              value={
                contador.inactivo
              }
              accent="text-red-500"
              icon={
                <PauseIcon className="h-4 w-4" />
              }
            />

            <Stat
              label="Dispositivos"
              value={
                totalDispositivos
              }
              accent="text-[#B98700]"
              icon={
                <DevicesIcon className="h-4 w-4" />
              }
            />
          </div>
        </section>

        <GlobalAiUsagePanel
          estado={
            estadoIaGlobal
          }
          cargando={
            cargandoIaGlobal
          }
          error={
            errorIaGlobal
          }
          clientes={
            clientes
          }
          onRefresh={() =>
            cargarEstadoIaGlobal()
          }
          onConfigure={() =>
            setMostrarConfigIaGlobal(
              true
            )
          }
        />

        {/* =================================================
            FILTROS
        ================================================= */}

        <section
          className="
            mb-5
            rounded-[28px]
            border
            border-white/10
            bg-[#151A22]
            p-3.5
            shadow-2xl
            shadow-black/20
            sm:p-4
          "
        >
          <div
            className="
              mb-3
              flex
              items-center
              justify-between
              gap-3
            "
          >
            <div>
              <p
                className="
                  text-xs
                  font-bold
                  uppercase
                  tracking-[0.16em]
                  text-[#FFC61A]
                "
              >
                Filtros
              </p>

              <p className="mt-1 text-sm text-white/45">
                Mostrando{" "}
                {
                  clientesFiltrados.length
                }{" "}
                de{" "}
                {
                  clientes.length
                }{" "}
                clientes
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Actualizar clientes"
                onClick={() =>
                  cargarClientes()
                }
                className="
                  grid
                  h-9
                  w-9
                  place-items-center
                  rounded-xl
                  border
                  border-white/10
                  bg-white/5
                  text-white/45
                  transition
                  hover:border-white/20
                  hover:text-[#FFC61A]
                "
              >
                <RefreshIcon className="h-4 w-4" />
              </button>

              <FilterIcon className="h-5 w-5 text-white/35" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              "todos",
              "activo",
              "vencido",
              "inactivo",
            ].map(
              (f) => {
                const activo =
                  filtro === f;

                return (
                  <button
                    type="button"
                    key={f}
                    onClick={() =>
                      setFiltro(
                        f
                      )
                    }
                    className={
                      `
                        pos-admin-filter-button
                        rounded-2xl
                        px-4
                        py-2
                        text-xs
                        font-bold
                        transition
                        active:scale-[0.98]
                      ` +
                      (activo
                        ? `
                          bg-[#FFC61A]
                          text-black
                          shadow-[0_8px_22px_rgba(255,198,26,0.16)]
                        `
                        : `
                          border
                          border-white/10
                          bg-[#0F131A]
                          text-white/60
                          hover:border-white/20
                          hover:text-white
                        `)
                    }
                  >
                    {f ===
                      "todos"
                      ? "Todos"
                      : ESTADO_STYLES[
                        f
                      ]
                        ?.label}
                  </button>
                );
              }
            )}
          </div>
        </section>

        {/* =================================================
            ERROR
        ================================================= */}

        {error && (
          <div
            className="
              mb-4
              flex
              items-start
              gap-3
              rounded-2xl
              border
              border-red-400/25
              bg-red-500/10
              px-4
              py-3
              text-sm
              text-red-200
            "
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />

            <span>
              {error}
            </span>
          </div>
        )}

        {/* =================================================
            LISTADO
        ================================================= */}

        {cargando ? (
          <LoadingClientes />
        ) : clientesFiltrados.length ===
          0 ? (
          <EmptyClientes />
        ) : (
          <div className="space-y-3">
            {clientesFiltrados.map(
              (cliente) => (
                <ClienteCard
                  key={
                    cliente.id
                  }
                  cliente={
                    cliente
                  }
                  onPago={() =>
                    abrirModal(
                      cliente,
                      "pago"
                    )
                  }
                  onDesactivar={() =>
                    abrirModal(
                      cliente,
                      "desactivar"
                    )
                  }
                  onPassword={() =>
                    abrirModal(
                      cliente,
                      "password"
                    )
                  }
                  onEliminar={() =>
                    abrirModal(
                      cliente,
                      "eliminar"
                    )
                  }
                  onDispositivos={() =>
                    abrirModal(
                      cliente,
                      "dispositivos"
                    )
                  }
                  onAsistenteIa={() =>
                    abrirModal(
                      cliente,
                      "asistente-ia"
                    )
                  }
                  onArca={() =>
                    abrirModal(
                      cliente,
                      "arca"
                    )
                  }
                  onTicket={() =>
                    abrirModal(
                      cliente,
                      "ticket"
                    )
                  }
                  onActivar={() =>
                    activarRapido(
                      cliente
                    )
                  }
                />
              )
            )}
          </div>
        )}
      </main>

      {/* ===================================================
          CREAR CLIENTE
      =================================================== */}

      <Modal
        open={
          mostrarCrear
        }
        onClose={() =>
          setMostrarCrear(
            false
          )
        }
        title="Nuevo cliente"
      >
        <FormCrearCliente
          onClose={() =>
            setMostrarCrear(
              false
            )
          }
          onDone={
            cargarClientes
          }
        />
      </Modal>

      {/* ===================================================
          PAGO
      =================================================== */}

      <Modal
        open={
          !!clienteModal &&
          modo === "pago"
        }
        onClose={
          cerrarModal
        }
        title="Registrar pago"
      >
        {clienteModal && (
          <FormPago
            cliente={
              clienteModal
            }
            onClose={
              cerrarModal
            }
            onDone={
              cargarClientes
            }
          />
        )}
      </Modal>

      {/* ===================================================
          DESACTIVAR
      =================================================== */}

      <Modal
        open={
          !!clienteModal &&
          modo ===
          "desactivar"
        }
        onClose={
          cerrarModal
        }
        title="Desactivar cliente"
      >
        {clienteModal && (
          <FormDesactivar
            cliente={
              clienteModal
            }
            onClose={
              cerrarModal
            }
            onDone={
              cargarClientes
            }
          />
        )}
      </Modal>

      {/* ===================================================
          PASSWORD
      =================================================== */}

      <Modal
        open={
          !!clienteModal &&
          modo ===
          "password"
        }
        onClose={
          cerrarModal
        }
        title="Nueva contraseña"
      >
        {clienteModal && (
          <FormPassword
            cliente={
              clienteModal
            }
            onClose={
              cerrarModal
            }
            onDone={
              cargarClientes
            }
          />
        )}
      </Modal>

      {/* ===================================================
          DISPOSITIVOS
      =================================================== */}

      <Modal
        open={
          !!clienteModal &&
          modo ===
          "dispositivos"
        }
        onClose={
          cerrarModal
        }
        title="Dispositivos"
      >
        {clienteModal && (
          <PanelDispositivos
            cliente={
              clienteModal
            }
            onClientRefresh={() =>
              cargarClientes({
                silent: true,
              })
            }
          />
        )}
      </Modal>

      {/* ===================================================
          USO GLOBAL IA
      =================================================== */}

      <Modal
        open={
          mostrarConfigIaGlobal
        }
        onClose={() =>
          setMostrarConfigIaGlobal(
            false
          )
        }
        title="Control global de IA"
      >
        <FormConfiguracionGlobalIa
          estado={
            estadoIaGlobal
          }
          onClose={() =>
            setMostrarConfigIaGlobal(
              false
            )
          }
          onDone={
            cargarEstadoIaGlobal
          }
        />
      </Modal>

      {/* ===================================================
          ASISTENTE IA
      =================================================== */}

      <Modal
        open={
          !!clienteModal &&
          modo ===
          "asistente-ia"
        }
        onClose={
          cerrarModal
        }
        title="Asistente IA"
      >
        {clienteModal && (
          <FormAsistenteIa
            cliente={
              clienteModal
            }
            onClose={
              cerrarModal
            }
            onDone={
              cargarClientes
            }
          />
        )}
      </Modal>

      {/* ===================================================
          TICKETS
      =================================================== */}

      <Modal
        open={
          !!clienteModal &&
          modo ===
          "ticket"
        }
        onClose={
          cerrarModal
        }
        title="Tickets"
      >
        {clienteModal && (
          <FormTicket
            cliente={
              clienteModal
            }
            onClose={
              cerrarModal
            }
            onDone={
              cargarClientes
            }
          />
        )}
      </Modal>

      {/* ===================================================
          FACTURACIÓN ARCA
      =================================================== */}

      <Modal
        open={
          !!clienteModal &&
          modo ===
          "arca"
        }
        onClose={
          cerrarModal
        }
        title="Facturación ARCA"
      >
        {clienteModal && (
          <FormArca
            cliente={
              clienteModal
            }
            onClose={
              cerrarModal
            }
            onDone={
              cargarClientes
            }
          />
        )}
      </Modal>

      {/* ===================================================
          ELIMINAR
      =================================================== */}

      <Modal
        open={
          !!clienteModal &&
          modo ===
          "eliminar"
        }
        onClose={
          cerrarModal
        }
        title="Eliminar cliente"
      >
        {clienteModal && (
          <FormEliminar
            cliente={
              clienteModal
            }
            onClose={
              cerrarModal
            }
            onDone={
              cargarClientes
            }
          />
        )}
      </Modal>
    </div>
  );
}

/* =========================================================
   CLIENTE CARD
========================================================= */

function ClienteCard({
  cliente,
  onPago,
  onDesactivar,
  onPassword,
  onEliminar,
  onDispositivos,
  onAsistenteIa,
  onArca,
  onTicket,
  onActivar,
}) {
  const estilo =
    ESTADO_STYLES[
    cliente.estado
    ] ||
    ESTADO_STYLES.inactivo;

  const activos =
    numeroSeguro(
      cliente
        .dispositivosActivos,
      0
    );

  const maximo =
    Math.max(
      1,
      numeroSeguro(
        cliente
          .maxDispositivos,
        1
      )
    );

  const completo =
    activos >= maximo;

  const aiConfig =
    cliente?.asistenteIa ||
    {};

  const aiUsage =
    cliente?.asistenteIaUso ||
    {};

  const aiEnabled =
    aiConfig.enabled ===
      true &&
    aiConfig.vigente !==
      false;

  const aiExpired =
    aiConfig.enabled ===
      true &&
    aiConfig.vigente ===
      false;

  const aiUsed =
    Math.max(
      0,
      numeroSeguro(
        aiUsage.usadas,
        0
      )
    );

  const aiLimit =
    Math.max(
      1,
      numeroSeguro(
        aiUsage.limite ??
          aiConfig.monthlyLimit,
        100
      )
    );

  const ticketConfig =
    cliente?.ticket || {};

  const ticketEnabled =
    ticketConfig.enabled ===
    true;

  const arcaConfig =
    cliente?.arca || {};

  const arcaEnabled =
    arcaConfig.enabled ===
    true;

  const arcaCompleted =
    Math.max(
      0,
      numeroSeguro(
        arcaConfig.completedRequirements,
        0
      )
    );

  const arcaTotal =
    Math.max(
      1,
      numeroSeguro(
        arcaConfig.requiredRequirements,
        5
      )
    );

  const arcaSandboxReady =
    arcaEnabled &&
    arcaConfig.status ===
      "sandbox-operativo";

  return (
    <article
      className="
        overflow-hidden
        rounded-[28px]
        bg-white
        text-[#111318]
        shadow-[0_18px_50px_rgba(0,0,0,0.18)]
      "
    >
      <div className="px-4 pb-4 pt-4 sm:px-5 sm:pt-5">

        {/* CLIENTE */}

        <div
          className="
            flex
            items-start
            justify-between
            gap-3
          "
        >
          <div className="min-w-0">
            <p
              className="
                mb-1
                text-[10px]
                font-extrabold
                uppercase
                tracking-[0.18em]
                text-[#B98700]
              "
            >
              Cliente
            </p>

            <h3
              className="
                truncate
                text-[17px]
                font-extrabold
                sm:text-lg
              "
            >
              {cliente.nombreNegocio ||
                "Sin nombre"}
            </h3>

            <p
              className="
                mt-1
                truncate
                text-xs
                font-medium
                text-black/45
                sm:text-sm
              "
            >
              {cliente.email}
            </p>
          </div>

          <span
            className={`
              inline-flex
              shrink-0
              items-center
              gap-1.5
              rounded-full
              border
              px-2.5
              py-1.5
              text-[11px]
              font-extrabold
              ${estilo.badge}
              ${estilo.text}
            `}
          >
            <span
              className={`
                h-1.5
                w-1.5
                rounded-full
                ${estilo.dot}
              `}
            />

            {estilo.label}
          </span>
        </div>

        <div
          className="
            my-4
            h-[3px]
            rounded-full
            bg-[#FFC61A]
          "
        />

        {/* INFORMACIÓN */}

        <div className="grid grid-cols-2 gap-2.5">
          <InfoBox
            label="Último pago"
            value={formatearFecha(
              cliente
                .fechaUltimoPago
            )}
            icon={
              <PaymentIcon className="h-4 w-4" />
            }
          />

          <InfoBox
            label="Vencimiento"
            value={formatearFecha(
              cliente
                .fechaVencimiento
            )}
            icon={
              <CalendarIcon className="h-4 w-4" />
            }
          />
        </div>

        {/* DISPOSITIVOS */}

        <button
          type="button"
          onClick={
            onDispositivos
          }
          className="
            group
            mt-2.5
            flex
            w-full
            items-center
            gap-3
            rounded-[20px]
            border
            border-black/[0.06]
            bg-[#F4F5F7]
            p-3
            text-left
            transition
            hover:border-[#FFC61A]/60
            hover:bg-[#FFF9E8]
            active:scale-[0.995]
          "
        >
          <div
            className="
              grid
              h-10
              w-10
              shrink-0
              place-items-center
              rounded-xl
              bg-[#11151C]
              text-[#FFC61A]
            "
          >
            <DevicesIcon className="h-[18px] w-[18px]" />
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.1em]
                text-black/35
              "
            >
              Dispositivos
            </div>

            <div
              className="
                mt-0.5
                text-sm
                font-black
                text-[#111318]
              "
            >
              {activos} /{" "}
              {maximo} activos
            </div>
          </div>

          <span
            className={
              `
                shrink-0
                rounded-full
                px-2.5
                py-1.5
                text-[9px]
                font-extrabold
                uppercase
              ` +
              (activos === 0
                ? `
                  bg-black/5
                  text-black/35
                `
                : completo
                  ? `
                  bg-[#FFF0BD]
                  text-[#9A7100]
                `
                  : `
                  bg-emerald-50
                  text-emerald-600
                `)
            }
          >
            {activos === 0
              ? "Sin uso"
              : completo
                ? "Completo"
                : "Disponible"}
          </span>

          <ChevronIcon className="h-4 w-4 shrink-0 text-black/20 transition group-hover:text-[#9A7100]" />
        </button>

        {/* ASISTENTE IA */}

        <button
          type="button"
          onClick={
            onAsistenteIa
          }
          className="
            group
            mt-2.5
            flex
            w-full
            items-center
            gap-3
            rounded-[20px]
            border
            border-black/[0.06]
            bg-[#F4F5F7]
            p-3
            text-left
            transition
            hover:border-[#FFC61A]/60
            hover:bg-[#FFF9E8]
            active:scale-[0.995]
          "
        >
          <div
            className="
              grid
              h-10
              w-10
              shrink-0
              place-items-center
              rounded-xl
              bg-[#11151C]
              text-[#FFC61A]
            "
          >
            <SparklesIcon className="h-[18px] w-[18px]" />
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.1em]
                text-black/35
              "
            >
              Asistente IA
            </div>

            <div
              className="
                mt-0.5
                text-sm
                font-black
                text-[#111318]
              "
            >
              {aiEnabled
                ? `${aiUsed} / ${aiLimit} consultas`
                : aiExpired
                  ? "Habilitación vencida"
                  : "Upgrade opcional"}
            </div>
          </div>

          <span
            className={
              `
                shrink-0
                rounded-full
                px-2.5
                py-1.5
                text-[9px]
                font-extrabold
                uppercase
              ` +
              (aiEnabled
                ? `
                  bg-emerald-50
                  text-emerald-600
                `
                : aiExpired
                  ? `
                    bg-[#FFF0BD]
                    text-[#9A7100]
                  `
                  : `
                    bg-black/5
                    text-black/35
                  `)
            }
          >
            {aiEnabled
              ? "Activo"
              : aiExpired
                ? "Vencido"
                : "Inactivo"}
          </span>

          <ChevronIcon className="h-4 w-4 shrink-0 text-black/20 transition group-hover:text-[#9A7100]" />
        </button>

        {/* TICKETS */}

        <button
          type="button"
          onClick={
            onTicket
          }
          className="
            group
            mt-2.5
            flex
            w-full
            items-center
            gap-3
            rounded-[20px]
            border
            border-black/[0.06]
            bg-[#F4F5F7]
            p-3
            text-left
            transition
            hover:border-[#FFC61A]/60
            hover:bg-[#FFF9E8]
            active:scale-[0.995]
          "
        >
          <div
            className="
              grid
              h-10
              w-10
              shrink-0
              place-items-center
              rounded-xl
              bg-[#11151C]
              text-[#FFC61A]
            "
          >
            <PaymentIcon className="h-[18px] w-[18px]" />
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.1em]
                text-black/35
              "
            >
              Tickets
            </div>

            <div
              className="
                mt-0.5
                text-sm
                font-black
                text-[#111318]
              "
            >
              {ticketEnabled
                ? `${Number(ticketConfig.defaultWidth) === 80 ? "80" : "58"} mm · PDF · compartir`
                : "Módulo opcional"}
            </div>
          </div>

          <span
            className={
              `
                shrink-0
                rounded-full
                px-2.5
                py-1.5
                text-[9px]
                font-extrabold
                uppercase
              ` +
              (ticketEnabled
                ? `
                  bg-emerald-50
                  text-emerald-600
                `
                : `
                  bg-black/5
                  text-black/35
                `)
            }
          >
            {ticketEnabled
              ? "Activo"
              : "Inactivo"}
          </span>

          <ChevronIcon className="h-4 w-4 shrink-0 text-black/20 transition group-hover:text-[#9A7100]" />
        </button>

        {/* FACTURACIÓN ARCA */}

        <button
          type="button"
          onClick={
            onArca
          }
          className="
            group
            mt-2.5
            flex
            w-full
            items-center
            gap-3
            rounded-[20px]
            border
            border-black/[0.06]
            bg-[#F4F5F7]
            p-3
            text-left
            transition
            hover:border-[#FFC61A]/60
            hover:bg-[#FFF9E8]
            active:scale-[0.995]
          "
        >
          <div
            className="
              grid
              h-10
              w-10
              shrink-0
              place-items-center
              rounded-xl
              bg-[#11151C]
              text-[#FFC61A]
            "
          >
            <PaymentIcon className="h-[18px] w-[18px]" />
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.1em]
                text-black/35
              "
            >
              Facturación ARCA
            </div>

            <div
              className="
                mt-0.5
                text-sm
                font-black
                text-[#111318]
              "
            >
              {arcaEnabled
                ? arcaSandboxReady
                  ? "Sandbox operativo"
                  : `${arcaCompleted} / ${arcaTotal} requisitos`
                : "Módulo opcional"}
            </div>
          </div>

          <span
            className={
              `
                shrink-0
                rounded-full
                px-2.5
                py-1.5
                text-[9px]
                font-extrabold
                uppercase
              ` +
              (arcaSandboxReady
                ? `
                  bg-emerald-50
                  text-emerald-600
                `
                : arcaEnabled
                  ? `
                    bg-[#FFF0BD]
                    text-[#9A7100]
                  `
                  : `
                    bg-black/5
                    text-black/35
                  `)
            }
          >
            {arcaSandboxReady
              ? "Listo"
              : arcaEnabled
                ? "Habilitado"
                : "Inactivo"}
          </span>

          <ChevronIcon className="h-4 w-4 shrink-0 text-black/20 transition group-hover:text-[#9A7100]" />
        </button>

        {/* ACCIONES */}

        <div className="mt-4">
          <button
            type="button"
            onClick={onPago}
            className="
              inline-flex
              w-full
              items-center
              justify-center
              gap-2
              rounded-2xl
              bg-[#FFC61A]
              px-4
              py-3.5
              text-sm
              font-extrabold
              text-black
              transition
              hover:bg-[#FFD248]
              active:scale-[0.99]
            "
          >
            <PaymentIcon className="h-4 w-4" />

            Registrar pago
          </button>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {cliente.estado ===
              "activo" ||
              cliente.estado ===
              "vencido" ? (
              <SmallBtn
                danger
                onClick={
                  onDesactivar
                }
                icon={
                  <PauseIcon className="h-4 w-4" />
                }
              >
                Desactivar
              </SmallBtn>
            ) : (
              <SmallBtn
                onClick={
                  onActivar
                }
                icon={
                  <CheckIcon className="h-4 w-4" />
                }
              >
                Activar
              </SmallBtn>
            )}

            <SmallBtn
              onClick={
                onPassword
              }
              icon={
                <KeyIcon className="h-4 w-4" />
              }
            >
              Contraseña
            </SmallBtn>
          </div>

          <button
            type="button"
            onClick={onEliminar}
            className="
              mt-2.5
              inline-flex
              w-full
              items-center
              justify-center
              gap-2
              rounded-2xl
              border
              border-red-200
              bg-red-50
              px-4
              py-3
              text-sm
              font-bold
              text-red-600
              transition
              hover:bg-red-100
              active:scale-[0.99]
            "
          >
            <TrashIcon className="h-4 w-4" />

            Eliminar cliente
          </button>
        </div>
      </div>
    </article>
  );
}

/* =========================================================
   CONTROL GLOBAL DE IA
========================================================= */

const AI_GLOBAL_STATUS = {
  normal: {
    label: "Normal",
    badge:
      "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
    bar:
      "bg-emerald-400",
  },
  warning: {
    label: "Advertencia",
    badge:
      "border-[#FFC61A]/25 bg-[#FFC61A]/10 text-[#FFC61A]",
    bar:
      "bg-[#FFC61A]",
  },
  alert: {
    label: "Alerta",
    badge:
      "border-orange-400/25 bg-orange-500/10 text-orange-300",
    bar:
      "bg-orange-400",
  },
  savings: {
    label: "Modo ahorro",
    badge:
      "border-red-400/25 bg-red-500/10 text-red-300",
    bar:
      "bg-red-400",
  },
  blocked: {
    label: "Bloqueado",
    badge:
      "border-red-400/30 bg-red-500/15 text-red-300",
    bar:
      "bg-red-500",
  },
};

function GlobalAiUsagePanel({
  estado,
  cargando,
  error,
  clientes,
  onRefresh,
  onConfigure,
}) {
  const today =
    estado?.today || {};

  const config =
    estado?.config || {};

  const month =
    estado?.month || {};

  const requests =
    Math.max(
      0,
      numeroSeguro(
        today.requests,
        0
      )
    );

  const internalLimit =
    Math.max(
      1,
      numeroSeguro(
        config.internalDailyLimit,
        450
      )
    );

  const technicalLimit =
    Math.max(
      internalLimit,
      numeroSeguro(
        config.technicalDailyLimit,
        500
      )
    );

  const rpmUsed =
    Math.max(
      0,
      numeroSeguro(
        today?.rpm?.used,
        0
      )
    );

  const rpmLimit =
    Math.max(
      1,
      numeroSeguro(
        today?.rpm?.limit ??
          config.internalRpmLimit,
        14
      )
    );

  const technicalRpmLimit =
    Math.max(
      rpmLimit,
      numeroSeguro(
        today?.rpm?.technicalLimit ??
          config.technicalRpmLimit,
        15
      )
    );

  const percentage =
    Math.max(
      0,
      Math.min(
        100,
        numeroSeguro(
          today.percentage,
          (
            requests /
            internalLimit
          ) * 100
        )
      )
    );

  const status =
    AI_GLOBAL_STATUS[
      today.level
    ] ||
    AI_GLOBAL_STATUS.normal;

  const clientMap =
    new Map(
      (Array.isArray(clientes)
        ? clientes
        : []
      ).map(
        (cliente) => [
          cliente.id,
          cliente,
        ]
      )
    );

  const ranking =
    Array.isArray(
      estado?.ranking
    )
      ? estado.ranking
          .slice(0, 5)
      : [];

  return (
    <section
      className="
        mb-5
        overflow-hidden
        rounded-[28px]
        border
        border-[#FFC61A]/15
        bg-[linear-gradient(145deg,#121821,#0D1118)]
        shadow-2xl
        shadow-black/20
      "
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#FFC61A]/20 bg-[#FFC61A]/10 text-[#FFC61A]">
              <SparklesIcon className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#FFC61A]">
                Uso global del proveedor
              </p>
              <h2 className="mt-1 text-lg font-black text-white">
                Capacidad de Gemini
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-white/40">
                El límite diario interno protege la cuota compartida entre todos los clientes.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={cargando}
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/45 transition hover:border-white/20 hover:text-[#FFC61A] disabled:opacity-40"
              aria-label="Actualizar uso global de IA"
            >
              <RefreshIcon
                className={
                  `h-4 w-4 ${
                    cargando
                      ? "animate-spin"
                      : ""
                  }`
                }
              />
            </button>

            <button
              type="button"
              onClick={onConfigure}
              className="rounded-xl border border-[#FFC61A]/25 bg-[#FFC61A]/10 px-3 py-2 text-xs font-black text-[#FFC61A] transition hover:bg-[#FFC61A]/15 active:scale-[0.98]"
            >
              Configurar
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-200">
            {error}
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <GlobalAiMetric
                label="Hoy"
                value={
                  cargando && !estado
                    ? "…"
                    : `${requests} / ${internalLimit}`
                }
                detail="solicitudes API"
              />

              <GlobalAiMetric
                label="RPM"
                value={`${rpmUsed} / ${rpmLimit}`}
                detail={`techo técnico ${technicalRpmLimit}/min`}
              />

              <GlobalAiMetric
                label="Reserva"
                value={
                  Math.max(
                    0,
                    technicalLimit -
                      internalLimit
                  )
                }
                detail={`de ${technicalLimit} RPD técnicos`}
              />

              <GlobalAiMetric
                label="Mes"
                value={
                  Math.max(
                    0,
                    numeroSeguro(
                      month.consultations,
                      0
                    )
                  )
                }
                detail="consultas respondidas"
              />

              <GlobalAiMetric
                label="Estado"
                value={status.label}
                detail={
                  today.level === "savings"
                    ? "Flash Lite + contexto reducido"
                    : today.level === "blocked"
                      ? "se alcanzó el techo interno"
                      : "protección automática activa"
                }
              />
            </div>

            <div className="mt-4 rounded-[22px] border border-white/10 bg-black/15 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-white">
                    Consumo diario
                  </p>
                  <p className="mt-1 text-[10px] text-white/35">
                    Reinicia según el día de cuota de Gemini ({today.timeZone || "America/Los_Angeles"}).
                  </p>
                </div>

                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${status.badge}`}
                >
                  {Math.round(percentage)}%
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${status.bar}`}
                  style={{
                    width:
                      `${percentage}%`,
                  }}
                />
              </div>

              <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] font-semibold text-white/35">
                <span>
                  70% aviso · 85% alerta · 95% ahorro
                </span>
                <span>
                  {Math.max(
                    0,
                    internalLimit -
                      requests
                  )} disponibles antes del límite interno
                </span>
              </div>
            </div>

            {ranking.length > 0 && (
              <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/35">
                      Mayor uso este mes
                    </p>
                    <p className="mt-1 text-sm font-black text-white">
                      Clientes con más consultas
                    </p>
                  </div>

                  <span className="text-[10px] font-bold text-white/30">
                    Top {ranking.length}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {ranking.map(
                    (entry, index) => {
                      const client =
                        clientMap.get(
                          entry.clienteId
                        );

                      return (
                        <div
                          key={entry.clienteId}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-black/10 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black text-white/80">
                              {index + 1}. {client?.nombreNegocio || client?.email || "Cliente"}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] text-white/30">
                              {client?.email || entry.clienteId}
                            </p>
                          </div>

                          <span className="shrink-0 text-xs font-black text-[#FFC61A]">
                            {Math.max(
                              0,
                              numeroSeguro(
                                entry.consultas,
                                0
                              )
                            )}
                          </span>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function GlobalAiMetric({
  label,
  value,
  detail,
}) {
  return (
    <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.035] p-3.5">
      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-white/30">
        {label}
      </p>
      <p className="mt-1.5 truncate text-base font-black text-white">
        {value}
      </p>
      <p className="mt-1 text-[10px] leading-snug text-white/30">
        {detail}
      </p>
    </div>
  );
}

function FormConfiguracionGlobalIa({
  estado,
  onClose,
  onDone,
}) {
  const initialConfig =
    estado?.config || {};

  const [technicalLimit, setTechnicalLimit] =
    useState(
      String(
        Math.max(
          1,
          numeroSeguro(
            initialConfig.technicalDailyLimit,
            500
          )
        )
      )
    );

  const [internalLimit, setInternalLimit] =
    useState(
      String(
        Math.max(
          1,
          numeroSeguro(
            initialConfig.internalDailyLimit,
            450
          )
        )
      )
    );

  const [technicalRpmLimit, setTechnicalRpmLimit] =
    useState(
      String(
        Math.max(
          1,
          numeroSeguro(
            initialConfig.technicalRpmLimit,
            15
          )
        )
      )
    );

  const [internalRpmLimit, setInternalRpmLimit] =
    useState(
      String(
        Math.max(
          1,
          numeroSeguro(
            initialConfig.internalRpmLimit,
            14
          )
        )
      )
    );

  const [retry429, setRetry429] =
    useState(
      initialConfig.retry429 !==
      false
    );

  const [fallbackEnabled, setFallbackEnabled] =
    useState(
      initialConfig.fallbackEnabled !==
      false
    );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState(null);

  const technicalNumber =
    Number(technicalLimit);

  const internalNumber =
    Number(internalLimit);

  const technicalRpmNumber =
    Number(technicalRpmLimit);

  const internalRpmNumber =
    Number(internalRpmLimit);

  const reserve =
    Number.isFinite(technicalNumber) &&
    Number.isFinite(internalNumber)
      ? Math.max(
          0,
          technicalNumber -
            internalNumber
        )
      : 0;

  async function save() {
    if (
      !Number.isInteger(
        technicalNumber
      ) ||
      technicalNumber < 1 ||
      technicalNumber > 1000000
    ) {
      setError(
        "El límite técnico diario debe ser un número entero válido."
      );
      return;
    }

    if (
      !Number.isInteger(
        internalNumber
      ) ||
      internalNumber < 1 ||
      internalNumber >
        technicalNumber
    ) {
      setError(
        "El límite interno debe ser mayor a 0 y no puede superar el límite técnico."
      );
      return;
    }

    if (
      !Number.isInteger(
        technicalRpmNumber
      ) ||
      technicalRpmNumber < 1 ||
      technicalRpmNumber > 10000
    ) {
      setError(
        "El límite técnico por minuto debe ser un número entero válido."
      );
      return;
    }

    if (
      !Number.isInteger(
        internalRpmNumber
      ) ||
      internalRpmNumber < 1 ||
      internalRpmNumber >
        technicalRpmNumber
    ) {
      setError(
        "El límite interno por minuto debe ser mayor a 0 y no puede superar el límite técnico."
      );
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await fnActualizarConfigGlobalAsistenteIa({
        technicalDailyLimit:
          technicalNumber,
        internalDailyLimit:
          internalNumber,
        technicalRpmLimit:
          technicalRpmNumber,
        internalRpmLimit:
          internalRpmNumber,
        retry429,
        fallbackEnabled,
      });

      await onDone?.({
        silent: true,
      });

      onClose?.();
    } catch (err) {
      console.error(
        "Error actualizando configuración global de IA:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo actualizar la configuración global de IA."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-[22px] border border-[#FFC61A]/15 bg-[#11151C] p-4 text-white">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black">
            <SparklesIcon className="h-5 w-5" />
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#FFC61A]">
              Protección del proveedor
            </p>
            <p className="mt-1 text-sm font-black">
              Cuota global compartida
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Estas reglas se aplican antes de enviar cada solicitud real a Gemini. Los límites mensuales por cliente continúan funcionando de forma independiente.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
            <span className="block text-xs font-black text-black/55">
              Límite técnico diario
            </span>
            <input
              type="number"
              min="1"
              max="1000000"
              step="1"
              value={technicalLimit}
              onChange={(event) =>
                setTechnicalLimit(
                  event.target.value
                )
              }
              className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-[#FFC61A]"
            />
            <span className="mt-1.5 block text-[10px] text-black/35">
              Actualmente Gemini muestra 500 RPD para Flash Lite.
            </span>
          </label>

          <label className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
            <span className="block text-xs font-black text-black/55">
              Límite interno diario
            </span>
            <input
              type="number"
              min="1"
              max={technicalLimit || undefined}
              step="1"
              value={internalLimit}
              onChange={(event) =>
                setInternalLimit(
                  event.target.value
                )
              }
              className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-[#FFC61A]"
            />
            <span className="mt-1.5 block text-[10px] text-black/35">
              Reserva actual: {reserve} solicitudes.
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
            <span className="block text-xs font-black text-black/55">
              RPM técnico
            </span>
            <input
              type="number"
              min="1"
              max="10000"
              step="1"
              value={technicalRpmLimit}
              onChange={(event) =>
                setTechnicalRpmLimit(
                  event.target.value
                )
              }
              className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-[#FFC61A]"
            />
            <span className="mt-1.5 block text-[10px] text-black/35">
              Gemini muestra actualmente 15 solicitudes/minuto.
            </span>
          </label>

          <label className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
            <span className="block text-xs font-black text-black/55">
              RPM interno
            </span>
            <input
              type="number"
              min="1"
              max={technicalRpmLimit || undefined}
              step="1"
              value={internalRpmLimit}
              onChange={(event) =>
                setInternalRpmLimit(
                  event.target.value
                )
              }
              className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-[#FFC61A]"
            />
            <span className="mt-1.5 block text-[10px] text-black/35">
              14/min deja una solicitud de margen.
            </span>
          </label>
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <div>
            <p className="text-sm font-black">
              Reintentar ante saturación 429
            </p>
            <p className="mt-1 text-xs leading-relaxed text-black/45">
              Hace un único reintento breve cuando el error parece ser temporal. Nunca reintenta una cuota diaria agotada.
            </p>
          </div>

          <input
            type="checkbox"
            checked={retry429}
            onChange={(event) =>
              setRetry429(
                event.target.checked
              )
            }
            className="h-5 w-5 shrink-0 accent-[#FFC61A]"
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <div>
            <p className="text-sm font-black">
              Fallback de modelos
            </p>
            <p className="mt-1 text-xs leading-relaxed text-black/45">
              Si un modelo devuelve 404/503, permite probar el siguiente modelo compatible. En modo ahorro se utiliza una sola solicitud Flash Lite.
            </p>
          </div>

          <input
            type="checkbox"
            checked={fallbackEnabled}
            onChange={(event) =>
              setFallbackEnabled(
                event.target.checked
              )
            }
            className="h-5 w-5 shrink-0 accent-[#FFC61A]"
          />
        </label>

        <div className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <p className="text-xs font-black text-black/55">
            Escalado automático
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-white px-2 py-3">
              <p className="text-sm font-black text-[#9A7100]">
                70%
              </p>
              <p className="mt-1 text-[9px] font-bold text-black/35">
                Aviso
              </p>
            </div>
            <div className="rounded-2xl bg-white px-2 py-3">
              <p className="text-sm font-black text-orange-600">
                85%
              </p>
              <p className="mt-1 text-[9px] font-bold text-black/35">
                Alerta
              </p>
            </div>
            <div className="rounded-2xl bg-white px-2 py-3">
              <p className="text-sm font-black text-red-600">
                95%
              </p>
              <p className="mt-1 text-[9px] font-bold text-black/35">
                Ahorro
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-black text-black/55 transition hover:bg-black/[0.03] disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#FFC61A] px-4 py-3 text-sm font-black text-black transition hover:bg-[#FFD248] disabled:opacity-50"
          >
            {saving ? (
              <SpinnerIcon className="h-4 w-4 animate-spin" />
            ) : (
              <SaveIcon className="h-4 w-4" />
            )}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   CONFIGURAR ASISTENTE IA
========================================================= */

const AI_PLAN_OPTIONS = {
  starter: {
    label: "Starter",
    defaultLimit: 100,
    description:
      "Consultas rápidas y de bajo costo.",
  },
  pro: {
    label: "Pro",
    defaultLimit: 300,
    description:
      "Mejor análisis para uso frecuente.",
  },
  business: {
    label: "Business",
    defaultLimit: 1000,
    description:
      "Mayor capacidad para comercios intensivos.",
  },
};

function isoToDateInput(
  value
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  const year =
    date.getFullYear();
  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");
  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function FormTicket({
  cliente,
  onClose,
  onDone,
}) {
  const ticket =
    cliente?.ticket || {};

  const [enabled, setEnabled] =
    useState(
      ticket.enabled === true
    );

  const [businessName, setBusinessName] =
    useState(
      String(
        ticket.businessName ||
        cliente?.nombreNegocio ||
        ""
      )
    );

  const [address, setAddress] =
    useState(
      String(ticket.address || "")
    );

  const [phone, setPhone] =
    useState(
      String(ticket.phone || "")
    );

  const [footerText, setFooterText] =
    useState(
      String(ticket.footerText || "")
    );

  const [defaultWidth, setDefaultWidth] =
    useState(
      Number(ticket.defaultWidth) === 80
        ? 80
        : 58
    );

  const [autoOpen, setAutoOpen] =
    useState(
      ticket.autoOpen !== false
    );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState(null);

  async function save() {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await fnActualizarModuloTicket({
        clienteId:
          cliente.id,
        enabled,
        businessName:
          businessName.trim(),
        address:
          address.trim(),
        phone:
          phone.trim(),
        footerText:
          footerText.trim(),
        defaultWidth,
        autoOpen,
      });

      await onDone?.({
        silent: true,
      });

      onClose?.();
    } catch (err) {
      console.error(
        "Error configurando módulo de tickets:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo actualizar el módulo de tickets."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <ModalClientHeader
        title={
          cliente.nombreNegocio ||
          "Sin nombre"
        }
        subtitle={
          cliente.email
        }
      />

      <div className="mb-4 rounded-[22px] border border-[#FFC61A]/15 bg-[#11151C] p-4 text-white">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black">
            <PaymentIcon className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#FFC61A]">
              Módulo por cliente
            </p>
            <p className="mt-1 text-sm font-black">
              Tickets
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Controla si este cliente puede generar el ticket posterior a la venta, imprimir en 58/80 mm, descargar PDF y compartirlo desde el dispositivo.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <div>
            <p className="text-sm font-black">
              Habilitar tickets
            </p>
            <p className="mt-1 text-xs text-black/45">
              Al confirmar una venta aparecerán las opciones para imprimir, descargar o compartir el ticket.
            </p>
          </div>

          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              setEnabled(
                event.target.checked
              )
            }
            className="h-5 w-5 accent-[#FFC61A]"
          />
        </label>

        <div className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#9A7100]">
            Datos del ticket
          </p>

          <div className="mt-3 grid gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black">Nombre comercial</span>
              <input
                type="text"
                maxLength={120}
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder={cliente?.nombreNegocio || "Mi Negocio"}
                className="w-full rounded-2xl border border-black/10 bg-white px-3.5 py-3 text-sm font-bold text-[#111318] outline-none transition focus:border-[#FFC61A]"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-black">Dirección</span>
              <input
                type="text"
                maxLength={180}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Opcional"
                className="w-full rounded-2xl border border-black/10 bg-white px-3.5 py-3 text-sm font-bold text-[#111318] outline-none transition focus:border-[#FFC61A]"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-black">Teléfono</span>
              <input
                type="text"
                maxLength={60}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Opcional"
                className="w-full rounded-2xl border border-black/10 bg-white px-3.5 py-3 text-sm font-bold text-[#111318] outline-none transition focus:border-[#FFC61A]"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-black">Texto al pie</span>
              <textarea
                rows={3}
                maxLength={240}
                value={footerText}
                onChange={(event) => setFooterText(event.target.value)}
                placeholder="Ej.: Gracias por elegirnos. Cambios dentro de las 48 hs."
                className="w-full resize-none rounded-2xl border border-black/10 bg-white px-3.5 py-3 text-sm font-bold text-[#111318] outline-none transition focus:border-[#FFC61A]"
              />
              <span className="mt-1 block text-right text-[10px] font-bold text-black/30">
                {footerText.length}/240
              </span>
            </label>
          </div>
        </div>

        <div className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#9A7100]">
            Comportamiento
          </p>

          <div className="mt-3">
            <span className="mb-2 block text-xs font-black">Tamaño predeterminado</span>
            <div className="grid grid-cols-2 gap-2">
              {[58, 80].map((width) => {
                const active = defaultWidth === width;

                return (
                  <button
                    key={width}
                    type="button"
                    onClick={() => setDefaultWidth(width)}
                    className={
                      `rounded-2xl border px-3 py-3 text-sm font-black transition ` +
                      (active
                        ? "border-[#FFC61A] bg-[#FFC61A] text-black"
                        : "border-black/10 bg-white text-black/55 hover:border-[#FFC61A]/40")
                    }
                  >
                    {width} mm
                  </button>
                );
              })}
            </div>
          </div>

          <label className="mt-3 flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white p-3.5">
            <div>
              <p className="text-xs font-black">Abrir ticket al finalizar la venta</p>
              <p className="mt-1 text-[11px] leading-relaxed text-black/40">
                Si se desactiva, el ticket seguirá disponible desde “Último ticket” y desde Historial.
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoOpen}
              onChange={(event) => setAutoOpen(event.target.checked)}
              className="h-5 w-5 shrink-0 accent-[#FFC61A]"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {["58 / 80 mm", "PDF", "Compartir", "Historial"].map(
            (feature) => (
              <div
                key={feature}
                className="rounded-[18px] border border-black/[0.07] bg-[#F4F5F7] px-3 py-3 text-center text-xs font-black text-[#111318]"
              >
                {feature}
              </div>
            )
          )}
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-bold text-red-600">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="w-full rounded-2xl bg-[#FFC61A] px-4 py-3.5 text-sm font-black text-black transition hover:bg-[#FFD248] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving
            ? "Guardando…"
            : "Guardar configuración"}
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   FACTURACIÓN ARCA — CONFIGURACIÓN POR CLIENTE
========================================================= */

function FormArca({
  cliente,
  onClose,
  onDone,
}) {
  const arca =
    cliente?.arca || {};

  const [enabled, setEnabled] =
    useState(
      arca.enabled === true
    );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState(null);

  const completed =
    Math.max(
      0,
      numeroSeguro(
        arca.completedRequirements,
        0
      )
    );

  const total =
    Math.max(
      1,
      numeroSeguro(
        arca.requiredRequirements,
        5
      )
    );

  const ready =
    arca.status ===
    "sandbox-operativo";

  async function save() {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await fnActualizarModuloArca({
        clienteId:
          cliente.id,
        enabled,
      });

      await onDone?.({
        silent: true,
      });

      onClose?.();
    } catch (err) {
      console.error(
        "Error configurando módulo ARCA:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo actualizar el módulo ARCA."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <ModalClientHeader
        title={
          cliente.nombreNegocio ||
          "Sin nombre"
        }
        subtitle={
          cliente.email
        }
      />

      <div className="mb-4 rounded-[22px] border border-[#FFC61A]/15 bg-[#11151C] p-4 text-white">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black">
            <PaymentIcon className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#FFC61A]">
              Módulo por cliente
            </p>
            <p className="mt-1 text-sm font-black">
              Facturación ARCA
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Al habilitarlo, el administrador del negocio verá la sección ARCA y podrá completar su onboarding sin intervención manual desde este panel.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <div>
            <p className="text-sm font-black">
              Habilitar módulo ARCA
            </p>
            <p className="mt-1 text-xs text-black/45">
              El cliente lo configurará desde su POS con un usuario administrador.
            </p>
          </div>

          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              setEnabled(
                event.target.checked
              )
            }
            className="h-5 w-5 accent-[#FFC61A]"
          />
        </label>

        <div className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-black/55">
                Progreso del cliente
              </p>
              <p className="mt-1 text-sm font-black">
                {ready
                  ? "Sandbox operativo"
                  : `${completed} / ${total} requisitos`}
              </p>
            </div>

            <span
              className={
                ready
                  ? "rounded-full bg-emerald-50 px-2.5 py-1.5 text-[9px] font-black uppercase text-emerald-600"
                  : "rounded-full bg-[#FFF0BD] px-2.5 py-1.5 text-[9px] font-black uppercase text-[#9A7100]"
              }
            >
              {ready
                ? "Listo"
                : "Sandbox"}
            </span>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-black/45">
            Producción permanece bloqueada. Esta etapa no permite emitir comprobantes, obtener CAE ni cargar certificados.
          </p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-black text-black/60 transition hover:bg-black/[0.03] disabled:opacity-40"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-2xl bg-[#FFC61A] px-4 py-3 text-sm font-black text-black transition hover:bg-[#FFD248] active:scale-[0.99] disabled:opacity-45"
          >
            {saving
              ? "Guardando…"
              : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormAsistenteIa({
  cliente,
  onClose,
  onDone,
}) {
  const initialConfig =
    cliente?.asistenteIa ||
    {};

  const initialPlan =
    Object.prototype.hasOwnProperty.call(
      AI_PLAN_OPTIONS,
      initialConfig.plan
    )
      ? initialConfig.plan
      : "starter";

  const [enabled, setEnabled] =
    useState(
      initialConfig.enabled ===
      true
    );

  const [plan, setPlan] =
    useState(initialPlan);

  const [monthlyLimit, setMonthlyLimit] =
    useState(
      String(
        Math.max(
          1,
          numeroSeguro(
            initialConfig.monthlyLimit,
            AI_PLAN_OPTIONS[
              initialPlan
            ].defaultLimit
          )
        )
      )
    );

  const [enabledUntil, setEnabledUntil] =
    useState(
      isoToDateInput(
        initialConfig.enabledUntil
      )
    );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState(null);

  const usage =
    cliente?.asistenteIaUso ||
    {};

  const used =
    Math.max(
      0,
      numeroSeguro(
        usage.usadas,
        0
      )
    );

  function changePlan(
    nextPlan
  ) {
    if (
      !Object.prototype.hasOwnProperty.call(
        AI_PLAN_OPTIONS,
        nextPlan
      )
    ) {
      return;
    }

    setPlan(nextPlan);
    setMonthlyLimit(
      String(
        AI_PLAN_OPTIONS[
          nextPlan
        ].defaultLimit
      )
    );
  }

  async function save() {
    const limit =
      Number(monthlyLimit);

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 5000
    ) {
      setError(
        "El límite mensual debe estar entre 1 y 5000 consultas."
      );
      return;
    }

    let untilIso = null;

    if (enabledUntil) {
      const untilDate =
        new Date(
          `${enabledUntil}T23:59:59`
        );

      if (
        Number.isNaN(
          untilDate.getTime()
        )
      ) {
        setError(
          "La fecha de finalización no es válida."
        );
        return;
      }

      untilIso =
        untilDate.toISOString();
    }

    setSaving(true);
    setError(null);

    try {
      await fnActualizarAsistenteIa({
        clienteId:
          cliente.id,
        enabled,
        plan,
        monthlyLimit:
          limit,
        enabledUntil:
          untilIso,
      });

      await onDone?.({
        silent: true,
      });

      onClose?.();
    } catch (err) {
      console.error(
        "Error configurando asistente IA:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo actualizar el asistente IA."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <ModalClientHeader
        title={
          cliente.nombreNegocio ||
          "Sin nombre"
        }
        subtitle={
          cliente.email
        }
      />

      <div
        className="
          mb-4
          rounded-[22px]
          border
          border-[#FFC61A]/15
          bg-[#11151C]
          p-4
          text-white
        "
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black">
            <SparklesIcon className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#FFC61A]">
              Upgrade por cliente
            </p>
            <p className="mt-1 text-sm font-black">
              Asistente personal con Gemini
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Puede analizar el negocio y proponer acciones operativas. Las modificaciones sensibles siempre requieren confirmación explícita antes de ejecutarse.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <div>
            <p className="text-sm font-black">
              Habilitar asistente IA
            </p>
            <p className="mt-1 text-xs text-black/45">
              Se mostrará automáticamente dentro del POS.
            </p>
          </div>

          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              setEnabled(
                event.target.checked
              )
            }
            className="h-5 w-5 accent-[#FFC61A]"
          />
        </label>

        <div className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <label className="block text-xs font-black text-black/55">
            Plan de IA
          </label>

          <select
            value={plan}
            onChange={(event) =>
              changePlan(
                event.target.value
              )
            }
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-[#FFC61A]"
          >
            {Object.entries(
              AI_PLAN_OPTIONS
            ).map(
              ([key, option]) => (
                <option
                  key={key}
                  value={key}
                >
                  {option.label}
                </option>
              )
            )}
          </select>

          <p className="mt-2 text-xs leading-relaxed text-black/45">
            {AI_PLAN_OPTIONS[plan].description}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
            <span className="block text-xs font-black text-black/55">
              Límite mensual
            </span>
            <input
              type="number"
              min="1"
              max="5000"
              step="1"
              value={monthlyLimit}
              onChange={(event) =>
                setMonthlyLimit(
                  event.target.value
                )
              }
              className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-[#FFC61A]"
            />
          </label>

          <label className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
            <span className="block text-xs font-black text-black/55">
              Habilitado hasta
            </span>
            <input
              type="date"
              value={enabledUntil}
              onChange={(event) =>
                setEnabledUntil(
                  event.target.value
                )
              }
              className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-[#FFC61A]"
            />
            <span className="mt-1.5 block text-[10px] text-black/35">
              Vacío = sin vencimiento propio.
            </span>
          </label>
        </div>

        <div className="rounded-[20px] border border-black/[0.07] bg-[#F4F5F7] p-4 text-[#111318]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-black/55">
                Uso del mes actual
              </p>
              <p className="mt-1 text-lg font-black">
                {used} consultas
              </p>
            </div>

            <span className="rounded-full bg-[#FFF0BD] px-3 py-1.5 text-[10px] font-black uppercase text-[#8B6500]">
              {usage.periodo || "Mes actual"}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
          {error}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-bold text-black/55 transition hover:bg-black/[0.03] disabled:opacity-40"
        >
          Cancelar
        </button>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#FFC61A] px-4 py-3 text-sm font-black text-black transition hover:bg-[#FFD248] disabled:opacity-50"
        >
          {saving ? (
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          ) : (
            <SaveIcon className="h-4 w-4" />
          )}
          {saving
            ? "Guardando..."
            : "Guardar"}
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   PANEL DISPOSITIVOS
========================================================= */

function PanelDispositivos({
  cliente,
  onClientRefresh,
}) {
  const [
    dispositivos,
    setDispositivos,
  ] = useState([]);

  const [
    cargando,
    setCargando,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    maxDispositivos,
    setMaxDispositivos,
  ] = useState(
    Math.max(
      1,
      numeroSeguro(
        cliente
          .maxDispositivos,
        1
      )
    )
  );

  const [
    maxGuardado,
    setMaxGuardado,
  ] = useState(
    Math.max(
      1,
      numeroSeguro(
        cliente
          .maxDispositivos,
        1
      )
    )
  );

  const [
    guardandoLimite,
    setGuardandoLimite,
  ] = useState(false);

  const [
    accionId,
    setAccionId,
  ] = useState(null);

  const [
    cerrandoTodas,
    setCerrandoTodas,
  ] = useState(false);

  const [
    timeoutMinutos,
    setTimeoutMinutos,
  ] = useState(10);

  /* =======================================================
     CARGAR DISPOSITIVOS
  ======================================================= */

  const cargar =
    useCallback(
      async (
        silent = false
      ) => {
        if (!silent) {
          setCargando(true);
        }

        setError(null);

        try {
          const res =
            await fnListarDispositivos(
              {
                clienteId:
                  cliente.id,
              }
            );

          const data =
            res?.data ||
            {};

          setDispositivos(
            Array.isArray(
              data.dispositivos
            )
              ? data.dispositivos
              : []
          );

          const limite =
            Math.max(
              1,
              numeroSeguro(
                data.maxDispositivos,
                1
              )
            );

          setMaxDispositivos(
            limite
          );

          setMaxGuardado(
            limite
          );

          if (
            Number.isFinite(
              Number(
                data.timeoutMinutos
              )
            )
          ) {
            setTimeoutMinutos(
              Number(
                data.timeoutMinutos
              )
            );
          }
        } catch (err) {
          console.error(
            "Error cargando dispositivos:",
            err
          );

          setError(
            mensajeError(
              err,
              "No se pudieron cargar los dispositivos."
            )
          );
        } finally {
          if (!silent) {
            setCargando(
              false
            );
          }
        }
      },
      [
        cliente.id,
      ]
    );

  useEffect(() => {
    cargar();

    const refrescar =
      () => {
        if (
          typeof document !==
            "undefined" &&
          document.visibilityState ===
            "hidden"
        ) {
          return;
        }

        cargar(
          true
        );
      };

    const intervalId =
      window.setInterval(
        refrescar,
        3000
      );

    window.addEventListener(
      "focus",
      refrescar
    );

    return () => {
      window.clearInterval(
        intervalId
      );

      window.removeEventListener(
        "focus",
        refrescar
      );
    };
  }, [
    cargar,
  ]);

  /* =======================================================
     CONTADORES
  ======================================================= */

  const activos =
    dispositivos.filter(
      (device) =>
        device.activo
    );

  const historicos =
    dispositivos.filter(
      (device) =>
        !device.activo
    );

  /* =======================================================
     GUARDAR LÍMITE
  ======================================================= */

  async function guardarLimite() {
    const nuevoLimite =
      Number(
        maxDispositivos
      );

    if (
      !Number.isInteger(
        nuevoLimite
      ) ||
      nuevoLimite < 1 ||
      nuevoLimite > 10
    ) {
      setError(
        "El límite debe estar entre 1 y 10 dispositivos."
      );

      return;
    }

    if (
      nuevoLimite ===
      maxGuardado
    ) {
      return;
    }

    /*
     * Si bajamos el límite por debajo de los activos,
     * el backend cerrará automáticamente los menos recientes.
     */
    if (
      nuevoLimite <
      activos.length
    ) {
      const confirmar =
        window.confirm(
          `Hay ${activos.length} dispositivos activos y estás bajando el límite a ${nuevoLimite}.\n\nLos dispositivos que excedan el nuevo límite serán desconectados.\n\n¿Continuar?`
        );

      if (!confirmar) {
        setMaxDispositivos(
          maxGuardado
        );

        return;
      }
    }

    setGuardandoLimite(
      true
    );

    setError(null);

    try {
      await fnActualizarLimite(
        {
          clienteId:
            cliente.id,

          maxDispositivos:
            nuevoLimite,
        }
      );

      await cargar(
        true
      );

      await onClientRefresh?.();
    } catch (err) {
      console.error(
        "Error cambiando límite:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo modificar el límite de dispositivos."
        )
      );
    } finally {
      setGuardandoLimite(
        false
      );
    }
  }

  /* =======================================================
     CERRAR DISPOSITIVO
  ======================================================= */

  async function cerrarDispositivo(
    device
  ) {
    if (
      !device?.deviceId
    ) {
      return;
    }

    const confirmar =
      window.confirm(
        `¿Cerrar la sesión de "${obtenerNombreDispositivo(
          device
        )}"?`
      );

    if (!confirmar) {
      return;
    }

    setAccionId(
      device.deviceId
    );

    setError(null);

    try {
      await fnCerrarDispositivo(
        {
          clienteId:
            cliente.id,

          deviceId:
            device.deviceId,
        }
      );

      await cargar(
        true
      );

      await onClientRefresh?.();
    } catch (err) {
      console.error(
        "Error cerrando dispositivo:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo cerrar el dispositivo."
        )
      );
    } finally {
      setAccionId(
        null
      );
    }
  }

  /* =======================================================
     CERRAR TODAS
  ======================================================= */

  async function cerrarTodas() {
    const confirmar =
      window.confirm(
        `¿Cerrar todas las sesiones de ${cliente.nombreNegocio || cliente.email}?\n\nTodos los dispositivos deberán iniciar sesión nuevamente.`
      );

    if (!confirmar) {
      return;
    }

    setCerrandoTodas(
      true
    );

    setError(null);

    try {
      await fnCerrarTodasSesiones(
        {
          clienteId:
            cliente.id,
        }
      );

      await cargar(
        true
      );

      await onClientRefresh?.();
    } catch (err) {
      console.error(
        "Error cerrando todas las sesiones:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudieron cerrar todas las sesiones."
        )
      );
    } finally {
      setCerrandoTodas(
        false
      );
    }
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div>
      <ModalClientHeader
        title={
          cliente.nombreNegocio ||
          "Sin nombre"
        }
        subtitle={
          cliente.email
        }
      />

      {/* RESUMEN */}

      <div
        className="
          mb-4
          overflow-hidden
          rounded-[22px]
          bg-white
          text-[#111318]
        "
      >
        <div className="p-4">
          <div
            className="
              flex
              items-center
              justify-between
              gap-3
            "
          >
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="
                  grid
                  h-11
                  w-11
                  shrink-0
                  place-items-center
                  rounded-2xl
                  bg-[#FFF5CC]
                  text-[#9A7100]
                "
              >
                <DevicesIcon className="h-5 w-5" />
              </div>

              <div>
                <p
                  className="
                    text-[9px]
                    font-extrabold
                    uppercase
                    tracking-[0.12em]
                    text-black/35
                  "
                >
                  Uso actual
                </p>

                <p
                  className="
                    mt-0.5
                    text-lg
                    font-black
                    text-[#111318]
                  "
                >
                  {activos.length} /{" "}
                  {maxGuardado}
                </p>
              </div>
            </div>

            <span
              className={
                `
                  rounded-full
                  px-2.5
                  py-1.5
                  text-[9px]
                  font-extrabold
                  uppercase
                ` +
                (activos.length ===
                  0
                  ? `
                    bg-black/5
                    text-black/35
                  `
                  : activos.length >=
                    maxGuardado
                    ? `
                    bg-[#FFF0BD]
                    text-[#9A7100]
                  `
                    : `
                    bg-emerald-50
                    text-emerald-600
                  `)
              }
            >
              {activos.length ===
                0
                ? "Sin uso"
                : activos.length >=
                  maxGuardado
                  ? "Límite completo"
                  : "Disponible"}
            </span>
          </div>

          <div className="my-4 h-[3px] rounded-full bg-[#FFC61A]" />

          <p
            className="
              text-xs
              leading-relaxed
              text-black/45
            "
          >
            Un dispositivo se
            considera activo mientras
            siga enviando actividad.
            Si deja de responder por
            aproximadamente{" "}
            {timeoutMinutos} minutos,
            deja de ocupar un lugar.
          </p>
        </div>
      </div>

      {/* LÍMITE */}

      <div
        className="
          mb-4
          rounded-[22px]
          border
          border-white/10
          bg-[#171B23]
          p-3.5
        "
      >
        <div
          className="
            flex
            items-center
            justify-between
            gap-3
          "
        >
          <div>
            <p
              className="
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.12em]
                text-[#FFC61A]
              "
            >
              Límite de licencia
            </p>

            <p className="mt-1 text-xs text-white/40">
              Máximo de dispositivos
              simultáneos.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={
                maxDispositivos <=
                1 ||
                guardandoLimite
              }
              onClick={() =>
                setMaxDispositivos(
                  (value) =>
                    Math.max(
                      1,
                      Number(
                        value
                      ) - 1
                    )
                )
              }
              className="
                grid
                h-10
                w-10
                place-items-center
                rounded-xl
                border
                border-white/10
                bg-white/5
                text-white
                transition
                hover:border-[#FFC61A]/50
                disabled:cursor-not-allowed
                disabled:opacity-25
              "
            >
              <MinusIcon className="h-4 w-4" />
            </button>

            <div
              className="
                grid
                h-10
                min-w-[46px]
                place-items-center
                rounded-xl
                bg-[#FFC61A]
                px-3
                text-base
                font-black
                text-black
              "
            >
              {maxDispositivos}
            </div>

            <button
              type="button"
              disabled={
                maxDispositivos >=
                10 ||
                guardandoLimite
              }
              onClick={() =>
                setMaxDispositivos(
                  (value) =>
                    Math.min(
                      10,
                      Number(
                        value
                      ) + 1
                    )
                )
              }
              className="
                grid
                h-10
                w-10
                place-items-center
                rounded-xl
                border
                border-white/10
                bg-white/5
                text-white
                transition
                hover:border-[#FFC61A]/50
                disabled:cursor-not-allowed
                disabled:opacity-25
              "
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {maxDispositivos !==
          maxGuardado && (
            <button
              type="button"
              disabled={
                guardandoLimite
              }
              onClick={
                guardarLimite
              }
              className="
              mt-3
              inline-flex
              w-full
              items-center
              justify-center
              gap-2
              rounded-2xl
              bg-[#FFC61A]
              px-4
              py-3
              text-xs
              font-extrabold
              text-black
              transition
              hover:bg-[#FFD248]
              disabled:opacity-40
            "
            >
              {guardandoLimite ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                <>
                  <SaveIcon className="h-4 w-4" />
                  Guardar límite
                </>
              )}
            </button>
          )}
      </div>

      {/* ERROR */}

      {error && (
        <ErrorMessage>
          {error}
        </ErrorMessage>
      )}

      {/* CARGA */}

      {cargando ? (
        <div className="py-10 text-center">
          <div
            className="
              mx-auto
              h-8
              w-8
              animate-spin
              rounded-full
              border-2
              border-white/10
              border-t-[#FFC61A]
            "
          />

          <p className="mt-3 text-xs text-white/40">
            Cargando dispositivos…
          </p>
        </div>
      ) : (
        <>
          {/* ACTIVOS */}

          <DeviceSectionTitle
            title="Dispositivos activos"
            count={
              activos.length
            }
            active
          />

          {activos.length ===
            0 ? (
            <EmptyDevices />
          ) : (
            <div className="space-y-2">
              {activos.map(
                (device) => (
                  <DeviceCard
                    key={
                      device.deviceId
                    }
                    device={
                      device
                    }
                    loading={
                      accionId ===
                      device.deviceId
                    }
                    onClose={() =>
                      cerrarDispositivo(
                        device
                      )
                    }
                  />
                )
              )}
            </div>
          )}

          {/* HISTORIAL */}

          {historicos.length >
            0 && (
              <>
                <DeviceSectionTitle
                  title="Otros dispositivos"
                  count={
                    historicos.length
                  }
                />

                <div className="space-y-2">
                  {historicos.map(
                    (device) => (
                      <DeviceCard
                        key={
                          device.deviceId
                        }
                        device={
                          device
                        }
                        historical
                      />
                    )
                  )}
                </div>
              </>
            )}
        </>
      )}

      {/* CERRAR TODAS */}

      <div
        className="
          mt-4
          border-t
          border-white/10
          pt-4
        "
      >
        <button
          type="button"
          disabled={
            cerrandoTodas ||
            activos.length === 0
          }
          onClick={
            cerrarTodas
          }
          className="
            inline-flex
            w-full
            items-center
            justify-center
            gap-2
            rounded-2xl
            border
            border-red-400/20
            bg-red-500/10
            px-4
            py-3.5
            text-sm
            font-extrabold
            text-red-300
            transition
            hover:bg-red-500/15
            disabled:cursor-not-allowed
            disabled:opacity-30
          "
        >
          {cerrandoTodas ? (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              Cerrando sesiones…
            </>
          ) : (
            <>
              <LogoutAllIcon className="h-4 w-4" />
              Cerrar todas las sesiones
            </>
          )}
        </button>

        <p
          className="
            mt-2
            px-2
            text-center
            text-[10px]
            leading-relaxed
            text-white/25
          "
        >
          Los usuarios deberán
          volver a iniciar sesión
          para acceder nuevamente.
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   DEVICE SECTION TITLE
========================================================= */

function DeviceSectionTitle({
  title,
  count,
  active = false,
}) {
  return (
    <div
      className="
        mb-2
        mt-4
        flex
        items-center
        justify-between
        gap-3
      "
    >
      <span
        className="
          text-[9px]
          font-extrabold
          uppercase
          tracking-[0.13em]
          text-white/35
        "
      >
        {title}
      </span>

      <span
        className={
          `
            rounded-full
            px-2
            py-1
            text-[9px]
            font-extrabold
          ` +
          (active
            ? `
              bg-emerald-500/10
              text-emerald-400
            `
            : `
              bg-white/5
              text-white/35
            `)
        }
      >
        {count}
      </span>
    </div>
  );
}

/* =========================================================
   DEVICE CARD
========================================================= */

function DeviceCard({
  device,
  loading = false,
  onClose,
  historical = false,
}) {
  const activo =
    !!device.activo;

  return (
    <div
      className="
        rounded-[20px]
        border
        border-white/10
        bg-[#171B23]
        p-3.5
      "
    >
      <div className="flex items-start gap-3">
        <div
          className={
            `
              grid
              h-10
              w-10
              shrink-0
              place-items-center
              rounded-xl
            ` +
            (activo
              ? `
                bg-emerald-500/10
                text-emerald-400
              `
              : `
                bg-white/5
                text-white/30
              `)
          }
        >
          <DeviceIcon className="h-[18px] w-[18px]" />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="
              flex
              items-start
              justify-between
              gap-2
            "
          >
            <div className="min-w-0">
              <p
                className="
                  truncate
                  text-sm
                  font-extrabold
                  text-white
                "
              >
                {obtenerNombreDispositivo(
                  device
                )}
              </p>

              <div
                className="
                  mt-1
                  flex
                  items-center
                  gap-1.5
                  text-[10px]
                "
              >
                <span
                  className={
                    activo
                      ? "text-emerald-400"
                      : "text-white/35"
                  }
                >
                  {activo
                    ? "Activo"
                    : "Desconectado"}
                </span>

                <span className="text-white/15">
                  ·
                </span>

                <span className="text-white/35">
                  {tiempoRelativo(
                    device.lastSeen
                  )}
                </span>
              </div>
            </div>

            <span
              className={
                `
                  mt-0.5
                  h-2
                  w-2
                  shrink-0
                  rounded-full
                ` +
                (activo
                  ? `
                    bg-emerald-400
                    shadow-[0_0_10px_rgba(52,211,153,0.55)]
                  `
                  : `
                    bg-white/15
                  `)
              }
            />
          </div>

          <div
            className="
              mt-2
              text-[9px]
              leading-relaxed
              text-white/25
            "
          >
            Última actividad:{" "}
            {formatearFechaHora(
              device.lastSeen
            )}
          </div>

          {device.email && (
            <div
              className="
                mt-0.5
                truncate
                text-[9px]
                text-white/20
              "
            >
              {device.email}
            </div>
          )}
        </div>
      </div>

      {activo &&
        !historical &&
        onClose && (
          <button
            type="button"
            disabled={
              loading
            }
            onClick={
              onClose
            }
            className="
              mt-3
              inline-flex
              w-full
              items-center
              justify-center
              gap-2
              rounded-xl
              border
              border-red-400/15
              bg-red-500/[0.07]
              px-3
              py-2.5
              text-xs
              font-bold
              text-red-300
              transition
              hover:bg-red-500/10
              disabled:opacity-40
            "
          >
            {loading ? (
              <>
                <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                Cerrando…
              </>
            ) : (
              <>
                <LogoutIcon className="h-3.5 w-3.5" />
                Cerrar este dispositivo
              </>
            )}
          </button>
        )}
    </div>
  );
}

/* =========================================================
   EMPTY DEVICES
========================================================= */

function EmptyDevices() {
  return (
    <div
      className="
        rounded-[20px]
        border
        border-dashed
        border-white/10
        bg-white/[0.025]
        px-4
        py-7
        text-center
      "
    >
      <div
        className="
          mx-auto
          grid
          h-10
          w-10
          place-items-center
          rounded-xl
          bg-white/5
          text-white/25
        "
      >
        <DevicesIcon className="h-[18px] w-[18px]" />
      </div>

      <p
        className="
          mt-3
          text-sm
          font-bold
          text-white/55
        "
      >
        Sin dispositivos activos
      </p>

      <p
        className="
          mx-auto
          mt-1
          max-w-[270px]
          text-xs
          leading-relaxed
          text-white/30
        "
      >
        Cuando el cliente inicie
        sesión en el POS aparecerá
        automáticamente acá.
      </p>
    </div>
  );
}

/* =========================================================
   LOADING / EMPTY CLIENTS
========================================================= */

function LoadingClientes() {
  return (
    <div
      className="
        flex
        min-h-[260px]
        items-center
        justify-center
      "
    >
      <div className="text-center">
        <div
          className="
            mx-auto
            mb-3
            h-9
            w-9
            animate-spin
            rounded-full
            border-2
            border-white/15
            border-t-[#FFC61A]
          "
        />

        <p
          className="
            text-sm
            font-semibold
            text-white/55
          "
        >
          Cargando clientes…
        </p>
      </div>
    </div>
  );
}

function EmptyClientes() {
  return (
    <div
      className="
        rounded-[30px]
        border
        border-white/10
        bg-[#151A22]
        px-6
        py-14
        text-center
      "
    >
      <div
        className="
          mx-auto
          mb-4
          grid
          h-14
          w-14
          place-items-center
          rounded-2xl
          bg-white/5
          text-white/35
        "
      >
        <InboxIcon className="h-6 w-6" />
      </div>

      <h3
        className="
          text-lg
          font-extrabold
          text-white
        "
      >
        No hay clientes
      </h3>

      <p className="mt-1 text-sm text-white/45">
        No encontramos clientes
        dentro de este filtro.
      </p>
    </div>
  );
}

/* =========================================================
   STAT
========================================================= */

function Stat({
  label,
  value,
  accent,
  icon,
}) {
  return (
    <div
      className="
        rounded-[22px]
        bg-white
        px-3
        py-3.5
        text-[#111318]
        shadow-[0_16px_40px_rgba(0,0,0,0.14)]
        sm:px-4
        sm:py-4
      "
    >
      <div
        className={`
          mb-2
          flex
          items-center
          gap-1.5
          ${accent}
        `}
      >
        {icon}

        <span
          className="
            hidden
            text-[10px]
            font-extrabold
            uppercase
            tracking-[0.12em]
            sm:inline
          "
        >
          {label}
        </span>
      </div>

      <div
        className={`
          text-2xl
          font-black
          leading-none
          sm:text-3xl
          ${accent}
        `}
      >
        {value}
      </div>

      <div
        className="
          mt-1
          text-[10px]
          font-bold
          uppercase
          tracking-[0.08em]
          text-black/40
          sm:hidden
        "
      >
        {label}
      </div>
    </div>
  );
}

/* =========================================================
   INFO BOX
========================================================= */

function InfoBox({
  label,
  value,
  icon,
}) {
  return (
    <div
      className="
        rounded-2xl
        bg-[#F4F5F7]
        p-3
      "
    >
      <div
        className="
          mb-1.5
          flex
          items-center
          gap-1.5
          text-black/40
        "
      >
        {icon}

        <span
          className="
            text-[10px]
            font-bold
            uppercase
            tracking-[0.1em]
          "
        >
          {label}
        </span>
      </div>

      <div
        className="
          text-sm
          font-extrabold
          text-[#111318]
        "
      >
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   BOTONES SECUNDARIOS
========================================================= */

function SmallBtn({
  children,
  onClick,
  danger,
  icon,
  disabled = false,
}) {
  return (
    <button
      type="button"
      disabled={
        disabled
      }
      onClick={
        onClick
      }
      className={
        `
          inline-flex
          w-full
          items-center
          justify-center
          gap-2
          rounded-2xl
          px-3
          py-3
          text-xs
          font-extrabold
          transition
          active:scale-[0.98]
          disabled:cursor-not-allowed
          disabled:opacity-40
        ` +
        (danger
          ? `
            border
            border-red-200
            bg-red-50
            text-red-600
            hover:bg-red-100
          `
          : `
            bg-[#11151C]
            text-white
            hover:bg-[#1A2029]
          `)
      }
    >
      {icon}

      {children}
    </button>
  );
}

/* =========================================================
   FIELD
========================================================= */

function Field({
  label,
  children,
  hint,
}) {
  return (
    <div className="mb-4">
      <label
        className="
          mb-1.5
          block
          text-xs
          font-bold
          text-white/55
        "
      >
        {label}
      </label>

      {children}

      {hint && (
        <p
          className="
            mt-1.5
            text-[10px]
            leading-relaxed
            text-white/30
          "
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/* =========================================================
   INPUT GLOBAL
========================================================= */

const inputBase = `
  w-full
  rounded-2xl
  border
  border-white/10
  bg-[#171B23]
  px-3.5
  py-3
  text-sm
  text-white
  outline-none
  placeholder:text-white/25
  focus:border-[#FFC61A]
  focus:ring-2
  focus:ring-[#FFC61A]/10
  disabled:cursor-not-allowed
  disabled:opacity-40
  transition
`;

/* =========================================================
   CREAR CLIENTE
========================================================= */

function FormCrearCliente({
  onClose,
  onDone,
}) {
  const [
    nombreNegocio,
    setNombreNegocio,
  ] = useState("");

  const [
    email,
    setEmail,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    dias,
    setDias,
  ] = useState("30");

  const [
    maxDispositivos,
    setMaxDispositivos,
  ] = useState("1");

  const [
    error,
    setError,
  ] = useState(null);

  const [
    enviando,
    setEnviando,
  ] = useState(false);

  const [
    creado,
    setCreado,
  ] = useState(false);

  const [
    copiado,
    setCopiado,
  ] = useState(false);

  /* =======================================================
     CREAR
  ======================================================= */

  async function confirmar() {
    setError(null);

    const diasNumber =
      Number(dias);

    const devicesNumber =
      Number(
        maxDispositivos
      );

    if (
      !nombreNegocio.trim() ||
      !email.trim() ||
      !password
    ) {
      setError(
        "Completá nombre, email y contraseña."
      );

      return;
    }

    if (
      password.length < 6
    ) {
      setError(
        "La contraseña debe tener al menos 6 caracteres."
      );

      return;
    }

    if (
      !Number.isInteger(
        diasNumber
      ) ||
      diasNumber < 1
    ) {
      setError(
        "Ingresá una cantidad de días válida."
      );

      return;
    }

    if (
      !Number.isInteger(
        devicesNumber
      ) ||
      devicesNumber < 1 ||
      devicesNumber > 10
    ) {
      setError(
        "El máximo de dispositivos debe estar entre 1 y 10."
      );

      return;
    }

    setEnviando(
      true
    );

    try {
      await fnCrearCliente(
        {
          nombreNegocio:
            nombreNegocio.trim(),

          email:
            email.trim(),

          password,

          diasCubiertos:
            diasNumber,

          maxDispositivos:
            devicesNumber,
        }
      );

      await onDone({
        silent: true,
      });

      setCreado(
        true
      );
    } catch (err) {
      console.error(
        "Error creando cliente:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo crear el cliente."
        )
      );
    } finally {
      setEnviando(
        false
      );
    }
  }

  /* =======================================================
     COPIAR
  ======================================================= */

  async function copiar() {
    try {
      await navigator
        .clipboard
        .writeText(
          [
            `Email: ${email}`,
            `Contraseña: ${password}`,
            `Dispositivos permitidos: ${maxDispositivos}`,
          ].join("\n")
        );

      setCopiado(
        true
      );

      window.setTimeout(
        () => {
          setCopiado(
            false
          );
        },
        2000
      );
    } catch (err) {
      console.error(
        "No se pudo copiar:",
        err
      );
    }
  }

  /* =======================================================
     CREADO
  ======================================================= */

  if (creado) {
    return (
      <div>
        <div
          className="
            mb-4
            rounded-2xl
            border
            border-[#FFC61A]/25
            bg-[#FFC61A]/10
            p-3.5
          "
        >
          <p
            className="
              text-sm
              leading-relaxed
              text-white/65
            "
          >
            Cliente creado
            correctamente. Guardá
            estos datos ahora.
          </p>
        </div>

        <div
          className="
            mb-4
            rounded-2xl
            bg-[#171B23]
            p-4
          "
        >
          <CredentialRow
            label="Email"
            value={email}
          />

          <div className="my-3 h-px bg-white/10" />

          <CredentialRow
            label="Contraseña"
            value={password}
            highlight
          />

          <div className="my-3 h-px bg-white/10" />

          <CredentialRow
            label="Dispositivos"
            value={`${maxDispositivos} permitido${Number(
              maxDispositivos
            ) === 1
                ? ""
                : "s"
              }`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={
              copiar
            }
            className="
              rounded-2xl
              bg-[#171B23]
              py-3.5
              text-sm
              font-bold
              text-white
            "
          >
            {copiado
              ? "Copiado"
              : "Copiar datos"}
          </button>

          <PrimaryModalButton
            onClick={
              onClose
            }
          >
            Listo
          </PrimaryModalButton>
        </div>
      </div>
    );
  }

  /* =======================================================
     FORMULARIO
  ======================================================= */

  return (
    <div>
      <Field label="Nombre del negocio">
        <input
          className={
            inputBase
          }
          value={
            nombreNegocio
          }
          onChange={(e) =>
            setNombreNegocio(
              e.target.value
            )
          }
          placeholder="Almacén Don José"
        />
      </Field>

      <Field label="Email">
        <input
          type="email"
          autoComplete="email"
          className={
            inputBase
          }
          value={email}
          onChange={(e) =>
            setEmail(
              e.target.value
            )
          }
          placeholder="cliente@ejemplo.com"
        />
      </Field>

      <Field label="Contraseña inicial">
        <input
          type="text"
          autoComplete="off"
          className={
            inputBase
          }
          value={
            password
          }
          onChange={(e) =>
            setPassword(
              e.target.value
            )
          }
          placeholder="Mínimo 6 caracteres"
        />
      </Field>

      <Field label="Días de acceso iniciales">
        <input
          type="number"
          min="1"
          step="1"
          className={
            inputBase
          }
          value={dias}
          onChange={(e) =>
            setDias(
              e.target.value
            )
          }
        />
      </Field>

      <Field
        label="Dispositivos permitidos"
        hint="Para evitar compartir la licencia, lo recomendado es 1 dispositivo."
      >
        <select
          className={
            inputBase
          }
          value={
            maxDispositivos
          }
          onChange={(e) =>
            setMaxDispositivos(
              e.target.value
            )
          }
        >
          {Array.from(
            {
              length: 10,
            },
            (
              _,
              index
            ) =>
              index + 1
          ).map(
            (number) => (
              <option
                key={
                  number
                }
                value={
                  number
                }
              >
                {number}{" "}
                {number === 1
                  ? "dispositivo"
                  : "dispositivos"}
              </option>
            )
          )}
        </select>
      </Field>

      {error && (
        <ErrorMessage>
          {error}
        </ErrorMessage>
      )}

      <PrimaryModalButton
        type="button"
        onClick={
          confirmar
        }
        disabled={
          enviando ||
          !nombreNegocio.trim() ||
          !email.trim() ||
          !password.trim()
        }
      >
        {enviando
          ? "Creando…"
          : "Crear cliente"}
      </PrimaryModalButton>
    </div>
  );
}

/* =========================================================
   REGISTRAR PAGO
========================================================= */

function FormPago({
  cliente,
  onClose,
  onDone,
}) {
  const [
    monto,
    setMonto,
  ] = useState("");

  const [
    dias,
    setDias,
  ] = useState("30");

  const [
    metodo,
    setMetodo,
  ] = useState(
    "Transferencia"
  );

  const [
    enviando,
    setEnviando,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  async function confirmar() {
    const amount =
      Number(monto);

    const days =
      Number(dias);

    if (
      !Number.isFinite(
        amount
      ) ||
      amount <= 0
    ) {
      setError(
        "Ingresá un monto válido."
      );

      return;
    }

    if (
      !Number.isInteger(
        days
      ) ||
      days <= 0
    ) {
      setError(
        "Ingresá una cantidad de días válida."
      );

      return;
    }

    setError(null);
    setEnviando(true);

    try {
      await fnRegistrarPago(
        {
          clienteId:
            cliente.id,

          monto:
            amount,

          diasCubiertos:
            days,

          metodoPago:
            metodo,
        }
      );

      await onDone({
        silent: true,
      });

      onClose();
    } catch (err) {
      console.error(
        "Error registrando pago:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo registrar el pago."
        )
      );
    } finally {
      setEnviando(
        false
      );
    }
  }

  return (
    <div>
      <ModalClientHeader
        title={
          cliente.nombreNegocio ||
          "Sin nombre"
        }
        subtitle={
          cliente.email
        }
      />

      <Field label="Monto">
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          className={
            inputBase
          }
          value={monto}
          onChange={(e) =>
            setMonto(
              e.target.value
            )
          }
          placeholder="0.00"
        />
      </Field>

      <Field label="Días cubiertos">
        <input
          type="number"
          min="1"
          step="1"
          className={
            inputBase
          }
          value={dias}
          onChange={(e) =>
            setDias(
              e.target.value
            )
          }
        />
      </Field>

      <Field label="Método de pago">
        <select
          className={
            inputBase
          }
          value={
            metodo
          }
          onChange={(e) =>
            setMetodo(
              e.target.value
            )
          }
        >
          <option>
            Transferencia
          </option>

          <option>
            Efectivo
          </option>

          <option>
            Mercado Pago
          </option>

          <option>
            Otro
          </option>
        </select>
      </Field>

      {error && (
        <ErrorMessage>
          {error}
        </ErrorMessage>
      )}

      <PrimaryModalButton
        type="button"
        onClick={
          confirmar
        }
        disabled={
          enviando ||
          !monto ||
          Number(monto) <= 0
        }
      >
        {enviando
          ? "Guardando…"
          : "Confirmar pago"}
      </PrimaryModalButton>
    </div>
  );
}

/* =========================================================
   DESACTIVAR CLIENTE
========================================================= */

function FormDesactivar({
  cliente,
  onClose,
  onDone,
}) {
  const [
    motivo,
    setMotivo,
  ] = useState("");

  const [
    enviando,
    setEnviando,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  async function confirmar() {
    setEnviando(true);
    setError(null);

    try {
      await fnDesactivarCliente(
        {
          clienteId:
            cliente.id,

          motivo:
            motivo.trim(),
        }
      );

      await onDone({
        silent: true,
      });

      onClose();
    } catch (err) {
      console.error(
        "Error desactivando cliente:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo desactivar el cliente."
        )
      );
    } finally {
      setEnviando(
        false
      );
    }
  }

  return (
    <div>
      <div
        className="
          mb-4
          rounded-2xl
          border
          border-red-400/20
          bg-red-500/10
          p-3.5
        "
      >
        <p
          className="
            text-sm
            leading-relaxed
            text-white/65
          "
        >
          <strong className="text-white">
            {cliente.nombreNegocio ||
              "Este cliente"}
          </strong>{" "}
          perderá acceso
          inmediato al POS y
          sus sesiones activas
          serán cerradas.
        </p>
      </div>

      <Field label="Motivo (opcional)">
        <textarea
          className={
            inputBase
          }
          rows={3}
          value={
            motivo
          }
          onChange={(e) =>
            setMotivo(
              e.target.value
            )
          }
          placeholder="Ej: Falta de pago"
        />
      </Field>

      {error && (
        <ErrorMessage>
          {error}
        </ErrorMessage>
      )}

      <DangerModalButton
        type="button"
        onClick={
          confirmar
        }
        disabled={
          enviando
        }
      >
        {enviando
          ? "Desactivando…"
          : "Desactivar cliente"}
      </DangerModalButton>
    </div>
  );
}

/* =========================================================
   CONTRASEÑA
========================================================= */

function FormPassword({
  cliente,
  onClose,
  onDone,
}) {
  const [
    passwordNueva,
    setPasswordNueva,
  ] = useState(null);

  const [
    enviando,
    setEnviando,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    copiado,
    setCopiado,
  ] = useState(false);

  async function generar() {
    const confirmar =
      window.confirm(
        "Al generar una nueva contraseña también se cerrarán las sesiones activas de este cliente.\n\n¿Continuar?"
      );

    if (!confirmar) {
      return;
    }

    setEnviando(
      true
    );

    setError(null);

    try {
      const res =
        await fnRestablecerPassword(
          {
            clienteId:
              cliente.id,
          }
        );

      setPasswordNueva(
        res?.data
          ?.nuevaPassword ||
        null
      );

      await onDone?.({
        silent: true,
      });
    } catch (err) {
      console.error(
        "Error cambiando contraseña:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo generar la nueva contraseña."
        )
      );
    } finally {
      setEnviando(
        false
      );
    }
  }

  async function copiar() {
    if (
      !passwordNueva
    ) {
      return;
    }

    try {
      await navigator
        .clipboard
        .writeText(
          passwordNueva
        );

      setCopiado(
        true
      );

      window.setTimeout(
        () => {
          setCopiado(
            false
          );
        },
        2000
      );
    } catch (err) {
      console.error(
        "No se pudo copiar:",
        err
      );
    }
  }

  if (passwordNueva) {
    return (
      <div>
        <div
          className="
            mb-4
            rounded-2xl
            border
            border-[#FFC61A]/25
            bg-[#FFC61A]/10
            p-3.5
          "
        >
          <p className="text-sm leading-relaxed text-white/65">
            Esta contraseña se
            muestra una sola vez.
            Copiala ahora. Las
            sesiones anteriores
            fueron invalidadas.
          </p>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <code
            className="
              min-w-0
              flex-1
              break-all
              rounded-2xl
              bg-[#171B23]
              px-3.5
              py-3
              text-sm
              font-bold
              text-[#FFC61A]
            "
          >
            {passwordNueva}
          </code>

          <button
            type="button"
            onClick={
              copiar
            }
            className="
              shrink-0
              rounded-2xl
              bg-white/10
              px-3.5
              py-3
              text-xs
              font-bold
              text-white
            "
          >
            {copiado
              ? "Copiado"
              : "Copiar"}
          </button>
        </div>

        <PrimaryModalButton
          type="button"
          onClick={
            onClose
          }
        >
          Listo
        </PrimaryModalButton>
      </div>
    );
  }

  return (
    <div>
      <ModalClientHeader
        title={
          cliente.nombreNegocio ||
          "Sin nombre"
        }
        subtitle="Generación segura de contraseña"
      />

      <p
        className="
          mb-4
          text-sm
          leading-relaxed
          text-white/55
        "
      >
        La contraseña actual no
        puede visualizarse. Al
        generar una nueva también
        se cerrarán las sesiones
        existentes del cliente.
      </p>

      {error && (
        <ErrorMessage>
          {error}
        </ErrorMessage>
      )}

      <PrimaryModalButton
        type="button"
        onClick={
          generar
        }
        disabled={
          enviando
        }
      >
        {enviando
          ? "Generando…"
          : "Generar nueva contraseña"}
      </PrimaryModalButton>
    </div>
  );
}

/* =========================================================
   ELIMINAR
========================================================= */

function FormEliminar({
  cliente,
  onClose,
  onDone,
}) {
  const [
    confirmacion,
    setConfirmacion,
  ] = useState("");

  const [
    enviando,
    setEnviando,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  const nombreEsperado =
    cliente.nombreNegocio ||
    "";

  const puedeConfirmar =
    confirmacion.trim() ===
    nombreEsperado.trim();

  async function confirmar() {
    if (
      !puedeConfirmar
    ) {
      return;
    }

    setEnviando(
      true
    );

    setError(null);

    try {
      await fnEliminarCliente(
        {
          clienteId:
            cliente.id,
        }
      );

      await onDone({
        silent: true,
      });

      onClose();
    } catch (err) {
      console.error(
        "Error eliminando cliente:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo eliminar el cliente."
        )
      );
    } finally {
      setEnviando(
        false
      );
    }
  }

  return (
    <div>
      <div
        className="
          mb-4
          rounded-2xl
          border
          border-red-400/20
          bg-red-500/10
          p-3.5
        "
      >
        <p
          className="
            text-sm
            leading-relaxed
            text-white/65
          "
        >
          Esta acción es
          irreversible. Se
          eliminará el usuario,
          la licencia y sus
          dispositivos
          registrados. El
          historial de pagos se
          conserva.
        </p>
      </div>

      <Field
        label={
          <>
            Escribí{" "}
            <span className="font-bold text-white">
              {nombreEsperado}
            </span>{" "}
            para confirmar
          </>
        }
      >
        <input
          className={
            inputBase
          }
          value={
            confirmacion
          }
          onChange={(e) =>
            setConfirmacion(
              e.target.value
            )
          }
          autoComplete="off"
        />
      </Field>

      {error && (
        <ErrorMessage>
          {error}
        </ErrorMessage>
      )}

      <DangerModalButton
        type="button"
        onClick={
          confirmar
        }
        disabled={
          !puedeConfirmar ||
          enviando
        }
      >
        {enviando
          ? "Eliminando…"
          : "Eliminar definitivamente"}
      </DangerModalButton>
    </div>
  );
}

/* =========================================================
   BOTÓN PRINCIPAL
========================================================= */

function PrimaryModalButton({
  children,
  ...props
}) {
  return (
    <button
      {...props}
      type={
        props.type ||
        "button"
      }
      className="
        w-full
        rounded-2xl
        bg-[#FFC61A]
        py-3.5
        text-sm
        font-extrabold
        text-black
        transition
        hover:bg-[#FFD248]
        active:scale-[0.99]
        disabled:cursor-not-allowed
        disabled:opacity-40
      "
    >
      {children}
    </button>
  );
}

/* =========================================================
   BOTÓN PELIGRO
========================================================= */

function DangerModalButton({
  children,
  ...props
}) {
  return (
    <button
      {...props}
      type={
        props.type ||
        "button"
      }
      className="
        w-full
        rounded-2xl
        bg-red-500
        py-3.5
        text-sm
        font-extrabold
        text-white
        transition
        hover:bg-red-600
        active:scale-[0.99]
        disabled:cursor-not-allowed
        disabled:opacity-30
      "
    >
      {children}
    </button>
  );
}

/* =========================================================
   ERROR MESSAGE
========================================================= */

function ErrorMessage({
  children,
}) {
  return (
    <div
      className="
        mb-3
        flex
        items-start
        gap-2.5
        rounded-2xl
        border
        border-red-400/20
        bg-red-500/10
        px-3.5
        py-3
        text-sm
        text-red-200
      "
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />

      <span>
        {children}
      </span>
    </div>
  );
}

/* =========================================================
   CREDENTIAL ROW
========================================================= */

function CredentialRow({
  label,
  value,
  highlight,
}) {
  return (
    <div>
      <div
        className="
          text-[10px]
          font-bold
          uppercase
          tracking-[0.14em]
          text-white/35
        "
      >
        {label}
      </div>

      <div
        className={`
          mt-1
          break-all
          text-sm
          font-bold
          ${highlight
            ? "text-[#FFC61A]"
            : "text-white"
          }
        `}
      >
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   HEADER CLIENTE MODAL
========================================================= */

function ModalClientHeader({
  title,
  subtitle,
}) {
  return (
    <div
      className="
        mb-4
        rounded-2xl
        bg-[#171B23]
        p-3.5
      "
    >
      <div
        className="
          text-[10px]
          font-bold
          uppercase
          tracking-[0.14em]
          text-[#FFC61A]
        "
      >
        Cliente
      </div>

      <div
        className="
          mt-1
          font-extrabold
          text-white
        "
      >
        {title}
      </div>

      {subtitle && (
        <div
          className="
            mt-1
            truncate
            text-xs
            text-white/40
          "
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   ICONOS
========================================================= */

function CartIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="20"
        r="1"
      />

      <circle
        cx="19"
        cy="20"
        r="1"
      />

      <path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  );
}

function PlusIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function MinusIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function LogoutIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </svg>
  );
}

function LogoutAllIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 17l5-5-5-5" />
      <path d="M14 12H3" />
      <path d="M16 7h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3" />
    </svg>
  );
}

function SunIcon({
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
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({
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
      <path d="M20.7 13.3A8.3 8.3 0 1 1 10.7 3.3 6.5 6.5 0 0 0 20.7 13.3Z" />
    </svg>
  );
}

function FilterIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

function CheckIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4 4L19 7" />
    </svg>
  );
}

function ClockIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
      />

      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function PauseIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M9 7v10" />
      <path d="M15 7v10" />
    </svg>
  );
}

function AlertIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function InboxIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h16v16H4z" />
      <path d="M4 13h5l2 3h2l2-3h5" />
    </svg>
  );
}

function PaymentIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
      />

      <path d="M3 10h18" />
      <path d="M7 15h3" />
    </svg>
  );
}

function CalendarIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3v3" />
      <path d="M18 3v3" />
      <path d="M4 8h16" />
      <path d="M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function KeyIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="15"
        r="4"
      />

      <path d="m11 12 8-8" />
      <path d="M15 8l2 2" />
      <path d="M17 6l2 2" />
    </svg>
  );
}

function TrashIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 14h10l1-14" />
    </svg>
  );
}

function DevicesIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4"
        width="13"
        height="10"
        rx="2"
      />

      <path d="M7 18h5" />
      <path d="M9.5 14v4" />

      <rect
        x="17"
        y="8"
        width="4"
        height="9"
        rx="1"
      />

      <path d="M18.5 15h1" />
    </svg>
  );
}

function DeviceIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="3"
        width="16"
        height="14"
        rx="2"
      />

      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

function ChevronIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function RefreshIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.2 9a7 7 0 0 0-11.7-2.2L4 11" />
      <path d="M5.8 15a7 7 0 0 0 11.7 2.2L20 13" />
    </svg>
  );
}

function SparklesIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3-1.2 3.4a4 4 0 0 1-2.4 2.4L5 10l3.4 1.2a4 4 0 0 1 2.4 2.4L12 17l1.2-3.4a4 4 0 0 1 2.4-2.4L19 10l-3.4-1.2a4 4 0 0 1-2.4-2.4L12 3Z" />
      <path d="m5 3 .4 1.1a2 2 0 0 0 1.2 1.2L8 6l-1.4.7a2 2 0 0 0-1.2 1.2L5 9l-.4-1.1a2 2 0 0 0-1.2-1.2L2 6l1.4-.7a2 2 0 0 0 1.2-1.2L5 3Z" />
    </svg>
  );
}

function SaveIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3h12l2 2v16H5z" />
      <path d="M8 3v6h8V3" />
      <path d="M8 21v-7h8v7" />
    </svg>
  );
}

function SpinnerIcon({
  className = "",
}) {
  return (
    <svg
      className={
        className
      }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  );
}