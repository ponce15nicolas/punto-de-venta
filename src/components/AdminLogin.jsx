// src/components/AdminLogin.jsx
// Pantalla de login exclusiva para el panel admin.

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase/config";

export default function AdminLogin() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [cargando, setCargando] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setCargando(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            // Al loguearse, App.jsx detecta el cambio de sesión y muestra AdminPanel
        } catch (err) {
            setError("Email o contraseña incorrectos.");
        } finally {
            setCargando(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0F1B2B] px-4">
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-sm bg-white/[0.03] border border-white/10 rounded-xl p-6"
            >
                <h1 className="text-lg font-semibold text-white mb-1">Panel administrativo</h1>
                <p className="text-sm text-[#8B98A5] mb-6">Ingresá con tu cuenta de admin.</p>

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Email</label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-3 mt-1 text-white outline-none focus:border-white/30"
                    required
                />

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Contraseña</label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 mt-1 text-white outline-none focus:border-white/30"
                    required
                />

                {error && <p className="text-sm text-rose-300 mb-4">{error}</p>}

                <button
                    type="submit"
                    disabled={cargando}
                    className="w-full py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-colors disabled:opacity-50"
                >
                    {cargando ? "Ingresando…" : "Ingresar"}
                </button>
            </form>
        </div>
    );
}