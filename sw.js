const CACHE_NAME = "fgo-calc-v19";

// Compute base path from service worker location (works on GitHub Pages subdirs)
const BASE = new URL(".", self.location.href).pathname;

const CLASS_ICON_NAMES = [
  "saber",
  "archer",
  "lancer",
  "rider",
  "caster",
  "assassin",
  "berserker",
  "shielder",
  "ruler",
  "avenger",
  "mooncancer",
  "alterego",
  "foreigner",
  "pretender",
  "beast",
];

const STATIC_ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "favicon.svg",
  BASE + "styles.min.css",
  BASE + "app.min.js",
  BASE + "ce-match-worker.min.js",
  BASE + "register-sw.js",
  BASE + "manifest.json",
  ...CLASS_ICON_NAMES.map((c) => BASE + "icons/classes/" + c + ".webp"),
];

// Security headers injected into every SW-served response
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'self'",
};

// Create new response with modified headers (preserves body stream)
function rebuildResponse(response, headerFn) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headerFn(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  });
}

// Inject security headers into any response (used for error responses)
function withSecurityHeaders(response) {
  return rebuildResponse(response, (headers) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }
  });
}

// Override GitHub Pages' 10-minute Cache-Control with a longer TTL
// and inject security headers (HSTS, COOP, XFO, frame-ancestors)
function withCacheControl(response, maxAge, isImmutable) {
  if (!response || !response.ok) return response;
  return rebuildResponse(response, (headers) => {
    let cc = "public, max-age=" + maxAge;
    if (isImmutable) cc += ", immutable";
    headers.set("Cache-Control", cc);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }
  });
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        STATIC_ASSETS.map((url) =>
          fetch(url, { cache: "no-cache" }).then((resp) => {
            if (resp.ok) return cache.put(url, resp);
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (!e.request.url.startsWith("http")) return;
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
            const respForCache = resp.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(e.request, withCacheControl(respForCache, 31536000, true)));
            return withCacheControl(resp, 31536000, true);
          }
          return withSecurityHeaders(resp);
        });
      }),
    );
    return;
  }

  // Stale-While-Revalidate for HTML, JS, CSS, data files
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(e.request).then((cached) => {
        // Background fetch to update cache for next load
        const fetchPromise = fetch(e.request)
          .then((resp) => {
            if (resp.ok) {
              const forCache = resp.clone();
              cache.put(e.request, withCacheControl(forCache, 604800, false));
            }
            return resp;
          })
          .catch(() => null);

        // Return cached version immediately if available, else wait for network
        if (cached) return withCacheControl(cached, 604800, false);
        return fetchPromise.then((resp) =>
          resp && resp.ok ? withCacheControl(resp, 604800, false) : withSecurityHeaders(resp),
        );
      });
    }),
  );
});
