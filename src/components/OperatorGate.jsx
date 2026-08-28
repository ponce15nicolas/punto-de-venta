// src/components/OperatorGate.jsx
//
// Control de operadores internos del comercio.
//
// Flujo:
// 1. Verifica si el negocio configuró operadores.
// 2. Si no existe configuración, permite crear el Administrador inicial.
// 3. Si ya existe, restaura y valida la sesión interna guardada.
// 4. Si no hay sesión válida, muestra selección de operador + clave.
// 5. Expone el operador autenticado mediante OperatorContext.
//
// Los roles internos pertenecen exclusivamente al comercio:
// - administrador
// - encargado
//
// No tienen relación con el panel global del proveedor.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { motion } from "motion/react";
import { httpsCallable } from "firebase/functions";

import { functions } from "../firebase/config";
import {
  browserIsOnline,
  isNetworkError,
} from "../lib/network";
import {
  clearOfflineOperatorAccess,
  readOfflineOperatorAccess,
  saveOfflineOperatorAccess,
} from "../lib/offlineAccess";

const OPERATOR_SESSION_KEY =
  "posOperatorSession";

/* =========================================================
   CLOUD FUNCTIONS
========================================================= */

const obtenerEstadoOperadoresFunction =
  httpsCallable(
    functions,
    "obtenerEstadoOperadores"
  );

const configurarAdministradorInicialFunction =
  httpsCallable(
    functions,
    "configurarAdministradorInicial"
  );

const listarOperadoresInternosFunction =
  httpsCallable(
    functions,
    "listarOperadoresInternos"
  );

const iniciarSesionOperadorFunction =
  httpsCallable(
    functions,
    "iniciarSesionOperador"
  );

const validarSesionOperadorFunction =
  httpsCallable(
    functions,
    "validarSesionOperador"
  );

const cerrarSesionOperadorFunction =
  httpsCallable(
    functions,
    "cerrarSesionOperador"
  );

const recuperarAdministradorPrincipalFunction =
  httpsCallable(
    functions,
    "recuperarAdministradorPrincipal"
  );

/* =========================================================
   CONTEXTO
========================================================= */

const OperatorContext =
  createContext(null);

export function useOperator() {
  const context =
    useContext(
      OperatorContext
    );

  if (!context) {
    throw new Error(
      "useOperator debe usarse dentro de OperatorGate."
    );
  }

  return context;
}

/* =========================================================
   SESSION STORAGE
========================================================= */

function leerSesionOperador() {
  if (
    typeof window === "undefined"
  ) {
    return null;
  }

  try {
    const raw =
      window.sessionStorage.getItem(
        OPERATOR_SESSION_KEY
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw);

    if (
      !parsed?.id ||
      !parsed?.token
    ) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error(
      "No se pudo leer la sesión interna:",
      error
    );

    return null;
  }
}

function guardarSesionOperador(
  session
) {
  if (
    typeof window === "undefined" ||
    !session?.id ||
    !session?.token
  ) {
    return;
  }

  window.sessionStorage.setItem(
    OPERATOR_SESSION_KEY,
    JSON.stringify(session)
  );
}

function borrarSesionOperador() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(OPERATOR_SESSION_KEY);
  }

  clearOfflineOperatorAccess();
}

/* =========================================================
   HELPERS
========================================================= */

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

function normalizarOperadores(
  value
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item) =>
        item?.id &&
        item?.nombre &&
        item?.activo !==
          false
    )
    .map(
      (item) => ({
        id:
          String(item.id),

        nombre:
          String(item.nombre),

        rol:
          item.rol ===
          "administrador"
            ? "administrador"
            : "encargado",

        activo:
          true,
      })
    );
}

/* =========================================================
   COMPONENTE PRINCIPAL
========================================================= */

export default function OperatorGate({
  children,
  license,
}) {
  const [
    estado,
    setEstado,
  ] = useState("cargando");

  const [
    error,
    setError,
  ] = useState(null);

  const [
    operadores,
    setOperadores,
  ] = useState([]);

  const [
    operador,
    setOperador,
  ] = useState(null);

  const [
    sesion,
    setSesion,
  ] = useState(null);

  const [
    offlineRestored,
    setOfflineRestored,
  ] = useState(false);

  const deviceId =
    license?.deviceId ||
    null;

  const sessionId =
    license?.sessionId ||
    null;

  /* =======================================================
     CARGAR OPERADORES
  ======================================================= */

  const cargarOperadores =
    useCallback(
      async () => {
        const response =
          await listarOperadoresInternosFunction();

        const lista =
          normalizarOperadores(
            response?.data
              ?.operadores
          );

        if (
          lista.length === 0
        ) {
          throw new Error(
            "No hay operadores activos configurados para este negocio."
          );
        }

        setOperadores(
          lista
        );

        setEstado(
          "login"
        );

        return lista;
      },
      []
    );

  /* =======================================================
     RESTAURAR SESIÓN
  ======================================================= */

  const restaurarSesion =
    useCallback(
      async () => {
        const offlineAccess =
          readOfflineOperatorAccess(
            deviceId
          );

        const storedSession =
          leerSesionOperador() ||
          offlineAccess?.session ||
          null;

        if (!storedSession) {
          return false;
        }

        if (!browserIsOnline()) {
          if (!offlineAccess?.operator) {
            return false;
          }

          guardarSesionOperador(
            offlineAccess.session
          );
          setSesion(offlineAccess.session);
          setOperador(offlineAccess.operator);
          setEstado("autorizado");
          setOfflineRestored(true);
          return true;
        }

        try {
          const response =
            await validarSesionOperadorFunction(
              {
                operadorSesion:
                  storedSession,

                deviceId,
              }
            );

          const currentOperator =
            response?.data
              ?.operador;

          if (
            !response?.data?.ok ||
            !currentOperator?.id
          ) {
            throw new Error(
              "La sesión interna no es válida."
            );
          }

          guardarSesionOperador(
            storedSession
          );
          saveOfflineOperatorAccess({
            session: storedSession,
            operator: currentOperator,
            deviceId,
          });

          setSesion(storedSession);
          setOperador(currentOperator);
          setEstado("autorizado");
          setOfflineRestored(false);
          return true;
        } catch (err) {
          if (
            (!browserIsOnline() ||
              isNetworkError(err)) &&
            offlineAccess?.operator
          ) {
            guardarSesionOperador(
              offlineAccess.session
            );
            setSesion(offlineAccess.session);
            setOperador(offlineAccess.operator);
            setEstado("autorizado");
            setOfflineRestored(true);
            return true;
          }

          console.warn(
            "La sesión interna guardada ya no es válida:",
            err
          );

          borrarSesionOperador();
          setOfflineRestored(false);
          setSesion(null);
          setOperador(null);
          return false;
        }
      },
      [
        deviceId,
      ]
    );

  /* =======================================================
     VERIFICAR CONFIGURACIÓN
  ======================================================= */

  const consultarEstado =
    useCallback(
      async () => {
        setError(null);
        setEstado("cargando");

        const restaurada =
          await restaurarSesion();

        if (restaurada) {
          return;
        }

        if (!browserIsOnline()) {
          setError(
            "Necesitás conectarte a Internet una vez para validar el acceso del operador."
          );
          setEstado("error");
          return;
        }

        try {
          const response =
            await obtenerEstadoOperadoresFunction();

          const configurado =
            response?.data
              ?.configurado ===
            true;

          if (!configurado) {
            borrarSesionOperador();
            setOfflineRestored(false);
            setSesion(null);
            setOperador(null);
            setOperadores([]);
            setEstado("sin-configurar");
            return;
          }

          await cargarOperadores();
        } catch (err) {
          console.error(
            "Error verificando operadores internos:",
            err
          );

          setError(
            mensajeError(
              err,
              "No se pudo verificar la configuración de acceso interno."
            )
          );
          setEstado("error");
        }
      },
      [
        cargarOperadores,
        restaurarSesion,
      ]
    );

  useEffect(() => {
    consultarEstado();
  }, [
    consultarEstado,
  ]);

  useEffect(() => {
    if (
      !offlineRestored ||
      estado !== "autorizado" ||
      typeof window === "undefined"
    ) {
      return undefined;
    }

    const revalidate = async () => {
      if (!browserIsOnline()) {
        return;
      }

      const valid =
        await restaurarSesion();

      if (valid) {
        return;
      }

      try {
        await cargarOperadores();
      } catch (err) {
        setError(
          mensajeError(
            err,
            "No se pudo revalidar el acceso interno."
          )
        );
        setEstado("error");
      }
    };

    window.addEventListener("online", revalidate);

    if (browserIsOnline()) {
      void revalidate();
    }

    return () => {
      window.removeEventListener("online", revalidate);
    };
  }, [
    offlineRestored,
    estado,
    restaurarSesion,
    cargarOperadores,
  ]);

  /* =======================================================
     ADMINISTRADOR INICIAL CREADO
  ======================================================= */

  const handleConfigured =
    useCallback(
      (payload) => {
        const newSession =
          payload?.sesion;

        const newOperator =
          payload?.operador;

        if (
          !newSession?.id ||
          !newSession?.token ||
          !newOperator?.id
        ) {
          setError(
            "El servidor no devolvió una sesión interna válida."
          );

          setEstado(
            "error"
          );

          return;
        }

        guardarSesionOperador(
          newSession
        );
        saveOfflineOperatorAccess({
          session: newSession,
          operator: newOperator,
          deviceId,
        });
        setOfflineRestored(false);

        setSesion(
          newSession
        );

        setOperador(
          newOperator
        );

        setOperadores([
          newOperator,
        ]);

        setEstado(
          "autorizado"
        );
      },
      [deviceId]
    );

  /* =======================================================
     LOGIN INTERNO COMPLETADO
  ======================================================= */

  const handleLogin =
    useCallback(
      (payload) => {
        const nextSession =
          payload?.sesion;

        const nextOperator =
          payload?.operador;

        if (
          !nextSession?.id ||
          !nextSession?.token ||
          !nextOperator?.id
        ) {
          throw new Error(
            "El servidor no devolvió una sesión interna válida."
          );
        }

        guardarSesionOperador(
          nextSession
        );
        saveOfflineOperatorAccess({
          session: nextSession,
          operator: nextOperator,
          deviceId,
        });
        setOfflineRestored(false);

        setSesion(
          nextSession
        );

        setOperador(
          nextOperator
        );

        setEstado(
          "autorizado"
        );
      },
      [deviceId]
    );

  /* =======================================================
     CERRAR SESIÓN INTERNA
  ======================================================= */

  const cerrarSesionInterna =
    useCallback(
      async () => {
        const currentSession =
          sesion ||
          leerSesionOperador();

        try {
          if (
            currentSession
              ?.id &&
            currentSession
              ?.token
          ) {
            await cerrarSesionOperadorFunction(
              {
                operadorSesion:
                  currentSession,

                deviceId,
              }
            );
          }
        } catch (err) {
          console.error(
            "Error cerrando sesión interna:",
            err
          );
        } finally {
          borrarSesionOperador();
          setOfflineRestored(false);

          setSesion(null);
          setOperador(null);
          setError(null);

          try {
            await cargarOperadores();
          } catch (err) {
            setError(
              mensajeError(
                err,
                "No se pudieron cargar los operadores."
              )
            );

            setEstado(
              "error"
            );
          }
        }
      },
      [
        cargarOperadores,
        deviceId,
        sesion,
      ]
    );

  /* =======================================================
     CONTEXTO
  ======================================================= */

  const contextValue =
    useMemo(
      () => ({
        operador,

        sesion,

        rol:
          operador?.rol ||
          null,

        esAdministrador:
          operador?.rol ===
          "administrador",

        esEncargado:
          operador?.rol ===
          "encargado",

        cerrarSesionInterna,
      }),
      [
        cerrarSesionInterna,
        operador,
        sesion,
      ]
    );

  /* =======================================================
     ESTADOS VISUALES
  ======================================================= */

  if (
    estado ===
    "cargando"
  ) {
    return (
      <OperatorLoading />
    );
  }

  if (
    estado ===
    "error"
  ) {
    return (
      <OperatorError
        message={error}
        onRetry={
          consultarEstado
        }
      />
    );
  }

  if (
    estado ===
    "sin-configurar"
  ) {
    return (
      <InitialAdminSetup
        deviceId={
          deviceId
        }
        onConfigured={
          handleConfigured
        }
      />
    );
  }

  if (
    estado ===
    "login"
  ) {
    return (
      <OperatorLogin
        operadores={
          operadores
        }
        deviceId={
          deviceId
        }
        sessionId={
          sessionId
        }
        onLogin={
          handleLogin
        }
        onReload={
          cargarOperadores
        }
      />
    );
  }

  if (
    estado !==
      "autorizado" ||
    !operador ||
    !sesion
  ) {
    return (
      <OperatorLoading />
    );
  }

  return (
    <OperatorContext.Provider
      value={contextValue}
    >
      {children}
    </OperatorContext.Provider>
  );
}

/* =========================================================
   LOGIN INTERNO
========================================================= */

function OperatorLogin({
  operadores,
  deviceId,
  sessionId,
  onLogin,
  onReload,
}) {
  const [
    operadorId,
    setOperadorId,
  ] = useState(
    operadores?.[0]?.id ||
    ""
  );

  const [
    clave,
    setClave,
  ] = useState("");

  const [
    enviando,
    setEnviando,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    mostrarRecuperacion,
    setMostrarRecuperacion,
  ] = useState(false);

  const [
    nuevaClaveAdmin,
    setNuevaClaveAdmin,
  ] = useState("");

  const [
    repetirNuevaClaveAdmin,
    setRepetirNuevaClaveAdmin,
  ] = useState("");

  const [
    recuperandoAdmin,
    setRecuperandoAdmin,
  ] = useState(false);

  const [
    recuperacionError,
    setRecuperacionError,
  ] = useState(null);

  const [
    recuperacionOk,
    setRecuperacionOk,
  ] = useState(null);

  const [
    recuperacionOperadorId,
    setRecuperacionOperadorId,
  ] = useState("");

  const [
    semillaRecuperacion,
    setSemillaRecuperacion,
  ] = useState("");

  const [
    nuevaSemillaRecuperacion,
    setNuevaSemillaRecuperacion,
  ] = useState(null);

  const administradores =
    operadores.filter(
      (item) =>
        item.rol ===
        "administrador"
    );

  const administradorDisponible =
    administradores[0] ||
    null;

  const seleccionado =
    operadores.find(
      (item) =>
        item.id ===
        operadorId
    ) ||
    null;

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (!operadorId) {
      setError(
        "Seleccioná un operador."
      );

      return;
    }

    if (
      clave.length < 6 ||
      clave.length > 72
    ) {
      setError(
        "Ingresá una clave válida."
      );

      return;
    }

    setError(null);
    setEnviando(true);

    try {
      const response =
        await iniciarSesionOperadorFunction(
          {
            operadorId,

            clave,

            deviceId:
              deviceId ||
              null,
          }
        );

      const payload =
        response?.data ||
        {};

      if (
        !payload?.ok ||
        !payload?.operador ||
        !payload?.sesion
      ) {
        throw new Error(
          "El servidor no devolvió una sesión válida."
        );
      }

      onLogin(
        payload
      );
    } catch (err) {
      console.error(
        "Error iniciando sesión interna:",
        err
      );

      setClave("");

      setError(
        mensajeError(
          err,
          "No se pudo iniciar la sesión interna."
        )
      );
    } finally {
      setEnviando(false);
    }
  }


  function abrirRecuperacionAdmin() {
    const adminSeleccionado =
      seleccionado?.rol ===
      "administrador"
        ? seleccionado
        : administradorDisponible;

    setError(null);
    setRecuperacionError(null);
    setRecuperacionOk(null);
    setNuevaSemillaRecuperacion(null);
    setSemillaRecuperacion("");
    setNuevaClaveAdmin("");
    setRepetirNuevaClaveAdmin("");
    setRecuperacionOperadorId(
      adminSeleccionado?.id ||
      administradorDisponible?.id ||
      ""
    );
    setMostrarRecuperacion(true);
  }

  function cerrarRecuperacionAdmin() {
    if (recuperandoAdmin) {
      return;
    }

    setRecuperacionError(null);
    setRecuperacionOk(null);
    setNuevaSemillaRecuperacion(null);
    setSemillaRecuperacion("");
    setRecuperacionOperadorId("");
    setNuevaClaveAdmin("");
    setRepetirNuevaClaveAdmin("");
    setMostrarRecuperacion(false);
  }

  async function handleRecuperarAdministrador(
    event
  ) {
    event.preventDefault();

    if (!recuperacionOperadorId) {
      setRecuperacionError(
        "Seleccioná el Administrador que querés recuperar."
      );

      return;
    }

    if (
      !String(
        semillaRecuperacion ||
        ""
      ).trim()
    ) {
      setRecuperacionError(
        "Ingresá la clave semilla del Administrador."
      );

      return;
    }

    if (
      nuevaClaveAdmin.length < 6 ||
      nuevaClaveAdmin.length > 72
    ) {
      setRecuperacionError(
        "La nueva clave debe tener entre 6 y 72 caracteres."
      );

      return;
    }

    if (
      nuevaClaveAdmin !==
      repetirNuevaClaveAdmin
    ) {
      setRecuperacionError(
        "Las claves no coinciden."
      );

      return;
    }

    const cleanDeviceId =
      String(
        deviceId ||
        ""
      ).trim();

    const cleanSessionId =
      String(
        sessionId ||
        ""
      ).trim();

    if (
      !cleanDeviceId ||
      !cleanSessionId
    ) {
      setRecuperacionError(
        "No se pudo validar la sesión principal de este dispositivo. Actualizá la página e intentá nuevamente."
      );

      return;
    }

    setRecuperacionError(null);
    setRecuperacionOk(null);
    setRecuperandoAdmin(true);

    try {
      const response =
        await recuperarAdministradorPrincipalFunction(
          {
            operadorId:
              recuperacionOperadorId,

            semillaRecuperacion,

            nuevaClave:
              nuevaClaveAdmin,

            deviceId:
              cleanDeviceId,

            sessionId:
              cleanSessionId,
          }
        );

      const payload =
        response?.data ||
        {};

      if (
        !payload?.ok ||
        !payload?.operador?.id
      ) {
        throw new Error(
          "El servidor no confirmó la recuperación del Administrador."
        );
      }

      if (
        !payload
          ?.nuevaSemillaRecuperacion
      ) {
        throw new Error(
          "El servidor no devolvió la nueva clave semilla."
        );
      }

      setOperadorId(
        payload.operador.id
      );

      setClave("");
      setSemillaRecuperacion("");
      setNuevaClaveAdmin("");
      setRepetirNuevaClaveAdmin("");

      setNuevaSemillaRecuperacion(
        payload
          .nuevaSemillaRecuperacion
      );

      setRecuperacionOk(
        `La clave de ${payload.operador.nombre || "Administrador"} fue actualizada. La semilla anterior ya no sirve. Guardá la nueva semilla antes de continuar.`
      );
    } catch (err) {
      console.error(
        "Error recuperando Administrador:",
        err
      );

      setRecuperacionError(
        mensajeError(
          err,
          "No se pudo recuperar la clave del Administrador."
        )
      );
    } finally {
      setRecuperandoAdmin(false);
    }
  }

  return (
    <ScreenShell>
      <motion.div
        initial={{
          opacity: 0,
          y: 12,
          scale: 0.985,
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.22,
          ease: "easeOut",
        }}
        className="
          relative
          z-10
          w-full
          max-w-[390px]
        "
      >
        <Brand />

        <div
          className="
            pos-auth-card
            overflow-hidden
            rounded-[30px]
            bg-white
            text-[#111318]
            shadow-[0_24px_70px_rgba(0,0,0,0.30)]
          "
        >
          <div className="p-5 sm:p-6">
            <div
              className="
                mx-auto
                grid
                h-14
                w-14
                place-items-center
                rounded-[20px]
                bg-[#FFF5CC]
                text-[#9A7100]
              "
            >
              <UserIcon className="h-6 w-6" />
            </div>

            <div className="mt-4 text-center">
              <span
                className="
                  inline-flex
                  items-center
                  rounded-full
                  bg-[#FFF8DD]
                  px-2.5
                  py-1
                  text-[9px]
                  font-extrabold
                  uppercase
                  tracking-[0.12em]
                  text-[#9A7100]
                "
              >
                Acceso interno
              </span>

              <h1
                className="
                  mt-3
                  text-xl
                  font-black
                  tracking-[-0.025em]
                  text-[#111318]
                "
              >
                ¿Quién está usando el POS?
              </h1>

              <p
                className="
                  mx-auto
                  mt-2
                  max-w-[320px]
                  text-sm
                  leading-relaxed
                  text-black/45
                "
              >
                Seleccioná tu usuario e ingresá tu clave para continuar.
              </p>
            </div>

            <div
              className="
                my-5
                h-[3px]
                rounded-full
                bg-[#FFC61A]
              "
            />

            {mostrarRecuperacion ? (
              <form
                onSubmit={
                  handleRecuperarAdministrador
                }
              >
                <div
                  className="
                    mb-4
                    rounded-2xl
                    border
                    border-[#F2D675]
                    bg-[#FFF8DD]
                    px-3.5
                    py-3
                  "
                >
                  <p
                    className="
                      text-xs
                      font-semibold
                      leading-relaxed
                      text-[#765700]
                    "
                  >
                    Para recuperar una clave de Administrador necesitás su clave semilla. La semilla se entrega una sola vez cuando se crea el Administrador y se renueva después de cada recuperación.
                  </p>
                </div>

                <Field
                  label="Administrador"
                >
                  <select
                    value={
                      recuperacionOperadorId
                    }
                    onChange={(
                      event
                    ) => {
                      setRecuperacionOperadorId(
                        event.target.value
                      );
                      setRecuperacionError(null);
                    }}
                    disabled={
                      recuperandoAdmin ||
                      Boolean(
                        nuevaSemillaRecuperacion
                      )
                    }
                    className={
                      inputBase
                    }
                  >
                    {administradores.map(
                      (item) => (
                        <option
                          key={item.id}
                          value={item.id}
                        >
                          {item.nombre}
                        </option>
                      )
                    )}
                  </select>
                </Field>

                <Field
                  label="Clave semilla"
                >
                  <input
                    type="text"
                    value={
                      semillaRecuperacion
                    }
                    onChange={(
                      event
                    ) => {
                      setSemillaRecuperacion(
                        event.target.value
                          .toUpperCase()
                      );
                      setRecuperacionError(null);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    disabled={
                      recuperandoAdmin ||
                      Boolean(
                        nuevaSemillaRecuperacion
                      )
                    }
                    className={
                      inputBase
                    }
                  />
                </Field>

                <Field
                  label="Nueva clave"
                >
                  <input
                    type="password"
                    value={
                      nuevaClaveAdmin
                    }
                    onChange={(
                      event
                    ) => {
                      setNuevaClaveAdmin(
                        event.target.value
                      );

                      setRecuperacionError(
                        null
                      );

                      setRecuperacionOk(
                        null
                      );
                    }}
                    autoComplete="new-password"
                    minLength={6}
                    maxLength={72}
                    placeholder="Mínimo 6 caracteres"
                    disabled={
                      recuperandoAdmin ||
                      Boolean(
                        nuevaSemillaRecuperacion
                      )
                    }
                    autoFocus
                    className={
                      inputBase
                    }
                  />
                </Field>

                <Field
                  label="Repetir nueva clave"
                >
                  <input
                    type="password"
                    value={
                      repetirNuevaClaveAdmin
                    }
                    onChange={(
                      event
                    ) => {
                      setRepetirNuevaClaveAdmin(
                        event.target.value
                      );

                      setRecuperacionError(
                        null
                      );

                      setRecuperacionOk(
                        null
                      );
                    }}
                    autoComplete="new-password"
                    minLength={6}
                    maxLength={72}
                    placeholder="Repetí la nueva clave"
                    disabled={
                      recuperandoAdmin ||
                      Boolean(
                        nuevaSemillaRecuperacion
                      )
                    }
                    className={
                      inputBase
                    }
                  />
                </Field>

                {recuperacionError && (
                  <div
                    role="alert"
                    className="
                      mb-4
                      rounded-2xl
                      border
                      border-red-200
                      bg-red-50
                      px-3.5
                      py-3
                      text-xs
                      font-semibold
                      leading-relaxed
                      text-red-600
                    "
                  >
                    {recuperacionError}
                  </div>
                )}

                {recuperacionOk && (
                  <div
                    role="status"
                    className="
                      mb-4
                      rounded-2xl
                      border
                      border-emerald-200
                      bg-emerald-50
                      px-3.5
                      py-3
                    "
                  >
                    <p
                      className="
                        text-xs
                        font-semibold
                        leading-relaxed
                        text-emerald-700
                      "
                    >
                      {recuperacionOk}
                    </p>

                    {nuevaSemillaRecuperacion && (
                      <>
                        <div
                          className="
                            mt-3
                            select-all
                            rounded-xl
                            border
                            border-emerald-200
                            bg-white
                            px-3
                            py-3
                            text-center
                            font-mono
                            text-sm
                            font-black
                            tracking-[0.08em]
                            text-[#111318]
                            break-all
                          "
                        >
                          {nuevaSemillaRecuperacion}
                        </div>

                        <p
                          className="
                            mt-2
                            text-[10px]
                            font-semibold
                            leading-relaxed
                            text-emerald-700/80
                          "
                        >
                          Esta semilla se muestra una sola vez. La anterior quedó invalidada.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {!recuperacionOk && (
                  <button
                    type="submit"
                    disabled={
                      recuperandoAdmin
                    }
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
                      shadow-[0_12px_30px_rgba(255,198,26,0.18)]
                      transition
                      hover:bg-[#FFD248]
                      active:scale-[0.99]
                      disabled:cursor-not-allowed
                      disabled:opacity-60
                    "
                  >
                    {recuperandoAdmin
                      ? "Actualizando clave..."
                      : "Crear nueva clave"}
                  </button>
                )}

                <button
                  type="button"
                  disabled={
                    recuperandoAdmin
                  }
                  onClick={
                    cerrarRecuperacionAdmin
                  }
                  className="
                    mt-2.5
                    inline-flex
                    w-full
                    items-center
                    justify-center
                    rounded-2xl
                    border
                    border-black/10
                    bg-[#F4F5F7]
                    px-4
                    py-3
                    text-xs
                    font-extrabold
                    text-black/50
                    transition
                    hover:bg-[#ECEEF1]
                    active:scale-[0.99]
                    disabled:opacity-60
                  "
                >
                  {recuperacionOk
                    ? "Ya guardé la semilla"
                    : "Cancelar"}
                </button>
              </form>
            ) : (
              <form
                onSubmit={handleSubmit}
              >
                <Field
                  label="Operador"
                >
                  <select
                    value={
                      operadorId
                    }
                    onChange={(
                      event
                    ) => {
                      setOperadorId(
                        event.target.value
                      );

                      setClave("");
                      setError(null);
                    }}
                    disabled={
                      enviando
                    }
                    className={inputBase}
                  >
                    {operadores.map(
                      (item) => (
                        <option
                          key={
                            item.id
                          }
                          value={
                            item.id
                          }
                        >
                          {item.nombre} ·{" "}
                          {item.rol ===
                          "administrador"
                            ? "Administrador"
                            : "Encargado"}
                        </option>
                      )
                    )}
                  </select>
                </Field>

                {seleccionado && (
                  <div
                    className="
                      mb-4
                      flex
                      items-center
                      justify-between
                      gap-3
                      rounded-2xl
                      bg-[#F4F5F7]
                      px-3.5
                      py-3
                    "
                  >
                    <div className="min-w-0">
                      <span
                        className="
                          block
                          truncate
                          text-sm
                          font-black
                          text-[#111318]
                        "
                      >
                        {
                          seleccionado.nombre
                        }
                      </span>

                      <span
                        className="
                          mt-0.5
                          block
                          text-[10px]
                          font-bold
                          uppercase
                          tracking-[0.08em]
                          text-black/35
                        "
                      >
                        {seleccionado.rol ===
                        "administrador"
                          ? "Administrador"
                          : "Encargado"}
                      </span>
                    </div>

                    <div
                      className="
                        grid
                        h-9
                        w-9
                        shrink-0
                        place-items-center
                        rounded-xl
                        bg-white
                        text-black/45
                      "
                    >
                      <UserSmallIcon className="h-4 w-4" />
                    </div>
                  </div>
                )}

                <Field
                  label="Clave"
                >
                  <input
                    type="password"
                    value={clave}
                    onChange={(
                      event
                    ) =>
                      setClave(
                        event.target.value
                      )
                    }
                    autoComplete="current-password"
                    minLength={6}
                    maxLength={72}
                    placeholder="Ingresá tu clave"
                    disabled={
                      enviando
                    }
                    autoFocus
                    className={
                      inputBase
                    }
                  />
                </Field>

                {error && (
                  <div
                    role="alert"
                    className="
                      mb-4
                      rounded-2xl
                      border
                      border-red-200
                      bg-red-50
                      px-3.5
                      py-3
                      text-xs
                      font-semibold
                      leading-relaxed
                      text-red-600
                    "
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    enviando ||
                    !operadorId
                  }
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
                    shadow-[0_12px_30px_rgba(255,198,26,0.18)]
                    transition
                    hover:bg-[#FFD248]
                    active:scale-[0.99]
                    disabled:cursor-not-allowed
                    disabled:opacity-60
                  "
                >
                  {enviando
                    ? "Verificando..."
                    : "Ingresar al POS"}
                </button>

                {administradorDisponible && (
                  <button
                    type="button"
                    disabled={
                      enviando
                    }
                    onClick={
                      abrirRecuperacionAdmin
                    }
                    className="
                      mt-3
                      inline-flex
                      w-full
                      items-center
                      justify-center
                      text-xs
                      font-extrabold
                      text-[#9A7100]
                      transition
                      hover:text-[#6F5200]
                      disabled:opacity-60
                    "
                  >
                    ¿Olvidaste la clave de administrador?
                  </button>
                )}

                <button
                  type="button"
                  disabled={
                    enviando
                  }
                  onClick={
                    async () => {
                      try {
                        setError(null);

                        await onReload();
                      } catch (err) {
                        setError(
                          mensajeError(
                            err,
                            "No se pudo actualizar la lista de operadores."
                          )
                        );
                      }
                    }
                  }
                  className="
                    mt-2.5
                    inline-flex
                    w-full
                    items-center
                    justify-center
                    rounded-2xl
                    border
                    border-black/10
                    bg-[#F4F5F7]
                    px-4
                    py-3
                    text-xs
                    font-extrabold
                    text-black/50
                    transition
                    hover:bg-[#ECEEF1]
                    active:scale-[0.99]
                    disabled:opacity-60
                  "
                >
                  Actualizar usuarios
                </button>
              </form>
            )}
          </div>
        </div>

        <SecurityFooter />
      </motion.div>
    </ScreenShell>
  );
}

/* =========================================================
   CONFIGURACIÓN INICIAL
========================================================= */

function InitialAdminSetup({
  deviceId,
  onConfigured,
}) {
  const [
    nombre,
    setNombre,
  ] = useState("");

  const [
    clave,
    setClave,
  ] = useState("");

  const [
    confirmarClave,
    setConfirmarClave,
  ] = useState("");

  const [
    enviando,
    setEnviando,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    configuracionPendiente,
    setConfiguracionPendiente,
  ] = useState(null);

  const [
    semillaInicial,
    setSemillaInicial,
  ] = useState(null);

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    const cleanName =
      nombre.trim();

    if (!cleanName) {
      setError(
        "Ingresá el nombre del administrador."
      );

      return;
    }

    if (
      clave.length < 6 ||
      clave.length > 72
    ) {
      setError(
        "La clave debe tener entre 6 y 72 caracteres."
      );

      return;
    }

    if (
      clave !==
      confirmarClave
    ) {
      setError(
        "Las claves no coinciden."
      );

      return;
    }

    setError(null);
    setEnviando(true);

    try {
      const response =
        await configurarAdministradorInicialFunction(
          {
            nombre:
              cleanName,

            clave,

            deviceId:
              deviceId ||
              null,
          }
        );

      const payload =
        response?.data ||
        {};

      if (
        !payload?.ok ||
        !payload?.operador ||
        !payload?.sesion ||
        !payload?.semillaRecuperacion
      ) {
        throw new Error(
          "El servidor no devolvió la configuración segura completa."
        );
      }

      setConfiguracionPendiente(
        payload
      );

      setSemillaInicial(
        payload
          .semillaRecuperacion
      );
    } catch (err) {
      console.error(
        "Error configurando administrador inicial:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo crear el administrador."
        )
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ScreenShell>
      <motion.div
        initial={{
          opacity: 0,
          y: 12,
          scale: 0.985,
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.22,
          ease: "easeOut",
        }}
        className="
          relative
          z-10
          w-full
          max-w-[390px]
        "
      >
        <Brand />

        <div
          className="
            pos-auth-card
            overflow-hidden
            rounded-[30px]
            bg-white
            text-[#111318]
            shadow-[0_24px_70px_rgba(0,0,0,0.30)]
          "
        >
          <div className="p-5 sm:p-6">
            <div
              className="
                mx-auto
                grid
                h-14
                w-14
                place-items-center
                rounded-[20px]
                bg-[#FFF5CC]
                text-[#9A7100]
              "
            >
              <AdminIcon className="h-6 w-6" />
            </div>

            <div className="mt-4 text-center">
              <span
                className="
                  inline-flex
                  items-center
                  rounded-full
                  bg-[#FFF8DD]
                  px-2.5
                  py-1
                  text-[9px]
                  font-extrabold
                  uppercase
                  tracking-[0.12em]
                  text-[#9A7100]
                "
              >
                Configuración inicial
              </span>

              <h1
                className="
                  mt-3
                  text-xl
                  font-black
                  tracking-[-0.025em]
                  text-[#111318]
                "
              >
                Creá tu acceso de administrador
              </h1>

              <p
                className="
                  mx-auto
                  mt-2
                  max-w-[320px]
                  text-sm
                  leading-relaxed
                  text-black/45
                "
              >
                Este acceso pertenece únicamente a tu negocio.
                Al crearlo, el sistema generará una clave semilla de recuperación que sólo se mostrará una vez.
              </p>
            </div>

            <div
              className="
                my-5
                h-[3px]
                rounded-full
                bg-[#FFC61A]
              "
            />

            {semillaInicial &&
            configuracionPendiente ? (
              <div>
                <div
                  className="
                    rounded-2xl
                    border
                    border-[#F2D675]
                    bg-[#FFF8DD]
                    px-3.5
                    py-3.5
                  "
                >
                  <span
                    className="
                      block
                      text-[9px]
                      font-extrabold
                      uppercase
                      tracking-[0.12em]
                      text-[#9A7100]
                    "
                  >
                    Clave semilla de recuperación
                  </span>

                  <p
                    className="
                      mt-1.5
                      text-xs
                      font-semibold
                      leading-relaxed
                      text-[#765700]
                    "
                  >
                    Guardala en un lugar seguro. La vas a necesitar si olvidás la clave de este Administrador. No podrá volver a consultarse desde el POS.
                  </p>

                  <div
                    className="
                      mt-3
                      select-all
                      rounded-xl
                      border
                      border-[#E3C45A]
                      bg-white
                      px-3
                      py-3
                      text-center
                      font-mono
                      text-sm
                      font-black
                      tracking-[0.08em]
                      text-[#111318]
                      break-all
                    "
                  >
                    {semillaInicial}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onConfigured(
                      configuracionPendiente
                    )
                  }
                  className="
                    mt-4
                    inline-flex
                    w-full
                    items-center
                    justify-center
                    rounded-2xl
                    bg-[#FFC61A]
                    px-4
                    py-3.5
                    text-sm
                    font-extrabold
                    text-black
                    shadow-[0_12px_30px_rgba(255,198,26,0.18)]
                    transition
                    hover:bg-[#FFD248]
                    active:scale-[0.99]
                  "
                >
                  Ya guardé la semilla
                </button>
              </div>
            ) : (
            <form
              onSubmit={handleSubmit}
            >
              <Field
                label="Nombre del administrador"
              >
                <input
                  type="text"
                  value={nombre}
                  onChange={(
                    event
                  ) =>
                    setNombre(
                      event.target.value
                    )
                  }
                  autoComplete="name"
                  maxLength={80}
                  placeholder="Ej: Nicolás"
                  disabled={enviando}
                  className={inputBase}
                />
              </Field>

              <Field
                label="Clave de acceso"
              >
                <input
                  type="password"
                  value={clave}
                  onChange={(
                    event
                  ) =>
                    setClave(
                      event.target.value
                    )
                  }
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={72}
                  placeholder="Mínimo 6 caracteres"
                  disabled={enviando}
                  className={inputBase}
                />
              </Field>

              <Field
                label="Repetir clave"
              >
                <input
                  type="password"
                  value={
                    confirmarClave
                  }
                  onChange={(
                    event
                  ) =>
                    setConfirmarClave(
                      event.target.value
                    )
                  }
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={72}
                  placeholder="Repetí la clave"
                  disabled={enviando}
                  className={inputBase}
                />
              </Field>

              {error && (
                <div
                  role="alert"
                  className="
                    mb-4
                    rounded-2xl
                    border
                    border-red-200
                    bg-red-50
                    px-3.5
                    py-3
                    text-xs
                    font-semibold
                    leading-relaxed
                    text-red-600
                  "
                >
                  {error}
                </div>
              )}

              <div
                className="
                  mb-4
                  flex
                  items-start
                  gap-2.5
                  rounded-2xl
                  bg-[#F4F5F7]
                  px-3.5
                  py-3
                "
              >
                <ShieldIcon
                  className="
                    mt-0.5
                    h-4
                    w-4
                    shrink-0
                    text-black/35
                  "
                />

                <p
                  className="
                    text-xs
                    leading-relaxed
                    text-black/45
                  "
                >
                  Guardá esta clave. No se almacena en texto visible
                  y no podrá consultarse desde el panel del proveedor.
                </p>
              </div>

              <button
                type="submit"
                disabled={enviando}
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
                  shadow-[0_12px_30px_rgba(255,198,26,0.18)]
                  transition
                  hover:bg-[#FFD248]
                  active:scale-[0.99]
                  disabled:cursor-not-allowed
                  disabled:opacity-60
                "
              >
                {enviando
                  ? "Creando administrador..."
                  : "Crear administrador"}
              </button>
            </form>
            )}
          </div>
        </div>

        <SecurityFooter />
      </motion.div>
    </ScreenShell>
  );
}

/* =========================================================
   CARGANDO
========================================================= */

function OperatorLoading() {
  return (
    <ScreenShell>
      <div
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
          <AdminIcon className="h-7 w-7" />
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
          Acceso interno
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
          Verificando acceso
        </h1>

        <p
          className="
            mt-2
            max-w-[300px]
            text-sm
            leading-relaxed
            text-white/40
          "
        >
          Estamos comprobando el operador autorizado en este dispositivo.
        </p>
      </div>
    </ScreenShell>
  );
}

/* =========================================================
   ERROR
========================================================= */

function OperatorError({
  message,
  onRetry,
}) {
  return (
    <ScreenShell>
      <motion.div
        initial={{
          opacity: 0,
          y: 12,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        className="
          relative
          z-10
          w-full
          max-w-[390px]
        "
      >
        <Brand />

        <div
          className="
            pos-auth-card
            rounded-[30px]
            bg-white
            p-5
            text-center
            text-[#111318]
            shadow-[0_24px_70px_rgba(0,0,0,0.30)]
            sm:p-6
          "
        >
          <div
            className="
              mx-auto
              grid
              h-14
              w-14
              place-items-center
              rounded-[20px]
              bg-red-50
              text-red-600
            "
          >
            <ShieldAlertIcon className="h-6 w-6" />
          </div>

          <h1
            className="
              mt-4
              text-xl
              font-black
            "
          >
            No pudimos verificar el acceso interno
          </h1>

          <p
            className="
              mt-2
              text-sm
              leading-relaxed
              text-black/45
            "
          >
            {message}
          </p>

          <button
            type="button"
            onClick={onRetry}
            className="
              mt-5
              inline-flex
              w-full
              items-center
              justify-center
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
            Reintentar
          </button>
        </div>
      </motion.div>
    </ScreenShell>
  );
}

/* =========================================================
   UI
========================================================= */

function ScreenShell({
  children,
}) {
  return (
    <div
      className="
        pos-auth-screen
        relative
        flex
        min-h-screen
        items-center
        justify-center
        overflow-hidden
        bg-[#0B0D12]
        px-4
        py-8
      "
    >
      <div
        className="
          pointer-events-none
          absolute
          -left-28
          -top-32
          h-[320px]
          w-[320px]
          rounded-full
          bg-[#FFC61A]/[0.045]
          blur-[90px]
        "
      />

      <div
        className="
          pointer-events-none
          absolute
          -bottom-36
          -right-28
          h-[300px]
          w-[300px]
          rounded-full
          bg-white/[0.025]
          blur-[100px]
        "
      />

      {children}
    </div>
  );
}

function Brand() {
  return (
    <div
      className="
        mb-4
        flex
        items-center
        justify-center
        gap-2
      "
    >
      <div
        className="
          grid
          h-9
          w-9
          place-items-center
          rounded-xl
          bg-[#FFC61A]
          text-black
        "
      >
        <StoreIcon className="h-4 w-4" />
      </div>

      <div className="text-left">
        <span
          className="
            block
            text-[8px]
            font-extrabold
            uppercase
            tracking-[0.16em]
            text-[#FFC61A]
          "
        >
          Punto de venta
        </span>

        <span
          className="
            mt-0.5
            block
            text-xs
            font-extrabold
            text-white
          "
        >
          Mi Negocio
        </span>
      </div>
    </div>
  );
}

function SecurityFooter() {
  return (
    <div
      className="
        mt-3
        flex
        items-center
        justify-center
        gap-1.5
        text-[9px]
        font-semibold
        text-white/25
      "
    >
      <ShieldIcon className="h-3 w-3" />
      Acceso interno protegido
    </div>
  );
}

function Field({
  label,
  children,
}) {
  return (
    <div className="mb-4">
      <label
        className="
          mb-1.5
          block
          text-xs
          font-bold
          text-black/55
        "
      >
        {label}
      </label>

      {children}
    </div>
  );
}

const inputBase = `
  w-full
  rounded-2xl
  border
  border-black/10
  bg-[#F4F5F7]
  px-3.5
  py-3
  text-sm
  font-semibold
  text-[#111318]
  outline-none
  placeholder:text-black/25
  focus:border-[#FFC61A]
  focus:ring-2
  focus:ring-[#FFC61A]/15
  transition
  disabled:cursor-not-allowed
  disabled:opacity-60
`;

/* =========================================================
   ICONOS
========================================================= */

function AdminIcon({
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
      <circle
        cx="12"
        cy="8"
        r="3"
      />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <path d="M17 8.5V6.8l1.5-.8 1.5.8v1.7l-1.5.8-1.5-.8Z" />
    </svg>
  );
}

function UserIcon({
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
      <circle
        cx="12"
        cy="8"
        r="3.5"
      />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <path d="M18 5v6" />
      <path d="M15 8h6" />
    </svg>
  );
}

function UserSmallIcon({
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
      <circle
        cx="12"
        cy="8"
        r="3"
      />
      <path d="M6 20a6 6 0 0 1 12 0" />
    </svg>
  );
}

function ShieldIcon({
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
      <path d="M12 3 19 6v5c0 4.8-2.9 8.6-7 10-4.1-1.4-7-5.2-7-10V6l7-3Z" />
      <path d="m9.5 12 1.7 1.7 3.5-3.7" />
    </svg>
  );
}

function ShieldAlertIcon({
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
      <path d="M12 3 19 6v5c0 4.8-2.9 8.6-7 10-4.1-1.4-7-5.2-7-10V6l7-3Z" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
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
