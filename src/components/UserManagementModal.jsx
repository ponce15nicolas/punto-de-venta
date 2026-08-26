// src/components/UserManagementModal.jsx
//
// Gestión inicial de usuarios internos del comercio.
//
// En esta etapa el Administrador puede:
// - crear nuevos Administradores;
// - crear nuevos Encargados.
//
// La autorización real se verifica también en Cloud Functions.
// Un Encargado no puede crear usuarios aunque intente invocar
// manualmente la Function.

import {
  useEffect,
  useState,
} from "react";

import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";

import { functions } from "../firebase/config";
import { useOperator } from "./OperatorGate";

const crearOperadorInternoFunction =
  httpsCallable(
    functions,
    "crearOperadorInterno"
  );

const listarOperadoresInternosFunction =
  httpsCallable(
    functions,
    "listarOperadoresInternos"
  );

const restablecerClaveOperadorInternoFunction =
  httpsCallable(
    functions,
    "restablecerClaveOperadorInterno"
  );

export default function UserManagementModal({
  open,
  onClose,
  deviceId = null,
}) {
  const {
    operador,
    sesion,
    esAdministrador,
  } = useOperator();

  const [
    nombre,
    setNombre,
  ] = useState("");

  const [
    rol,
    setRol,
  ] = useState(
    "encargado"
  );

  const [
    clave,
    setClave,
  ] = useState("");

  const [
    repetirClave,
    setRepetirClave,
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
    creado,
    setCreado,
  ] = useState(null);

  const [
    operadores,
    setOperadores,
  ] = useState([]);

  const [
    cargandoUsuarios,
    setCargandoUsuarios,
  ] = useState(false);

  const [
    resetTarget,
    setResetTarget,
  ] = useState(null);

  const [
    nuevaClave,
    setNuevaClave,
  ] = useState("");

  const [
    repetirNuevaClave,
    setRepetirNuevaClave,
  ] = useState("");

  const [
    restableciendo,
    setRestableciendo,
  ] = useState(false);

  const [
    resetError,
    setResetError,
  ] = useState(null);

  const [
    resetOk,
    setResetOk,
  ] = useState(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setError(null);
    setCreado(null);
  }, [
    open,
  ]);

  useEffect(() => {
    if (
      !open ||
      !esAdministrador
    ) {
      return undefined;
    }

    let cancelado = false;

    async function cargarUsuarios() {
      setCargandoUsuarios(true);
      setResetError(null);

      try {
        const response =
          await listarOperadoresInternosFunction();

        const lista =
          Array.isArray(
            response?.data?.operadores
          )
            ? response.data.operadores
            : [];

        if (!cancelado) {
          setOperadores(
            lista
          );
        }
      } catch (err) {
        console.error(
          "Error listando usuarios internos:",
          err
        );

        if (!cancelado) {
          setResetError(
            mensajeError(
              err,
              "No se pudieron cargar los usuarios."
            )
          );
        }
      } finally {
        if (!cancelado) {
          setCargandoUsuarios(
            false
          );
        }
      }
    }

    cargarUsuarios();

    return () => {
      cancelado = true;
    };
  }, [
    esAdministrador,
    open,
  ]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(
      event
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        onClose?.();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [
    onClose,
    open,
  ]);

  if (!open) {
    return null;
  }

  if (!esAdministrador) {
    return null;
  }

  function resetForm() {
    setNombre("");
    setRol(
      "encargado"
    );
    setClave("");
    setRepetirClave("");
    setError(null);
  }

  async function recargarUsuarios() {
    const response =
      await listarOperadoresInternosFunction();

    const lista =
      Array.isArray(
        response?.data?.operadores
      )
        ? response.data.operadores
        : [];

    setOperadores(
      lista
    );
  }

  function abrirRestablecerClave(
    target
  ) {
    if (!target?.id) {
      return;
    }

    if (
      target.rol ===
      "administrador"
    ) {
      setResetOk(
        "Las claves de Administrador sólo se recuperan con su clave semilla desde el login de usuarios."
      );

      return;
    }

    setResetTarget(
      target
    );
    setNuevaClave("");
    setRepetirNuevaClave("");
    setResetError(null);
    setResetOk(null);
  }

  function cerrarRestablecerClave() {
    if (restableciendo) {
      return;
    }

    setResetTarget(null);
    setNuevaClave("");
    setRepetirNuevaClave("");
    setResetError(null);
  }

  async function handleRestablecerClave(
    event
  ) {
    event.preventDefault();

    if (!resetTarget?.id) {
      setResetError(
        "Seleccioná un usuario."
      );

      return;
    }

    if (
      resetTarget.rol ===
      "administrador"
    ) {
      setResetError(
        "La clave de un Administrador sólo puede recuperarse con su clave semilla."
      );

      return;
    }

    if (
      nuevaClave.length < 6 ||
      nuevaClave.length > 72
    ) {
      setResetError(
        "La nueva clave debe tener entre 6 y 72 caracteres."
      );

      return;
    }

    if (
      nuevaClave !==
      repetirNuevaClave
    ) {
      setResetError(
        "Las claves no coinciden."
      );

      return;
    }

    if (
      !sesion?.id ||
      !sesion?.token
    ) {
      setResetError(
        "Tu sesión de administrador ya no es válida. Volvé a ingresar al POS."
      );

      return;
    }

    const cleanDeviceId =
      String(
        deviceId || ""
      ).trim();

    if (!cleanDeviceId) {
      setResetError(
        "No se pudo validar este dispositivo. Cerrá esta ventana e intentá nuevamente."
      );

      return;
    }

    setRestableciendo(true);
    setResetError(null);
    setResetOk(null);

    try {
      const response =
        await restablecerClaveOperadorInternoFunction(
          {
            operadorId:
              resetTarget.id,

            nuevaClave,

            operadorSesion:
              sesion,

            deviceId:
              cleanDeviceId,
          }
        );

      if (!response?.data?.ok) {
        throw new Error(
          "El servidor no confirmó el cambio de clave."
        );
      }

      const nombreActual =
        resetTarget.nombre;

      const sesionActualRevocada =
        response?.data
          ?.sesionActualRevocada ===
        true;

      setResetTarget(null);
      setNuevaClave("");
      setRepetirNuevaClave("");

      if (sesionActualRevocada) {
        window.location.reload();

        return;
      }

      setResetOk(
        `Clave de ${nombreActual} restablecida correctamente.`
      );

      await recargarUsuarios();
    } catch (err) {
      console.error(
        "Error restableciendo clave interna:",
        err
      );

      setResetError(
        mensajeError(
          err,
          "No se pudo restablecer la clave."
        )
      );
    } finally {
      setRestableciendo(
        false
      );
    }
  }

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    const cleanName =
      nombre.trim();

    if (!cleanName) {
      setError(
        "Ingresá el nombre del usuario."
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
      repetirClave
    ) {
      setError(
        "Las claves no coinciden."
      );

      return;
    }

    if (
      !sesion?.id ||
      !sesion?.token
    ) {
      setError(
        "Tu sesión de administrador ya no es válida. Volvé a ingresar al POS."
      );

      return;
    }

    setError(null);
    setCreado(null);
    setEnviando(true);

    try {
      const response =
        await crearOperadorInternoFunction(
          {
            nombre:
              cleanName,

            rol,

            clave,

            operadorSesion:
              sesion,

            deviceId:
              String(
                deviceId || ""
              ).trim() ||
              undefined,
          }
        );

      const nextOperator =
        response?.data
          ?.operador;

      if (
        !response?.data?.ok ||
        !nextOperator?.id
      ) {
        throw new Error(
          "El servidor no devolvió el usuario creado."
        );
      }

      setCreado({
        ...nextOperator,

        semillaRecuperacion:
          response?.data
            ?.semillaRecuperacion ||
          null,
      });

      resetForm();

      await recargarUsuarios();
    } catch (err) {
      console.error(
        "Error creando usuario interno:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo crear el usuario."
        )
      );
    } finally {
      setEnviando(
        false
      );
    }
  }

  return createPortal(
    <div
      className="
        pos-user-management-overlay
        fixed
        inset-0
        z-[120]
        flex
        items-end
        justify-center
        bg-black/70
        p-0
        backdrop-blur-sm
        sm:items-center
        sm:p-4
      "
      role="dialog"
      aria-modal="true"
      aria-label="Gestión de usuarios"
      onMouseDown={(
        event
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose?.();
        }
      }}
    >
      <motion.div
        initial={{
          opacity: 0,
          y: 24,
          scale: 0.985,
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.18,
          ease: "easeOut",
        }}
        className="
          pos-user-management-panel
          max-h-[92dvh]
          w-full
          max-w-[440px]
          overflow-y-auto
          overscroll-contain
          rounded-t-[28px]
          border
          border-white/10
          bg-[#11151C]
          shadow-[0_30px_90px_rgba(0,0,0,0.55)]
          sm:rounded-[28px]
        "
      >
        <div
          className="
            pos-user-management-header
            sticky
            top-0
            z-10
            flex
            items-center
            justify-between
            gap-3
            border-b
            border-white/10
            bg-[#11151C]/95
            px-5
            py-4
            backdrop-blur-xl
          "
        >
          <div className="min-w-0">
            <span
              className="
                block
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.16em]
                text-[#FFC61A]
              "
            >
              Administración
            </span>

            <h2
              className="
                mt-0.5
                text-lg
                font-black
                text-white
              "
            >
              Usuarios del negocio
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="
              grid
              h-9
              w-9
              shrink-0
              place-items-center
              rounded-xl
              border
              border-white/10
              bg-white/[0.04]
              text-white/45
              transition
              hover:bg-white/[0.08]
              hover:text-white
              active:scale-[0.97]
            "
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-5">
          <div
            className="
              mb-5
              flex
              items-center
              gap-3
              rounded-2xl
              border
              border-[#FFC61A]/15
              bg-[#FFC61A]/[0.07]
              px-3.5
              py-3
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
                bg-[#FFC61A]
                text-black
              "
            >
              <AdminIcon className="h-4.5 w-4.5" />
            </div>

            <div className="min-w-0">
              <span
                className="
                  block
                  truncate
                  text-sm
                  font-black
                  text-white
                "
              >
                {operador?.nombre}
              </span>

              <span
                className="
                  mt-0.5
                  block
                  text-[9px]
                  font-bold
                  uppercase
                  tracking-[0.1em]
                  text-[#FFC61A]
                "
              >
                Administrador activo
              </span>
            </div>
          </div>

          <div className="mb-5">
            <div
              className="
                mb-2.5
                flex
                items-end
                justify-between
                gap-3
              "
            >
              <div>
                <h3
                  className="
                    text-sm
                    font-black
                    text-white
                  "
                >
                  Usuarios
                </h3>

                <p
                  className="
                    mt-1
                    text-xs
                    leading-relaxed
                    text-white/35
                  "
                >
                  Restablecé la clave de un usuario cuando sea necesario.
                </p>
              </div>

              <span
                className="
                  shrink-0
                  rounded-full
                  border
                  border-white/10
                  bg-white/5
                  px-2.5
                  py-1
                  text-[9px]
                  font-bold
                  text-white/40
                "
              >
                {operadores.length}
              </span>
            </div>

            {resetOk && (
              <div
                className="
                  mb-3
                  rounded-2xl
                  border
                  border-emerald-400/20
                  bg-emerald-500/10
                  px-3.5
                  py-3
                  text-xs
                  font-semibold
                  text-emerald-400
                "
              >
                {resetOk}
              </div>
            )}

            {cargandoUsuarios ? (
              <div
                className="
                  rounded-2xl
                  border
                  border-white/10
                  bg-white/[0.035]
                  px-3.5
                  py-4
                  text-xs
                  font-semibold
                  text-white/35
                "
              >
                Cargando usuarios...
              </div>
            ) : (
              <div className="space-y-2">
                {operadores.map(
                  (item) => (
                    <div
                      key={item.id}
                      className="
                        flex
                        items-center
                        justify-between
                        gap-3
                        rounded-2xl
                        border
                        border-white/[0.07]
                        bg-white/[0.035]
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
                            text-white
                          "
                        >
                          {item.nombre}
                        </span>

                        <span
                          className="
                            mt-0.5
                            block
                            text-[9px]
                            font-bold
                            uppercase
                            tracking-[0.1em]
                            text-white/35
                          "
                        >
                          {item.rol ===
                          "administrador"
                            ? "Administrador"
                            : "Encargado"}
                          {item.id ===
                          operador?.id
                            ? " · Tu usuario"
                            : ""}
                        </span>
                      </div>

                      {item.rol ===
                      "administrador" ? (
                        <span
                          className="
                            shrink-0
                            rounded-xl
                            border
                            border-white/10
                            bg-white/[0.04]
                            px-3
                            py-2
                            text-[9px]
                            font-extrabold
                            text-white/35
                          "
                        >
                          Usa semilla
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            abrirRestablecerClave(
                              item
                            )
                          }
                          className="
                            shrink-0
                            rounded-xl
                            border
                            border-[#FFC61A]/20
                            bg-[#FFC61A]/10
                            px-3
                            py-2
                            text-[10px]
                            font-extrabold
                            text-[#FFC61A]
                            transition
                            hover:bg-[#FFC61A]/15
                            active:scale-[0.98]
                          "
                        >
                          Restablecer clave
                        </button>
                      )}
                    </div>
                  )
                )}

                {operadores.length ===
                  0 && (
                  <div
                    className="
                      rounded-2xl
                      border
                      border-white/10
                      bg-white/[0.035]
                      px-3.5
                      py-4
                      text-xs
                      font-semibold
                      text-white/35
                    "
                  >
                    No hay usuarios disponibles.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mb-4">
            <h3
              className="
                text-sm
                font-black
                text-white
              "
            >
              Crear usuario
            </h3>

            <p
              className="
                mt-1
                text-xs
                leading-relaxed
                text-white/35
              "
            >
              El usuario podrá identificarse con su nombre y clave al ingresar al POS. Los Administradores reciben además una clave semilla de recuperación.
            </p>
          </div>

          {creado && (
            <div
              className="
                mb-4
                rounded-2xl
                border
                border-emerald-400/20
                bg-emerald-500/10
                px-3.5
                py-3
              "
            >
              <span
                className="
                  block
                  text-xs
                  font-black
                  text-emerald-400
                "
              >
                Usuario creado correctamente
              </span>

              <span
                className="
                  mt-1
                  block
                  text-xs
                  text-white/45
                "
              >
                {creado.nombre} ·{" "}
                {creado.rol ===
                "administrador"
                  ? "Administrador"
                  : "Encargado"}
              </span>

              {creado.rol ===
                "administrador" &&
                creado
                  .semillaRecuperacion && (
                  <div
                    className="
                      mt-3
                      rounded-xl
                      border
                      border-[#FFC61A]/25
                      bg-[#FFC61A]/10
                      px-3
                      py-3
                    "
                  >
                    <span
                      className="
                        block
                        text-[9px]
                        font-extrabold
                        uppercase
                        tracking-[0.12em]
                        text-[#FFC61A]
                      "
                    >
                      Clave semilla · guardala ahora
                    </span>

                    <div
                      className="
                        mt-2
                        select-all
                        rounded-lg
                        bg-black/25
                        px-2.5
                        py-2.5
                        text-center
                        font-mono
                        text-[11px]
                        font-black
                        tracking-[0.08em]
                        text-white
                        break-all
                      "
                    >
                      {creado
                        .semillaRecuperacion}
                    </div>

                    <p
                      className="
                        mt-2
                        text-[10px]
                        font-semibold
                        leading-relaxed
                        text-white/45
                      "
                    >
                      Se muestra una sola vez. Permitirá recuperar la clave de este Administrador si la olvida.
                    </p>
                  </div>
                )}
            </div>
          )}

          <form
            onSubmit={
              handleSubmit
            }
          >
            <Field
              label="Nombre"
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
                maxLength={80}
                autoComplete="off"
                placeholder="Ej: Juan"
                disabled={
                  enviando
                }
                className={
                  inputBase
                }
              />
            </Field>

            <Field
              label="Rol"
            >
              <select
                value={rol}
                onChange={(
                  event
                ) =>
                  setRol(
                    event.target.value
                  )
                }
                disabled={
                  enviando
                }
                className={
                  inputBase
                }
              >
                <option value="encargado">
                  Encargado
                </option>

                <option value="administrador">
                  Administrador
                </option>
              </select>
            </Field>

            <RoleInfo
              rol={rol}
            />

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
                minLength={6}
                maxLength={72}
                autoComplete="new-password"
                placeholder="Mínimo 6 caracteres"
                disabled={
                  enviando
                }
                className={
                  inputBase
                }
              />
            </Field>

            <Field
              label="Repetir clave"
            >
              <input
                type="password"
                value={
                  repetirClave
                }
                onChange={(
                  event
                ) =>
                  setRepetirClave(
                    event.target.value
                  )
                }
                minLength={6}
                maxLength={72}
                autoComplete="new-password"
                placeholder="Repetí la clave"
                disabled={
                  enviando
                }
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
                  border-red-400/20
                  bg-red-500/10
                  px-3.5
                  py-3
                  text-xs
                  font-semibold
                  leading-relaxed
                  text-red-400
                "
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={
                enviando
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
                shadow-[0_12px_30px_rgba(255,198,26,0.15)]
                transition
                hover:bg-[#FFD248]
                active:scale-[0.99]
                disabled:cursor-not-allowed
                disabled:opacity-60
              "
            >
              {enviando
                ? "Creando usuario..."
                : "Crear usuario"}
            </button>
          </form>
        </div>
      </motion.div>

      {resetTarget && (
        <div
          className="
            fixed
            inset-0
            z-[140]
            flex
            items-end
            justify-center
            bg-black/75
            p-0
            backdrop-blur-sm
            sm:items-center
            sm:p-4
          "
          role="dialog"
          aria-modal="true"
          aria-label="Restablecer clave"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              cerrarRestablecerClave();
            }
          }}
        >
          <motion.div
            initial={{
              opacity: 0,
              y: 18,
              scale: 0.985,
            }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            transition={{
              duration: 0.16,
              ease: "easeOut",
            }}
            className="
              pos-user-management-panel
              w-full
              max-w-[420px]
              rounded-t-[28px]
              border
              border-white/10
              bg-[#11151C]
              p-5
              pb-[calc(2rem+env(safe-area-inset-bottom))]
              shadow-[0_30px_90px_rgba(0,0,0,0.6)]
              sm:rounded-[28px]
              sm:pb-5
            "
          >
            <div
              className="
                flex
                items-start
                justify-between
                gap-3
              "
            >
              <div className="min-w-0">
                <span
                  className="
                    block
                    text-[9px]
                    font-extrabold
                    uppercase
                    tracking-[0.16em]
                    text-[#FFC61A]
                  "
                >
                  Seguridad
                </span>

                <h3
                  className="
                    mt-1
                    text-lg
                    font-black
                    text-white
                  "
                >
                  Restablecer clave
                </h3>

                <p
                  className="
                    mt-1
                    text-xs
                    leading-relaxed
                    text-white/40
                  "
                >
                  Nueva clave para {resetTarget.nombre}.
                </p>
              </div>

              <button
                type="button"
                onClick={
                  cerrarRestablecerClave
                }
                disabled={
                  restableciendo
                }
                aria-label="Cerrar"
                className="
                  grid
                  h-9
                  w-9
                  shrink-0
                  place-items-center
                  rounded-xl
                  border
                  border-white/10
                  bg-white/[0.04]
                  text-white/45
                  transition
                  hover:bg-white/[0.08]
                  hover:text-white
                  disabled:opacity-50
                "
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            {resetTarget.id ===
              operador?.id && (
              <div
                className="
                  mt-4
                  rounded-2xl
                  border
                  border-[#FFC61A]/20
                  bg-[#FFC61A]/10
                  px-3.5
                  py-3
                  text-xs
                  font-semibold
                  leading-relaxed
                  text-[#FFC61A]
                "
              >
                Estás cambiando tu propia clave. Al confirmar tendrás que ingresar nuevamente con tu usuario interno.
              </div>
            )}

            <form
              onSubmit={
                handleRestablecerClave
              }
              className="mt-4"
            >
              <Field label="Nueva clave">
                <input
                  type="password"
                  value={
                    nuevaClave
                  }
                  onChange={(
                    event
                  ) =>
                    setNuevaClave(
                      event.target.value
                    )
                  }
                  minLength={6}
                  maxLength={72}
                  autoComplete="new-password"
                  placeholder="Mínimo 6 caracteres"
                  disabled={
                    restableciendo
                  }
                  className={
                    inputBase
                  }
                />
              </Field>

              <Field label="Repetir nueva clave">
                <input
                  type="password"
                  value={
                    repetirNuevaClave
                  }
                  onChange={(
                    event
                  ) =>
                    setRepetirNuevaClave(
                      event.target.value
                    )
                  }
                  minLength={6}
                  maxLength={72}
                  autoComplete="new-password"
                  placeholder="Repetí la nueva clave"
                  disabled={
                    restableciendo
                  }
                  className={
                    inputBase
                  }
                />
              </Field>

              {resetError && (
                <div
                  role="alert"
                  className="
                    mb-4
                    rounded-2xl
                    border
                    border-red-400/20
                    bg-red-500/10
                    px-3.5
                    py-3
                    text-xs
                    font-semibold
                    leading-relaxed
                    text-red-400
                  "
                >
                  {resetError}
                </div>
              )}

              <div
                className="
                  grid
                  grid-cols-2
                  gap-2.5
                "
              >
                <button
                  type="button"
                  onClick={
                    cerrarRestablecerClave
                  }
                  disabled={
                    restableciendo
                  }
                  className="
                    rounded-2xl
                    border
                    border-white/10
                    bg-white/5
                    px-4
                    py-3.5
                    text-sm
                    font-extrabold
                    text-white/70
                    transition
                    hover:bg-white/10
                    disabled:opacity-50
                  "
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={
                    restableciendo
                  }
                  className="
                    rounded-2xl
                    bg-[#FFC61A]
                    px-4
                    py-3.5
                    text-sm
                    font-extrabold
                    text-black
                    transition
                    hover:bg-[#FFD248]
                    disabled:opacity-60
                  "
                >
                  {restableciendo
                    ? "Guardando..."
                    : "Cambiar clave"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>,
    document.body
  );
}

function RoleInfo({
  rol,
}) {
  return (
    <div
      className="
        mb-4
        rounded-2xl
        border
        border-white/[0.07]
        bg-white/[0.035]
        px-3.5
        py-3
      "
    >
      <span
        className="
          block
          text-[9px]
          font-extrabold
          uppercase
          tracking-[0.12em]
          text-white/30
        "
      >
        Permisos
      </span>

      <p
        className="
          mt-1
          text-xs
          leading-relaxed
          text-white/50
        "
      >
        {rol ===
        "administrador"
          ? "Acceso completo y gestión de usuarios. Al crearlo se genera una clave semilla de recuperación que se muestra una sola vez."
          : "Operación del POS sin gestión de usuarios ni eliminación de cierres históricos."}
      </p>
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
          text-white/55
        "
      >
        {label}
      </label>

      {children}
    </div>
  );
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

const inputBase = `
  w-full
  rounded-2xl
  border
  border-white/10
  bg-[#171B23]
  px-3.5
  py-3
  text-sm
  font-semibold
  text-white
  outline-none
  placeholder:text-white/25
  focus:border-[#FFC61A]
  focus:ring-2
  focus:ring-[#FFC61A]/10
  transition
  disabled:cursor-not-allowed
  disabled:opacity-60
`;

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
    </svg>
  );
}

function CloseIcon({
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
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}
