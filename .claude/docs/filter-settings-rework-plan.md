# Filter Settings Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the "Filter Settings" modal into seven labelled, divided sections — rarity, class, class group, both alignment axes, sub-attribute, CE Bonus — built by one shared module instead of three hand-rolled copies.

**Architecture:** Pure matching rules (`ServantFilters`) go in `domain.js` so `npm run test` can prove them without a browser. One presentation module (`filter-sections.js`) renders chips from a declarative row list. `CEFilterApp` and `ServantSelector` keep their own state and call both. `BaseLayout.astro` keeps being the only stylesheet, `index.astro` the only markup.

**Tech Stack:** Astro 7 / Vite 8 (Rolldown), vanilla ES modules, node:test, Puppeteer render gate.

**Spec:** `.claude/docs/filter-settings-rework-design.md`

## Global Constraints

- No `innerHTML`, no `insertAdjacentHTML`. `DOMFactory.el(tag, className, attrs)` + `textContent` + `replaceChildren()`.
- All CSS in the single `<style is:inline>` of `src/layouts/BaseLayout.astro`. There is no other stylesheet.
- No `vh` unit in a new rule: use `--screen-h` (the zoom magnifier divides it by `zoom`).
- Double quotes, semicolons, 2-space indent, `printWidth: 120`. `npm run format` before committing.
- Chip floors: 48×48 class, 48×36 text. Nothing smaller.
- Trait ids are 4-digit strings. Rarity order stays ★0 → ★5 (`RARITY_FILTERS`).
- Filters are page-scoped: nothing new is written to `fgo_ce_filter_data`.
- `docs/` is gitignored; this plan and the design live in `.claude/docs/`, tracked on `develop` only.
- Never merge `develop` into `main` with a bare `git merge`; ship with `scripts/merge_code_only.sh`.
- The browser gate runs against a served build: `npx astro preview` then `node scripts/verify_render.js`.

## File Map

| File | Change |
|---|---|
| `src/scripts/constants.js` | + `CLASS_GROUPS`, `ALIGNMENT_LNC_FILTERS`, `ALIGNMENT_GBE_FILTERS`, `SUB_ATTR_FILTERS` |
| `src/scripts/domain.js` | + `ServantFilters` (`classScope`, `match`, `SUB_ALI_OTHER`) |
| `src/scripts/filter-sections.js` | new: shared chip builder |
| `src/pages/index.astro` | both Filter Settings modal bodies → sectioned markup |
| `src/layouts/BaseLayout.astro` | section, label, divider, disabled, group-chip, button-reset rules |
| `src/scripts/ce-filter-app.js` | state keys, `ServantFilters.match`, new `buildGroupFilter`, `buildMatchCountFilter` rewritten as buttons |
| `src/scripts/selectors.js` | `ServantSelector` uses the builder, greys out-of-scope classes; `CEServantOverlap` untouched |
| `tests/servant-filters.test.js` | new: the matching rules |
| `scripts/verify_render.js` | new assertions for the seven sections and the group grey-out |
| `.claude/CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/docs/structure.md`, `.claude/docs/code-style.md`, `scripts/build_baseline.json` | record the rework |

---

### Task 1: Filter data and matching rules

**Files:**
- Modify: `src/scripts/constants.js` (after `RARITY_FILTERS`, line ~78)
- Modify: `src/scripts/domain.js` (after the `Quest` block, line ~455)
- Test: `tests/servant-filters.test.js` (create)

**Interfaces:**
- Consumes: `CLASS_FILTERS`, `GRAND_EXTRA_I`, `GRAND_EXTRA_II` (`constants.js`)
- Produces:
  - `CLASS_GROUPS: [{ key, label, classes: string[] }]` — keys `knight`, `cavalry`, `extra1`, `extra2`
  - `ALIGNMENT_LNC_FILTERS` / `ALIGNMENT_GBE_FILTERS` / `SUB_ATTR_FILTERS`: `[{ id, label }]`; the GBE list ends with `{ id: null, label: "Other", other: true }`
  - `ServantFilters.SUB_ALI_OTHER = "other"`
  - `ServantFilters.classScope(groupClassFilters, lockedClasses) → string[] | null`
  - `ServantFilters.match(traits, filters) → boolean`, `filters = { classFilters, rarityFilters, groupClassFilters, aliFilters, subAliFilters, subAttrFilters, lockedClasses }`

- [ ] **Step 1: Write the failing test** — `tests/servant-filters.test.js`, node:test + `assert/strict`, style of `tests/bond-quest.test.js`. Cases:
  - `classScope([])` is `null`; `classScope(["knight"])` is `["0100","0102","0101"]`; `classScope(["knight","extra1"])` unions to 7 ids; an unknown key is ignored; a `lockedClasses` list clips the scope to the classes it has in common, and `classScope(["cavalry"], ["0107"])` is `[]`.
  - the four groups tile all 15 `CLASS_FILTERS` ids exactly once each.
  - `match(["0001","0100","0200","0300","0303","0404"], {})` is `true` — no row selected means no filter.
  - one row is a union: rarity `["0404","0405"]` against a ★4 servant passes, against a ★3 fails.
  - rows are ANDed: `{ aliFilters: ["0300"], subAliFilters: ["0303"] }` passes Helena (`0301`+`0303`) on Good but fails her on Lawful.
  - `subAliFilters: ["other"]` passes a servant with only `0308` (Summer) and only `0306` (Madness), fails one with `0303`.
  - sub-attribute `["0204"]` matches the Beast attribute, not the `"2821"` Beast Servants trait, and not `0124` Class Beast.
  - group + class: `{ groupClassFilters: ["knight"], classFilters: ["0107"] }` yields nothing; `{ groupClassFilters: ["knight"], classFilters: [] }` yields the three knights.

- [ ] **Step 2: Run it, confirm it fails** — `npm run test`. Expected: `SyntaxError`/`undefined` on the new imports.
- [ ] **Step 3: Add the four constants** to `src/scripts/constants.js`, each with a one-line comment naming who reads it.
- [ ] **Step 4: Add `ServantFilters`** to `src/scripts/domain.js`. Approach: one `rowMatches(traits, selected, { other })` helper the four trait rows share; `classScope` folds `CLASS_GROUPS` and then intersects with `lockedClasses` when present. `match` short-circuits on the first row that selects nothing.
- [ ] **Step 5: Run `npm run test`** — expected: all green.
- [ ] **Step 6: `npm run lint && npm run format`**, then commit `feat(filter): add the class groups, alignment rows and the matching rule`.

---

### Task 2: Shared section builder

**Files:**
- Create: `src/scripts/filter-sections.js`
- Test: none (DOM module; pinned by Task 6's render gate)

**Interfaces:**
- Consumes: `DOMFactory` (`presentation.js`), the Task 1 constants, `ServantFilters.SUB_ALI_OTHER`
- Produces: `FilterSections.renderRow(container, chips, selected, onToggle, opts = {})` — `chips: [{ id, label, icon?, other? }]` (an `other` chip writes `SUB_ALI_OTHER` into state), `selected: Set<string>`, `onToggle(nextIds: string[])`, `opts.disabled: (chip) => boolean`, `opts.className` for the row's chip class (`class-btn` / `rarity-btn` / `ce-group-btn`). Rebuilds `container` with `replaceChildren()`. Also `FilterSections.chipEl(chip, isActive, isDisabled)` → the `<button>`, reused by Task 5's CE Bonus row.

- [ ] **Step 1: Write the module** — a `<button type="button">` per chip, `aria-pressed`, `disabled` + a `--disabled` class when `opts.disabled` says so, `title`/`alt` carrying the label, icon `<img src>` for class chips (`src`, never `data-src` — nothing promotes a deferred icon inside a modal). Click on an enabled chip toggles and calls `onToggle([...selected])`; a disabled chip has `disabled`, so no handler is needed.
- [ ] **Step 2: `npm run lint`** — expected: clean.
- [ ] **Step 3: commit** `feat(filter): one chip row builder for every filter section`.

---

### Task 3: Sectioned modal markup

**Files:**
- Modify: `src/pages/index.astro:703-708` (`#servantFilterModal` body), `:825-831` (`#cefilterFilterModal` body)
- Modify: `src/layouts/BaseLayout.astro` (the one `<style is:inline>`)

**Interfaces:**
- Consumes: `.cefilter-modal-body` (already `overflow-y: auto`, `max-height: calc(var(--screen-h) * 0.8 - 80px)`)
- Produces, per modal, a labelled row the builder can find by id:
  - `#cefilterRarityFilter` `#cefilterClassFilter` `#cefilterGroupFilter` `#cefilterAliFilter` `#cefilterSubAliFilter` `#cefilterAttrFilter` `#cefilterMatchCount` (ids kept where they existed, so `scripts/verify_render.js` still finds them)
  - `#servantRarityFilter` `#servantClassFilter` `#servantGroupFilter` `#servantAliFilter` `#servantSubAliFilter` `#servantAttrFilter`
  - each row is `<div class="cefilter-modal-section">` holding `<div class="cefilter-modal-label" id="…Label">` + `<div class="class-filter|… " id="…" role="group" aria-labelledby="…Label">`, and a `<div class="cefilter-modal-divider">` between sections.
  - The `#servantFilterModal` body gains only six sections; `#cefilterFilterModal` gains seven, with `CE Bonus` last.

- [ ] **Step 1: Rewrite both modal bodies** with the section blocks above. No JS in the markup.
- [ ] **Step 2: Add CSS** — `.cefilter-modal-section { display: flex; flex-direction: column; gap: 6px }`, `.cefilter-modal-label { text-align: center; font-size: 0.75rem; font-weight: 700; color: var(--text-secondary) }`, `.cefilter-modal-divider { height: 1px; background: var(--border) }`, `.ce-group-btn` on the `.rarity-btn` box with `width: auto`, `.class-btn--disabled` / `.rarity-btn--disabled` / `.ce-group-btn--disabled { opacity: 0.35; pointer-events: none }` and no `:hover`/`:active` border for those, plus the `button` reset the chip classes now need (`font: inherit; color: inherit;` and the existing borders/heights kept).
- [ ] **Step 3: `npm run build`** — expected: build succeeds (Astro 7 from `/home/famakung/dev/fgo-calculator`, not the `/mnt/storage` copy).
- [ ] **Step 4: commit** `feat(filter): section the Filter Settings modal markup`.

---

### Task 4: Bond Gain CE tab

**Files:**
- Modify: `src/scripts/ce-filter-app.js:60-73` (state), `:216-230` (init build), `:313-333` (`_applySearchClassRarity`), `:335-404` (`buildClassFilter`/`buildRarityFilter`), `:471-505` (`buildMatchCountFilter`)

**Interfaces:**
- Consumes: Task 1 `ServantFilters.match` / `classScope`, Task 2 `FilterSections.renderRow`
- Produces: state keys `groupClassFilters: []`, `aliFilters: []`, `subAliFilters: []`, `subAttrFilters: []` beside the existing `classFilters` / `rarityFilters` / `matchCounts`; `buildGroupFilter()`; every filter row rebuilt from `_debouncedRender`'s path.

- [ ] **Step 1: Extend the state object** with the four arrays and their comments.
- [ ] **Step 2: Replace the two builders with one `_renderFilterRows()`** that calls `FilterSections.renderRow` per row, passing `ServantFilters.classScope(this.state.groupClassFilters)` as the class row's `disabled` source (a class outside the scope is greyed), and keeps `this.state.currentPage = 1` + `this._debouncedRender()` as the toggle effect.
- [ ] **Step 3: Rewrite `_applySearchClassRarity`** to keep search, then apply `entries.filter((e) => ServantFilters.match(e.servant.traits, this.state))`. It must still read the *resolved ascension's* traits where the code already does — do not swap `e.servant.traits` for a merged union here.
- [ ] **Step 4: Add `buildGroupFilter()`** and call it from `init()` next to the old two, and `buildMatchCountFilter(preFiltered)` keeps its existing dynamic-count behaviour, now through `FilterSections.chipEl`.
- [ ] **Step 5: `npm run build && npm run test && npm run lint`** — expected: green.
- [ ] **Step 6: commit** `feat(filter): match the Bond Gain CE grid on all seven rows`.

---

### Task 5: Servant picker sub-modal

**Files:**
- Modify: `src/scripts/selectors.js:15-27` (fields), `:216-239` (`getFilteredServants`), `:244-276` (`syncPickerControls`), `:279-340` (`_buildClassFilter`/`_buildRarityFilter`)

**Interfaces:**
- Consumes: Task 1, Task 2
- Produces: `ServantSelector.groupClassFilters` / `aliFilters` / `subAliFilters` / `subAttrFilters` page-scoped fields; `lockedClasses` still set by `open(…, { lockClasses })`.

- [ ] **Step 1: Add the four fields** and delete `_buildClassFilter` / `_buildRarityFilter`.
- [ ] **Step 2: `syncPickerControls()`** renders six rows through `FilterSections.renderRow`. The class row is *always* built now: out-of-scope classes render greyed instead of absent, where out-of-scope means `ServantFilters.classScope(this.groupClassFilters, this.lockedClasses)`. Keep the single-class rule that greys the Class sort option and drops a remembered `class` sort to `id`.
- [ ] **Step 3: `getFilteredServants()`** calls `ServantFilters.match(s.traits, this)` for every row including class (it reads `groupClassFilters` and `lockedClasses` itself, and returns no filter when neither is set), then `ServantSort.sorted`. `Quest.pickedClassIds` stays the rule `match` uses inside it, so the Grand Duel lock behaves exactly as it does today.
- [ ] **Step 4: A group chip that shares no class with the quest lock is disabled**; a group chip inside the lock stays enabled and clips to the intersection.
- [ ] **Step 5: `npm run build && npm run lint`** — expected: green.
- [ ] **Step 6: commit** `feat(filter): give the servant picker the same seven rows`.

---

### Task 6: Render gate, baseline, docs

**Files:**
- Modify: `scripts/verify_render.js` (the blocks at ~1142, ~1163, ~1180, ~1265 that read `#servantClassFilter` / `#servantRarityFilter`)
- Modify: `scripts/build_baseline.json` (through `--write`, never by hand)
- Modify: `.claude/CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/docs/structure.md`, `.claude/docs/code-style.md`, this plan's and the design's status lines

**Interfaces:**
- Consumes: everything above.
- Produces: gate evidence the owner can read.

- [ ] **Step 1: Update the existing picker assertions** — they still pass (`#servantClassFilter` keeps its id and `.class-btn` children), except anywhere that counted rows or assumed out-of-scope classes were *absent*; those now assert *disabled*.
- [ ] **Step 2: Add a Bond Gain CE block** — open `#cefilterFilterModal`, assert seven `.cefilter-modal-section` labels in order `Rarity / Category`, `Class`, `Class (Group)`, `Alignment (Lawful/Neutral/Chaotic)`, `Alignment (Good/Balanced/Evil)`, `Sub-Attribute`, `CE Bonus`; tick Three Knights and assert the eight out-of-scope class chips report `disabled` while Saber/Archer/Lancer do not; add Extra I and assert the scope is 7; tick Lawful + Good + Earth and assert the result grid changes and that `matchCounts` still rebuilds.
- [ ] **Step 3: Serve and run** — `npx astro preview` (port 3000), then `node scripts/verify_render.js`. Expected: exit 0.
- [ ] **Step 4: Re-pin the build baseline** — `npm run build && node scripts/check_build_output.js` shows the new `filter-sections` chunk plus the two text signatures moving; then `node scripts/check_build_output.js --write` and `node scripts/check_build_output.js` clean. Do not hand-edit `build_baseline.json`.
- [ ] **Step 5: Docs** — rewrite the Bond Gain CE "Filter Settings" sentence in `.claude/CLAUDE.md` / `AGENTS.md` / `GEMINI.md` (all four must say the same thing), the Bond Gain CE UI paragraph in `.claude/docs/structure.md`, and add the builder to Patterns in `.claude/docs/code-style.md`.
- [ ] **Step 6: commit** `docs(filter): record the seven-section filter modal` (or two commits, gate then docs).

---

## Review Focus

- **A group tick that makes an existing class pick illegal** — the out-of-scope class must be ignored, not priced in, and must come back when the group is cleared (`Task 1` scope tests, `Task 6` disabled-chip assertion).
- **"Other" alignment** — Summer (28 servants) and Madness (3) must land in Other, and a servant with Good must not. `Task 1`.
- **Multi-ascension servants** — filtering a result card reads that ascension's merged traits, not the base set; a Pretender-form Caster must answer to the class its card shows. Covered by `Task 4` Step 3's note and `Task 6`'s grid assertion.
- **Class-like traits that are not classes** — `0204` Beast Attribute and `2821` Beast Servants must not satisfy a class or sub-attribute chip. `Task 1`.
- **A modal row that empties** — zero CEs picked leaves the CE Bonus row with no buttons while the other six sections stay rendered and interactive. `Task 6` Step 2 asserts the seven labels exist before any CE is picked.

## Execution

Native, in this session, no subagents (owner decision). After Task 6, report the gate output and stop — the owner tests by hand at `localhost:3000` and reviews the diff.
