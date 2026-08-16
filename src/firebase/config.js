// src/firebase/config.js
// Configuración central de Firebase.
//
// Servicios disponibles:
// - Authentication
// - Cloud Firestore
// - Cloud Functions
// - Cloud Storage
//
// IMPORTANTE:
// La configuración de Firebase Web identifica el proyecto,
// pero NO reemplaza las Security Rules ni la autorización
// del lado del servidor.

import {
    getApp,
    getApps,
    initializeApp,
} from "firebase/app";

import {
    getAuth,
} from "firebase/auth";

import {
    getFirestore,
} from "firebase/firestore";

import {
    getFunctions,
} from "firebase/functions";

import {
    getStorage,
} from "firebase/storage";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const firebaseConfig = {
    apiKey:
        "AIzaSyDU1f-HXfQ-KnCnk_NF94tbJX8wcmDAfeU",

    authDomain:
        "punto-de-venta-pos-7a2e1.firebaseapp.com",

    databaseURL:
        "https://punto-de-venta-pos-7a2e1-default-rtdb.firebaseio.com",

    projectId:
        "punto-de-venta-pos-7a2e1",

    storageBucket:
        "punto-de-venta-pos-7a2e1.firebasestorage.app",

    messagingSenderId:
        "185997451017",

    appId:
        "1:185997451017:web:e2d8f82c368b5ee2cabdd8",

    measurementId:
        "G-2LKZ02G1HW",
};

/* =========================================================
   INICIALIZACIÓN
========================================================= */

/*
 * Evita inicializar Firebase más de una vez.
 *
 * Es especialmente útil durante desarrollo con Vite/HMR,
 * tests o si en el futuro este módulo termina importándose
 * desde diferentes puntos de entrada.
 */
const app =
    getApps().length > 0
        ? getApp()
        : initializeApp(
            firebaseConfig
        );

/* =========================================================
   AUTHENTICATION
========================================================= */

export const auth =
    getAuth(app);

/* =========================================================
   FIRESTORE
========================================================= */

export const db =
    getFirestore(app);

/* =========================================================
   CLOUD FUNCTIONS
========================================================= */

/*
 * Tus callable functions siguen usando us-central1.
 *
 * getFunctions() usa esa región por defecto, pero la dejamos
 * explícita para evitar confusiones si más adelante desplegás
 * funciones en otra región.
 */
export const functions =
    getFunctions(
        app,
        "southamerica-east1"
    );
/* =========================================================
   CLOUD STORAGE
========================================================= */

/*
 * Queda preparado para subir imágenes y archivos desde
 * el panel sin tener que volver a modificar firebase/config.
 */
export const storage =
    getStorage(app);

/* =========================================================
   APP
========================================================= */

export default app;