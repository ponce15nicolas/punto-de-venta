// src/main.jsx
// Punto de entrada principal de la aplicación.
// No necesita cambios visuales: el diseño global vive en index.css
// y la estructura visual principal en App.jsx.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { registerPosServiceWorker } from "./lib/pwa";

const THEME_STORAGE_KEY = "pos-theme";

function getInitialTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);

    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // Continuamos con la preferencia del sistema.
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function applyInitialTheme() {
  const theme = getInitialTheme();

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  const themeColor = document.querySelector('meta[name="theme-color"]');

  if (themeColor) {
    themeColor.setAttribute(
      "content",
      theme === "light" ? "#F4F1E8" : "#0B0D12"
    );
  }
}

applyInitialTheme();
registerPosServiceWorker();

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