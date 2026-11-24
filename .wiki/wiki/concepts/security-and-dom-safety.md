---
title: "Security and DOM Safety"
category: concept
sources:
  - raw/notes/2026-11-24-legacy-security.md
  - raw/notes/2026-11-24-legacy-claude-md.md
created: 2026-11-24
updated: 2026-11-24
tags: [security, trusted-types, dom-safety, xss-prevention, github-pages]
aliases: [DOM Safety, Trusted Types Policy, Zero External Resources]
confidence: high
volatility: cold
summary: "Establishes FGO Calculator's non-negotiable DOM construction rules, inline Trusted Types passthrough policy, and zero-external-resource posture. Explains how client-side enforcement compensates for GitHub Pages' lack of custom security headers and the removal of the legacy Service Worker."
---

# Security and DOM Safety

> FGO Calculator enforces strict XSS prevention through safe DOM APIs, an inline Trusted Types policy in `<head>`, allowlisted storage sanitization, and total self-containment with zero external network assets at runtime.

## Strict DOM Construction (Zero `innerHTML`)

All JavaScript modules and inline scripts follow an absolute prohibition on string-to-HTML sinks:

- **Forbidden sinks**: Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, or `document.write`.
- **Required APIs**: Build every element via `document.createElement()` (wrapped by `DOMFactory.el()`), populate text strictly with `textContent`, and set attributes with `setAttribute()`.
- **Batched updates**: Construct heavy lists and grids inside an off-DOM `DocumentFragment` and commit with a single `replaceChildren(frag)` call to preserve both DOM safety and layout performance.

## Inline Trusted Types Policy

Because Astro emits `<script type="module">` chunks that browsers trust by default, `src/layouts/BaseLayout.astro` runs a synchronous `<script is:inline>` in `<head>` before any module or deferred script executes:

```js
if (window.trustedTypes && trustedTypes.createPolicy) {
  trustedTypes.createPolicy("default", {
    createHTML: (s) => s,
    createScriptURL: (s) => s,
    createScript: (s) => s,
  });
}
```

Any accidental call to an unsanitized DOM sink triggers a runtime Trusted Types violation when `require-trusted-types-for 'script'` is active, acting as JS-layer defense-in-depth alongside code review.

## GitHub Pages Constraints and Service Worker Removal

GitHub Pages serves static files over HTTPS with HSTS (`strict-transport-security: max-age=31556952`) and HTTP-to-HTTPS 301 redirects, but **cannot emit custom HTTP response headers** (`Content-Security-Policy`, `X-Frame-Options`, `Permissions-Policy`).

During the Astro migration, the legacy Service Worker (which previously injected security headers and managed offline caching) was permanently removed:

- **Inline cleanup**: A `<head>` script in `BaseLayout.astro` iterates `navigator.serviceWorker.getRegistrations()` to unregister stale registrations and calls `caches.delete()` across all legacy `CacheStorage` buckets.
- **Kill-switch worker**: `public/sw.js` ships as a self-unregistering, cache-purging kill-switch for returning visitors whose browsers still run background byte-for-byte Service Worker update checks.
- **No offline support**: If a Service Worker were ever re-introduced, it would be restricted to caching same-origin assets only and injecting `CSP`, `X-Frame-Options`, and `COOP` headers.

Without CSP headers from the host, security rests on three pillars: self-contained same-origin resources, the Trusted Types policy, and safe DOM APIs.

## Input Validation and Storage Sanitization

- **`localStorage` objects**: `Validator.validateStorageData()` filters loaded JSON against an explicit key allowlist and numeric coercion (`parseFloat`).
- **ID pick lists**: `CEFilterStore` (`fgo_ce_filter_data`) and similar pick arrays cannot use `validateStorageData` (which coerces values to floats); instead they pass `Validator.validatePicks()` (`/^\d{3,}$/`, deduplicated) followed by existence checks (`ServantData.getServant(id)` or `CEById.has(id)`).
- **Numeric bounds**: User-entered quantities, levels, AP caps, and teapot counts are clamped via `Validator.clamp()` against `Schema` min/max bounds.
- **Search inputs**: Filter and search queries are sliced/matched strictly as plain strings and never interpolated into HTML.

## Zero External Resources and Image Rules

- **Zero third-party origins**: Production bundles contain zero CDN scripts, external fonts, third-party images, or analytics. Automated verification confirms zero `https://` URLs inside any built JS chunk or generated `public/servant_info/*.json` payload.
- **Local `.webp` assets**: All servant portraits, Saint Graphs, skill icons, Craft Essences, event shop icons, and UI icons load from same-origin `.webp` files keyed by known game IDs (never raw user input), with `DOMFactory` `onerror` fallbacks. `public/favicon.svg` is the sole SVG asset.

## Key Files & Tests

- `src/layouts/BaseLayout.astro` — inline Trusted Types `'default'` policy and legacy SW/`CacheStorage` cleanup
- `public/sw.js` — self-unregistering kill-switch Service Worker
- `src/scripts/presentation.js` (`DOMFactory`), `src/scripts/domain.js` (`Validator`, `Schema`) — safe DOM creation and storage/bounds sanitization
- `tests/validate-picks.test.js`, `tests/shell-state-a11y.test.js`, `tools/verify_render.js` — pick validation, a11y/state, and zero-external-URL render checks

## See Also

- [[architecture-and-bundling|Architecture and Bundling]] ([Architecture and Bundling](../concepts/architecture-and-bundling.md)) — `<head>` script ordering and Astro static output layout
- [[code-style-and-conventions|Code Style and Conventions]] ([Code Style and Conventions](../references/code-style-and-conventions.md)) — `DOMFactory` helpers, `CEFilterStore`, and persistence patterns
- [[zero-commit-data-pipeline|Zero-Commit Data Pipeline]] ([Zero-Commit Data Pipeline](../concepts/zero-commit-data-pipeline.md)) — forbidden external URL stripping in `servant_info` payloads

## Sources

- [DOM Security and Trusted Types Policy](../../raw/notes/2026-11-24-legacy-security.md) — Trusted Types policy, GitHub Pages header limits, SW removal, and input validation
- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — DOM safety rules, head script checks, and external-URL prohibitions
