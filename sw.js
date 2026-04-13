const CACHE_NAME = "fgo-calc-v4";

// Compute base path from service worker location (works on GitHub Pages subdirs)
const BASE = new URL(".", self.location.href).pathname;

const STATIC_ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "styles.min.css",
  BASE + "app.min.js",
  BASE + "data/traits.js",
  BASE + "data/servants.js",
  BASE + "data/craft_essences.js",
  BASE + "manifest.json"
];

// Override GitHub Pages' 10-minute Cache-Control with a longer TTL
function withCacheControl(response, maxAge, isImmutable) {
  if (!response || !response.ok) return response;
  const headers = new Headers(response.headers);
  let cc = "public, max-age=" + maxAge;
  if (isImmutable) cc += ", immutable";
  headers.set("Cache-Control", cc);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Cache-first for static assets (icons, fonts, images)
  if (
    url.pathname.startsWith(BASE + "icons/") ||
    url.pathname.startsWith(BASE + "fonts/") ||
    url.pathname.startsWith(BASE + "servants/") ||
    url.pathname.startsWith(BASE + "craft_essences/")
  ) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return withCacheControl(cached, 31536000, true);
        return fetch(e.request).then((resp) => {
          if (resp.ok) {
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(e.request, withCacheControl(resp.clone(), 31536000, true))
            );
            return withCacheControl(resp, 31536000, true);
          }
          return resp;
        });
      })
    );
    return;
  }

  // Stale-While-Revalidate for HTML, JS, CSS, data files
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(e.request).then((cached) => {
        // Background fetch to update cache for next load
        const fetchPromise = fetch(e.request).then((resp) => {
          if (resp.ok) {
            cache.put(e.request, withCacheControl(resp.clone(), 604800, false));
          }
          return resp;
        }).catch(() => null);

        // Return cached version immediately if available, else wait for network
        if (cached) return withCacheControl(cached, 604800, false);
        return fetchPromise.then((resp) =>
          resp && resp.ok ? withCacheControl(resp, 604800, false) : resp
        );
      });
    })
  );
});
