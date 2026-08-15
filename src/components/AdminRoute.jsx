// src/components/AdminRoute.jsx
// Punto de entrada del panel admin. Ahora, además de pedir sesión de Google,
// verifica contra Firestore (colección "admins") que esa cuenta específica
// esté autorizada. Si no lo está, se desloguea automáticamente y no llega
// a ver el panel ni sus datos.

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import AdminLogin from "./AdminLogin";
import AdminPanel from "./AdminPanel";

export default function AdminRoute() {
    const [estado, setEstado] = useState("cargando"); // cargando | sin-sesion | no-autorizado | autorizado

    useEffect(() => {
        return onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setEstado("sin-sesion");
                return;
            }

            setEstado("cargando");
            try {
                const adminSnap = await getDoc(doc(db, "admins", user.uid));
                if (!adminSnap.exists()) {
                    await signOut(auth);
                    setEstado("no-autorizado");
                    return;
                }
                setEstado("autorizado");
            } catch (err) {
                await signOut(auth);
                setEstado("no-autorizado");
            }
        });
    }, []);

    if (estado === "cargando") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0F1B2B] text-[#8B98A5] text-sm">
                Verificando acceso…
            </div>
        );
    }

    if (estado === "no-autorizado") {
        return (
            <AdminLogin mensajeError="Esta cuenta de Google no está autorizada para acceder al panel." />
        );
    }

    if (estado === "autorizado") {
        return <AdminPanel />;
    }

    return <AdminLogin />;
}