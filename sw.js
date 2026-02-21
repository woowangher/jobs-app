const CACHE_NAME = "jobs-app-shell-v1";
const API_CACHE = "jobs-app-api-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (k !== CACHE_NAME && k !== API_CACHE) return caches.delete(k);
    }));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // same-origin only
  if (url.origin !== self.location.origin) return;

  // API: stale-while-revalidate-ish
  if (url.pathname === "/api/jobs") {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req).then(async (res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);

      return cached || (await fetchPromise) || new Response(JSON.stringify({ ok:false }), {
        headers: { "Content-Type": "application/json" }
      });
    })());
    return;
  }

  // App shell: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    // optional: cache GETs
    if (req.method === "GET" && res && res.ok) cache.put(req, res.clone());
    return res;
  })());
});