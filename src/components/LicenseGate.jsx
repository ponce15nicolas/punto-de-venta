// src/components/LicenseGate.jsx
// Envolvé tu POS con este componente. Si la licencia no está activa,
// muestra una pantalla de bloqueo en vez del sistema de ventas.
//
// Uso en App.jsx:
//   <LicenseGate>
//     <TuPOS />
//   </LicenseGate>

import { useLicenseCheck } from "../hooks/useLicenseCheck";
import Login from "./Login";

const MENSAJES = {
    inactivo: {
        titulo: "Cuenta desactivada",
        texto: "Tu acceso al sistema fue desactivado. Contactá a soporte para más información.",
    },
    vencido: {
        titulo: "Suscripción vencida",
        texto: "Tu período de pago venció. Regularizá tu situación para seguir usando el POS.",
    },
};

export default function LicenseGate({ children }) {
    const { estado, bloqueado, cerrarSesion } = useLicenseCheck();

    if (estado === "cargando") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0F1B2B] text-[#8B98A5] text-sm">
                Verificando licencia…
            </div>
        );
    }

    if (estado === "sin-sesion") {
        return <Login />;
    }

    if (bloqueado) {
        const msg = MENSAJES[estado] || MENSAJES.inactivo;
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0F1B2B] px-4">
                <div className="max-w-sm text-center">
                    <h1 className="text-lg font-semibold text-white mb-2">{msg.titulo}</h1>
                    <p className="text-sm text-[#8B98A5] mb-6">{msg.texto}</p>
                    <button
                        onClick={cerrarSesion}
                        className="px-4 py-2 text-sm rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
                    >
                        Cerrar sesión
                    </button>
                </div>
            </div>
        );
    }

    return children;
}