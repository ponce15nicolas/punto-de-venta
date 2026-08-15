// src/components/Login.jsx
// Pantalla de login para el cliente final (el negocio que usa el POS).
// Solo Google Sign-In. Para que un cliente pueda entrar, su Gmail debe
// coincidir exactamente con el email cargado al crearlo desde el panel admin.

import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase/config";

export default function Login() {
    const [error, setError] = useState(null);
    const [cargando, setCargando] = useState(false);

    const handleGoogleLogin = async () => {
        setError(null);
        setCargando(true);
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            // useLicenseCheck se encarga de buscar el cliente por email y validar
        } catch (err) {
            if (err.code !== "auth/popup-closed-by-user") {
                setError("No se pudo iniciar sesión con Google.");
            }
        } finally {
            setCargando(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-bg px-4">
            <div className="w-full max-w-sm bg-white/[0.03] border border-white/10 rounded-xl p-6 text-center">
                <h1 className="text-lg font-semibold text-white mb-1">Iniciar sesión</h1>
                <p className="text-sm text-[#8B98A5] mb-6">Ingresá con la cuenta de Google de tu negocio.</p>

                {error && (
                    <p className="text-sm text-rose-300 mb-4 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                        {error}
                    </p>
                )}

                <button
                    onClick={handleGoogleLogin}
                    disabled={cargando}
                    className="w-full py-2.5 rounded-lg bg-white text-[#0F1B2B] text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    <svg width="16" height="16" viewBox="0 0 48 48">
                        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.3-.3-3.5z" />
                        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.8 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5c-7.7 0-14.4 4.4-17.7 10.8z" />
                        <path fill="#4CAF50" d="M24 44.5c5.4 0 10.3-1.9 14.1-5.1l-6.5-5.5C29.6 35.6 26.9 36.5 24 36.5c-5.3 0-9.7-3.1-11.4-7.5l-6.6 5.1C9.5 40.3 16.2 44.5 24 44.5z" />
                        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.5l6.5 5.5C41.5 36 44.5 30.5 44.5 24c0-1.2-.1-2.3-.3-3.5z" />
                    </svg>
                    {cargando ? "Ingresando…" : "Continuar con Google"}
                </button>
            </div>
        </div>
    );
}