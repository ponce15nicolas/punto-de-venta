// src/main.jsx
// Punto de entrada principal de la aplicación.
// No necesita cambios visuales: el diseño global vive en index.css
// y la estructura visual principal en App.jsx.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    'No se encontró el elemento "#root" en index.html'
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);