// src/components/AdminRoute.jsx
// Punto de entrada del panel admin. Muestra login o el panel según la sesión.
// No depende de react-router: alcanza con montar esto en App.jsx.

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase/config";
import AdminLogin from "./AdminLogin";
import AdminPanel from "./AdminPanel";

export default function AdminRoute() {
    const [user, setUser] = useState(undefined); // undefined = cargando, null = sin sesión

    useEffect(() => {
        return onAuthStateChanged(auth, (u) => setUser(u));
    }, []);

    if (user === undefined) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0F1B2B] text-[#8B98A5] text-sm">
                Cargando…
            </div>
        );
    }

    return user ? <AdminPanel /> : <AdminLogin />;
}