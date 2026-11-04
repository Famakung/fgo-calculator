# Security Rules

## DOM Safety
- **No `innerHTML`, `outerHTML`, `insertAdjacentHTML`** — always `createElement()`. Prevents XSS.
- Text: `textContent`. Attributes: `setAttribute()`. Never interpolated HTML strings.

## Trusted Types
Astro outputs `<script type="module">` which browsers trust by default. An inline `<script>` in `<head>` creates a Trusted Types passthrough policy before any module loads:
```js
if (window.trustedTypes && trustedTypes.createPolicy) {
  trustedTypes.createPolicy('default', {
    createHTML: s => s,
    createScriptURL: s => s,
    createScript: s => s
  });
}
```
This satisfies `require-trusted-types-for 'script'` if enforced by CSP headers. GitHub Pages does not set custom headers, so Trusted Types is a defense-in-depth measure.

## GitHub Pages Security
GitHub Pages provides:
- **HTTPS** with HSTS (`strict-transport-security: max-age=31556952`)
- **HTTP → HTTPS** 301 redirect
- **No custom headers** — GitHub Pages does not support `Content-Security-Policy`, `X-Frame-Options`, or `Permissions-Policy` headers

Since GitHub Pages cannot set CSP headers, the site relies on:
1. Self-contained resources only (no external scripts, styles, fonts, or images)
2. Trusted Types policy as a JS-layer enforcement
3. Safe DOM APIs (`createElement`, `textContent`, `setAttribute`)

## Inline Scripts
Inline scripts in `<head>` (inside BaseLayout.astro):
| Script | Purpose |
|--------|---------|
| Trusted Types policy | Passthrough `default` policy (runs before any module) |
| Wide-screen magnification | Sets `zoom` on `<html>` from `window.innerWidth` (1400 base, 2x cap) and `--screen-h` from `innerHeight`; no storage, no markup, no network |
| Tab-init + image preloads | Reads localStorage for active tab, preloads LCP images via `createElement("link")` |

All use only safe DOM APIs. No `innerHTML`, `eval`, or `document.write`.

## No Service Worker
Service Worker was removed during Astro migration. The site no longer has:
- SW-injected security headers (previously compensated for GitHub Pages' no-custom-headers)
- Cache-first or stale-while-revalidate strategies
- Offline support

To purge legacy service workers and obsolete `CacheStorage` caches from visitors who accessed the site before the Astro migration:
- `BaseLayout.astro` includes an inline script running `navigator.serviceWorker.getRegistrations()` to unregister any active registrations, and `caches.delete()` for all legacy cache buckets.
- `public/sw.js` acts as a kill-switch service worker (self-unregisters and purges `caches`) for clients whose browsers perform background byte-for-byte update checks.

If SW is re-added, it should only cache same-origin assets and inject security headers (CSP, X-Frame-Options, COOP) into intercepted responses.

## Data Handling
- localStorage: sanitize on load via `Validator.validateStorageData` key allowlist
- localStorage id lists: `Validator.validatePicks` (`/^\d{3,}$/`, deduped, both Bond Gain CE sub-tabs) plus an existence check at the caller (`ServantData.getServant(id)` for servant ids, `CEById.has(id)` for CE ids) — `validateStorageData` coerces through `parseFloat`, so it cannot carry an array
- Numeric inputs: clamp via `Validator.clamp()` with `Schema` min/max bounds
- Search/filter inputs: string match only — never rendered as HTML

## Images
- All local `.webp` — no external URLs, no PNG
- `favicon.svg` only SVG (favicon `<link rel="icon">`)
- Paths from known IDs — not raw user input
- Missing image fallback: `onerror` in `DOMFactory`

## External Resources
- **Zero** external resources: no CDN scripts, no external fonts, no third-party images, no analytics
- All assets served from same origin
- No `https://` URLs in any JS chunk (verified by production audit)