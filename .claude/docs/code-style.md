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
- Persist localStorage on any meaningful change
- Sanitize on load via key allowlists

## DOM
- **NO `innerHTML`** — `createElement()` + `textContent` + `setAttribute()` only
- Heavy renders: `DocumentFragment` → `replaceChildren(frag)` once
- Below-fold images: `DOMFactory.createLazyImg(src, className, attrs)`
- Above-fold small icons: plain `el("img")` — no lazy
- Event Shop grids pre-built in `index.astro`; `UIBuilder` hydrates (cache refs, add error handlers)

## Data Layer
- `src/scripts/data/*.js` export `const` (`TRAIT_DATA`, `SERVANT_DATA`, `CE_DATA`)
- Trait IDs sorted numerically in arrays
- New CE fields → whitelist in `CEList` IIFE `src/scripts/data.js`
- New servant fields → handle in `ServantData.load()` `src/scripts/data.js`
- Servant + CE images use `?v=${IMAGE_VERSION}` from `constants.js`; bump on asset update — only copy. `BaseLayout.astro` head preload script takes same constant via `define:vars={{ v: IMAGE_VERSION }}` (imported in frontmatter) and refers to `v`, so it can't drift behind; a local `var v` in that script shadows it and every preload misses.

## Astro-Specific
- `index.astro` imports all JS modules — Astro/Vite bundles + code-splits automatically
- `BaseLayout.astro` holds `<style is:inline>` critical CSS (Astro doesn't process it)
- `import.meta.env.BASE_URL` for `href` attrs needing base path (favicon, manifest)
- Native system font stacks (`system-ui`, `ui-monospace`) — no `@font-face` or web font assets
- Astro emits every `<script>` as `<script type="module">`, deferred
- Scripts needing sync run (tab-init, Trusted Types) go in `<script is:inline>`
- `astro.config.mjs` splits chunks via `build.rolldownOptions.output.codeSplitting.groups` (Vite 8 / Rolldown — never reintroduce Rollup's `rollupOptions.output.manualChunks`: function form deprecated, silently drops rules). Each group needs anchored `test` regex (`/\/name\.js$/`, not `includes()` — old `includes("main.js")` also matched `domain.js`) + `priority` for first-match-wins order. `scripts/check_build_output.js` asserts resulting chunk names — changed name fails CI.

## Patterns
- **Pending slot**: add servant/CE → push `null` to state → open modal; cancel removes null
- **Single slot shape**: `defaultSlot(overrides)` in `bond-app.js` = sole place a servant slot's fields are spelled out — init, `removeSlot`, `onPendingRemove`, build fallback, `loadState` padding and both its maps call it. New slot field goes there once, then clamp in `loadState`'s `sanitize()`
- **Data-owned input**: Next Lv. Required box belongs to data until player types. `Current Lv.` + a servant pick re-price from that servant's table; `buildServantSlots()` fills only an empty box, so typed figure survives every other re-render
- **Debounce**: inputs `DEBOUNCE_MS=100ms`; filter renders 50ms
- **Loop guard**: `MAX_ITERATIONS=10000`
- **Lazy tab init**: Bond + Event tabs via dynamic `import()` on first visit
- **Computation cache**: `computeAllCEMatches()` → `_allCEMatchesCache`; first run in Worker
- **Tab flash**: head inline `<script>` sets `data-tab` on `<html>`, preloads LCP images
- **Bond Gain CE persistence**: both sub-tabs persist picks under `CEFILTER_STORAGE_KEY` as `{ servantPicks: [...], cePicks: [...], ceMode: "all", subTab: "ce" | "servant" }`. Every write goes through `CEFilterStore.write(patch)` (`ce-servant-select.js`), which reads key first — one blob, two sub-tabs, so single-field `setItem` erases other's picks. `ServantSelect` saves from `addServant`/`removeServant`/`clearAll`; `CEFilterApp` saves once from `render()`, where every pick mutation lands (`main.js`'s picker `onApply` and card-badge clicks assign `state.selectedCEs` directly). Not `Persistence` (Event Shop-shaped), not `validateStorageData` (parseFloat). Class/rarity filters, match-count, search and paging still reset
- **Event Shop planner persistence**: plan lives under `EVENT_SHOP_STORAGE_KEY` (`fgo_event_shop_data`) as `{ eventId, requires: { [itemId]: count } }`, written on every commit. `EventPlanner.applyRequires(partial)` is the sole mutation path — merges known item ids only, clamps via `EventShop.clampRequire`, persists, refreshes displays. The per-currency config modal (`EventShopModal`) owns all edits: draft clone on open, Default zeros / Select All = `EventShop.clearRequires` / Cancel discards / Done commits. Tier Required displays are read-only (geometry inherited from .material-input-box-field, dashed-border edit cue) and open the modal. Event rotation (saved `eventId` ≠ data `event.id`) resets the plan. Not `Persistence` (tier-calculator shaped), not `CEFilterStore`
- **rAF init**: `DOMContentLoaded` in `main.js` wrapped in `requestAnimationFrame`
- **Critical CSS**: `<style is:inline>` in BaseLayout.astro — whole stylesheet, not only above-fold rules (see CSS)
- **Worker**: `ce-match-worker.js` standalone chunk, TraitMatcher inlined; double-rAF + worker for first render
- **CLS prevention**: `.drop-value` `min-width:4ch; tabular-nums`; `.cefilter-search-container` static layout; `.cefilter-sort-row` `gap:8px`; `.cefilter-pagination` `min-height:52px`; `.cefilter-servant-card` `content-visibility:auto; contain-intrinsic-size:auto 208px` (its `min-height:208px` is gone — row height comes from the tallest card via grid stretch, and the floor only added bottom slack below the badges. The 208px placeholder is now stale; see the 2026-11-10 `style(layout)` entry in progress.md for the measurements and the re-check threshold (`_getPageSize()` above 30 cards)); system fonts (0 KB load, zero FOUT/FOIT shifts)
- **Pagination**: `_getPageSize()` via `window.innerWidth` (>=1120→6, >=940→5, >=760→4, >=580→3, else 2) × 5; `currentPage` resets on reload; filters reset to 1; buttons use cached `_lastCEFiltered`
- **Servant sort**: `ServantSort.sorted(rows, sortBy, order, idOf, traitsOf)` (`domain.js`) = sole comparator — ID / Rarity / Class, ID tie-break, direction applied to tie-break. Picker calls it with plain servants (`.id`, `.traits`); `CEFilterApp._sortEntries` passes card's own id + trait resolvers, since a result card is a servant plus the ascension it matched on
- **Whose traits**: filter reads traits of the form it looks at — `getTraitsForAscension(id, ascension)` for a card/slot naming one, `ServantData.getAllTraits(id)` for anything that doesn't (party picker, card with no `primaryAscension`). Never `servant.traits` directly for filtering: it is the intersection of stages, so a sub-attribute arriving with an ascension is absent from it.
- **Filter rows are rendered, never patched**: `FilterSections.renderRow(container, chips, selected, onToggle, opts)` (`filter-sections.js`) = sole place a Filter Settings chip is built, by `CEFilterApp._renderFilterRows()` and `ServantSelector._renderFilterRows()`. Row empties + refills from caller's current state, so nothing shows selected that state no longer holds; a chip paints its own pressed state on click because a row rebuilds only when something else asks. `opts.disabled(chip)` = greyed rule (class row's bound = `ServantFilters.rowScope`: group chips and a quest lock only — class pick never greys a sibling). Matching reads `ServantFilters.match(traits, filters)` once per row: union inside row, AND across rows, empty row = no filter, `effectiveClassIds` as class rule. New row = list in `constants.js` + one `renderRow` call + one key in caller's state; nothing in `index.astro` gains a chip.
- **Modal stacking**: base `.servant-modal` uses `z-index: 1000`; nested filter sub-modals (`#servantFilterModal`, `#ceOverlapFilterModal`) use `z-index: 1050` and follow their parent modal in `index.astro`

## CSS
- Shipped CSS: single `<style is:inline>` block in BaseLayout.astro `<head>` (tokens, reset, layout, every component rule). Nothing else ships CSS — no `<link rel=stylesheet>`, no `.css` in `dist/`
- No second stylesheet to write into: `src/styles/global.css` and `critical.css` deleted 2026-11-04 (nothing imported them; their rules never shipped). Write each rule once, in the inline block. `npm run lint:css` gone with stylelint
- Grid + Flexbox. Breakpoints: 580/760/940/1120px; `.grid` and `.ce-grid` use `padding: 8px`
- Image & button tokens: `--servant-portrait-h: 96px` (`width: auto; aspect-ratio: 142 / 155` ~88px); `--ce-badge-h: 48px` & `--ce-badge-w: calc(var(--ce-badge-h) * 142 / 155)` (~44px); `--portrait-lg: 96px`; `.class-btn`: 48×48px (img: 40×40px); `.rarity-btn`, `.ce-count-btn`: 48×36px; `.servant-slot-badge-item`: 24×24px; `.material-icon`: 96px height auto width (`aspect-ratio: 112 / 120` ~90px, fg: 80×80px); `.mini-icon`: 48px height auto width (`aspect-ratio: 112 / 120` ~45px, fg: 40×40px)
- Servant slots: bond badges at `top: 4px; left: 4px; z-index: 2;` (outside portrait, opposite remove button at `top: 4px; right: 4px;`); blank slots share CE add slot layout (`+` fallback `0.7rem`, `"Add Servant"` bold 600 in `.servant-slot-name`, no dummy controls), keep frontline red (`#e74c3c`) and backline blue (`#3498db`) borders
- `:hover` only inside `@media (hover: hover)`. `:active` after for touch
- Modal max-width: 360px / >=580:480px / >=760:540px / >=940:720px / >=1120:900px (filter & 4-item sub-modals capped at 540px on >=940px); `.class-filter` is a `repeat(5, 48px)` grid (3×5)
- Small tap targets → `::before` extends area
- Picker grids: `.grid-sm` defaults `repeat(2, minmax(0, 140px))` with `padding: 8px 4px; gap: 8px;` on mobile (<580px), `repeat(auto-fit, minmax(130px, 140px))` + `justify-content:center` on >=580px; items `width: 100%; max-width: 140px; box-sizing: border-box; height: 136px` (or `140×144px`)