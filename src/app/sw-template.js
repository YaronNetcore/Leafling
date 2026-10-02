// Leafling service worker (generated at build time: build id and precache list are injected by vite.config.ts).
// - App shell + hashed assets precached per build; old caches (incl. the Phase 0 harness
//   cache "leafling-p0-v1") are deleted on activate so an old design never sticks.
// - Navigations are network-first so Cloudflare Access can re-authenticate; offline falls back to the shell.
// - /api/* is never cached by the service worker (data lives in IndexedDB).
const BUILD_ID = "__BUILD_ID__";
const SHELL = `leafling-shell-${BUILD_ID}`;
const IMAGES = "leafling-images-v1";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // Delete older Leafling builds and the legacy root-scoped Phase 0 cache; never touch /phase0/ caches.
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith("leafling-shell-") && k !== SHELL) || k === "leafling-p0-v1").map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/phase0") || url.pathname.startsWith("/keygen")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html", { cacheName: SHELL })));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }
  if (url.pathname.startsWith("/img/")) {
    e.respondWith(caches.open(IMAGES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});
