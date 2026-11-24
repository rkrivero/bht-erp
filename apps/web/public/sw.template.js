const CACHE_NAME = "bht-shell-__BHT_CACHE_HASH__";
const SHELL = [
  "/offline",
  "/login",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];
const OFFLINE_WORKSPACES = new Set(["/vendedor", "/almacen"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (
            response.ok &&
            !response.redirected &&
            OFFLINE_WORKSPACES.has(url.pathname)
          ) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(`${url.origin}${url.pathname}`, response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          if (OFFLINE_WORKSPACES.has(url.pathname)) {
            const workspaceShell = await cache.match(`${url.origin}${url.pathname}`);
            if (workspaceShell) return workspaceShell;
          }
          return (await cache.match("/offline")) || Response.error();
        }
      })()
    );
    return;
  }

  const isHashedStaticAsset =
    url.pathname.startsWith("/_next/static/") &&
    /(?:[./_-])[a-f0-9]{8,}(?:[./_-]|$)/i.test(url.pathname);
  if (isHashedStaticAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      })
    );
  }
});
