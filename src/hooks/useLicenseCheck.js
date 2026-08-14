// src/hooks/useLicenseCheck.js
// Verifica el estado de la licencia del cliente al iniciar sesión en el POS,
// y aplica sesión única: si la cuenta se abre en otro navegador/dispositivo,
// esta sesión se cierra automáticamente y avisa por qué.

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase/config";

const REVALIDAR_CADA_MS = 5 * 60 * 1000; // cada 5 minutos

function nombreDispositivo() {
    const ua = navigator.userAgent;
    if (/Mobi|Android/i.test(ua)) return "Dispositivo móvil";
    if (/Mac/i.test(ua)) return "Mac";
    if (/Win/i.test(ua)) return "Windows";
    return "Navegador de escritorio";
}

export function useLicenseCheck() {
    const [estado, setEstado] = useState("cargando"); // cargando | activo | inactivo | vencido | sesion-remota | sin-sesion
    const [datosCliente, setDatosCliente] = useState(null);

    // ID único para esta pestaña/dispositivo, se regenera en cada carga de página
    const sessionIdLocal = useRef(
        (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
    ).current;
    const sesionReclamada = useRef(false);
    const sesionExpulsada = useRef(false); // evita que el signOut automático pise el mensaje

    useEffect(() => {
        let unsubscribeCliente = null;

        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (unsubscribeCliente) unsubscribeCliente();

            if (!user) {
                // Si llegamos acá por un signOut automático (sesión tomada por otro dispositivo),
                // dejamos el mensaje de "sesion-remota" en pantalla en vez de pisarlo con el login.
                if (sesionExpulsada.current) {
                    sesionExpulsada.current = false;
                    return;
                }
                setEstado("sin-sesion");
                setDatosCliente(null);
                return;
            }

            sesionReclamada.current = false;

            // 1. Reclamar esta sesión como la activa (invalida cualquier otra abierta)
            try {
                const registrarSesion = httpsCallable(functions, "registrarSesion");
                await registrarSesion({ sessionId: sessionIdLocal, dispositivo: nombreDispositivo() });
                sesionReclamada.current = true;
            } catch (err) {
                console.error("No se pudo registrar la sesión:", err);
            }

            // 2. Escuchar el documento del cliente en tiempo real
            const clienteRef = doc(db, "clientes", user.uid);
            unsubscribeCliente = onSnapshot(clienteRef, (snap) => {
                if (!snap.exists()) {
                    setEstado("inactivo");
                    return;
                }

                const data = snap.data();
                setDatosCliente(data);

                // Si ya reclamamos la sesión y el ID remoto cambió a otro distinto,
                // significa que alguien más inició sesión con esta cuenta.
                const sesionRemota = data.sesionActiva?.sessionId;
                if (sesionReclamada.current && sesionRemota && sesionRemota !== sessionIdLocal) {
                    sesionExpulsada.current = true;
                    setEstado("sesion-remota");
                    signOut(auth);
                    return;
                }

                const vencimiento = data.fechaVencimiento?.toDate?.();
                const vencido = vencimiento && vencimiento < new Date();

                if (data.estado === "inactivo") {
                    setEstado("inactivo");
                } else if (data.estado === "vencido" || vencido) {
                    setEstado("vencido");
                } else if (data.estado === "activo") {
                    setEstado("activo");
                } else {
                    setEstado("inactivo");
                }
            });
        });

        return () => {
            unsubscribeAuth();
            if (unsubscribeCliente) unsubscribeCliente();
        };
    }, [sessionIdLocal]);

    // Revalidación periódica adicional (por si el listener en tiempo real fallara)
    useEffect(() => {
        const interval = setInterval(() => {
            auth.currentUser?.getIdToken(true); // fuerza refresco del token
        }, REVALIDAR_CADA_MS);
        return () => clearInterval(interval);
    }, []);

    const cerrarSesion = () => signOut(auth);

    const bloqueado = estado === "inactivo" || estado === "vencido" || estado === "sesion-remota";

    return { estado, datosCliente, bloqueado, cerrarSesion };
}