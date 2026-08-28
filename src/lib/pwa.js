export function registerPosServiceWorker() {
  if (
    !import.meta.env.PROD ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "/sw.js",
        {
          scope: "/",
          updateViaCache: "none",
        }
      );

      const refresh = () => {
        if (navigator.onLine !== false) {
          void registration.update();
          registration.active?.postMessage({
            type: "REFRESH_PWA_CACHE",
          });
        }
      };

      refresh();
      window.addEventListener("online", refresh);
    } catch (error) {
      console.warn("No se pudo registrar el modo PWA:", error);
    }
  });
}
