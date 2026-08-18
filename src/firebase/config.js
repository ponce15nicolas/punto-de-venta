// src/firebase/config.js
// Configuración central de Firebase.
//
// Servicios disponibles:
// - Authentication
// - Cloud Firestore
// - Cloud Functions
// - Cloud Storage

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
 * Las callable functions del frontend
 * utilizan southamerica-east1.
 */
export const functions =
    getFunctions(
        app,
        "southamerica-east1"
    );

/* =========================================================
   CLOUD STORAGE
========================================================= */

export const storage =
    getStorage(app);

/* =========================================================
   APP
========================================================= */

export default app;