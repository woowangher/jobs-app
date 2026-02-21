// sw.js (stable)
// Strategy:
// - SAME ORIGIN only (avoid chrome-extension, 3p)
// - /api/* : network only (never cache)
// - HTML navigate: network-first, fallback cache
// - Assets: cache-first + background update

const VERSION = "stable_sw_1";
const CACHE = `jobs-app-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=stable_sw_1",
  "./app.js?v=stable_sw_1",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ SAME ORIGIN only (핵심: chrome-extension 에러 방지)
  if (url.origin !== self.location.origin) return;

  // ✅ API never cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  const accept = req.headers.get("accept") || "";
  const isHTML = req.mode === "navigate" || accept.includes("text/html");

  if (isHTML) {
    // network-first for HTML
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // assets: cache-first + update
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      // background update
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          await cache.put(req, fresh.clone());
        } catch {}
      })());
      return cached;
    }

    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch {
      // as a last resort
      return cached;
    }
  })());
});