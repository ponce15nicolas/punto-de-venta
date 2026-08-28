const META_CACHE = "pos-pwa-meta-v1";
const SHELL_PREFIX = "pos-shell-";
const BUILD_KEY = "/__pos_pwa_build__";
const ASSET_MANIFEST = "/pwa-assets.json";
const VERSION_FILE = "/version.json";

function shellCacheName(buildId) {
  return `${SHELL_PREFIX}${buildId}`;
}

async function readActiveBuildId() {
  const cache = await caches.open(META_CACHE);
  const response = await cache.match(BUILD_KEY);
  return response ? response.text() : "";
}

async function writeActiveBuildId(buildId) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    BUILD_KEY,
    new Response(buildId, {
      headers: { "Content-Type": "text/plain" },
    })
  );
}

async function fetchAssetManifest() {
  const response = await fetch(`${ASSET_MANIFEST}?t=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("No se pudo cargar el manifiesto PWA.");
  }

  const payload = await response.json();
  const buildId = String(payload?.buildId || "").trim();
  const assets = Array.isArray(payload?.assets)
    ? payload.assets.filter((item) => typeof item === "string" && item.startsWith("/"))
    : [];

  if (!buildId || assets.length === 0) {
    throw new Error("Manifiesto PWA inválido.");
  }

  return { buildId, assets };
}

async function cacheOne(cache, url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) {
      await cache.put(url, response.clone());
    }
  } catch {
    // Un recurso opcional no debe impedir la activación offline.
  }
}

async function refreshShell() {
  const { buildId, assets } = await fetchAssetManifest();
  const currentBuildId = await readActiveBuildId();
  const nextCacheName = shellCacheName(buildId);
  const cache = await caches.open(nextCacheName);

  if (currentBuildId === buildId) {
    await Promise.all(
      assets.map(async (url) => {
        const cached = await cache.match(url);
        if (!cached) {
          await cacheOne(cache, url);
        }
      })
    );

    return nextCacheName;
  }

  await Promise.all(
    assets.map((url) => cacheOne(cache, url))
  );

  await writeActiveBuildId(buildId);

  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith(SHELL_PREFIX) && name !== nextCacheName)
      .map((name) => caches.delete(name))
  );

  return nextCacheName;
}

async function activeShellCache() {
  const buildId = await readActiveBuildId();
  return buildId ? caches.open(shellCacheName(buildId)) : null;
}

async function cachedResponse(request) {
  const cache = await activeShellCache();
  if (!cache) return null;

  const exact = await cache.match(request);
  if (exact) return exact;

  return cache.match(new URL(request.url).pathname);
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);

    return response;
  } catch {
    const cache = await activeShellCache();
    const fallback =
      (cache && await cache.match("/index.html")) ||
      (cache && await cache.match("/"));

    if (fallback) return fallback;
    throw new Error("Aplicación no disponible sin conexión.");
  }
}

async function assetResponse(request) {
  const cached = await cachedResponse(request);
  if (cached) return cached;

  const response = await fetch(request);

  if (response.ok) {
    const cache = await activeShellCache();
    await cache?.put(request, response.clone());
  }

  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    refreshShell()
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients.claim()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "REFRESH_PWA_CACHE") {
    event.waitUntil(refreshShell().catch(() => undefined));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === VERSION_FILE || url.pathname === ASSET_MANIFEST || url.pathname === "/sw.js") {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    event.waitUntil(refreshShell().catch(() => undefined));
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icon-") ||
    url.pathname.startsWith("/favicon") ||
    url.pathname === "/apple-touch-icon.png"
  ) {
    event.respondWith(assetResponse(request));
  }
});
