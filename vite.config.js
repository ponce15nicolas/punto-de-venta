import {
  defineConfig,
} from "vite";

import react from "@vitejs/plugin-react";

function updateVersionPlugin(
  buildId
) {
  const versionPayload =
    JSON.stringify(
      {
        buildId,
        generatedAt:
          new Date().toISOString(),
      },
      null,
      2
    );

  return {
    name: "pos-update-version",

    configureServer(server) {
      server.middlewares.use(
        "/version.json",
        (_request, response) => {
          response.statusCode = 200;
          response.setHeader(
            "Content-Type",
            "application/json; charset=utf-8"
          );
          response.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate"
          );
          response.end(
            versionPayload
          );
        }
      );
    },

    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: versionPayload,
      });
    },
  };
}

export default defineConfig(() => {
  const buildId =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

  return {
    plugins: [
      react(),
      updateVersionPlugin(buildId),
    ],

    define: {
      "import.meta.env.VITE_APP_BUILD_ID":
        JSON.stringify(buildId),
    },
  };
});
