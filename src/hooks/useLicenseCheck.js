// src/hooks/useLicenseCheck.js
// Verifica el estado de la licencia del cliente al iniciar sesión en el POS.
//
// Soporta dos formas de login:
// 1. Email/contraseña creado por el admin → el UID de Auth coincide con el ID
//    del documento en "clientes", se busca directo.
// 2. Google Sign-In → el UID es distinto, así que se busca el documento por
//    el campo "email" (debe coincidir exactamente con el que cargaste al
//    crear el cliente desde el panel admin).

import { useEffect, useState } from "react";
import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../firebase/config";

const REVALIDAR_CADA_MS = 5 * 60 * 1000; // cada 5 minutos

async function resolverIdDeCliente(user) {
    // 1. Intento directo por UID (cuentas creadas con email/contraseña)
    const directo = await getDoc(doc(db, "clientes", user.uid));
    if (directo.exists()) return user.uid;

    // 2. Si no existe por UID, buscar por email (típico de login con Google)
    if (user.email) {
        const q = query(collection(db, "clientes"), where("email", "==", user.email));
        const resultados = await getDocs(q);
        if (!resultados.empty) return resultados.docs[0].id;
    }

    return null; // no se encontró ningún cliente asociado
}

export function useLicenseCheck() {
    const [estado, setEstado] = useState("cargando"); // cargando | activo | inactivo | vencido | sin-sesion | no-encontrado
    const [datosCliente, setDatosCliente] = useState(null);

    useEffect(() => {
        let unsubscribeCliente = null;

        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (unsubscribeCliente) unsubscribeCliente();

            if (!user) {
                setEstado("sin-sesion");
                setDatosCliente(null);
                return;
            }

            const clienteId = await resolverIdDeCliente(user);

            if (!clienteId) {
                // Se autenticó (por ejemplo con Google) pero no hay ningún cliente
                // registrado con ese email — no es un cliente dado de alta.
                setEstado("no-encontrado");
                setDatosCliente(null);
                return;
            }

            // Escucha en tiempo real: si el admin desactiva al cliente,
            // este hook lo detecta sin necesidad de refrescar la página.
            const clienteRef = doc(db, "clientes", clienteId);
            unsubscribeCliente = onSnapshot(clienteRef, (snap) => {
                if (!snap.exists()) {
                    setEstado("inactivo");
                    return;
                }

                const data = snap.data();
                setDatosCliente(data);

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
    }, []);

    // Revalidación periódica adicional (por si el listener en tiempo real fallara)
    useEffect(() => {
        const interval = setInterval(() => {
            auth.currentUser?.getIdToken(true); // fuerza refresco del token
        }, REVALIDAR_CADA_MS);
        return () => clearInterval(interval);
    }, []);

    const cerrarSesion = () => signOut(auth);

    const bloqueado = estado === "inactivo" || estado === "vencido" || estado === "no-encontrado";

    return { estado, datosCliente, bloqueado, cerrarSesion };
}