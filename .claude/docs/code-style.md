# Code Style

## Lang & Format
- Vanilla JS ES modules. No frameworks, no transpilation
- `src/scripts/` → Astro/Vite bundling → code-split chunks in `dist/_astro/`
- 2-space indent, semicolons required
- Section comments: `/* ===...=== Name ===...=== */` 44-char bars

## Naming
- Constants: `UPPER_SNAKE_CASE` (`SERVANT_MAX_SLOTS`, `BOND_STORAGE_KEY`)
- Objects/modules: `PascalCase` (`Schema`, `DOMFactory`, `TraitMatcher`)
- Functions/methods: `camelCase`
- CSS classes: `kebab-case` + BEM `--` (`servant-slot--frontline`, `cefilter-class-row`)

## State
- Plain object, immutable spread updates
- Persist to localStorage on every meaningful change
- Sanitize on load via key allowlists

## DOM
- **NO `innerHTML`** — `createElement()` + `textContent` + `setAttribute()` only
- Heavy renders: `DocumentFragment` → `replaceChildren(frag)` once
- Below-fold images: `DOMFactory.createLazyImg(src, className, attrs)`
- Above-fold small icons: plain `el("img")` — skip lazy
- Event Shop grids pre-built in `index.astro`; `UIBuilder` hydrates (caches refs, adds error handlers)

## Data Layer
- `src/scripts/data/*.js` export `const` (`TRAIT_DATA`, `SERVANT_DATA`, `CE_DATA`)
- Trait IDs sorted numerically in arrays
- New CE fields → whitelist in `CEList` IIFE `src/scripts/data.js`
- New servant fields → handle in `ServantData.load()` `src/scripts/data.js`
- Servant and CE images use `?v=${IMAGE_VERSION}` from `constants.js`; bump when assets update and sync in `BaseLayout.astro`

## Astro-Specific
- `index.astro` imports all JS modules — Astro/Vite automatically bundles and code-splits
- `BaseLayout.astro` contains `<style is:inline>` for critical CSS (not processed by Astro)
- `import.meta.env.BASE_URL` used for `href` attributes that need the base path (favicon, manifest, font preloads)
- `@font-face` URLs in `<style is:inline>` use relative `fonts/` paths (Astro rewrites with base path)
- Astro places all `<script>` tags as `<script type="module">` with deferred execution
- Inline scripts that must run sync (tab-init, Trusted Types) go in `<script is:inline>` blocks
- `astro.config.mjs` defines chunk splitting as `build.rolldownOptions.output.codeSplitting.groups` (Vite 8 / Rolldown — do not reintroduce Rollup's `rollupOptions.output.manualChunks`: its function form is deprecated and silently drops rules). Each group needs an anchored `test` regex (`/\/name\.js$/`, not `includes()` — the old `includes("main.js")` also matched `domain.js`) and a `priority` to keep first-match-wins order. The resulting chunk names are asserted by `scripts/check_build_output.js`, so a changed name fails CI.

## Patterns
- **Pending slot**: add servant/CE → push `null` to state → open modal; cancel removes null
- **Single slot shape**: `defaultSlot(overrides)` in `bond-app.js` is the only place a servant slot's fields are spelled out — init, `removeSlot`, `onPendingRemove`, the build fallback, the `loadState` padding and both its maps call it. A new slot field goes there once, then gets clamped in `loadState`'s `sanitize()`
- **Data-owned input**: the Next Lv. Required box belongs to the data until the player types in it. `Current Lv.` and a servant pick re-price it from that servant's table; `buildServantSlots()` fills only an empty box, so a typed figure survives every other re-render
- **Debounce**: inputs `DEBOUNCE_MS=100ms`; filter renders 50ms
- **Loop guard**: `MAX_ITERATIONS=10000`
- **Lazy tab init**: Bond + Event tabs via dynamic `import()` on first visit
- **Computation cache**: `computeAllCEMatches()` → `_allCEMatchesCache`; first run in Worker
- **Tab flash**: head inline `<script>` sets `data-tab` on `<html>` and preloads LCP images
- **Bond Gain CE persistence**: both sub-tabs persist their picks under `CEFILTER_STORAGE_KEY` as `{ servantPicks: [...], cePicks: [...], ceMode: "all" }`. Every write goes through `CEFilterStore.write(patch)` (`ce-servant-select.js`), which reads the key first — one blob shared by two sub-tabs, so a single-field `setItem` erases the other's picks. `ServantSelect` saves from `addServant`/`removeServant`/`clearAll`; `CEFilterApp` saves once from `render()`, the point every pick mutation reaches (`main.js`'s picker `onApply` and the card-badge clicks assign to `state.selectedCEs` directly). Not `Persistence` (Event Shop-shaped) and not `validateStorageData` (parseFloat). Sub-tab choice, class/rarity filters, match-count selection, search and paging still reset
- **rAF init**: `DOMContentLoaded` in `main.js` wrapped in `requestAnimationFrame`
- **Critical CSS**: `<style is:inline>` in BaseLayout.astro — the whole stylesheet, not just above-fold rules (see CSS)
- **Worker**: `ce-match-worker.js` standalone chunk, TraitMatcher inlined; double-rAF + worker for first render
- **CLS prevention**: `.drop-value` `min-width:4ch; tabular-nums`; `.cefilter-search-container` static layout; `.cefilter-sort-row` `gap:8px`; `.cefilter-pagination` `min-height:52px`; `.cefilter-servant-card` `content-visibility:auto; min-height:208px; contain-intrinsic-size:auto 208px`; `font-display:swap` (swap is safe: layout shifts prevented by `min-height`)
- **Pagination**: `_getPageSize()` via `window.innerWidth` (>=1120→6, >=940→5, >=760→4, >=580→3, else 2) × 5; `currentPage` resets on reload; filters reset to 1; buttons use cached `_lastCEFiltered`
- **Servant sort**: `ServantSort.sorted(rows, sortBy, order, idOf, traitsOf)` (`domain.js`) is the one comparator — ID / Rarity / Class, ID tie-break, direction applied to the tie-break. The picker calls it with plain servants (`.id`, `.traits`); `CEFilterApp._sortEntries` passes the card's own id and trait resolvers, since a result card is a servant plus the ascension it matched on
- **Modal stacking**: every `.servant-modal` shares `z-index: 1000`, so a modal that must cover another is written after it in `index.astro` — `#servantFilterModal` follows `#servantModal` for exactly that reason

## CSS
- Shipped CSS: the single `<style is:inline>` block in BaseLayout.astro `<head>` (font-face, tokens, reset, layout, every component rule). Nothing else provides CSS — no `<link rel=stylesheet>`, no `.css` in `dist/`
- There is no second stylesheet to write into: `src/styles/global.css` and `critical.css` were deleted 2026-11-04 (nothing imported them, and rules existed only there that never shipped). Write each rule once, in the inline block. `npm run lint:css` is gone with stylelint
- Grid + Flexbox. Breakpoints: 580/760/940/1120px; `.grid` and `.ce-grid` use `padding: 8px`
- Image & button tokens: `--servant-portrait-h: 96px` (`width: auto; aspect-ratio: 142 / 155` ~88px); `--ce-badge-h: 48px` & `--ce-badge-w: calc(var(--ce-badge-h) * 142 / 155)` (~44px); `--portrait-lg: 96px`; `.class-btn`: 48×48px (img: 40×40px); `.rarity-btn`, `.ce-count-btn`: 48×36px; `.servant-slot-badge-item`: 24×24px; `.material-icon`: 96px height auto width (`aspect-ratio: 112 / 120` ~90px, fg: 80×80px); `.mini-icon`: 48px height auto width (`aspect-ratio: 112 / 120` ~45px, fg: 40×40px)
- Servant slots: bond badges placed at `top: 4px; left: 4px; z-index: 2;` (outside portrait, opposite remove button at `top: 4px; right: 4px;`); blank slots share CE add slot layout (`+` fallback `0.7rem`, `"Add Servant"` bold 600 in `.servant-slot-name`, no dummy controls), preserving frontline red (`#e74c3c`) and backline blue (`#3498db`) borders
- `:hover` → always inside `@media (hover: hover)`. `:active` after for touch
- Modal max-width: 360px / >=760:540px / >=940:720px / >=1120:900px
- Small tap targets → `::before` pseudo-element extends area
- Picker grids: `.grid-sm` defaults to `repeat(2, minmax(0, 140px))` with `padding: 8px 4px; gap: 8px;` on mobile (<580px) and `repeat(auto-fit, minmax(130px, 140px))` on >=580px, `justify-content:center`; items `width: 100%; max-width: 140px; box-sizing: border-box; height: 136px` (or `140×144px`)