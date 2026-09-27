// Leafling Phase 0 spike service worker — app-shell cache + push. API requests are never cached.
const CACHE = "leafling-p0-v1";
const SHELL = ["/", "/index.html", "/app.js", "/style.css", "/manifest.webmanifest", "/icon-180.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/keygen") || e.request.method !== "GET") return;
  if (e.request.mode === "navigate") {
    // Network first (lets Access redirect to sign-in when the session expired); cache when offline.
    e.respondWith(fetch(e.request).catch(() => caches.match("/index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});

// Classic Web Push path. Declarative Web Push (iOS 18.4+) notifications that are not
// "mutable" are displayed by the system without this handler; "· SW" marks this path.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const n = d.notification || { title: d.title, body: d.body, navigate: d.url };
  const badge = d.app_badge ?? d.badge;
  e.waitUntil(Promise.all([
    self.registration.showNotification(n.title || "Leafling", { body: `${n.body || ""} · SW`, data: { url: n.navigate || "/" }, lang: "he", dir: "rtl" }),
    badge != null && self.navigator.setAppBadge ? self.navigator.setAppBadge(badge).catch(() => {}) : null,
  ]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ("navigate" in c) return c.focus().then(() => c.navigate(url));
    return self.clients.openWindow(url);
  }));
});
