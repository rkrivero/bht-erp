const CACHE_NAME = "bht-shell-v2";
const SHELL = ["/offline", "/login", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
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
          // /vendedor is a client-rendered shell; sensitive records still come
          // from no-store APIs and are loaded from the user's scoped IndexedDB snapshot.
          if (response.ok && url.pathname === "/vendedor") {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(`${url.origin}/vendedor`, response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          if (url.pathname === "/vendedor") {
            const sellerShell = await cache.match(`${url.origin}/vendedor`);
            if (sellerShell) return sellerShell;
          }
          return (await cache.match("/offline")) || Response.error();
        }
      })()
    );
    return;
  }

  if (
    url.pathname === "/vendedor" &&
    request.headers.get("accept")?.includes("text/html")
  ) {
    event.respondWith(
      fetch(request).then(async (response) => {
        if (
          response.ok &&
          response.headers.get("content-type")?.includes("text/html")
        ) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(`${url.origin}/vendedor`, response.clone());
        }
        return response;
      })
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
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
