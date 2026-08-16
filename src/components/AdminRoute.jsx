// src/components/AdminRoute.jsx
// Punto de entrada del panel de administración.
// Verifica sesión de Google y autorización en Firestore.
// Mantiene la lógica original y adapta la pantalla de carga
// al mismo lenguaje visual del resto del sistema.

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import AdminLogin from "./AdminLogin";
import AdminPanel from "./AdminPanel";

export default function AdminRoute() {
    const [estado, setEstado] = useState("cargando");
    // cargando | sin-sesion | no-autorizado | autorizado

    useEffect(() => {
        return onAuthStateChanged(
            auth,
            async (user) => {
                if (!user) {
                    setEstado("sin-sesion");
                    return;
                }

                setEstado("cargando");

                try {
                    const adminRef = doc(
                        db,
                        "admins",
                        user.uid
                    );

                    const adminSnap =
                        await getDoc(adminRef);

                    if (!adminSnap.exists()) {
                        await signOut(auth);
                        setEstado("no-autorizado");
                        return;
                    }

                    setEstado("autorizado");
                } catch (error) {
                    console.error(
                        "Error verificando acceso admin:",
                        error
                    );

                    try {
                        await signOut(auth);
                    } catch (signOutError) {
                        console.error(
                            "Error cerrando sesión admin:",
                            signOutError
                        );
                    }

                    setEstado("no-autorizado");
                }
            }
        );
    }, []);

    /* =========================================================
       CARGANDO
    ========================================================= */

    if (estado === "cargando") {
        return <AdminLoading />;
    }

    /* =========================================================
       NO AUTORIZADO
    ========================================================= */

    if (estado === "no-autorizado") {
        return (
            <AdminLogin
                mensajeError="Esta cuenta de Google no está autorizada para acceder al panel."
            />
        );
    }

    /* =========================================================
       AUTORIZADO
    ========================================================= */

    if (estado === "autorizado") {
        return <AdminPanel />;
    }

    /* =========================================================
       SIN SESIÓN
    ========================================================= */

    return <AdminLogin />;
}

/* =========================================================
   LOADING ADMIN
========================================================= */

function AdminLoading() {
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
            {/* Fondo ambiental */}

            <div
                className="
          pointer-events-none
          absolute
          inset-0
          overflow-hidden
        "
                aria-hidden="true"
            >
                <div
                    className="
            absolute
            left-1/2
            top-1/2
            h-[360px]
            w-[360px]
            -translate-x-1/2
            -translate-y-1/2
            rounded-full
            bg-[#FFC61A]/[0.055]
            blur-[100px]
          "
                />
            </div>

            {/* Contenido */}

            <motion.div
                initial={{
                    opacity: 0,
                    scale: 0.96,
                    y: 8,
                }}
                animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                }}
                transition={{
                    duration: 0.28,
                    ease: "easeOut",
                }}
                className="
          relative
          z-10
          flex
          w-full
          max-w-[320px]
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
                    <ShieldIcon className="h-7 w-7" />
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
                    Panel administrativo
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
            text-sm
            leading-relaxed
            text-white/40
          "
                >
                    Estamos comprobando que tu cuenta tenga permisos de administrador.
                </p>

                <div
                    className="
            mt-5
            h-1
            w-28
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
   ICONOS INLINE
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
            <path d="M12 3 19 6v5c0 4.8-2.9 8.6-7 10-4.1-1.4-7-5.2-7-10V6l7-3Z" />
            <path d="m9.5 12 1.7 1.7 3.5-3.7" />
        </svg>
    );
}
