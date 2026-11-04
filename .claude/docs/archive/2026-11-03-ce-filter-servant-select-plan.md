# CE Filter "Servant Select" Sub-Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Servant Select` sub-tab to the CE Filter tab: pick any number of servants, get every group of two or more of them listed with the craft essences all of them can use.

**Architecture:** One pure domain function computes the groups from the match cache `CEFilterApp` already builds, so no new trait matching runs. One new presentation module renders the sub-panel and is imported by `ce-filter-app.js`, which puts it in the existing `ce-filter-chunk`. `index.astro` gains the first nested tab level in the app; `global.css` gains its styles.

**Tech Stack:** Astro 7.4.5, Vite 8 (Rolldown), vanilla ES modules, no TypeScript at runtime, no new dependencies.

**Spec:** the Design section below. No separate design document was written — the description was agreed in chat on 2026-11-03 and is recorded here.

## Design

`Craft Essence Select` (today's CE Filter, unchanged) selects CEs and lists servants. `Servant Select` inverts it. A servant's **usable CE list** is the union of `matchingCEIds` over every cache entry carrying that servant id — a multi-ascension servant produces one entry per distinct CE group (`ce-filter-app.js:824-841`), and the union is the "usable at any ascension" rule, which also means adding a servant needs no ascension choice.

A **group** is a set of picked servants plus the intersection of their usable lists. Rules:

- A group with fewer than two servants is pruned. A lone servant's list is that servant's inventory, not a combo, and the widest list in the run would otherwise sit on top of every result.
- Two groups with the same CE list collapse into one row holding the union of their servants. Union preserves intersection (`I(S₁)=I(S₂)=P ⟹ I(S₁∪S₂)=P`), so nothing is lost. This makes the row set small: 4 real servants → 15 eligible groups → 3 rows.
- Each row's servant list is expanded to every picked servant whose usable list contains that row's CE list, so the row always shows the maximal group.
- Empty intersections prune their whole subtree.
- Rows sort by CE count desc, then servants covered desc, then `ceIds[0]`, then `servantIds[0]`, both ascending, for stable output.
- A size with zero rows renders no section header.
- Picked servants in no row at all are named once, below the list, as `No shared CE with: <name>`.

Verified against this checkout's data (471 servants, 24 CEs; `docs/` is gitignored so the probe lives nowhere — re-derive with `TraitMatcher` if in doubt):

```
Mash Kyrielight (001)     Chaldea Morning · Checking Reports · Needle of Sincerity · Blessed Bride
Jeanne d'Arc    (059)     Checking Reports · Needle of Sincerity · Blessed Bride · Foreign God
Kukulcan        (373)     Checking Reports · Needle of Sincerity · Blessed Bride · Foreign God
U-Olga Marie    (444)     Needle of Sincerity · Blessed Bride · Foreign God · Chaldea Morning · Checking Reports

4 CE · [Chaldea Morning | Checking Reports | Needle of Sincerity | Blessed Bride] · Mash, U-Olga Marie
4 CE · [Checking Reports | Needle of Sincerity | Blessed Bride | Foreign God]      · Jeanne, Kukulcan, U-Olga Marie
3 CE · [Checking Reports | Needle of Sincerity | Blessed Bride]                    · all four
```

Non-goals: no localStorage persistence (CE Filter has none today; `CEFILTER_STORAGE_KEY` at `constants.js:9` stays unused), no share URL, no per-ascension narrowing, no CE rarity sort (CE data carries no star rating), no export.

## Global Constraints

- Never `innerHTML`, `insertAdjacentHTML` or raw HTML strings in DOM sinks — `DOMFactory.createElement()`/`el()`, `textContent`, `setAttribute()`, and `DocumentFragment` + `replaceChildren()` for bulk renders. A Trusted Types `default` policy is installed in `BaseLayout.astro` `<head>`.
- Node >= 22.23.4. `node --version` before trusting a build.
- No new npm dependencies. Tests run on `node --test` (stdlib).
- JS style: ES modules, 2-space indent, semicolons, double quotes, `printWidth: 120`, `prefer-const`, no `var`.
- Element ids and classes keep the tab's existing prefix: `cefilter*` ids, `.cefilter-*` classes.
- Do not touch `vite.build.rolldownOptions.output.codeSplitting.groups` in `astro.config.mjs` — the new module joins `ce-filter-chunk` by being imported from `ce-filter-app.js`.
- Build only from `/home/famakung/dev/fgo-calculator`. `astro build` fails on the `/mnt/storage` mount.
- Commits are Conventional Commits (`feat:`, `test:`, `docs:`) and each message ends with the `Co-Authored-By: Claude Code <noreply@anthropic.com>` line.
- `npm run check:build` compares against `scripts/build_baseline.json`, so every task that changes markup or a bundled module re-captures the baseline in its own commit. That keeps the gate green at every commit.

## Review Focus

Each line is a case no task's happy path covers. Each gets the named test or assertion in the owning task.

1. **A picked servant nobody shares a CE with** must be named as unshared, not silently missing from the results — the user cannot tell "no matches" from "your input was ignored".
2. **A multi-ascension servant** arrives as several cache entries with the same id; the usable list must be their union and the servant must count once, never as two members of a group.
3. **The same servant added twice** (or two servants with identical usable lists) must not double a group's servant count or print a duplicate chip.
4. **A CE count with no rows** must print nothing at all — no `2 CE · 0 groups` header, no empty expander.
5. **A big pick** must degrade to a stated limit instead of freezing the tab, and the whole panel must stay reachable by keyboard (chip removal and expander are `<button>`s, not click-only `<div>`s).

---

### Task 1: Domain — shared-CE group calculator, plus the test harness

**Files:**
- Create: `tests/servant-combo.test.js`
- Modify: `src/scripts/domain.js` (append after `TraitMatcher`, which ends at `src/scripts/domain.js:133`)
- Modify: `package.json:7-21` — add a `test` script; extend the two Prettier globs to cover `tests/**/*.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `ServantComboCalculator.buildSharedCEGroups(entries, pickedIds)` in `src/scripts/domain.js`, and `ServantComboCalculator.MAX_COMBO_NODES = 50000`.
  - `entries`: the `CEFilterApp` match cache — objects with `servant.id` (string) and `matchingCEIds` (a `Set` of CE id strings). Several entries may share one `servant.id`. Never mutated.
  - `pickedIds`: array of servant id strings, any order, may contain repeats.
  - Returns `{ groups, unshared, truncated }` where `groups` is `Array<{ ceIds: string[], servantIds: string[] }>`, both arrays sorted ascending by id string, `unshared` is sorted servant id strings, `truncated` is a boolean.

- [ ] **Step 1: Branch**

```bash
git checkout -b feat/ce-filter-servant-select
```

- [ ] **Step 2: Add the harness**

In `package.json`, add to `"scripts"`:

```json
"test": "node --test tests/"
```

and change the `format` and `format:check` globs so `tests/**/*.js` is included next to `src/scripts/**/*.js`. Leave `lint:js` as `eslint src/scripts/` — the ESLint config has no test globals, so `tests/` is formatted but not linted.

- [ ] **Step 3: Write the failing test**

`tests/servant-combo.test.js`, `node:test` + `node:assert/strict`, importing `{ ServantComboCalculator } from "../src/scripts/domain.js"`. Build fixtures with a local helper:

```js
const entry = (id, ceIds) => ({ servant: { id }, matchingCEIds: new Set(ceIds) });
```

Cases, with the Design section's ids as the fixture values (`"0001"` Chaldea Morning, `"0002"` Checking Reports, `"0003"` Needle of Sincerity, `"0004"` Blessed Bride, `"0005"` Foreign God):

- `union across ascension entries`: `entry("001", ["0001","0002"])` and `entry("001", ["0002","0003"])` are the same servant → usable list is all three. Pick `["001","059"]` where `059` has `["0002","0003"]` → one group `ceIds ["0002","0003"]`, `servantIds ["001","059"]`.
- `collapses identical CE lists to the union of servants`: Mash + Jeanne + Kukulcan where Jeanne and Kukulcan have the same list → the pair (Mash, Jeanne), the pair (Mash, Kukulcan) and the triple all yield the same intersection → exactly one row for that CE list carrying all three servant ids, and `servantIds` has no repeats.
- `prunes single-servant groups`: one picked servant with 3 usable CEs → `groups` is `[]`, `unshared` is `["001"]`.
- `names a servant that shares nothing`: two picked servants with disjoint lists → `groups` is `[]`, `unshared` has both ids sorted.
- `sorts by CE count then servant count`: the real four-servant fixture from the Design section → 3 groups, sizes `[4, 4, 3]`, the two 4-CE rows in `servantIds.length` order then `ceIds[0]` order, and the 3-CE row last with all four servants.
- `maximal group expansion`: a servant whose list is a superset of an existing row's CE list is folded into that row's `servantIds` even when it was not in the enumerated subset.
- `input is not mutated`: `deepStrictEqual` a snapshot of the entries' `matchingCEIds` before and after.
- `truncated at the node budget`: 20 servants, each list = a shared CE plus one unique CE, so every subset intersects non-empty; assert `truncated === true` and that `groups` is still a valid non-empty result.
- `duplicate picked ids`: `["001","001","059"]` behaves as `["001","059"]` (Review Focus 3).

- [ ] **Step 4: Run it, confirm it fails**

Run: `npm test`
Expected: FAIL, `does not provide an export named 'ServantComboCalculator'`.

- [ ] **Step 5: Implement `buildSharedCEGroups`**

`export const ServantComboCalculator = { ... }` in `src/scripts/domain.js`. Steps the implementation takes, in order:

1. Build `usable: Map<servantId, Set<ceId>>` by unioning `matchingCEIds` over the entries whose `servant.id` is picked. Skip picked ids with no entry.
2. Group the picked ids into classes by identical usable list (signature = sorted ids joined). One class per distinct list; members are interchangeable (Review Focus 2 and 3).
3. Depth-first over the classes with an include/exclude branch, carrying the running intersection, **including single-class subsets** — one class can still expand to two servants. Do not recurse into a branch whose intersection is empty. Count every visited node against `MAX_COMBO_NODES`; when the count is exceeded, stop and set `truncated = true`.
4. For a non-empty intersection `P`, expand it to `J = every picked servant whose usable list ⊇ P`, and key the row by `P`. Rows come from a `Map<P, string[]>` holding the sorted `J`, so a later duplicate overwrites (Review Focus 1 and the maximality rule). The `≥ 2` test happens here, after expansion, not on the subset size.
5. Compute `unshared` as picked ids in no surviving row. Sort per the Design rules.

- [ ] **Step 6: Run the tests, confirm they pass**

Run: `npm test`
Expected: PASS, 9 tests, 0 fail.

- [ ] **Step 7: Lint and format**

Run: `npm run lint && npm run format:check`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/scripts/domain.js tests/servant-combo.test.js package.json
git commit -m "feat: add shared-CE group calculator for the Servant Select sub-tab"
```

---

### Task 2: Sub-tab shell — markup, styles, switching

**Files:**
- Modify: `src/pages/index.astro:471-548` (`<section class="tab-panel active" id="panel-cefilter">` … `</section>`)
- Modify: `src/styles/global.css` — CE Filter block ends near `1267`; mobile rules live at `2150-2281`
- Modify: `src/scripts/ce-filter-app.js` (`state` at `:68-79`, `init(callbacks)` at `:93`)
- Test: `scripts/verify_render.js` gains the assertions in Task 5 — this task is verified by the build gate and by hand in the browser.

**Interfaces:**
- Consumes: `DOMFactory.el(tag, className, attrs)` and `CEFilterApp`.
- Produces: `CEFilterApp.state.subTab` (`"ce"` | `"servant"`, default `"ce"`), `CEFilterApp._switchSubTab(sub)`, and the ids `#cefilterSubtabs`, `#cefilterSubCE`, `#cefilterSubServant`, plus `.cefilter-subtab-btn[data-subtab]`.

- [ ] **Step 1: Markup**

Inside `#panel-cefilter`, insert a `<div class="cefilter-subtabs" id="cefilterSubtabs" role="tablist">` holding two `<button type="button" class="cefilter-subtab-btn active" data-subtab="…">` labelled `Craft Essence Select` and `Servant Select`. Wrap the section's two existing `<div class="card">` blocks in `<div class="cefilter-subpanel" id="cefilterSubCE" role="tabpanel">`. Add the sibling `<div class="cefilter-subpanel" id="cefilterSubServant" role="tabpanel" hidden>` containing, in this order: a card with `#cefilterServantAddBtn` (`.cefilter-add-btn`, `Add Servant`), `#cefilterServantClearBtn` (`Clear`), `#cefilterServantCount` (`.cefilter-servant-count`), `#cefilterServantChips` (`.cefilter-servant-chips`), `#cefilterComboCount` (`.cefilter-combo-count`), `#cefilterComboResults` (`.cefilter-combo-results`), `#cefilterComboEmpty` (`.cefilter-combo-empty`, hidden), `#cefilterComboUnshared` (`.cefilter-combo-unshared`, hidden), `#cefilterComboTruncated` (`.cefilter-combo-truncated`, hidden). Keep the existing indentation style; `hidden` is an attribute, not a class.

- [ ] **Step 2: Styles**

In the CE Filter block of `global.css`: `.cefilter-subtabs` as a flex row, gap `8px`, `margin-bottom` from the existing CE Filter card spacing token; `.cefilter-subtab-btn` 48px tall, `var(--radius)`, `1px solid var(--border)`, `var(--card)` background, `var(--text-secondary)`, and an `.active` state using `var(--accent)` with `var(--text)`; `.cefilter-subpanel[hidden] { display: none; }`; `.cefilter-servant-chips` flex wrap; `.cefilter-servant-chip` pill with a `24px` portrait slot; `.cefilter-combo-results` reusing the existing `.grid` / `.grid-sm` columns. Add a `@media (max-width: 580px)` rule making the two sub-tab buttons `flex: 1` at 14px. Use existing custom properties only — `--bg`, `--card`, `--text`, `--text-secondary`, `--border`, `--accent`, `--radius`. There is no dark-mode block in this file; do not add one.

- [ ] **Step 3: Switching**

In `ce-filter-app.js`, add `subTab: "ce"` to `state`, a `_switchSubTab(sub)` that toggles `.active` on the two `.cefilter-subtab-btn`s, sets `hidden` on the two sub-panels, and calls `this.render()` only for `"ce"` — Task 3 adds the servant branch. Bind one `click` listener on `#cefilterSubtabs` using `event.target.closest(".cefilter-subtab-btn")`, inside `init()`, guarded by a null check on the container like the existing `getElementById` guards. `aria-selected` mirrors the active button.

- [ ] **Step 4: Build and check the gate fails on text only**

Run: `npm run build && npm run check:build`
Expected: build succeeds; `check:build` FAILs on the page-text signature (`rawTextSha` / `normalisedTextSha`), and reports no missing chunk and no head-marker move. A missing-chunk or head-marker failure means the markup broke the `<head>` order or the chunk layout — stop and fix that instead of re-capturing.

- [ ] **Step 5: Re-capture, confirm green**

Run: `node scripts/check_build_output.js --write && npm run check:build`
Expected: both exit 0. Read the `scripts/build_baseline.json` diff: `ce-filter-chunk` bytes rise, no chunk name changes.

- [ ] **Step 6: Browser check**

Run: `npm run dev` then open `localhost:3000`, click both sub-tabs.
Expected: `Craft Essence Select` shows today's CE Filter unchanged (add-CE, chips, results, pagination all work); `Servant Select` shows the empty panel; no console errors. Then `astro dev stop`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/index.astro src/styles/global.css src/scripts/ce-filter-app.js scripts/build_baseline.json
git commit -m "feat: add CE Filter sub-tab shell for Servant Select"
```

---

### Task 3: Servant picking and chips

**Files:**
- Create: `src/scripts/ce-servant-select.js`
- Modify: `src/scripts/ce-filter-app.js` — import the new module at the top with the other imports; call `ServantSelect.init(...)` at the end of `init()` (`:93-218`)
- Modify: `src/scripts/selectors.js` — `ServantSelector.open(slotIndex, pending, callbacks)` at `:31` and the item-click branch at `:77-86`

**Interfaces:**
- Consumes: `ServantSelector.open(slotIndex, pending, callbacks)` (`selectors.js:31`), `DOMFactory.createLazyImg(src, cls, attrs)`, `DOMFactory.addAscensionFallback(img, id)`, `ServantData.getServant(id)` and `ServantData.getImageForAscension(id, asc)`.
- Produces: `export const ServantSelect` with `state.pickedIds` (`string[]`), `_deps`, `init(deps)` where `deps = { getEntries }` and `getEntries()` returns the Task 1 `entries` shape, `addServant(id)`, `removeServant(id)`, `clearPicked()`, `renderChips()`, and `render()`. `CEFilterApp` reaches it as `ServantSelect`.
- **Task 4 fills in `render()`.** In this task it exists and does nothing, so Tasks 3 and 4 stay independently committable.

- [ ] **Step 1: Give the picker an ascension bypass**

Add a fourth parameter to `ServantSelector.open`, `options = {}`, store `this._skipAscension = options.skipAscension === true`, reset it to `false` in `open()` when the option is absent, and in the item-click handler at `selectors.js:77-86` call `callbacks.onSelect(slotIndex, id, null)` directly when `_skipAscension` is true instead of opening `AscensionSelector`. Bond tab callers pass nothing, so their two-click flow is unchanged.

- [ ] **Step 2: Build the module**

`src/scripts/ce-servant-select.js`. `init(deps)` grabs `#cefilterServantAddBtn`, `#cefilterServantClearBtn`, `#cefilterServantChips`, binds add → `ServantSelector.open(0, false, { onSelect: (slotIndex, id) => this.addServant(id) }, { skipAscension: true })`, binds clear → `clearPicked()`. `addServant(id)` ignores an id already in `pickedIds` (Review Focus 3), pushes, then calls `renderChips()` and `render()`. `removeServant(id)` filters it out and re-renders.

- [ ] **Step 3: Render the chips**

`renderChips()` builds a `DocumentFragment` and calls `replaceChildren()` once on `#cefilterServantChips`. Per picked servant: `.cefilter-servant-chip` div holding a lazy portrait (`createLazyImg(ServantData.getImageForAscension(id, null), "cefilter-servant-chip-img", { alt: name })`, then `addAscensionFallback`), a name `span`, and a `×` `button.cefilter-servant-chip-remove` of `type="button"` with an `aria-label` naming the servant (Review Focus 5). Set `#cefilterServantCount`'s `textContent` to `Servants (N)`, N = `pickedIds.length`.

- [ ] **Step 4: Wire it into the tab**

In `ce-filter-app.js` `init()`, end with `ServantSelect.init({ getEntries: () => this.computeAllCEMatches() })` so the panel reuses the same cache the CE side uses, worker-populated or not. `_switchSubTab("servant")` calls `ServantSelect.render()`.

- [ ] **Step 5: Lint, build, re-capture**

Run: `npm run lint && npm run build && node scripts/check_build_output.js --write && npm run check:build`
Expected: all exit 0. `ce-filter-chunk` bytes grow (the new module is inside it); chunk names unchanged.

- [ ] **Step 6: Browser check**

Run `npm run dev`, open `localhost:3000`, go to CE Filter → Servant Select.
Expected: `Add Servant` opens the existing modal with its search and class/rarity filters; one click on a servant adds a chip and closes the modal, with no ascension prompt; a multi-ascension servant such as `001` also takes one click; `×` removes it; `Clear` empties the row; the Bond tab still asks for an ascension when adding a servant. No console errors. Then `astro dev stop`.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/ce-servant-select.js src/scripts/ce-filter-app.js src/scripts/selectors.js scripts/build_baseline.json
git commit -m "feat: pick servants for the CE Filter Servant Select sub-tab"
```

---

### Task 4: Combo rows

**Files:**
- Modify: `src/scripts/ce-servant-select.js` — fill in `render()` and add the row builders
- Modify: `src/scripts/ce-filter-app.js` — add `selectCEFromCombo(ceId)` next to the other public methods
- Modify: `src/styles/global.css` — row and section styles
- Test: `scripts/verify_render.js` (Task 5)

**Interfaces:**
- Consumes: `ServantComboCalculator.buildSharedCEGroups(entries, pickedIds)` → `{ groups, unshared, truncated }` (Task 1), `CEList` from `data.js` for `name` and `thumbImage`, `DOMFactory.createLazyImg(src, cls, attrs)`, `DOMFactory.addSimpleFallback(img, cls, id)`, `ServantData.getServant(id)`, `CEFilterApp._switchSubTab(sub)` (Task 2).
- Produces: `ServantSelect.render()` painting `#cefilterComboResults`, and `CEFilterApp.selectCEFromCombo(ceId)`. Classes `.cefilter-combo-size`, `.cefilter-combo-group`, `.cefilter-combo-ce`, `.cefilter-combo-servants`, `.cefilter-combo-more`.

- [ ] **Step 1: Compute and paint**

`render()` calls `this._deps.getEntries()`, runs `buildSharedCEGroups`, then buckets the rows by `ceIds.length` in descending order. Per bucket: one `h3.cefilter-combo-size` reading `<N> CE · <M> groups`, then the rows. A bucket with zero rows is never created (Review Focus 4). Each row `.cefilter-combo-group` holds `div.cefilter-combo-ce` per CE — `createLazyImg(ce.thumbImage, "cefilter-combo-ce-img", { alt: ce.name, title: ce.name })` plus `addSimpleFallback`, then a `span` with `ce.name` — and a `.cefilter-combo-servants` line listing the covered servants by name. Each CE is clickable per the `_buildCard` badge pattern at `ce-filter-app.js:632-649`: `cursor: pointer`, a click handler that stops propagation and calls `CEFilterApp.selectCEFromCombo(ceId)`. Add that method to `ce-filter-app.js` in this task — push `ceId` into `state.selectedCEs` when absent, reset `state.currentPage` to `1`, `this.render()`, then `this._switchSubTab("ce")`, so the click hands the user to `Craft Essence Select` with that CE already chosen. `CEServantOverlap.open(entry)` is not reused — it takes a servant match entry, not a CE. Assemble in a `DocumentFragment`, one `replaceChildren()` on `#cefilterComboResults`. Update `#cefilterComboCount` to the group total.

- [ ] **Step 2: Keep the tab responsive**

Show at most 5 rows per bucket; beyond that append a `button.cefilter-combo-more` of `type="button"`, `aria-expanded="false"`, labelled `Show N more`, that reveals the rest of its bucket on click. Build the fragment inside the double `requestAnimationFrame` yield the app already uses for heavy renders, and cap the initial build at the first 60 rows across all buckets — rows past 60 wait behind the same button. Review Focus 5: the 20-servant budget case must not paint 50k rows.

- [ ] **Step 3: Empty, unshared, truncated**

`groups.length === 0` → `#cefilterComboEmpty` visible with `No CE is usable by two or more of these servants.` and results cleared. `unshared.length > 0` → `#cefilterComboUnshared` visible, text `No shared CE with: ` + the servant names joined, resolved through `ServantData.getServant(id).name` (Review Focus 1). `truncated` → `#cefilterComboTruncated` visible, text `Too many combinations — remove a servant.` Hide all three when they do not apply, every render, not only on the first.

- [ ] **Step 4: Re-render on every input change**

`addServant`, `removeServant`, `clearPicked`, the expander and `_switchSubTab("servant")` all call `render()` directly. Every one is a single click, so no debounce and no new timer.

- [ ] **Step 5: Lint, build, re-capture**

Run: `npm run lint && npm run build && node scripts/check_build_output.js --write && npm run check:build`
Expected: all exit 0.

- [ ] **Step 6: Browser check against real data**

Run `npm run dev`. Add, in order, `Mash Kyrielight`, `Jeanne d'Arc`, `Kukulcan`, then `U-Olga Marie`.
Expected after three: `4 CE · 1 group` (Checking Reports, Needle of Sincerity, Blessed Bride, Foreign God · Jeanne, Kukulcan) above `3 CE · 1 group` (the same three less Foreign God · Mash, Jeanne, Kukulcan), and no `2 CE` or `1 CE` section. Adding U-Olga Marie inserts a second `4 CE` row starting `Chaldea Morning`, lengthens both existing rows to include her, and the count line goes `2 groups`. Every name and count above is from this checkout's data and must match exactly; a mismatch means the usable-list union is wrong, not the sort.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/ce-servant-select.js src/scripts/ce-filter-app.js src/styles/global.css scripts/build_baseline.json
git commit -m "feat: render shared craft essence groups per servant group"
```

---

### Task 5: Browser gate, docs, final verification

**Files:**
- Modify: `scripts/verify_render.js` — extend the CE Filter assertion group at `:94-108`
- Modify: `.claude/CLAUDE.md` (untracked) and `.claude/docs/progress.md` (untracked). This repo gitignores `.claude`, `docs/`, `design-docs` and `.plans` (`.gitignore:1-7`), so all planning and guidance docs stay local by convention — expect nothing from them in the commit.

**Interfaces:**
- Consumes: the ids and classes Tasks 2-4 produce.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add the assertions**

In the CE Filter group, after the existing `#cefilterResults > .cefilter-servant-card` check: click `.tab-btn[data-tab="cefilter"]`, then `button.cefilter-subtab-btn[data-subtab="servant"]`; assert `#cefilterSubCE` is `hidden`, `#cefilterSubServant` is not, and `#cefilterServantAddBtn` is clickable. Click it, wait for `#servantModal.open`, click the first `#servantPickerGrid` item, then a second, and assert `#cefilterServantChips > .cefilter-servant-chip` has 2 children and `#cefilterComboResults > .cefilter-combo-group` has at least 1 — Review Focus 2, 3 and 4 pinned at the page level. Reuse the existing error collection; a `pageerror` still fails the run.

- [ ] **Step 2: Run the gate**

Run: `npx astro preview --port 4173` then `node scripts/verify_render.js`
Expected: exit 0, the new CE Filter sub-tab assertions reported passing. Then `astro preview stop`.

- [ ] **Step 3: Full suite**

Run: `npm test && npm run lint && npm run format:check && npm run build && npm run check:build && npm run data:validate`
Expected: every command exits 0.

- [ ] **Step 4: Update the docs**

Under **CE Filter** in `.claude/CLAUDE.md`, add that the tab has two sub-tabs, `Craft Essence Select` (CEs → servants) and `Servant Select` (servants → shared-CE groups, groups of ≥2, deduped by CE list, no persistence), and that `domain.js` now exports `ServantComboCalculator`. Tick the feature off in `.claude/docs/progress.md`. Note in the progress entry that `.claude/` is untracked in this repo, so these edits stay local.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify_render.js
git commit -m "test: drive the Servant Select sub-tab in the browser gate"
```

- [ ] **Step 6: Check nothing tracked is left behind**

Run: `git status --short`
Expected: clean.

---

## Not covered by this plan

Merging `feat/ce-filter-servant-select` into `develop` and `main`, and the Pages deploy, are a separate decision — `develop` is local-only, so a push publishes `main` directly. Persistence of the picked list, share URLs, and per-ascension narrowing are deliberately out (see Non-goals).
