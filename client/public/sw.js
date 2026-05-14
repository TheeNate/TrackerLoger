// Hand-rolled service worker for OJT Tracker.
// - Pre-caches the navigation shell so the app can boot offline.
// - Runtime caches built JS/CSS as they're fetched.
// - Network-first for /api/* GETs with cache fallback so list pages
//   continue to render the last-known data when offline.
// - All non-GET requests bypass the cache and go straight to the network
//   so the offline mutation queue (in IndexedDB) is the single source of
//   truth for queued writes.

const VERSION = "v1";
const SHELL_CACHE = `ojt-shell-${VERSION}`;
const ASSET_CACHE = `ojt-assets-${VERSION}`;
const API_CACHE = `ojt-api-${VERSION}`;

const SHELL_URLS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        cache.addAll(SHELL_URLS).catch(() => {
          // If the index can't be fetched (offline first run), ignore.
        }),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k !== SHELL_CACHE && k !== ASSET_CACHE && k !== API_CACHE,
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    /\.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GETs.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept Vite dev/HMR requests.
  if (url.pathname.startsWith("/@") || url.pathname.includes("?v=")) return;

  // Navigation requests: network-first, fall back to cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/index.html", fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached =
            (await cache.match("/index.html")) || (await cache.match("/"));
          return (
            cached ||
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  // API GETs: network-first with cache fallback.
  if (isApiRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(API_CACHE);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ message: "Offline" }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first.
  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(ASSET_CACHE);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          return new Response("", { status: 504 });
        }
      })(),
    );
  }
});
