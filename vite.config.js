import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PWA_PUBLIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/favicon.svg",
  "/favicon-32x32.png",
  "/favicon-16x16.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
];

function buildMetadataPlugin(buildId) {
  const versionPayload = JSON.stringify(
    {
      buildId,
      generatedAt: new Date().toISOString(),
    },
    null,
    2
  );

  return {
    name: "pos-build-metadata",

    configureServer(server) {
      server.middlewares.use("/version.json", (_request, response) => {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        response.end(versionPayload);
      });
    },

    generateBundle(_options, bundle) {
      const emittedAssets = Object.values(bundle)
        .map((entry) => entry.fileName)
        .filter(Boolean)
        .map((fileName) => `/${fileName}`);

      const pwaAssets = Array.from(
        new Set([
          ...PWA_PUBLIC_ASSETS,
          ...emittedAssets,
        ])
      );

      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: versionPayload,
      });

      this.emitFile({
        type: "asset",
        fileName: "pwa-assets.json",
        source: JSON.stringify(
          {
            buildId,
            assets: pwaAssets,
          },
          null,
          2
        ),
      });
    },
  };
}

export default defineConfig(() => {
  const buildId = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  return {
    plugins: [
      react(),
      buildMetadataPlugin(buildId),
    ],

    define: {
      "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(buildId),
    },
  };
});
