# Security Rules

## DOM Safety
- **No `innerHTML`, `outerHTML`, `insertAdjacentHTML`** — always `createElement()`. Prevents XSS.
- Text: `textContent`. Attributes: `setAttribute()`. Never interpolated HTML strings.

## Trusted Types
Astro outputs `<script type="module">`, browsers trust by default. Inline `<script>` in `<head>` creates Trusted Types passthrough policy before any module load:
```js
if (window.trustedTypes && trustedTypes.createPolicy) {
  trustedTypes.createPolicy('default', {
    createHTML: s => s,
    createScriptURL: s => s,
    createScript: s => s
  });
}
```
Satisfies `require-trusted-types-for 'script'` if CSP enforces it. GitHub Pages sets no custom headers, so Trusted Types is defense-in-depth.

## GitHub Pages Security
GitHub Pages provides:
- **HTTPS** with HSTS (`strict-transport-security: max-age=31556952`)
- **HTTP → HTTPS** 301 redirect
- **No custom headers** — GitHub Pages can't set `Content-Security-Policy`, `X-Frame-Options`, `Permissions-Policy` headers

No CSP headers possible, so site relies on:
1. Self-contained resources only (no external scripts, styles, fonts, images)
2. Trusted Types policy as JS-layer enforcement
3. Safe DOM APIs (`createElement`, `textContent`, `setAttribute`)

## Inline Scripts
Inline scripts in `<head>` (BaseLayout.astro):
| Script | Purpose |
|--------|---------|
| Trusted Types policy | Passthrough `default` policy (runs before any module) |
| Service-worker & cache cleanup | Purges active service workers and legacy caches from pre-migration visitors |
| Build-etag poller | Checks deployment ETag against `fgo_build_etag` in sessionStorage, shows reload banner on update |
| Tab-init + image preloads | Read localStorage active tab and `data-subtab`, preload LCP images via `createElement("link")` |

All use only safe DOM APIs. No `innerHTML`, `eval`, `document.write`.

## No Service Worker
Service Worker removed during Astro migration. Site no longer has:
- SW-injected security headers (previously compensated GitHub Pages' no-custom-headers)
- Cache-first or stale-while-revalidate strategies
- Offline support

Purge legacy service workers + obsolete `CacheStorage` caches from pre-migration visitors:
- `BaseLayout.astro` inline script runs `navigator.serviceWorker.getRegistrations()` to unregister active registrations, `caches.delete()` for all legacy cache buckets.
- `public/sw.js` kill-switch service worker (self-unregister, purge `caches`) for clients whose browsers do background byte-for-byte update checks.

If SW re-added: cache same-origin assets only, inject security headers (CSP, X-Frame-Options, COOP) into intercepted responses.

## Data Handling
- localStorage: sanitize on load via `Validator.validateStorageData` key allowlist
- localStorage id lists: `Validator.validatePicks` (`/^\d{3,}$/`, deduped, both Bond Gain CE sub-tabs) plus caller existence check (`ServantData.getServant(id)` for servant ids, `CEById.has(id)` for CE ids) — `validateStorageData` coerces via `parseFloat`, cannot carry array
- Numeric inputs: clamp via `Validator.clamp()` with `Schema` min/max bounds
- Search/filter inputs: string match only — never rendered as HTML

## Images
- All local `.webp` — no external URLs, no PNG
- `favicon.svg` only SVG (favicon `<link rel="icon">`)
- Paths from known IDs — not raw user input
- Missing image fallback: `onerror` in `DOMFactory`

## External Resources
- **Zero** external resources: no CDN scripts, no external fonts, no third-party images, no analytics
- All assets from same origin
- No `https://` URLs in any JS chunk (verified by production audit)