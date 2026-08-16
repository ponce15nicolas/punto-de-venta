// src/components/AdminLogin.jsx
// Login del panel administrativo — SOLO cuentas de Google autorizadas.
// Rediseñado con la misma identidad visual del POS.
// La verificación de "quién está autorizado" sigue ocurriendo en AdminRoute.jsx.

import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase/config";

export default function AdminLogin({ mensajeError }) {
  const [error, setError] = useState(mensajeError || null);
  const [cargando, setCargando] = useState(false);

  const handleGoogleLogin = async () => {
    setError(null);
    setCargando(true);

    try {
      const provider = new GoogleAuthProvider();

      await signInWithPopup(auth, provider);

      // AdminRoute detecta el cambio de sesión
      // y valida si la cuenta está autorizada.
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        setError(
          "No se pudo iniciar sesión con Google. Intentá de nuevo."
        );
      }
    } finally {
      setCargando(false);
    }
  };

  return (
    <div
      className="
        relative
        min-h-screen
        overflow-hidden
        bg-gradient-to-b
        from-[#0B0D12]
        via-[#10141B]
        to-[#171B23]
        px-4
        py-8
        text-white
        sm:px-6
      "
    >
      {/* LUZ DECORATIVA SUPERIOR */}

      <div
        aria-hidden="true"
        className="
          pointer-events-none
          absolute
          left-1/2
          top-[-180px]
          h-[420px]
          w-[420px]
          -translate-x-1/2
          rounded-full
          bg-[#FFC61A]/10
          blur-3xl
        "
      />

      {/* LUZ DECORATIVA INFERIOR */}

      <div
        aria-hidden="true"
        className="
          pointer-events-none
          absolute
          bottom-[-220px]
          right-[-160px]
          h-[420px]
          w-[420px]
          rounded-full
          bg-white/[0.03]
          blur-3xl
        "
      />

      <div
        className="
          relative
          z-10
          mx-auto
          flex
          min-h-[calc(100vh-4rem)]
          w-full
          max-w-[430px]
          items-center
          justify-center
        "
      >
        <div className="w-full">

          {/* =============================================
              ENCABEZADO
          ============================================= */}

          <div className="mb-7 text-center">

            <div
              className="
                mx-auto
                mb-4
                grid
                h-14
                w-14
                place-items-center
                rounded-[20px]
                bg-[#FFC61A]
                text-black
                shadow-[0_14px_36px_rgba(255,198,26,0.18)]
              "
            >
              <ShieldIcon className="h-6 w-6" />
            </div>

            <span
              className="
                block
                text-[10px]
                font-extrabold
                uppercase
                tracking-[0.22em]
                text-[#FFC61A]
              "
            >
              Consola de licencias
            </span>

            <h1
              className="
                mt-2
                text-3xl
                font-black
                tracking-[-0.03em]
                text-white
                sm:text-[34px]
              "
            >
              Panel{" "}
              <span className="text-[#FFC61A]">
                Admin
              </span>
            </h1>

            <p
              className="
                mx-auto
                mt-2
                max-w-[310px]
                text-sm
                leading-relaxed
                text-white/45
              "
            >
              Administración segura de clientes y licencias
              del sistema POS.
            </p>

          </div>

          {/* =============================================
              TARJETA PRINCIPAL
          ============================================= */}

          <div
            className="
              overflow-hidden
              rounded-[30px]
              bg-white
              text-[#111318]
              shadow-[0_24px_70px_rgba(0,0,0,0.35)]
            "
          >
            <div
              className="
                px-5
                pb-5
                pt-5
                sm:px-6
                sm:pb-6
                sm:pt-6
              "
            >

              {/* CABECERA INTERNA */}

              <div className="flex items-start gap-3">

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
                  <LockIcon className="h-5 w-5" />
                </div>

                <div className="min-w-0">

                  <p
                    className="
                      text-[10px]
                      font-extrabold
                      uppercase
                      tracking-[0.16em]
                      text-[#B98700]
                    "
                  >
                    Acceso administrativo
                  </p>

                  <h2
                    className="
                      mt-1
                      text-xl
                      font-black
                      tracking-[-0.02em]
                      text-[#111318]
                    "
                  >
                    Acceso restringido
                  </h2>

                  <p
                    className="
                      mt-1
                      text-sm
                      leading-relaxed
                      text-black/45
                    "
                  >
                    Solo pueden ingresar cuentas de Google
                    previamente autorizadas.
                  </p>

                </div>

              </div>

              {/* SEPARADOR AMARILLO */}

              <div
                className="
                  my-5
                  h-[3px]
                  rounded-full
                  bg-[#FFC61A]
                "
              />

              {/* ERROR */}

              {error && (
                <div
                  className="
                    mb-4
                    flex
                    items-start
                    gap-2.5
                    rounded-2xl
                    border
                    border-red-200
                    bg-red-50
                    px-3.5
                    py-3
                    text-sm
                    leading-relaxed
                    text-red-600
                  "
                  role="alert"
                >
                  <AlertIcon
                    className="
                      mt-0.5
                      h-4
                      w-4
                      shrink-0
                    "
                  />

                  <span>{error}</span>

                </div>
              )}

              {/* =========================================
                  BOTÓN GOOGLE
              ========================================= */}

              <button
                onClick={handleGoogleLogin}
                disabled={cargando}
                className="
                  inline-flex
                  w-full
                  items-center
                  justify-center
                  gap-3
                  rounded-2xl
                  bg-[#FFC61A]
                  px-4
                  py-4
                  text-sm
                  font-extrabold
                  text-black
                  shadow-[0_12px_30px_rgba(255,198,26,0.2)]
                  transition
                  hover:bg-[#FFD248]
                  active:scale-[0.99]
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              >

                {cargando ? (
                  <SpinnerIcon
                    className="
                      h-[18px]
                      w-[18px]
                      animate-spin
                    "
                  />
                ) : (
                  <GoogleIcon />
                )}

                {cargando
                  ? "Ingresando…"
                  : "Continuar con Google"}

              </button>

              {/* =========================================
                  AVISO DE SEGURIDAD
              ========================================= */}

              <div
                className="
                  mt-4
                  flex
                  items-start
                  gap-2
                  rounded-2xl
                  bg-[#F4F5F7]
                  px-3.5
                  py-3
                "
              >

                <InfoIcon
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
                  La autorización final de acceso se valida
                  después de iniciar sesión.
                </p>

              </div>

            </div>
          </div>

          {/* =============================================
              ESTADO INFERIOR
          ============================================= */}

          <div
            className="
              mt-5
              flex
              items-center
              justify-center
              gap-2
              text-[11px]
              font-semibold
              text-white/30
            "
          >

            <span
              className="
                h-1.5
                w-1.5
                rounded-full
                bg-emerald-500
              "
            />

            Acceso protegido con Firebase Authentication

          </div>

        </div>
      </div>
    </div>
  );
}

/* =========================================================
   GOOGLE ICON
========================================================= */

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
    >

      <path
        fill="#FFC107"
        d="
          M43.6 20.5H42V20H24v8h11.3
          C33.7 32.9 29.3 36 24 36
          c-6.6 0-12-5.4-12-12
          s5.4-12 12-12
          c3.1 0 5.8 1.1 8 3l6-6
          C34.5 5.5 29.5 3.5 24 3.5
          12.7 3.5 3.5 12.7 3.5 24
          S12.7 44.5 24 44.5
          44.5 35.3 44.5 24
          c0-1.2-.1-2.3-.3-3.5z
        "
      />

      <path
        fill="#FF3D00"
        d="
          M6.3 14.7l6.6 4.8
          C14.6 15.8 18.9 13 24 13
          c3.1 0 5.8 1.1 8 3l6-6
          C34.5 5.5 29.5 3.5 24 3.5
          c-7.7 0-14.4 4.4-17.7 10.8z
        "
      />

      <path
        fill="#4CAF50"
        d="
          M24 44.5
          c5.4 0 10.3-1.9 14.1-5.1
          l-6.5-5.5
          C29.6 35.6 26.9 36.5 24 36.5
          c-5.3 0-9.7-3.1-11.4-7.5
          l-6.6 5.1
          C9.5 40.3 16.2 44.5 24 44.5z
        "
      />

      <path
        fill="#1976D2"
        d="
          M43.6 20.5H42V20H24v8h11.3
          c-.8 2.3-2.3 4.2-4.2 5.5
          l6.5 5.5
          C41.5 36 44.5 30.5 44.5 24
          c0-1.2-.1-2.3-.3-3.5z
        "
      />

    </svg>
  );
}

/* =========================================================
   ESCUDO
========================================================= */

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

      <path
        d="
          M12 3
          5 6v5
          c0 4.7 2.8 8.4 7 10
          4.2-1.6 7-5.3 7-10
          V6l-7-3Z
        "
      />

      <path d="m9.5 12 1.7 1.7 3.6-4" />

    </svg>
  );
}

/* =========================================================
   CANDADO
========================================================= */

function LockIcon({
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

      <rect
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2"
      />

      <path
        d="
          M8 10V7
          a4 4 0 0 1 8 0
          v3
        "
      />

    </svg>
  );
}

/* =========================================================
   ALERTA
========================================================= */

function AlertIcon({
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

      <path d="M12 9v4" />

      <path d="M12 17h.01" />

      <path
        d="
          M10.3 3.9
          2.4 18
          a2 2 0 0 0 1.7 3
          h15.8
          a2 2 0 0 0 1.7-3
          L13.7 3.9
          a2 2 0 0 0-3.4 0Z
        "
      />

    </svg>
  );
}

/* =========================================================
   INFORMACIÓN
========================================================= */

function InfoIcon({
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
        cy="12"
        r="9"
      />

      <path d="M12 11v5" />

      <path d="M12 8h.01" />

    </svg>
  );
}

/* =========================================================
   LOADING
========================================================= */

function SpinnerIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >

      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />

      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

    </svg>
  );
}