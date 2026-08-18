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
              onClick={() =>
                signOut(auth)
              }
              className="
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