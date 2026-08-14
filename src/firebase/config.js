import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
    apiKey: "AIzaSyDU1f-HXfQ-KnCnk_NF94tbJX8wcmDAfeU",
    authDomain: "punto-de-venta-pos-7a2e1.firebaseapp.com",
    databaseURL: "https://punto-de-venta-pos-7a2e1-default-rtdb.firebaseio.com",
    projectId: "punto-de-venta-pos-7a2e1",
    storageBucket: "punto-de-venta-pos-7a2e1.firebasestorage.app",
    messagingSenderId: "185997451017",
    appId: "1:185997451017:web:e2d8f82c368b5ee2cabdd8",
    measurementId: "G-2LKZ02G1HW",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export default app;
