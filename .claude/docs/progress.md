# Progress Log

> **2026-05-11 — Migrated from vanilla JS/esbuild to Astro.** See commit `f78ea36`. The project is now a pure Astro static site with Vite bundling. Old esbuild config, `build.cjs`, `sw.js`, `register-sw.js`, `index.html`, `styles.css`, `data/` root dir, and `src/*.js` (flat) have been removed. Source now lives under `src/scripts/`, `src/styles/`, `src/layouts/`, `src/pages/`, and `public/`. Docs updated accordingly.

---

## 2026-11-09 — feat(ci): enforce update-describing commit messages in merge_code_only and align branch docs

- **Commit Message Enforcement & Hardening in `scripts/merge_code_only.sh`**:
  - Updated argument parsing to support `scripts/merge_code_only.sh <commit_message>` (defaulting source branch to `develop`) as well as `scripts/merge_code_only.sh [source] <commit_message>`.
  - Added strict validation requiring a non-empty, non-whitespace commit message (`[ -z "${MSG//[[:space:]]/}" ]`) describing what was updated.
  - Added regex guard rejecting generic `Merge branch ...` messages including leading whitespace and flexible spacing (`^[[:space:]]*[Mm]erge[[:space:]]+branch`).
  - Added unquoted argument count guard (`[ "$#" -gt 2 ]`) warning users to quote multi-word commit messages if spaces are unquoted.
  - Switched commit step to always commit with the validated message (`git commit -m "$MSG" --quiet`).
- **Documentation & Workflow Alignment Across Specs**:
  - `AGENTS.md`: Updated merge-to-main instructions to require an update-describing commit message and forbid generic "Merge branch 'develop'".
  - `.claude/CLAUDE.md`: Updated Deployment & CI/CD Pipeline section to mandate `<commit_message>` for `merge_code_only.sh`.
  - `skills/fgo-calculator/SKILL.md`: Completely purged obsolete mentions of deleted `global.css`/`critical.css` (warning box and checklist) and removed Stylelint reference; updated Git Branch Workflow to document local-only `develop`, prohibit plain merges into `main`, and mandate `scripts/merge_code_only.sh "<commit_message>"`.
- **Verification & Test Coverage**:
  - Added comprehensive test suite in `tests/merge-code-only.test.js` covering 0 args, branch-only args, generic merge message variants, whitespace-only messages (`"   "`, `"\t\n "`), leading-space bypasses (`"  Merge branch ..."`), and excessive unquoted arguments (`>2`).
  - All 199 unit tests pass cleanly (`npm test`).
  - ESLint (`npm run lint`) and Prettier (`npm run format:check`) pass with 0 errors and 0 warnings.

---

## 2026-11-09 — feat(layout): adopt fluid dynamic pure CSS zoom for seamless wide-screen scaling

- **Fluid Auto-Dynamic Pure CSS Zoom Architecture**:
  - `src/layouts/BaseLayout.astro`: Upgraded wide-screen scaling to a single, continuous, declarative pure CSS rule:
    - `@media (min-width: 1400px)`: `html { zoom: min(2, calc(100vw / 1400px)); }`, `:root { --screen-h: calc(100dvh / min(2, calc(100vw / 1400px))); }`.
  - Scales automatically and continuously with viewport width from 1400px up to 2800px (2x cap) with exact 1:1 pixel fidelity, identical to the deployed site.
  - Zero stepped jumps, zero fragile manual CSS overrides, zero JavaScript resize listeners.
- **QA Suite Assertions Updated**:
  - `scripts/test_qa_viewport_modal_bounds.js`:
    - Suite 1: Verified `--screen-h` starts with `100dvh` or `calc(100dvh`.
    - Suite 5: Added dynamic zoom assertion `zoomMetrics.zoom === Math.min(2, svp.width / 1400)` and verified card expansion across viewports.
- **Zero JavaScript Runtime Overhead**:
  - Zero `<script>` tags, zero DOM mutations, zero resize event listeners. Fully compliant with Trusted Types CSP.
- **Verification**:
  - All 190 domain unit tests pass (`npm test`).
  - ESLint passes cleanly with 0 errors, 0 warnings (`npm run lint`).
  - Astro build succeeds in 653ms (`npm run build`).
  - Build baseline verification passes (`npm run check:build`).
  - Headless Puppeteer QA suite passes all 5 suites defect-free (`node scripts/test_qa_viewport_modal_bounds.js`).

---

## 2026-11-09 — feat(layout): comprehensive multi-tab pure CSS scaling calibrated against deployed zoom metrics

- **Mathematical Calibration Against 1400px Zoom Dimensions**:
  - `src/layouts/BaseLayout.astro`: Refined `@media (min-width: 1500px)` and `@media (min-width: 1800px)` breakpoints to exactly replicate the physical rendered visual proportions of the original 1400px dynamic zoom behavior without JavaScript runtime execution:
    - **Laptop 1.25x (1536px viewport, zoom factor ~1.097x)**: Root font-size `17.55px`, `--servant-portrait-h: 105px;`, `--ce-badge-h: 53px;`, `--slot-ce-h: 70px;`, `.container { max-width: 1229px; }`, 176px cards (`repeat(6, minmax(0, 176px))` / `repeat(3, minmax(0, 176px))`), 105px material icon height with 88px fg-layer, 53px mini-icons, 39px CE filter control heights, and 53px class buttons.
    - **Desktop 1.0x / Ultrawide (1920px viewport, zoom factor ~1.371x)**: Root font-size `21.94px`, `--servant-portrait-h: 132px;`, `--ce-badge-h: 66px;`, `--slot-ce-h: 88px;`, `.container { max-width: 1536px; }`, 220px cards (`repeat(6, minmax(0, 220px))` / `repeat(3, minmax(0, 220px))`), 132px material icon height with 110px fg-layer, 66px mini-icons, 49px CE filter control heights, 66px class buttons, and 1100px servant modal width.
    - **Multi-Tab Parity & Cascade Ordering Fix**: Ordered `.grid` (3 columns) before `.cefilter-results-grid` (6 columns) in media queries so that `<div class="cefilter-results-grid grid">` correctly inherits 6 columns at >=1500px and >=1800px instead of being overridden to 3 columns. Fully synchronized Event Shop, CE Filter, and Bond Calculator tabs alongside global components.
- **QA Suite Assertions Updated**:
  - `scripts/test_qa_viewport_modal_bounds.js`: Aligned Suite 5 assertions with the calibrated values and verified that `.cefilter-results-grid` computed style contains exactly 6 columns at 1536px and 1920px:
    - 1536px: `portraitH: "105px"`, `ceBadgeH: "53px"`, `slotCeH: "70px"`, `fontSize: "17.55px"`, `cardW: 176`, `maxW: "176px"`.
    - 1920px: `portraitH: "132px"`, `ceBadgeH: "66px"`, `slotCeH: "88px"`, `fontSize: "21.94px"`, `cardW: 220`, `maxW: "220px"`.

---

## 2026-11-09 — refactor(layout): remove wide-screen zoom hack and adopt 100dvh viewport units

- **Removal of 1400px JS Zoom Hack**:
  - `src/layouts/BaseLayout.astro`: Removed the `<head>` inline resize listener script that dynamically computed and set `de.style.zoom` on `<html>` above 1400 CSS px.
  - Eliminated zoom-related coordinate distortions, browser-specific zoom quirks, and oversized viewport recalculations.
- **Modern Responsive Viewport Units**:
  - `src/layouts/BaseLayout.astro`: Changed `--screen-h: 100vh;` to `--screen-h: 100dvh;` in the inline `:root` stylesheet for accurate dynamic mobile and desktop viewport sizing.
  - Site layout now operates strictly on standard CSS media queries and native responsive layout rules.
- **Documentation Synchronization**:
  - Synchronized `AGENTS.md`, `GEMINI.md`, `.claude/CLAUDE.md`, `.claude/docs/structure.md`, and `.claude/docs/security.md` to remove all references to the wide-screen magnification zoom hack.

---

## 2026-11-08 — refactor(filter): extract availability predicates and active filter pruning

- **Shared Predicate Extraction (`createAvailPredicates`)**:
  - `src/scripts/filter-sections.js`: Extracted `createAvailPredicates(avail = {})` to unify predicate checking between `selectAll` and `renderStandardRows`. Standardized predicate signatures to `(chip) => boolean` handling both chip objects and direct ID strings.
  - Decomposed `FilterModalController.renderStandardRows` into single-responsibility helpers `_renderClassAndGroupRows` and `_renderTraitRows`, keeping all controller and section functions strictly < 20 lines.
- **Active Filter Pruning & GBE Alignment (`CEFilterApp`)**:
  - `src/scripts/ce-filter-app.js`: Extracted `_pruneActiveFilters(avail)` from `renderResults(ceFiltered)` (< 20 lines) to eliminate duplication and keep filter pruning modular.
  - In `_computeAvail(base)`: Replaced hardcoded `"0303"`, `"0304"`, `"0305"` trait checks with `ServantFilters.GBE.includes(t)`.
- **Test Suite Updates**:
  - `tests/ce-filter-modal-avail.test.js`: Fixed comment labeling `"0301"` as "Chaotic" instead of "Neutral". Added unit tests covering `createAvailPredicates` and `_pruneActiveFilters`.
  - All 190 tests pass with zero regressions; ESLint passes with 0 errors.

---

## 2026-11-08 — fix(bond): eliminate layout shift in Bond Calculator tab

- **Problem**: Opening or refreshing the Bond Calculator tab (#panel-bond) suffered dual layout shifts:
  1. Select Quest card in static HTML displayed all 4 dropdown rows (Main, Quest, Class, Difficulty) plus the custom quest section (~366px tall), which abruptly collapsed by up to 226px when `syncQuestRows()` hid unselected rows after lazy hydration.
  2. `#servantGrid` was empty in static HTML (height: 16px), and expanded by ~358px to 374px+ once `buildServantSlots()` dynamically inserted 8 elements (2 group labels + 6 servant slots), violently shifting down `.bond-card-actions` (Max AP, Teapot, Calculate Quest Runs button) by over 130px.
- **Pre-paint Quest Synchronization**:
  - `BaseLayout.astro`: Synchronous `<head>` script inspects `fgo_bond_calculator_data` in localStorage on initial parse. Sets `data-bond-quest="fq"` or `"gd"` (and `data-bond-custom="1"`) on `<html>`.
  - Inlined `<style is:inline>`: Added display rules hiding `.bond-quest-row--free`, `.bond-quest-row--grand`, and `.custom-quest-section` by default (`display: none;`), un-hiding matching rows via `html[data-bond-quest="..."]` before first paint.
  - `src/pages/index.astro`: Added `.bond-quest-row--free` and `.bond-quest-row--grand` classes to respective quest `.input-row`s.
  - `src/scripts/bond-app.js`: Extracted `_syncQuestAttributes(freeOn, grandOn)` in `syncQuestRows()` (<15 lines each) to keep live DOM attributes and inline styles synchronized during runtime select changes.
- **Pre-rendered Default Servant Grid**:
  - `src/pages/index.astro`: Pre-populated `#servantGrid` with the 2 group labels ("Starting Member", "Sub Member") and 6 empty `.servant-add-slot` elements matching the exact DOM output of `buildServantSlots()`.
  - `BaseLayout.astro`: Added `.servant-add-slot { cursor: pointer; }` to inline stylesheet, eliminating repetitive inline styles.
- **Verification & Zero CLS Proof**:
  - Created automated regression suite `scripts/test_bond_layout_shift.js` asserting pre-hydration vs post-hydration element geometry across 7 scenarios (fresh session, saved Free Quest, saved Custom FQ, saved Grand Duel, viewports 320px–1600px, and malformed storage). Measured layout shift is exactly **0.00px**.
  - All 162 unit tests passing, all Python regression checks passing, baseline updated via `scripts/check_build_output.js --write`.

## 2026-11-08 — feat(sync): switch Atlas image fetching to lossless WebP

- `scripts/sync_atlas_data.py` (`download_face_icon`) and `scripts/fetch_bordered_ces.py` (`download_ce_icon`): changed WebP encoding from lossy `quality=80, method=6` to `lossless=True, method=6`.
- Ensures downloaded Atlas servant and CE face icons retain full pixel fidelity without lossy compression artifacts.
- Verified with unit tests and adversarial QA tests verifying zero pixel degradation on decode and no regressions across python test suites (`test_check_data_version.py`, `test_deploy_workflow.py`, `test_drift.py`).
- Updated `.claude/docs/fetch-data-guideline.md` manual CLI instructions and script docstrings.


## 2026-11-06 — feat(filter): Filter Settings becomes eight labelled sections

Design `.claude/docs/archive/2026-11-05-filter-settings-rework-design.md`, plan `.claude/docs/archive/2026-11-05-filter-settings-rework-plan.md` (both archived once shipped).

- Rarity / Class / Class (Group) / Alignment (Lawful·Neutral·Chaotic) / Alignment (Good·Balanced·Evil·Other) / Sub-Attribute / Gender (added after approval) / CE Bonus, each a centred label over centred chips with the card's 2px separator; one column, the modal body scrolls (owner choice A).
- One chip builder: `FilterSections.renderRow` / `chipEl` (`src/scripts/filter-sections.js`) replaces `CEFilterApp.buildClassFilter`/`buildRarityFilter` and `ServantSelector._buildClassFilter`/`_buildRarityFilter`. A chip is now `<button aria-pressed>`, because the class row has to render a chip that exists but cannot be clicked.
- New state (page-scoped, never persisted): `groupClassFilters`, `aliFilters`, `subAliFilters`, `subAttrFilters` beside the existing `classFilters` / `rarityFilters` / `matchCounts`.
- Rules in `ServantFilters` (`domain.js`): union inside a row, AND across rows, empty row = no filter; `rowScope` is the display bound (group chips and a Grand Duel lock only — a class pick never greys a sibling, owner decision), `effectiveClassIds` what the grid matches on; `Other` = the Good/Balanced/Evil complement (Madness, Summer live there).
- `CLASS_GROUPS` (`constants.js`): Three Knights = Saber/Archer/Lancer, Four Cavalries = Rider/Caster/Assassin/Berserker, Extra I/II reused from the Grand Duel lists — all four are class-id lists, so no hand-maintained servant roster and `data:sync` is untouched.
- Word chips (group, both alignments, sub-attribute) size to their text (`width: auto`), rarity and CE-count chips keep the 48px box; separators are `2px` of `var(--border)`, the same recipe as a card's own border (a 1px hairline read as absent).
- Data check (`npm run data:sync`, full servant revalidation): the stored data matched Atlas exactly, so the first pass concluded Alice had no Earth anywhere. **That conclusion was wrong and is superseded by `b13919d`**: the sub-attribute is not in `ascensionAdd.individuality` at all, it is in `ascensionAdd.attribute.ascension` (`{'3': 'earth', '4': 'earth'}` for 415, long id 505500), which `sync_atlas_data.py` never read. Now mapped to `02xx` onto the stage sets: 415 human→earth, 465 Demeter heaven→star, 416 Hibiki & Chikagi earth→star, 444 U-Olga Marie star→human. `2011 skyOrEarthServant` / `2903 kuonjiAliceStage3` are skill-AI gate conditions, correctly dropped by `normalize_trait_id`. `npm run data:validate` clean; `servants.js` is gitignored so only the script and the test changed. **Requires `npm run data:sync`** (or a CI sync run) before the per-stage attribute shows in the app — an old generated `servants.js` still lacks it.
- Follow-up fixes (`f534ff6`), both found by the owner testing by hand: `_applyFilters` and the class/rarity availability passes matched `entry.servant.traits` (the base list) instead of `this._traitsOf(entry)` (the ascension the card shows), so no alignment trait living in an ascension diff could be filtered on at all — broken before this rework too; and `rowMatches` let the `Other` chip veto the chips beside it in its own row.
- Follow-up (`ServantData.getAllTraits`): `base` is the intersection of the stages, so the four attribute-changing servants named no sub-attribute to anything that reads the whole servant — the Bond tab's party picker (`ServantSelector.getFilteredServants`) and a result card with no `primaryAscension` (`CEFilterApp._traitsOf`). Both now read `getAllTraits(id)`, the cached union of every form, so Alice answers to Human and Earth in a picker that has not chosen a form, while a card that has chosen one still answers to that form alone.
- `tests/servant-filters.test.js` (new, 16 tests, 75 in the whole suite), `scripts/verify_render.js` picker blocks re-pinned to the greyed-not-dropped DOM plus a new Bond Gain CE section block, `scripts/build_baseline.json` re-captured with `--write`.
- Not run by the author: `npm run test` and `npm run build` passed; `node scripts/verify_render.js` was **not** executed after the last markup change (owner tests by hand at `localhost:3000`).

## 2026-11-05 — feat(bond): servant picker modal takes the Bond Gain CE tab's shape

Asked as *"rework servant modal in bond calculator tab to be consistent with Bond Gain CE tab — search bar outside filter, filter button pops up a sub-modal and sort config next to it"*, then *"in grand duel single class will not have class sort selectable"*, then *"space between search and filter in modal should be consistent with Craft Essence Select, currently too much"*.

The picker's filters had lived in a `CollapsibleFactory` "Filters" box with the search bar buried inside it. `#servantModal` now carries `#servantPickerSearch` in a `.cefilter-search-container`, one `.cefilter-sort-row` (`#servantPickerFilterBtn` → `#servantPickerSortBy` ID / Rarity / Class → `#servantPickerSortOrder` ▲/▼), then the grid; class and rarity moved into a nested `#servantFilterModal`. `ServantSelector.buildFilterArea()` became `syncPickerControls()` — it reads the remembered row back and refills the two sub-modal rows. `#ceModal` (essence picker), the ascension prompt and the overlap modal keep their collapsible: one modal, not a sweep.

Non-obvious bits:
- **The modal is shared**, so the Bond party picker and the Bond Gain CE **Servant Select** picker changed together — that is the consistency asked for, not collateral.
- **Stacking is DOM order.** Every `.servant-modal` is `z-index: 1000`, so `#servantFilterModal` had to be written *after* `#servantModal` in `index.astro` or it would have opened underneath it.
- **Escape learned layers.** Both modals listen on `document`; the picker's handler now returns while the sub-modal is open, so one press peels the sub-modal and the next closes the picker. `close()` clears both, which is also what keeps a pending-slot cancel from leaving the sub-modal over the tab.
- **8px read as 24px until it was told to stay 8.** `.servant-modal-content` is a flex column with `gap: 8px`, and a flex gap does not collapse adjacent margins — the tab's `margin-bottom: 8` on the search container plus `margin-top: 8` on the sort row, which collapse to 8px in normal block flow, added 8 + 8 + 8 inside the modal. One shipped rule zeroes both margins under `#servantModal`, and the gate measures the gap on both sides rather than trusting the cascade.
- **Class icons switched from `data-src` to `src`.** `CollapsibleFactory.build()` promoted `data-src` → `src` on the box's first open; with the row living in a modal nothing promotes them, so every class button would have rendered an empty tile.
- **One comparator, not two.** `ServantSort` (`domain.js`, `tests/servant-sort.test.js`) took over the CE tab's `_getEntryRarity` / `_getEntryClassIndex` / inline `sort()` and deleted its 10-line `getClassOrderMap`; the card shape passes its own id and trait resolvers, since a result card is a servant plus the ascension it matched on. The picker sorts at the end of `getFilteredServants()`, so ordering never interferes with filtering. `verify_render.js` gained a CE-tab block that re-orders the result grid through the shared path and puts it back — the refactor no unit test could see, `ce-filter-app.js` having no DOM harness.
- **Single-class Grand Duel greys Class out** and drops a remembered `class` sort back to `id`, for the same reason `syncPickerControls()` builds no class row there. Extra I / Extra II / Extra keep it — those span several classes.

Verification: `npm run test` 57/57 (7 new) · `npm run lint` exit 0 · `npx prettier --check` clean on the touched files · `npm run build` ✓ · `npm run check:build` SUCCESS after one `--write` re-capture (`rawTextSha` / `normalisedTextSha` moved by design — the page gained the search placeholder, "Filter", "ID/Rarity/Class", a second "Filter Settings" title) and green again after the CSS rule with **no** second re-capture, because the signature strips `<style>` bodies. The re-capture also absorbed **pre-existing** byte drift: a build of the untouched HEAD tree gave `selectors-chunk` 28849 B and `ce-filter-chunk` 21774 B against a committed baseline of 22883 B and 27650 B, so the baseline had gone stale in both directions before this change. This change's own delta is `selectors-chunk` 28849 → 31278 B and `ce-filter-chunk` 21774 → 21000 B, both inside the ceilings, no chunk renamed, no head marker moved · `node scripts/verify_render.js` SUCCESS, new blocks: search-to-controls gap 8px on both sides, ID ascending at first paint over 472 cards, Rarity desc an exact reverse of Rarity asc, that choice surviving a reopen and a refresh wiping it, the Filter button opening the sub-modal over the picker with Escape leaving the picker open, and Saber greying Class with the sort back on ID. The new blocks were proved to bite by running the gate against a build of HEAD's tree first: it dies with `Error: No element found for selector: #servantPickerFilterBtn`.

Not checked by any gate: the sub-modal's own scroll height (`.cefilter-modal-body` keeps the tab's `calc(var(--screen-h) * 0.8 - 80px)` rule, untouched), and `AscensionSelector.back()`, which reopens the picker and so inherits the same controls without being re-measured.

## 2026-11-05 — feat(sync): bond CEs that differ on a support servant (`supportBonus`)

`scripts/sync_atlas_data.py` now reads the `followerVals` of the chosen `servantFriendshipUp` function next to its `svals`. When the two differ, the CE ships `bonus` (worn by your own servant) **and** `supportBonus` (worn by a servant you borrowed as support). Of the 59 detected bond CEs exactly one differs — **0910 Chaldea Teatime, 5% self vs 15% support** — and it was carried by the `CE_OVERRIDES = {"0910": {"bonus": 15}}` hardcode, which is deleted; the override dict itself stays for future holes in Atlas's data. `_bond_rates()` is the one parser for both value lists.

- `supportBonus` joins the same-effect signature used for grouping, so a campaign series can never group variants whose support rates disagree.
- `CEList` (`src/scripts/data.js`) whitelists the field — without that line the value is silently stripped at load.
- `SlotCEs.partyPool()` returns `{ entry, isSupport }` instead of bare entries: the rule needs to know *whose* servant wears the essence, and the pool is the only place that knows. `SlotCEs.rate(ce, isSupport)` (`domain.js`) is the single chooser, used by `calculate()` and by `_ceBonusText()`, so the chip title, the results badge and the maths agree.
- The applied-CE literal became a copy `{ ...ce, bonus: rate }` and deliberately carries **no** `isSupport` flag — the results renderer already uses that name for "this badge is a frontline support *servant*" (`+4% All`), and a borrowed essence is not one.
- Follower `AddCount` (flat bond) is not parsed: no CE in Atlas has one today. `shortcut:` comment at the call site.
- **Numbers move for the player**: a Teatime on your own servant is now 5%, not the 15% the hardcode printed. A friend's support servant wearing it still gives your party 15%.

Verification: `npm run test` 36/36 (two `partyPool` asserts updated, one new `rate` test) · `npm run lint` exit 0 · Prettier clean · `npm run build` ✓ · `npm run check:build` SUCCESS, baseline re-captured with `--write` (`bond-lazy` 19012 → 19051 B, `ce-filter-chunk` 26548 → 26644 B, no chunk renamed, no head marker moved) · `node scripts/verify_render.js` SUCCESS.
The 5%/15% split was proved against the served production build with a throwaway Puppeteer probe (`fgo_bond_calculator_data` seeded with CE `0910` in slot 0 Normal and slot 1 support, custom quest 1,000 pts/run): chip titles `Chaldea Teatime · +5% All` and `Chaldea Teatime · +15% All`, result badges `Chaldea Teatime +5%` and `+15%`, and `1,000(+488)` on the card — which is `floor(200 × 1.24) + 200 + 40`, i.e. the 20% the two essences contribute, not the 30% the old hardcode would have paid (612) or the 10% a both-self reading would (364). `RUNS: 4` = `ceil(5000 / 1488)`. The same check is now permanent: the last block of `scripts/verify_render.js` seeds that exact save, reloads, and asserts both chip titles, both result badges and the `+488` bonus — three failures fire when `SlotCEs.rate` is stubbed to ignore `supportBonus` (chips and badges fall to `+5%`, bonus to `+364`), which is how the block was proved non-vacuous.
Not checked by any gate: the fetcher's live network path — `extract_bond_craft_essences()` and `update_craft_essences_js()` were run against the cached `.cache/atlas/nice_equip_lang_en.json`, whose only diff against the shipped file was the 0910 pair.

## 2026-11-05 — feat(bond): craft essences moved into the servant slot

Plan `.claude/docs/archive/2026-11-05-bond-slot-ce-rework-plan.md`, spec `.claude/bond-grand-ce-slot.html`, executed inline on `feat/bond-slot-ce` (commits `50e745e..` — six commits, one per task).

The "Craft Essences Bonus" card became a block inside every servant card. Each slot owns `ces: []` + `grand: false`; capacity 1, 2 under **Grand Servant**; chips portrait only at 64px. The maths is untouched — `calculate()` walks `SlotCEs.partyPool(slots)` — which is the whole reason `SlotCEs` exists as a domain object instead of rendering logic: `tests/bond-slot-ces.test.js` pins capacity, trim, pool order, the shape rule and the clamp without a browser.

Non-obvious bits:
- **Task order had to bend.** Dropping `state.ces` in Task 2 while `buildCESlots()` (`this.state.ces.length`) and `calculate()` (`this.state.ces.forEach`) still read it would ship a Bond tab that throws on init, and no unit test can see that — the DOM has no unit harness here. Task 2 therefore also took Task 3's `partyPool` swap and the removal of `buildCESlots()`'s call, so no intermediate commit is broken. The dead functions went in Task 3.
- **Collapsed, not hidden.** Support and Max Bond slots used to build the level selects, the point box and (for Support) the tick row, then hide them with `visibility: hidden` — the card kept the height. Creation is gated on `isSupport` / `isBondHidden` now, and the essence block moves up: 415px Normal, 317px Max Bond, 298px Support, which is the mock's 98px/117px saving to the pixel. The hidden-state `--hidden` classes are gone from CSS and JS. Nothing resets `slot.bondLevel`/`targetLevel`/`bondNeeded`, so a Support round trip returns the player's own figures (the gate reads the box value to prove it).
- **Old saves load empty.** `data.ces` is dropped rather than dealt out to the cards, and each slot's own list goes through `SlotCEs.sanitize`, which is the same shape rule the old pool filter used (non-empty string, or `{groupId, optionId}` — a `groupId` alone is dropped) plus a clamp to capacity, so a hand-edited three-chip save with `grand: false` comes back as one chip.
- **`#ceGrid` has two remaining references and both are the guard**: `scripts/verify_render.js` asserts it is *absent*. `grep -rn "ceGrid\|buildCESlots\|state\.ces" src/ scripts/` finding only those two lines is the expected state, not a miss.
- `.calculate-btn` is shared with the Event Shop tab, so the smaller bond button is scoped to `.bond-card-actions` and the gate measures both widths (bond 31% of its row, event 100%) rather than trusting the cascade.
- The dead `onOpenSubSelector` callback went with `buildCESlots()` — nothing has ever called it; `CESelector.renderGrid` opens `CESubSelector` itself.

Verification: `npm run test` 35/35 · `npm run lint` exit 0 · `npm run build` ✓ · `npm run check:build` SUCCESS after `--write` (the page text lost "Craft Essences Bonus" and reordered, so both signatures moved; `bond-lazy` shrank, `ce-filter-chunk` grew) · `node scripts/verify_render.js` SUCCESS, including the new bond-slot blocks: chip height 64px, one chip Normal / two on Grand / one again after untick, equip and remove through the picker, no block on an empty slot, field collapse and height, tab order and button widths.
Not checked by the gate: an unresolvable CE id rendering the fallback tile (needs a seeded save plus reload — pinned only by the code path and `SlotCEs.sanitize`), and the picker-cancel path that splices a pending hole. Both were eyeballed at `localhost:3000` by the owner.

## 2026-11-05 — feat(bond): "Party Setup" card title

Asked as "in bond calculator tab change *Bond Points Requirements* to *Party Setup*". One string, one place: `src/pages/index.astro:417`, the `card-title` of the first card in `#panel-bond` (the servant-grid card). A case-insensitive repo-wide grep found no other occurrence — no test, doc, or gate asserted the old wording, so nothing else needed rewording. `scripts/verify_render.js` asserts the slot point box's label (`Next Lv. Required`), a different element, and was untouched.

The one non-obvious step: `npm run check:build` pins two page-text signatures (`rawTextSha`, `normalisedTextSha`), so any visible title change trips it by design — that is the only failure this produced, and `npm run check:build -- --write` is the documented route for an intentional change, not a workaround. Re-capture also absorbed **pre-existing** byte drift: `bond-lazy` was 19347 B against a 19349 B baseline and `ce-filter-chunk` 26056 B against 25880 B. Neither came from this edit — rebuilding at HEAD's old markup gives the same two sizes, so the baseline had gone stale by 2 B and 176 B before it, inside the floor/ceiling tolerance and therefore only ever reported as a NOTE. No chunk was added and no head marker moved.

Verification: `npm run build` ✓ · `npm run lint` exit 0 · `npm run test` 25/25 · `npm run check:build` SUCCESS after re-capture.
Not checked: not viewed in a browser, and `node scripts/verify_render.js` was not run — the new title is shorter than the old, so no clip risk, and no assertion covers card titles.

## 2026-11-04 — chore(repo): docs made reachable, dead files deleted, CSS collapsed to one home

Prompted by "can another AI agent pick this up from the docs?" — it could not, and one dead file was quietly costing the live site.

### Agent handoff (commits `75be629`, `fd32889`)
- `.gitignore` said `.claude` on line 1, so `CLAUDE.md` and all of `.claude/docs/` were untracked: invisible to CI, to a fresh clone, and to any non-Claude agent. Now `.claude/*` + `!.claude/CLAUDE.md` + `!.claude/docs/`; `settings.local.json` stays local. Traps, both silent: a bare `.claude` line cannot be re-included (git does not descend into an excluded directory), and the file's own `docs/` pattern matched `.claude/docs/` and cancelled the new negation — anchored to `/docs/`.
- `AGENTS.md` / `GEMINI.md` were byte-identical and every link in them was `file:///d:/Dev/Projects/fgo-calculator/…`, a Windows path matching neither clone: no agent could follow one reference. `AGENTS.md` is now the contract with repo-relative links; `GEMINI.md` points at it plus the six non-negotiables, so the copies cannot drift again.
- "MUST ALWAYS read `.claude/docs/`" meant 320 KB, ~60-80k tokens before any code. Mandatory read is now the four ~25 KB docs (`code-style`, `structure`, `data-rules`, `security`); `CLAUDE.md`, `progress.md` and `fetch-data-guideline.md` are marked on-demand with their sizes.
- 26 `file:///mnt/storage/…` links in this log rewritten relative.
- `AGENTS.md` states `/home/famakung/dev/fgo-calculator` is the main checkout and `/mnt/storage` is off-limits — this log already records an agent that ran a command without `cd`, read the stale copy, and reported bugs that do not exist here.

### Dead files (commit `8e59fc1`)
- `src/styles/critical.css`, `.claude/docs/download_image.py`: zero importers.
- `npm run lighthouse` + `lighthouse` devDependency: the script ran `lighthouse-runner.js`, a gitignored temp file present in neither clone, so the documented command was broken. 1,616 lockfile lines. `npx lighthouse <url>` instead.
- Audit method mattered: a filename grep calls `scripts/fetch_bordered_ces.py` dead, but `sync_atlas_data.py:1345` does `from fetch_bordered_ces import sync_ces`. Name-grep alone would have broken the data sync.
- Kept, with reasons: `public/sw.js` (killswitch for browsers still holding the old PWA registration — nothing registers it, deleting it could strand one), and the `fluid-desktop-layout-*.md` pair (both already open with "do not build this" banners).

### One stylesheet (commit in this batch)
- Deleted `src/styles/global.css` (47 KB) and `src/styles/critical.css`, removed `src/styles/`, dropped `.stylelintrc.json` + both stylelint devDependencies, and `lint:js`/`lint:css` collapsed into `npm run lint` = eslint only. `BaseLayout.astro`'s inline `<style>` is now the only CSS in the project.
- **The dead copy held one live rule.** `.cefilter-sort-order-btn:active { background: var(--bg) }` existed only in `global.css`, so the sort-direction button has had no press state on the site; it is ported into `BaseLayout.astro`. The other two recorded drifts were left as the shipped copy has them on purpose: `#panel-cefilter > .card:first-child .card-inner { position: relative }` stays unconditional, and font `src` stays `fonts/…` — the `/fonts/…` form in the dead file would break under the `/fgo-calculator/` base path.
- `scripts/check_build_output.js` pins the `.cefilter-subpanel` display rules across two texts (`dist/index.html`, `BaseLayout.astro`) instead of three; the `--write` refusal is unchanged.
- Wording fixed everywhere the dual copy was described as the norm: `AGENTS.md`, `GEMINI.md`, `README.md`, `CLAUDE.md` (perf bullet, Lint & Format section, Known Issues), `code-style.md`, `structure.md`, plus a file note in each fluid-layout doc.
- Superseded plans that only lived in ignored directories (`docs/superpowers/`, `design-docs/`) are now `.claude/docs/archive/` with a `README.md` saying they are records, not work, and which files they name no longer exist.

### Not a bug: the `aria-expanded` finding
This log records `ce-servant-select.js:177` as "always renders `aria-expanded="false"`, so after a click the next batch claims a collapsed state. Re-checked the code: the button is created inside `if (hidden > 0)` (`ce-servant-select.js:197-198`) and `_paintResults()` rebuilds the whole fragment, so an element that exists only while rows are still hidden carrying `false` is accurate — and once nothing is hidden, there is no button left to misreport. No code change made, the finding closed. Separate, real, and unfixed: clicking `Show N more` destroys the focused button and does not restore focus, so a keyboard or screen-reader user loses their place in the list each press.

### Verification
`npm run lint` exit 0 · `npm run test` 25/25 · `npm run build` ✓ · `npm run check:build` SUCCESS against baseline · `node scripts/verify_render.js` after this batch (see below) · `git check-ignore -v` confirms `.claude/CLAUDE.md`, `.claude/docs/**`, `AGENTS.md`, `GEMINI.md` tracked while `.claude/settings.local.json` and root `docs/` stay ignored.

Not checked: the ported `:active` rule was verified by grep on the shipped CSS, not by pressing the button in a browser; `npm prune` removed 206 packages from `node_modules` here only, so the `/mnt/storage` copy still carries stylelint and lighthouse.

## 2026-11-04 — feat(layout): wide-screen magnification of the 1280 layout

Started as "screen width over 1280 think display on 1280" and ended as magnification. The owner was shown three readings of that sentence — magnify, leave the 1120px rail alone, or widen the rail — picked magnification, then explicitly dropped the fluid-layout plan when its documents surfaced as an already-written argument against `zoom`. Merged to `main` as `a8f7185` and deployed (run 41818042561).

### What Was Built
- `src/layouts/BaseLayout.astro` — one head `<script is:inline>`, before the other inline ones and therefore before first paint: `zoom` on `<html>` = `Math.max(1, Math.min(window.innerWidth / 1280, 2))`, re-applied on `resize`. Under 1280 CSS px nothing changes; above it the layout viewport is pinned to 1280 and scaled, so the 1120px rail, the 160px cards and every label grow together at the ratios a real 1280 window shows. `MAX = 2` keeps 4K from going absurd; an ultrawide past 2560 gains margin instead of size.
- **`innerWidth`, not `clientWidth`.** `documentElement.clientWidth` is already divided by `zoom` once a factor is applied, and dividing by it a second time on the next `resize` lands on the wrong number. The first attempt at the cleaner-looking version read `clientWidth` and, at an 800x600 window, computed `z = 0.625` — so `--screen-h` became `600 / 0.625 = 960px`, the picker modal grew to `0.8 × 960 = 768px` on a 600px screen, `#servantModalClose` fell off-screen, and `scripts/verify_render.js` died with `Error: Node is either not clickable or not an Element`. Clamping `z` to at least 1 is the fix; the gate is what caught it.
- `--screen-h` (`innerHeight / zoom`, declared `100vh` in `:root`) replaces the three viewport-unit lengths in **both** CSS copies: `body{min-height}`, `.servant-modal-content{max-height}`, `.cefilter-modal-body{max-height}`. Chrome multiplies viewport units by `zoom`, so they would otherwise overshoot the screen — before the variable the modal measured 2304px tall on a 2560x1440 window (top at -432px, clipped); after it, 1152px, exactly 80% of the screen. At zoom 1 the variable equals `100vh`, so nothing moves on a normal window.
- `.container` stays at `max-width: 1120px`. It was briefly raised to 1280px — which made the site *look* like a 1280 window edge-to-edge but left every component the same size — and the owner asked for it back down. Measured with the rail at 1280: identical container, card, column-count, page-size and font-size at 1280 and 2560, apart from the six `position: fixed; inset: 0` `.servant-modal` backdrops, which are the dim layer and span the real window by design.
- Docs corrected rather than merely extended. The "Comfort scale" bullet in `.claude/CLAUDE.md` and the same row in `.claude/docs/security.md`'s inline-script table described a `zoom = 1.5 / devicePixelRatio` script and a `verify_render.js` that restores `deviceScaleFactor: 1.5`; **neither exists** — `git log --all -S devicePixelRatio` is empty and the gate sets no viewport at all. Both now describe the script that ships. `.claude/docs/archive/2026-11-04-fluid-desktop-layout-design.md` and `-plan.md` keep their arguments but carry a status note saying magnification shipped, so no future session starts the plan against a `zoom` that is already there.

### Verification
- Puppeteer against the production build (`npx astro preview`, port 3000): container / card / servant-name in device px — 1280x900 → 1120 / 160 / 11.2 at zoom 1; 1440x900 → 1260 / 180 / 12.9 at 1.125; 1920x1080 → 1680 / 240 / 16.8 at 1.5; 2560x1440 → 2240 / 320 / 22.4 at 2; 3840x1600 → 2240 / 320 / 22.4, still 2 (cap). `documentElement.scrollWidth > clientWidth` false at every size, so the 20px gutter is never eaten.
- `resize` chain 2560 → 2000 → 1200 gives `2`, `1.5625`, `1`. An 800x600 window keeps `--screen-h: 600px`.
- Modal sizing under magnification: at 2560x1440 with `#cefilterFilterModal` open, computed `max-height` 576px = 1152 device px = 80% of the screen, top 492, bottom 948, inside the viewport.
- `npm run test` 25/25, `npm run lint`, `npm run check:build` SUCCESS with **no** `--write` re-capture (the new script is HTML, not a chunk, and the page-text signature strips `<script>` bodies), `node scripts/verify_render.js` SUCCESS on the merged tree.
- Live: `https://famakung.github.io/fgo-calculator/` returns 200 and its `<head>` contains `var W=1280,MAX=2,de=document.documentElement;function apply(){var z=Math.max` — the clamped version.

### Follow-up from review
- Owner asked to try 1400 as the base instead of 1280 (`e7f09ad`, merged `d61ed6d`). One constant: `W=1400`. 1280 magnified hard — 1920 at 1.5x, the 2x cap already reached at 2560, and a 1366 laptop got the whole effect. At 1400: 1366 untouched, 1920 → 1.371x (card 219, name 15.4 device px), 2560 → 1.829x (293 / 20.5), cap binds past 2800 (320 / 22.4). The 1120px rail is now 80% of the layout viewport instead of 87.5%, so side gutters widen. Re-measured with the same Puppeteer pass, no horizontal overflow at 1280 / 1400 / 1440 / 1920 / 2560 / 3840; `npm run lint`, `npm run test` 25/25, `npm run check:build` SUCCESS without re-capture, `node scripts/verify_render.js` SUCCESS. Deployed on run 41820557023, live `<head>` carries `var W=1400,MAX=2`.

### Note
- Not checked: real hardware, and Firefox/Safari behaviour of `zoom` on the root element (verified in Chromium only). Browser zoom (`Ctrl` +/-) changes `innerWidth`, so magnification stacks on the visitor's own zoom up to the 2x cap — the exact double-magnification `.claude/docs/archive/2026-11-04-fluid-desktop-layout-design.md` warns about, accepted by the owner after that document was read out to them.
- `.claude/docs/` is untracked (the `docs/` pattern in `.gitignore`), so none of these doc edits can be committed from here.
- No test or gate assertion covers the magnification numbers; they live in this log and in the CLAUDE.md bullet. `scripts/verify_render.js` runs at 800x600, where the script is by construction inert, so a future regression in the ladder would need a new wide-viewport case.

Started as "can you fetch Atlas bond point require each servant" and ended as the Bond Calculator planning whole level ranges by itself. Branch `feat/bond-level-planning` off `develop`, merged into `main`.

### What Was Built
- **Ask first, then the data.** Every question about the level table was answered against the live Atlas export before any code: `bondGrowth` is 16 ints per servant, already inside the cached `nice_servant_lore_lang_en.json`, and **it is a running total from Lv.0** — Altria's `9125` is Lv.0→Lv.2, so Lv.1→Lv.2 is `6125`. That correction arrived *after* the first implementation had already treated the values as per-level costs, and it is why the generator differences the list: `scripts/sync_atlas_data.py::sync_bond_growth()` writes `src/scripts/data/bond_growth.js` with `BOND_TABLES` (key → 16 step costs) + `BOND_TABLE_BY_SVT` (servant id → key). Playable gate is the same `type in ("normal", "heroine")` the servant sync uses.
- **Deduped, and stored outside `servants.js`.** 471 servants share 76 tables, so one file holds the shapes plus a key map (~18 KB) instead of 16 numbers per servant (~56 KB in the eager `data-chunk`). Keeping it out of `SERVANT_DATA` also sidesteps `revalidate_servant_traits()`'s text comparison — no bond change can ever trigger the trait-drift full rewrite again.
- `src/scripts/data.js` — `ServantData.getBondGrowth(id)`, resolving split portraits (`"467-1"` → `"467"`). `ServantData.load()`'s whitelist needed no change, because the maps are keyed by id rather than carried on the entry.
- `src/scripts/domain.js` — `BondLevelCalculator.plan({ growth, current, target, bondPerRun, typedCost })` → `{ rows: [{from,to,runs}], total, spansLevels }`. Rows group by **runs spent**, not by level: one batch of runs that clears two levels is one row (`Bond Lv.0->2` / `1 run`). Surplus carries forward to Lv.10 and is discarded from there (the in-game bond cap), so Lv.11+ needs whole runs each. Bounded by levels, guarded by `MAX_ITERATIONS`.
- `src/scripts/bond-app.js` — `defaultSlot()` replaces eight hand-copied slot literals; **Current Lv.** (0–15) and **Target Lv.** (Current+1–16) render above the box, which is relabelled **Bond Point Required** (was "Bond Required"). Both the level select and `setServant()` re-price the box from the table every time; `buildServantSlots()` fills only an empty box, so a typed figure survives unrelated re-renders. Current Lv. ≥ 15 ticks "Bond ≥15", a lower level unticks it. The card keeps the plain `X runs` line unless `spansLevels`, then prints the rows under the total.
- CSS in both copies, same order: `.bond-level-row`, `.bond-level-select`, `.bond-result-levels`, `.bond-result-level-label`, `.bond-result-level-runs`.
- `scripts/ensure_data.js` requires the new file on a fresh clone; `scripts/validate_data.js` checks 16 positive ints per table, that every key resolves, and that every `SERVANT_DATA` entry has a table.

### Verification
- `npm run test` 25/25 — new `tests/bond-level-calculator.test.js` (6 cases): single level stays one row and `spansLevels: false`; carry to Lv.10; one run crossing two levels; the cap discarding surplus so Lv.11+ rounds alone; a typed figure pricing only the standing level; rejects and clamping (`target 99` clamps to the last priced level).
- `npm run lint`, `npx prettier --check` on the touched files (both `bond-app.js` and `domain.js` were Prettier-clean at HEAD and my edits had drifted them), `npm run build`, `npm run data:validate`, `npm run check:build` — re-captured with `--write`: `data-chunk` 51974 → 64441 B, `bond-lazy` 17798 → 19226 B, both inside their ceilings, no new chunk, no page-text change (all the new strings are runtime DOM).
- `node scripts/verify_render.js` against `astro preview :4173` — SUCCESS, unchanged.
- Puppeteer against the **production build** (never the HMR dev server): control order `servant-slot-name > input-row > bond-checkbox-row > bond-level-row > bond-input-box`, labels `Current Lv. / Target Lv. / Bond Point Required` with a 17px gap (the earlier longer labels collided inside a 160px slot); box = 6,125 at Lv.1 and 282,500 at Lv.5; Target options start at Current+1; card `Bond Lv.1->2 / 7 runs … Bond Lv.9->10 / 369 runs`, rows summing to the 1,634 headline; single-level plan prints no rows; support and Max Bond slots hide all three; **swapping the servant re-prices the box** (Mash Lv.3 → Altria (Alter): 1,000 → 2,500); Current 15 ticks Bond ≥15 and 9/5 untick it; no page or console errors.
- Not checked: `verify_render.js` gained no bond assertions (the gate still proves the tab loads, not the new controls); the 12 Atlas servants with no table and 4 with 5 entries never reach this clone, so their path is untested by construction.

### Note
- Docs updated: `README.md` (features, usage steps, file tree, architecture table, pipeline bullet), `.claude/CLAUDE.md` (four Bond Calculator bullets, Data Layer entry for `bond_growth.js`), `.claude/docs/data-rules.md` (new "Bond point tables" section), `.claude/docs/structure.md` (module lines, data/ entry, Domain layer), `.claude/docs/code-style.md` (two Patterns entries), `.claude/docs/fetch-data-guideline.md` (Bond Point Tables bullet).
- Two CI effects on the first deploy, both intended and one-time: the asset cache key hashes `scripts/sync_atlas_data.py`, so the run re-downloads the Atlas JSON and every image; and the new data file changes the data hash, so a `schedule` run builds instead of skipping.
- `defaultSlot()` is a module function, not a `BondApp` method — it is used inside the object literal that defines `BondApp` and needs no `this`.

Asked as a design question first ("should CE Select save the way Servant Select does?"). Answer: yes, with three blockers, all fixed in this entry.

### What Was Built
- `CEFilterStore` (new export in `ce-servant-select.js`): `read()` returns the parsed blob, or `{}` for a missing key, unparseable JSON or a top-level array; `write(patch)` merges into whatever is already stored. **Both sub-tabs share `CEFILTER_STORAGE_KEY`, and `ServantSelect._savePicks()` used to `setItem` a whole `{ servantPicks }` object — the first CE write would have erased the servant list, and vice versa.** Servant Select now saves through the store, which keeps "only this module touches `localStorage`" true.
- `CEFilterApp._saveState()` writes `{ cePicks, ceMode }` from the top of `render()`. That is the one point every mutation reaches — the picker's `onApply` (`main.js`), the card-badge click, the chip remove, `clearAllCEs()` and `selectCEFromCombo()` all render afterwards — so none of those five sites needed a save call. `CEFilterApp._loadPicks()` runs at the top of `init()`, before `modeSelect.value` is read from state.
- The match mode travels with the picks: chips restored under the default mode would show a wider result set than the user left. `matchCustomCounts`, class/rarity filters, search and `currentPage` still reset. `renderResults` forces the mode back to `all` below two selected CEs, so a stored mode that no longer applies is corrected on the first render.
- `Validator.validateServantPicks` renamed to `Validator.validatePicks` — it now sanitizes both id lists. CE ids are `"0099"`-style, servant ids `"001"`-style, and both pass the same `/^\d{3,}$/`. Callers: `ce-servant-select.js`, `ce-filter-app.js` (new), `tests/validate-servant-picks.test.js` → `git mv`'d to `tests/validate-picks.test.js`.
- `CE_MODES = ["all", "any", "custom"]` (module-local in `ce-filter-app.js`) is the allowlist for a stored mode; anything else keeps the state default.

### Verification
- `npm run test` 19/19 — `tests/ce-filter-store.test.js` (Map-backed `globalThis.localStorage`): a CE write keeps `servantPicks`, a repeated write replaces only its own fields, `read()` collapses missing/junk/array storage to `{}`. `tests/validate-picks.test.js` gained a 4-digit CE id case.
- Standalone Puppeteer pass against `astro preview :4173`: two CEs + mode `any` + one servant stored as `{"cePicks":["1949","1973"],"ceMode":"any","servantPicks":["001"]}`; the CE tab re-rendering kept `servantPicks`; after reload 2 CE chips, `#cefilterMode` = `any`, 1 servant chip, combo rows rendered; `Clear all` stored `cePicks: []` with `servantPicks` intact; no page or console errors.
- Browser gate `scripts/verify_render.js` extended — its old assertion `stored === '{"servantPicks":[]}'` was exactly the whole-key-replace contract this change retires. Now: re-select one CE from a card badge before the reload, assert 1 CE chip after it, and assert the post-clear blob keeps `cePicks.length === 1` while `servantPicks` empties. SUCCESS.
- `npm run lint` and `npx prettier --check` clean · `npm run build` green · `npm run check:build` SUCCESS **without `--write`** — `ce-filter-chunk` 24659 → 25059 B, no chunk added or renamed, no page text changed (the save point is `render()`, so no UI string moved).
- Not checked: the gate asserts restored CE *chips*, not the restored *mode* (proved only by the throwaway script above, now deleted); nothing asserts behaviour when a stored CE id has been dropped by a data re-sync beyond the `CEById.has` filter.
- Docs updated: `README.md` tree line, `.claude/CLAUDE.md` (sub-tab persistence sentence, Craft Essence Select chips bullet, Key Files entry for `ce-servant-select.js`), `.claude/docs/code-style.md` (Bond Gain CE persistence pattern), `.claude/docs/security.md` (localStorage id lists), `.claude/docs/structure.md` (both module lines). Untouched pre-existing error spotted nearby: `README.md:50` claims Bond Gain CE "page state persists on refresh" — it does not.

---

## 2026-11-03 — feat(ce-filter): Craft Essence Select chips match Servant Select (portrait only + Clear all)

### What Was Built
- `#cefilterClearBtn` added to the Craft Essence Select controls row in `src/pages/index.astro`, right after `#cefilterAddBtn`, `hidden` in the markup, borrowing `.cefilter-add-btn` plus the existing `.cefilter-add-btn--clear` outline modifier. No CSS was written for it: the modifier already sits in both copies (`src/styles/global.css:969` and the shipping inline `<style>` block in `BaseLayout.astro`).
- `CEFilterApp.clearAllCEs()` — empties `state.selectedCEs`, resets `currentPage` to 1, then `render()`. No-op when already empty. `renderResults` already forces `mode` back to `"all"` once fewer than two CEs are selected, so the match-mode row needs no handling here.
- `CEFilterApp.renderChips()` now drives the button the way `ServantSelect.renderChips()` does — `Clear all (N)`, hidden at N = 0 — with the label update placed **before** the `selectedCEs.length === 0` early return, which would otherwise strand the label at the old count.
- The visible CE name is gone from the chip: the `nameSpan` (`DOMFactory.el("span")` + `textContent = ce.name`) is deleted, so both sub-tabs show the same portrait-only chip. The name moves to the remove button's `aria-label` (`Remove ${ce.name}`), which the CE side lacked and `ce-servant-select.js:138` already set, alongside the `img alt` that was already there.

### Verification
- `npm test` 16/16 (no domain change) · `npm run lint` clean · `npm run format:check` clean.
- `npm run build` green; `npm run check:build` failed on the raw/normalised page-text signatures only (new button text), re-captured with `node scripts/check_build_output.js --write`, then SUCCESS.
- Browser gate extended (`scripts/verify_render.js`), asserted against `astro preview :4173`: after the CE hand-off the chip row has a chip, no `span` name, one `aria-label`ed remove button per chip, and the label reads `Clear all (N)`; clicking it leaves 0 chips, hides the button, restores the label to `Clear all`, and keeps the servant grid populated. The hand-off check now compares `img alt` instead of chip `textContent`, which is no longer carrying a name.

### Follow-up from review
- `ServantSelect.render()` now resets `visibleCards` itself. Only `clearAll()` reset it, so adding or removing a servant kept the previous page counter and a fresh pick could start deep inside a long row list. `clearAll()`'s own assignment is gone; `_paintResults()` — the path "Show N more" uses — still does not reset, and the sub-tab entry re-render now shows the first 60 rows.
- `_paintNotes()` shows the "No CE is usable by two or more of these servants." note only when `!truncated`. Zero rows from a walk that stopped at `MAX_COMBO_NODES` proves nothing, which is already why `buildSharedCEGroups` returns `unshared: []` when truncated.
- `.cefilter-subpanel` markup carries no `id`, yet `CLAUDE.md` documented `#cefilterSubCE` / `#cefilterSubServant`; the doc now names `data-subpanel` instead.
- `node --check scripts/verify_render.js` passes and `npx prettier --check --stdin-filepath scripts/verify_render.js` is clean, but that file is outside the repo's Prettier scope (`package.json:17-18` globs cover `src/scripts/`, `tests/`, `src/styles/`, `*.mjs`), and `git show main:scripts/verify_render.js` piped through the same check also fails. The only deviation prettier wanted in the current file was a wrapped `if` in the new hunk, so that line was collapsed rather than reformatting the whole file.
- Not changed: the shipping inline `.cefilter-combo-card` lacks `background`, `border`, `border-radius`, `overflow`, `text-align` that `global.css` declares — zero visual effect because the same element also carries `.cefilter-servant-card`, which ships all five. `_skipAscension` stays as the documented non-multi guard even though the multi early-return makes it unreachable here. `Show N more` rebuilds its button, so keyboard focus returns to `<body>`, and its `aria-expanded` stays `"false"`.

### Note
- `cavecrew-reviewer` was dispatched over this diff and ran with no `cd`, so it read `/mnt/storage/Dev/Projects/fgo-calculator` — the stale editor copy, whose `CEFilterPicker.open` has a dead positional `alsoMatch` and whose `constants.js` has `MAX_CELIST_ITEMS`. Neither exists in this clone (checked at `1d0aba8`: `grep -rn MAX_CELIST_ITEMS src/scripts/` empty, `selectors.js:641` is `open(callbacks = null)`). One finding survives: `ce-servant-select.js:177` always renders `aria-expanded="false"` on the `Show N more` button, so after a click the next batch claims a collapsed state. Left unfixed for now.

---

## 2026-11-03 — fix(data): permanent `traitAdd` individualities are now read

**Branch:** `fix/servant-trait-add` off `develop` → `4d159cc`; fast-forwarded into `develop`, merged into `main` as `c821bbf` and pushed.

### What Was Built
- `extract_servant_traits()` (`scripts/sync_atlas_data.py`) merges permanent `traitAdd` entries — `condType: "none"`, `eventId: 0`, trait id `> 1000` — into the base set and every ascension/costume set. Atlas keeps some always-on traits out of the servant's own `traits` list; the sync read only `traits` + `ascensionAdd`, so those traits vanished from the dataset. See `fetch-data-guideline.md` → *`traitAdd` — traits kept out of `traits`*.
- Reported by the user as "servants 314 / 334 have no trait 2821": Koyanskaya of Light and of Dark carry `2632` (`demonicBeastServant`) in `traits` and `2821` (Beast Servants) only in `traitAdd`, so neither matched CE `1949` "From NFF with Love" (`servantFriendshipUp` functval `2821`, NA text `[Beast Servants]`). 22 stored entries were missing the trait this way — `014`/`202` Atalante ×2, `053` Asterios, `058` Tamamo Cat, `062`/`128` Tamamo-no-Mae ×2, `147` Gorgon, `148` Jaguar Warrior, `158` Hessian Lobo, `205` Ivan the Terrible, `231` Red Hare, `234` Beni-Enma, `265` Altria Pendragon, `270` Astolfo, `299` Ibuki-Douji, `300` Vritra, `307` Miss Crane, `310` Barghest, `312` Mélusine, `314`/`334` Koyanskaya ×2, `332` Dobrynya Nikitich.
- Removed the `if cno == 238: tset.add("2821")` hardcode — Kingprotea reaches `2821` through the new path and her stored entry is byte-identical, so the patch was pure duplication.
- The id `> 1000` filter is what keeps Mash (`cno 1`) correct: her `traitAdd` is one entry per class form keyed by `idx` = classId (`100`–`117`), each adding that form's rarity (`403`/`405`). Merging those would have stamped `0403` and `0405` onto her base traits at once.
- `scripts/test_drift.py` gains cases E–H: permanent `traitAdd` merges (incl. 238 without the hardcode), event-gated and quest-gated entries ignored, class-form rarity does not leak, and a servant stored before the fix is flagged by `revalidate_servant_traits()` so a scheduled CI run rewrites it in place.
- Side effects of the fresh fetch, not of this change: servant `081` (Henry Jekyll & Hyde) gained a new spiritron dress from Atlas (`2780` in base, `300: ["2821"]` + `optionLabels`, `public/servants/081/300.webp` downloaded), and `483` タマモアリア was appended.

### Verification
- `python3 -I scripts/test_drift.py` — 8 passed (A–D unchanged).
- `python3 scripts/sync_atlas_data.py --skip-ces --skip-traits` — 23 entries replaced, 24 targeted (`483` image backfill); diff against the pre-run copy of `src/scripts/data/servants.js` is 2821 additions plus the two side effects above.
- `npm run data:validate` clean (472 entries) · `npm run lint` clean · `npm run test` 13/13 and `npm run build` + `npm run check:build` SUCCESS on the feature branch; build + gate re-run on `main`'s tree before push (`data-chunk` 51633 → 51974 B, inside the ceiling, no baseline re-capture). `npm run test` does not exist on `main`/`develop` — the `tests/` dir and script live only on feature branches.
- Domain-level proof in node (no browser): `ServantData.load()` + `TraitMatcher` — CE `1949` matches went 39 → 61 servants, `314` and `334` among them, Mash's traits unchanged.
- CI run `41631746994` (push to `main`) green through deploy. Live `_astro/data-chunk.CN1wqbvo.js` — same hash as the local build — reads `314:{name:`Koyanskaya of Light`,traits:{base:[… `2780`,`2821`]}}` and `334:{…`0405`,`2821`]}}`.
- Not checked: no Puppeteer/`verify_render.js` pass — the browser gate does not cover CE-to-servant matching, and the live check above reads the shipped chunk, not the rendered card grid.
- Docs updated (all gitignored, working copy only): `.claude/CLAUDE.md` Data Layer bullet, `.claude/docs/fetch-data-guideline.md` field-table row + new `traitAdd` section, this entry.

---

## 2026-11-03 — feat(ce-filter): Servant Select clear-all + pick persistence

**Branch:** `feat/ce-filter-servant-select` — implemented from the drawn mock after recommendations 2 and 3 were chosen; recommendation 1 (sort row + real pagination for `#cefilterComboResults`) was **cancelled** by the user, so `Show N more`, `MAX_INITIAL_CARDS`, `CARDS_PER_PAGE` and `state.visibleCards` all stay.

### What Was Built
- `#cefilterServantClearBtn` in the Servant Select controls row (`index.astro`, after `#cefilterServantAddBtn`), `hidden` in the markup and driven from `ServantSelect.renderChips()`: label `Clear all (N)`, hidden at N = 0. First clear control in the app — `grep -n "Clear\b\|Reset" src/pages/index.astro` returned nothing before this, so it borrows `.cefilter-add-btn` plus a `.cefilter-add-btn--clear` outline modifier.
- `ServantSelect.clearAll()` — empty list, `visibleCards = MAX_INITIAL_CARDS` (a stale page counter would start the next pick deep in the list), `renderChips()`, `_savePicks()`, `render()`. No-op when already empty.
- Picks persist across refresh under `CEFILTER_STORAGE_KEY` = `"fgo_ce_filter_data"` (`constants.js:9`, declared since before this and read by nothing). Payload is `{ "servantPicks": ["001","444"] }`. Saved from `addServant`, `removeServant`, `clearAll`; loaded once in `ServantSelect.init()` before the first `renderChips()`. Sub-tab choice and `visibleCards` still reset.
- `Validator.validateServantPicks(value)` (`domain.js`) — pure: array in, deduped insertion-order array of `/^\d{3,}$/` strings out. `ServantSelect._loadPicks()` then drops ids `ServantData.getServant()` no longer knows, because CI re-syncs generated data every 10 min and a retired id is a normal stored input. Both storage reads and writes are `try`/`catch`.
- **Not** routed through `Validator.validateStorageData`: that function coerces every allowed key with `parseFloat` and keeps numbers only, so an id array cannot pass through it. Event Shop's allowlist is untouched.

### Verification
- `npm run test` 16/16 — three new cases in `tests/validate-servant-picks.test.js` (save order + dedupe + a `1000` id, junk rejection incl. `__proto__` and short `"01"`, non-array input). Caught a real mistake: the first draft used the trait rule `/^\d{4}$/` and matched nothing, because **servant** ids are 3-digit (`"001"`) while trait ids are 4-digit.
- `npm run lint` clean (eslint once flagged `let raw = null` as `no-useless-assignment`) · `npm run format:check` clean.
- `npm run build` green on Astro 7.4.5 · `npm run check:build` failed on both page-text signatures (expected: new button text), re-captured with `node scripts/check_build_output.js --write`, then SUCCESS. Baseline moved `ce-filter-chunk` 22626 → 24299 B, `data-chunk` 51633 → 51974 B and `selectors-chunk` 22623 → 22628 B — the data-chunk figure is drift from the synced dataset, not from this change.
- Browser gate `node scripts/verify_render.js` against `astro preview :4173` — SUCCESS. New assertions: reload → 2 chips + 2 cards + label `Clear all (2)`; click → 0 chips, 0 cards, `localStorage["fgo_ce_filter_data"] === '{"servantPicks":[]}'`. First run failed both card counts because the panel paints inside a double rAF — the gate now waits on `.cefilter-combo-card`, never on a synchronous snapshot.
- CSS written in both copies, same order: `src/styles/global.css` (`.cefilter-add-btn--clear` after `.cefilter-add-btn`, its `:hover` after the existing `.cefilter-add-btn:hover` pair — equal specificity, so order decides) and the shipping `<style is:inline>` block in `BaseLayout.astro`.
- Not checked: `npm run data:validate` (no data touched), and nothing asserts the outline modifier's contrast against a future token change.
- Docs updated: `README.md` (new Servant Select bullet, `ce-filter-app.js` tree comment), `.claude/CLAUDE.md` sub-tab + Servant Select bullets, `.claude/docs/code-style.md` (`CEFilter no persist` pattern replaced), `.claude/docs/security.md` (localStorage line), `.claude/docs/structure.md` (`ce-filter-app.js` line, `ce-servant-select.js` line, Bond Gain CE UI section).

---

## 2026-11-03 — feat(ce-filter): Servant Select badges are image only

### What Was Built
- `ServantSelect._buildServantCell()` no longer appends the blue `.cefilter-ascension-label` div under each member badge — the cell is portrait only. **Supersedes** the "`getAscensionLabel` lines plus `getSpiritronLabel`, `.cefilter-ascension-label` under the badge" bullet in the entry below: `labelParts` still builds, and still feeds the badge's `name` string, so `title`/`alt` carry `Chloe von Einzbern (1st Ascension, 2nd Ascension, Serious Mode)` as before.
- Dead CSS removed from **both** copies, same order: `.cefilter-combo-servant .cefilter-ascension-label` deleted from `src/styles/global.css` and from the shipping `<style is:inline>` block in `src/layouts/BaseLayout.astro`. `.cefilter-combo-servant` keeps `flex-direction: column; gap: 2px` (harmless with a single child); the base `.cefilter-ascension-label` rule stays — Craft Essence Select cards (`ce-filter-app.js:671`) and the overlap modal (`selectors.js:1150`) still print it.
- Docs: `README.md` split bullet, `CLAUDE.md` Servant Select bullet. `design-docs/2026-11-03-ce-filter-servant-select-plan.md` left as the dated plan record.

### Verification
- `npm run lint`, `npm run format:check` (via lint targets), `npm test` 13/13, `npm run build` + `npm run check:build` green — `ce-filter-chunk` 23429 → 23326 B, floor 5656, no baseline re-capture needed.
- No browser pass: `scripts/verify_render.js` does not cover this label. Checked instead in the built chunk — `cefilter-ascension-label` occurrences in `ce-filter-chunk` 2 → 1 (the survivor is `CEFilterApp._buildCard`), `selectors-chunk` unchanged at 1.

---

## 2026-11-03 — feat(ce-filter): Servant Select splits ascension groups

### What Was Built
- `ServantComboCalculator.buildSharedCEGroups` no longer unions a picked servant's `matchingCEIds` across its match-cache entries. Every entry is a **member**; rows are `{ ceIds, members: [entry] }` (`servantIds` dropped) and a row still needs ≥2 distinct servants, so one servant split across two forms is not a combo on its own.
- The union could claim a CE pair that no single form holds at once: with 001 as `["0001"]` + `["0002"]` and 059 as `["0001","0002"]`, the old output was one row `[0001,0002] · Mash, Jeanne`; the split output is two rows — `[0001] · Mash (form A), Jeanne` and `[0002] · Mash (form B), Jeanne`.
- Class signatures, the intersection walk and `MAX_COMBO_NODES` bookkeeping unchanged; `unshared` / `truncated` still speak in servant ids. Sort tie-break is distinct-servant count, counted once per row in `servantCounts`.
- `ServantSelect._buildServantCell()` renders one badge per member: ascension portrait (`ServantData.getImageForAscension`), `getAscensionLabel` lines plus `getSpiritronLabel`, `.cefilter-ascension-label` under the badge, name + labels in `title`/`alt`. Same rule as a Craft Essence Select card (`ce-filter-app.js:621-674`), so a non-split servant still renders a bare unlabeled badge.
- CSS: `.cefilter-combo-servant-row` / `.cefilter-combo-servant` / `.cefilter-combo-servant .cefilter-ascension-label` added to `src/styles/global.css` **and** the shipping `<style is:inline>` block in `src/layouts/BaseLayout.astro`.
- Docs: `CLAUDE.md` Servant Select bullet + Domain row + Key Files entry; `structure.md` module list, Bond Gain CE UI sub-tabs, and a CSS correction (`global.css` is imported by nothing and Astro emits no `.css` — only the inline block ships); `README.md` sub-tab feature bullets + usage step 5.

### Verification
- `npm test` 13/13 — the old "union across ascension entries" case is now "splits a servant whose ascensions match different CEs", plus two new cases: "a split servant shows every form that can use the row" (superset entry shares the row) and "one servant split across forms is still not a combo".
- `npm run lint`, `npm run format:check`, `npm run check:build` green (`ce-filter-chunk` 22626 → 23429 B, inside the ceiling, no baseline re-capture), `node scripts/verify_render.js` green.
- Production build + Puppeteer on `astro preview :4173`, picks 282/285/444 and 001/059/388: rendered titles `Chloe von Einzbern (1st Ascension, 2nd Ascension, Serious Mode)` from `servants/388/000.webp` and `Chloe von Einzbern (3rd Ascension)` from `388/002.webp`; Mash and Jeanne stay unlabeled bare badges; 3 cards per pick set, `clipped: []` even at the widest 6-cell card, no page errors.

---

## 2026-11-03 — feat(ce-filter): Servant Select sub-tab (servants → shared-CE groups)

### What Was Built
- Bond Gain CE now has two sub-tabs — the app's first nested tab level. **Craft Essence Select** (`#cefilterSubCE`) is the original CEs → servants view unchanged and still the default; **Servant Select** (`#cefilterSubServant`) inverts it.
- `src/scripts/domain.js` → `ServantComboCalculator.buildSharedCEGroups(entries, pickedIds)` (pure, no DOM): union each picked servant's `matchingCEIds` over **every** cache entry with its id (a multi-ascension servant yields one entry per CE group, `ce-filter-app.js:824-841`), collapse interchangeable servants by usable-list signature, depth-first over those classes, prune empty intersections, then for each intersection keep the **maximal** servant group. Rows need ≥2 servants — the `≥2` test runs after expansion, otherwise Mash ∩ U-Olga Marie's real 4-CE row disappears. Dedupe by CE list (union of servants preserves intersection, `I(S₁)=I(S₂)=P ⟹ I(S₁∪S₂)=P`), so 4 real servants → 15 eligible groups → 3 rows. Enumeration stops at `MAX_COMBO_NODES = 50000` and flags `truncated`. **Superseded the same day** by the entry above: entries are members, there is no union, and `groups[].servantIds` is now `groups[].members`.
- `src/scripts/ce-servant-select.js` — the whole sub-panel view, imported only by `ce-filter-app.js` so it lands in `ce-filter-chunk`. Reaches data through injected deps (`getEntries`, `onSelectCE`) instead of importing `CEFilterApp` back. Buckets rows by CE count desc; a bucket with zero rows is never built, so no `2 CE · 0 groups` line can print. 5 rows per bucket initially, 60 rows total, rest behind `Show N more`. CE chips are `button.cefilter-combo-ce` and hand over to Craft Essence Select with that CE selected (`CEFilterApp.selectCEFromCombo`).
- Servant picking reuses `#servantModal`/`ServantSelector` unchanged except a 4th `options` arg: `{ skipAscension: true }` bypasses `AscensionSelector` (traits are unioned across ascensions anyway). All five existing Bond callers pass three args, so `pendingSlot`/`onSelect`/`close()` semantics are untouched. `ServantSelect.render()` starts as a no-op in the chips task and is filled by the rows task.
- **No new trait matching and no worker protocol change** — the panel re-projects `computeAllCEMatches()` / `_ceMatchEntriesIndex` output that already exists. No persistence: Bond Gain CE never had any (`CEFILTER_STORAGE_KEY` is still declared and unread); the picked list and sub-tab choice reset on refresh.
- `package.json`: new `test` script `node --test "tests/**/*.test.js"`. **`node --test tests/` does not work on Node 22.23.4** — it resolves the directory as a module and exits 1. `tests/**/*.js` added to both Prettier globs; `lint:js` still only covers `src/scripts/` (no test globals in the ESLint config).
- `.gitignore` note: `tests` was added mid-implementation and removed again before the commit, so `tests/servant-combo.test.js` is tracked. `design-docs` is now ignored, and `.claude`, `docs/`, `.plans` always were — the plan for this feature (`design-docs/2026-11-03-ce-filter-servant-select-plan.md`) and this log are local-only by repo convention.

### Verification
- Unit: `npm test` 9/9 — union across ascension entries, identical-list collapse, single-servant prune, disjoint → unshared, sort order, maximal expansion, input-not-mutated, node-budget truncation (20 synthetic servants), duplicate picked ids.
- Browser gate (`scripts/verify_render.js`, new Bond Gain CE sub-tab block): panel swap hides/shows `#cefilterSubCE`/`#cefilterSubServant`, two one-click picks (001 Mash, 444 U-Olga Marie — 444 is multi-ascension, so this is what pins the ascension bypass), chips = 2, ≥1 combo row, no zero-group section, empty/unshared notes stay hidden while rows render, then returning to Craft Essence Select restores the panel and its 20 cards. Green against `astro preview` on the production build.
- Throwaway per-task checks (`check-task3.mjs` 17, `check-task4.mjs` 34) ran the chip flow, the exact four-servant ladder from the design, the CE click hand-off, the disjoint case, and the expander. They lived in the plan's git-ignored workspace and were deleted at finish — the durable version of their assertions is `scripts/verify_render.js`.
- `npm run lint`, `npm run format:check`, `npm run data:validate` clean; `npm run check:build` green with `scripts/build_baseline.json` re-captured in each commit that changed markup or a bundled module (`ce-filter-chunk` grew).
- Real data this checkout: 471 servants, 24 CEs, 13 CEs with traits. Expected ladder, verified in the browser: with 001/059/373 the rows are `4 CE` [Checking Reports · Needle of Sincerity · Blessed Bride · Foreign God] · Jeanne, Kukulcan and `3 CE` [Checking Reports · Needle of Sincerity · Blessed Bride] · Mash, Jeanne, Kukulcan; adding 444 inserts the second `4 CE` row beginning Chaldea Morning and lengthens both existing rows.

### Note
- The servant picker shows the same name for different ids (003/078/179 "Altria Pendragon (Alter)", 009/032 "Gilles de Rais", 018/457 Elisabeth Báthory, 056/134 Kiyohime, 059/216 Jeanne d'Arc, 070/133 Scáthach), and the two can have different usable-CE lists. Pre-existing on the Bond tab; browser checks therefore target the portrait path `servants/<id>/`, never the label.
- The 60-row initial cap is unreachable with 24 CEs; only the per-bucket `Show N more` path is exercised by real data.

---

## 2026-10-21 — fix(ci): gate baselines moved to `.ci-baselines/` with a run-scoped cache (commits `f94cce9`/`9afe0c2`/`2c013f6`)

### What Was Built
- **Root cause (dispatch runs #60/#61, 2026-10-20):** `data_version.txt` + `data_hash.txt` lived in `.cache/atlas/` inside the `actions/cache@v4` asset blob keyed `hashFiles(sync_atlas_data.py, check_data_version.py)`. `actions/cache` never re-saves on an exact-key hit, so the baselines froze at the value from the last miss; after a real JP hash change (`ee73b6`→`42a639`) every run re-detected `CHANGED` forever — idle skips stopped working and any data change would force rebuild+redeploy every 10 min.
- `check_data_version.py` default path → `.ci-baselines/data_version.txt` (`.ci-baselines/` gitignored).
- New workflow pair: `Restore version baselines` (`actions/cache/restore@v4`, before the gate) + `Save version baselines` (`actions/cache/save@v4`, **last build-job step, after `Upload Pages artifact`** — a failed build must not persist baselines and silently swallow the update). Key `fgo-version-baseline-${{ github.run_id }}-${{ github.run_attempt }}` (run-unique key ⇒ always a primary miss ⇒ save always writes; `run_attempt` because `run_id` is stable across `gh run rerun` and save hard-fails on an existing key), `restore-keys: fgo-version-baseline-`. Save `if`: push `||` `CHECK=='CHANGED'` `||` `DATA_DIRTY=='true'`, bare form (`would_run()` evals the stored string).
- Asset blob key no longer hashes `check_data_version.py` (gate edits must not force full image re-downloads); `.ci-baselines/` excluded from the blob by living outside it. `data_change` step: `mkdir -p .ci-baselines` + `HASH_FILE=".ci-baselines/data_hash.txt"`.
- `scripts/test_deploy_workflow.py` scenario 9 pins the wiring structurally (single restore/save, run-scoped key equality, paths, blob exclusions, step ordering); docstring now nine scenarios with honest 7/8 lines.
- Note: earlier history entries mentioning `.cache/atlas/data_hash.txt` (2026-10-19) are as-were; superseded by this entry.

### Verification
- Local: `test_check_data_version.py` 8, `test_deploy_workflow.py` 9, `test_drift.py` 4 — all green on `main` merged result.
- Live on `main` `2c013f6`: seeding push run `39548951139` saved `fgo-version-baseline-39548951139-1` after upload + deployed. Dispatch `39549368416`: restored that baseline, `CHECK=UNCHANGED` → "Nothing to do", deploy skipped (~1 min). Rerun of the seeding run: attempt 2 prefix-hit `…-1`, saved `…-2` with no key collision, green. The #61 bug is fixed end-to-end.

---

## 2026-10-19 — fix(ce-filter) spiritron costume labels + feat(layout) ETag new-version prompt

### What Was Built
- **Spiritron costume label always surfaces (commit `2044300`)** — `ServantData.getSpiritronLabel()`:
  - The first fix (commit `2c5b3cc`) targeted a dead path: the worker matches against the **full CE list**, not just selected CEs, so spiritron servants whose stage adds a common trait (388's stage `002` adds `2821` Beast, matched by CE 1949) are *permanently split* into two ascension-group cards (`[000,001]` + `[002]`) and never render via the `baseMatchesAll` branch.
  - `getSpiritronLabel(id, matchingCEs, matchedAscensions, baseMatchesAll)` runs in the multi-group path too: when a matching CE carries trait `2780` and the base group (key `"000"`) is present, it appends the spiritron costume name to that group's label.
  - **Filter against `rawTraits` stage keys** (`!stages[key]`): only append costumes that are NOT already trait-diff stages. This fixed the 091 over-display where the base card `[000,001,002]` had all three bunny `optionLabels` appended *on top of* card 2's natural labels. Stage costumes (444, 091 bunnies, 448, 174, 311, 070) render via their own stage group; label-only (388 "Serious Mode") get the append.
  - Applied in both render paths: `ce-filter-app.js` `_buildCard` and `selectors.js` `createServantMiniCard` (overlap modal) — same unified `labelParts` block joining `getAscensionLabel` parts + spiritron label with `\n`.
- **ETag new-version prompt for stale tabs (commit `995c678`)** — inline `<script is:inline>` in `BaseLayout.astro` (client-side, distinct from the CI-side ETag build gate):
  - Conditional-GETs its own page URL (`If-None-Match` from sessionStorage key `fgo_build_etag`); 304 → silent, 200 → store new ETag + show fixed-bottom banner "A new version is available." with Reload button and × dismiss (createElement/textContent only, no innerHTML).
  - Triggers: on load, `setInterval(check, 30000)`, and `window "focus"` (catches background tabs returning). Skips `localhost`/`127.` hosts.
  - Root problem it solves: GitHub Pages serves `index.html` with `cache-control: max-age=600` + ETag, and content-hashed chunks are referenced from the entry bundle (not index.html), so an open tab keeps the old chunk set after a deploy until the user manually refreshes.

### Verification
- `npm run lint` + `format:check` + `data:validate` + `npm run build`: all passed.
- Live E2E (Puppeteer against `astro preview` of the production build, fresh profile, 0 page errors):
  - 388 Chloe Akinshiro → card shows **"1st Ascension / 2nd Ascension / Serious Mode"**.
  - 444 U-Olga Marie → **"1st Ascension / 2nd Ascension / Earth President"** (stage costume, not duplicated).
  - 174 Shiki → clean 2-card split, no label leak onto base card.
  - 091 Jade Rabbit → **"1st Ascension / 2nd Ascension / 3rd Ascension / Incognito Glasses"** (091's own stage), bunny labels stay on their stage card only — the 6-line jumble is gone.
- ETag prompt A/B/C logic verified end-to-end (first-load 200 no banner / same ETag 304 no banner / stale 200 new ETag → banner).
- **GitHub Actions** run `39265621841`: Succeeded, deployed to Pages. Live `data-chunk.0JmB4njH.js` confirmed to contain `getSpiritronLabel` with the `rawTraits` stage filter.

### Note
- npm audit reports 54 vulns (1 "critical" = Astro SSR/island/hydration XSS + host-header SSRF advisories, all `<=7.2.7`). This is a **static** site with none of those SSR paths active — dev-tooling-only exposure; do **not** run `npm audit fix --force`.

---

## 2026-10-19 — feat(sync): ETag revalidation, hourly CI with build gate, existing-servant trait revalidation

### What Was Built
- **ETag Conditional-GET Revalidation (`scripts/sync_atlas_data.py`)**:
  - `fetch_url()` now accepts `if_none_match` and returns `(data, etag)`; HTTP 304 → `(None, None)`.
  - `get_cached_json()` revalidates cached JSON via `If-None-Match` (stored in `<file>.etag` sidecars). 304 serves cache at ~0 bytes; 200 compares payloads and rewrites only on real change.
  - Verified live: second run returned 304, 0 bytes, cache served.
- **Hourly CI + Build Gate (`.github/workflows/deploy.yml`)**:
  - Schedule replaced (daily 02:00 UTC) with hourly cron `13 * * * *`.
  - New step hashes the three generated data JS files and compares to `.cache/atlas/data_hash.txt` from the previous run → `DATA_DIRTY` output.
  - Validate/build/upload steps gated: run when `DATA_DIRTY == true` **or** `github.event_name != 'schedule'` (push to main + manual dispatch always build). Deploy job skips when build skipped.
  - Idle scheduled runs cost ~7 conditional GETs (mostly 304) and no deploy.
- **Existing-Servant Revalidation (trait drift detection)**:
  - `_parse_servant_entries()` — parses `SERVANT_DATA` into `{key: entry text}` (all key forms: `"001"`, `"467-1"`, `200`).
  - `revalidate_servant_traits()` — reformats each stored entry via `format_servant_js_entry` and diffs against current file text. Catches: base trait changes, **new Spiritron Dress costume-stage traits (base-only → multi-ascension)**, ascension diffs, optionLabels/optionNames, name changes. Servant 467 (split) excluded.
  - `update_servants_js_full()` — replaces drifted entries in place and re-sorts the file; unchanged entries stay byte-identical.
  - Bulk `nice_servant_lore_lang_en.json` now fetched every run (one conditional GET) instead of only for 20+ new servants.
  - Verified: zero false drift on all 471 real entries; simulated Spiritron dress (Scáthach 070 base-only + API costume stage 300) correctly detected as drift `[70]`.
- **Housekeeping**: removed stale `src/scripts/data/.gitkeep` (dir holds tracked data files).
- **Verification & Deployment**:
  - `npm run data:validate`, `npm run lint`, `npm run format:check`: all passed.
  - `python3 scripts/sync_atlas_data.py --dry-run`: clean, no false drift.

---

## 2026-10-19 — fix(sync): map Beast class variants to 0124, preserve search aliases & support 2.5% CE bonuses

### What Was Built
- **Beast Class Trait Mapping (`scripts/sync_atlas_data.py`)**:
  - Registered `BEAST_CLASS_TRAIT_IDS = {113, 114, 116, 118, 119, 121, 122, 124, 125, 126, 129, 132, 133, 135, 194}` to map all Atlas Beast variants to `"0124"` (`Class Beast`).
  - Added fallback `cno in (377, 417, 444)` in `extract_servant_traits()` so Draco, Space Ereshkigal, and U-Olga Marie always possess trait `"0124"`.
  - Space Ereshkigal (`417`) now correctly appears when filtering by the **Beast** class filter button (`id: "0124"`).
- **Search Aliases for Non-Differentiated Servants**:
  - Moved `name_asc` extraction in `extract_servant_traits()` before early return, preserving `optionNames: { "001": "Anki Ereshkigal", "002": "Space Ereshkigal" }`.
  - Enables instant matching when searching for "Space Ereshkigal" or "Anki Ereshkigal" in the servant selector via precomputed `allNames`.
- **Fractional Craft Essence Bond Bonuses (e.g. 2.5%)**:
  - Fixed integer division `sv["RateCount"] // 10` which truncated `25` (0.1% units) down to `2%`.
  - Replaced with `val = sv["RateCount"] / 10; rate_val = int(val) if val.is_integer() else val`, properly yielding `bonus: 2.5` for:
    - `1565`: **Story of a Wolf** (`2.5%`)
    - `1605`: **Standing beneath the Azure Sky** (`2.5%`)
    - `1726`: **Dream Closet** (`2.5%`)
  - Corrected UI display across `bond-app.js` (`+2.5% All`, tooltips, and fallback portraits).
- **Verification & Deployment**:
  - `npm run data:validate`: Passed with 0 errors, 0 warnings.
  - `npm run lint` & `npm run format:check`: Passed cleanly.
  - `npm run build`: Static build passed in 1.29s.
  - GitHub Actions CI workflow `39155212224`: Succeeded and deployed to GitHub Pages.
  - Production verification: Verified live on `https://famakung.github.io/fgo-calculator/` in `data-chunk.DVRSLcy8.js` that servant `417` has `"0124"` and CEs have `bonus: 2.5`.

---

## 2026-10-19 — fix(sync): support Spiritron Dress costume traits, optionLabels & dynamic costume face icons

### What Was Built
- **Spiritron Dress Costume Extraction (`scripts/sync_atlas_data.py`)**:
  - Enhanced `extract_servant_traits()` to inspect `ascensionAdd.individuality.costume` and `profile.costume` in addition to ascension differences.
  - Generates costume stage keys (`"300"`, `"400"`, `"500"`) and trait differences against the servant's common base set.
  - Automatically extracts official English costume labels from `profile.costume[cid].shortName`, backed by `KNOWN_COSTUME_LABELS` fallback mapping for JP-only entries.
  - Handled servants whose Spiritron Dresses grant new traits:
    - **Scáthach (`"070"`)**: `300: ["2821"]`, `optionLabels: { 300: "Piercing Bunny" }`.
    - **Ryougi Shiki (`"091"`)**: `300: ["2821"], 400: ["2821"], 500: ["2821"]`, `optionLabels: { 300: "Decapitating Bunny (First Ascension)", 400: "Decapitating Bunny (Second Ascension)", 500: "Decapitating Bunny (Third Ascension)" }`.
    - **Paul Bunyan (`174`)**: `300: ["2821"]`, `optionLabels: { 300: "Mad Bunny" }`.
    - **Baobhan Sith (`311`)**: `300: ["2821"]`, `optionLabels: { 300: "Bloody Bunny" }`, `optionNames: { "000": "Tam Lin Tristan" }`.
    - **Chloe von Einzbern (`388`)**: `"002": ["2821"]`, `optionLabels: { 300: "Serious Mode" }`.
    - **U-Olga Marie (`444`)**: `300: ["0304"]`, `optionLabels: { 300: "Earth President" }`, `optionNames: { "002": "Olga Marie Animusphere" }`.
    - **Jade Rabbit (`448`)**: `300: ["0301", "0303", "2654", "2821"]`, `optionLabels: { 300: "Incognito Glasses" }`, `optionNames: { "001": "Ryougi Shiki", "002": "Jade Rabbit Kaguya", 300: "Jade Rabbit" }`.
- **Costume Face Icon Resolution**:
  - Extended `download_face_icon()` with `battle_chara_id` support to query Atlas static CDN face assets (`f_{battleCharaId}0_bordered.png`, `f_{battleCharaId}_bordered.png`).
- **Formatting & Zero-Commit Compatibility**:
  - Updated `format_servant_js_entry()` to serialize `optionLabels` and unquoted numeric costume stage keys (`300`, `400`, `500`) matching project formatting conventions.
  - Maintained zero-commit game data policy (`src/scripts/data/*.js` ignored in git).
- **Verification**:
  - `python3 scripts/sync_atlas_data.py`: Successfully synchronized 471 servants, 24 CEs, and 42 traits.
  - `npm run data:validate`: Passed with 0 errors and 0 warnings.
  - `npm run build`: Static build passed in 1.39s.
  - `npm run lint` & `npm run format:check`: Passed cleanly.
  - GitHub Actions CI build & deploy (`39152304215`): Passed in 52s build / 12s deploy.

---

## 2026-10-18 — feat(sync): zero-commit game data architecture & automated API trait fetching engine

### What Was Built
- **Zero-Commit Game Data Architecture**:
  - Transitioned `src/scripts/data/*.js` (`servants.js`, `craft_essences.js`, `traits.js`) to complete Zero-Commit architecture alongside image assets.
  - Added `src/scripts/data/*.js` to `.gitignore` and untracked existing files from git index while preserving disk files.
  - Created `scripts/ensure_data.js` and added `"predev"` / `"prebuild"` hooks in `package.json` to auto-generate datasets on fresh clone.
  - Updated `.github/workflows/deploy.yml` with `actions/cache@v4` caching `src/scripts/data/` for instant ~1s restoration across CI runs.
- **Automated API Trait Fetching Engine (`scripts/sync_atlas_data.py`)**:
  - Replaced static `CANONICAL_TRAIT_NAMES` dictionary with dynamic fetching from `export/NA/nice_trait.json`.
  - Implemented dynamic bracketed trait name extraction from NA CE skills (`[Beast Servants]`, `[modern human]`).
  - Preserved `"0200": "Heaven Attribute"` matching official NA in-game terminology.
  - Generates `src/scripts/data/traits.js` dynamically from API data.
- **Dual-Region CE Localization Fallback**:
  - Integrated `export/NA/basic_equip.json` to automatically upgrade unreleased JP CEs (`UNOFFICIAL_JP_TRANSLATIONS`) to official NA names when released globally.
- **Verification**:
  - `python3 scripts/sync_atlas_data.py --dry-run`: 0 errors.
  - `python3 scripts/sync_atlas_data.py`: Synchronized 24 CEs, 42 traits, and 474 servants.
  - `npm run data:validate`: Passed with 0 errors and 0 warnings.
  - `npm run build`: Static build passed in 1.41s.

---

## 2026-10-18 — feat(sync): full-auto Craft Essence data detection, series grouping & dynamic icon sync

### What Was Built
- **Atlas Academy Craft Essence Export Ingestion (`scripts/sync_atlas_data.py`)**:
  - Automatically queries and decompresses `export/JP/nice_equip_lang_en.json` (1.22 MB gzip, ~4.5s) using polite rate limiting.
  - Automatically detects all permanent bond gain CEs (`funcType == "servantFriendshipUp"` and no `EventId`), filtering out temporary event-only CEs.
  - Automatically extracts MLB values (`RateCount` -> `%`, `AddCount` -> `flatBonus`) and trait conditions (`functvals`, `overWriteTvalsList`, `matchAll: true`, and standard 7-class expansion for trait `2858`).
  - Formats and writes `src/scripts/data/craft_essences.js` with exact 2-space indentation and sorted 4-digit zero-padded string keys (`"0099"`, `"0330"`, `"1973"`, `"2509"`, etc.).
- **Automated Series-Aware Same-Effect Grouping**:
  - Automatically groups campaign variants sharing the exact same effect signature into `isGroup: true` with sub-options and contiguous folder ranges.
  - Discovered and grouped:
    - **Heroic Portrait** (`0099–0108`, 10 variants, flat +50 bond).
    - **Heroic Spirit Encounter** (`1973–1979`, 7 class variants, +10% bond to Fate/stay night servants).
    - **Heroic Spirit Apex** (`2512–2532`, 21 servant variants, +2% bond).
  - Applied series name alias mapping (`SERIES_NAME_OVERRIDES`) to name the *Fate/stay night* 20th Anniversary group **"Heroic Spirit Encounter"** with options formatted as `"Heroic Spirit Encounter: <Class>"`.
  - Registered trait `"2883": "Fate/stay night"` in `TRAIT_DATA` and mapped to all 10 FSN servants in `src/scripts/data/servants.js`.
- **Dynamic Face Icon Resolution (`scripts/fetch_bordered_ces.py`)**:
  - Fully removed the static `CE_MAP` dictionary (deprecating 46 hardcoded lines).
  - Extracts 8-digit face IDs dynamically from `extraAssets.faces.equip` via regex `f_(\d+)\.png`.
  - Multi-threaded download and WebP conversion to `public/craft_essences/{collectionNo:04d}.webp` (142x155 WebP, q80).
- **Verification**:
  - `python3 scripts/sync_atlas_data.py --dry-run`: Verified 0 errors.
  - `python3 scripts/sync_atlas_data.py`: Synchronized 24 CEs and fetched missing icons in 1.5s.
  - `node scripts/validate_data.js`: Passed with 0 errors and 0 warnings.
  - `astro build`: Static build complete in 1.34s with clean chunk splitting.

---

## 2026-10-18 — feat(sync): automated build-time data sync pipeline with actions/cache@v4, zero committed images & multi-ascension sync

### What Was Built
- **Build-Time Atlas Academy Data Sync Engine (`scripts/sync_atlas_data.py`)**:
  - Automatically queries `/export/JP/basic_servant.json`, extracts traits, and formats new entries into `src/scripts/data/servants.js`.
  - Built with `PoliteRateLimiter` configured to `0.1s` (100ms) delay between requests (~8 req/s), fetching cold-start datasets in **~1 minute** without hitting HTTP 429 rate limits.
  - Handles split servant IDs (`467-1` François Prélati, ID `505600`; `467-2` Francesca Prélati, ID `505700`).
  - Automatically detects missing multi-ascension stages (`001`, `002`) and spiritron dresses (`300`, `400`, `500`), downloading face icons using the `f_{base}{stage}_bordered.png` scheme.
  - Automatically verifies and synchronizes Craft Essence images via `ensure_ce_images()` and `scripts/fetch_bordered_ces.py`.
  - Cleans temporary cache on completion via `--clean-cache`.
- **Data Integrity & Schema Validator (`scripts/validate_data.js`)**:
  - Validates 4-digit zero-padded trait format, ascending sort order, and TRAIT_DATA coverage across 471 servants and 17 CEs.
  - Strictly verifies that default icons (`000.webp`) and all multi-ascension stage icons (`001`, `002`, `300`+) exist on disk.
- **Zero-Commit Git Architecture**:
  - Ignored `public/servants/` and `public/craft_essences/` in `.gitignore`.
  - Untracked all historical image files from Git repository (`git rm -r --cached`), keeping all files physically intact on local disk for local testing.
  - Flattened CE images folder from `public/craft_essences/128/` directly into `public/craft_essences/` and updated image references in `data.js` and `BaseLayout.astro`.
- **GitHub Actions Ephemeral Workflow (`.github/workflows/deploy.yml`)**:
  - Automated CI running on daily schedule (`02:00 UTC`), push to `main`, and manual dispatch (`workflow_dispatch`).
  - Restores and caches assets with `actions/cache@v4` on `.cache/atlas/`, `public/servants/`, and `public/craft_essences/`.
  - Runs data sync and validation before `astro build`, deploying a 100% same-origin static site to GitHub Pages with zero external dependencies at runtime.
- **Verification**:
  - `node scripts/validate_data.js`: Passed with 0 errors and 0 warnings.
  - `python3 scripts/sync_atlas_data.py --dry-run`: Verified 100% up-to-date.
  - GitHub Actions Run `#39141689903`: Build and deploy succeeded in 2m 32s.
  - Dev server running on `localhost:3000/fgo-calculator/`.

---

## 2026-10-15 — feat(cefilter): modalize servant filters into Filter Settings modal, direct search bar layout & mobile 2-per-row grid

### What Was Built
- **Servants Card Layout Modernization**:
  - Moved the search bar out of the collapsible filter accordion and placed `#cefilterSearchInput` statically above the controls row for instant accessibility.
  - Positioned the `Filter` button directly adjacent to the sort selection controls (`#cefilterSortBy` + `#cefilterSortOrderToggle`) in `.cefilter-sort-row`.
- **Servant Filters Modal (`#cefilterFilterModal`)**:
  - Modal titled `"Filter Settings"` containing the Class, Rarity, and CE Match Count filter buttons.
  - Header features only a close button (`✕`), maintaining visual consistency with the "Add Craft Essence" modal.
  - Class, rarity, and CE match count buttons continue to filter results live in the background.
  - **Class Icon Fix**: Updated class filter icons to assign `src: icons/classes/${cls.icon}.webp` directly (instead of deferred `data-src`), ensuring all 15 class icons render immediately upon opening the modal.
- **"Add Craft Essence" Modal Search Bar Refactor (`#ceFilterModal`)**:
  - Removed the collapsible filter accordion (`CollapsibleFactory.populateFilterArea`) from the CE picker modal.
  - Replaced it with a direct search input (`#ceFilterPickerSearch`) immediately above the CE grid with automatic query resetting upon modal open.
- **Mobile 2-per-Row Grid Fix (`.grid-sm`)**:
  - Fixed mobile collapsing issue on viewports < 580px (e.g. iPhone SE 375px / 320px) where `repeat(auto-fit, minmax(0, 140px))` collapsed grid columns down to 1 item per row.
  - Defaulted `.grid-sm` to `grid-template-columns: repeat(2, minmax(0, 140px)); gap: 8px; padding: 8px 4px; justify-content: center;`.
  - Configured mobile `.servant-modal-content` to `width: 95%; padding: 16px 8px; max-width: 360px;`.
  - Scaled picker items to `width: 100%; max-width: 140px; box-sizing: border-box; height: 136px;`.
  - Responsive scaling preserved via `@media (width >= 580px)` overrides (`grid-template-columns: repeat(auto-fit, minmax(130px, 140px)); padding: 8px; width: 90%; padding: 20px;`).
- **Modal Accessibility & Keyboard Navigation**:
  - Added `Escape` key listeners to close `#cefilterFilterModal` and `#ceFilterModal`.
  - Added `aria-label="Close"` and `aria-label="Back"` attributes across modal buttons.
- **Critical CSS Synchronization & Zero CLS**:
  - Replaced `#cefilter-filter-area` in `critical.css` and synchronized `<style is:inline>` in `BaseLayout.astro` with static layout rules for `.cefilter-search-container`, `.cefilter-search-input`, and `.cefilter-filter-btn`.
  - Zero Cumulative Layout Shift (CLS).
- **Validation**:
  - ESLint and Stylelint passed with 0 errors.
  - Prettier format check passed cleanly.
  - Astro production build succeeded.
  - Automated Puppeteer E2E tests verified 2 items per row on iPhone SE (375px) and iPhone SE 1st gen (320px), live search filtering, class icon rendering, and 0 browser console errors.

---

## 2026-10-14 — style(filters): adjust CE num select and star select filter buttons to 48×36px

### What Was Built

- Standardized the dimensions of all CE count select buttons (`.ce-count-btn`) and star / rarity select buttons (`.rarity-btn`) across the application:
  - Updated dimensions from `min-width: 40px; height: 32px; padding: 0 8px;` to `width: 48px; height: 36px; padding: 0 4px;`.
  - Harmonizes horizontal button width (48px) with class filter buttons (`.class-btn`: 48×48px) while providing a clean 36px height profile.
  - Sizing applies across:
    - Bond Gain CE collapsible filter area: star select (`.rarity-btn`, 5★–0★) and CE match count (`.ce-count-btn`, 0–5 CE).
    - Bond Gain CE custom count selector (`.cefilter-custom-count .ce-count-btn`, 1, 2, 3...).
    - Servant Selector modal: star select (`.rarity-btn`, 5★–0★).
    - CE Servant Overlap modal: star select (`.rarity-btn`) and CE match count (`.ce-count-btn`).
- Synchronized across [`src/styles/global.css`](../../src/styles/global.css) and inlined `<style is:inline>` in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro).

---

## 2026-10-14 — feat(bond): bond badge repositioning outside portrait & blank servant slot consistency

### What Was Built

- **Bond Badge Placement (Outside Portrait)**:
  - Attached `.servant-slot-frontline-badge` to `.servant-slot` (`slot.appendChild(badgeContainer)`), positioned at `top: 4px; left: 4px; z-index: 2;`.
  - Places the bond bonus badge outside the centered servant portrait in the top-left corner of the card, creating clean symmetry with the remove button (`.servant-remove-btn`) at `top: 4px; right: 4px;`.
  - Preserved centered text overlay (`.servant-slot-badge-overlay`) directly over the medal icon (`+20%`, `All / +4%`, `All / +25%`) with 4-way white text shadow outline.
- **Blank Servant Slot Template & Spacing Alignment**:
  - Removed ~40 lines of legacy hidden dummy controls (`dummyTypeRow`, `dummyCheckboxRow`, `dummyInputBox`) that previously inflated empty slot card height.
  - Aligned blank servant slot template with blank Craft Essence slot (`.ce-slot.ce-add-slot`):
    - Fallback icon `+`: `.servant-slot-portrait-fallback` updated to `font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);`.
    - Label `"Add Servant"`: updated to `.servant-slot-name` with bold font weight (`font-weight: 600; color: var(--text); font-size: 0.7rem; text-align: center; margin-top: 6px; width: 100%;`), matching `"Add Craft Essence"`.
    - Total empty slot height now matches CE slot (~142.8px) with exact same 6px gap and 10px 8px padding.
    - Preserved frontline red (`#e74c3c`) and backline blue (`#3498db`) borders both in normal state and hover state (`border-style: dashed;` with color retention).
  - Harmonized grid padding: both `.grid` and `.ce-grid` share `padding: 8px;`.
- Synchronized all CSS changes into `<style is:inline>` in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro) and [`src/styles/global.css`](../../src/styles/global.css).

---

## 2026-10-14 — fix(worker): migrate CE match Web Worker to Vite ESM worker constructor

### Problem

- On `https://famakung.github.io/fgo-calculator/`, browser console logged `warn: Worker error:` and network failed with HTTP 404 for `ce-match-worker.min.js`.
- Root cause: `CEFilterApp` instantiated the worker using legacy esbuild filename string `new Worker("ce-match-worker.min.js")`, which was never compiled or output by Astro/Vite.

### What Was Built

- Migrated worker constructor in [`src/scripts/ce-filter-app.js`](../../src/scripts/ce-filter-app.js) to standard Vite ESM format: `new Worker(new URL("./ce-match-worker.js", import.meta.url), { type: "module" })`.
- Vite now automatically compiles `src/scripts/ce-match-worker.js` into hashed chunk `dist/_astro/ce-match-worker-*.js` and rewrites the asset URL correctly.
- Dispatched `{ type: "compute" }` in `initWorker()` and connected `_processWorkerResults(e.data)` in `_worker.onmessage` to store worker-computed match caches.
- Verified with Puppeteer: worker loads with HTTP 200, executes trait calculations, and posts results with 0 console errors.

---

## 2026-10-14 — fix(assets): implement image cache busting and legacy service worker purge

### Problem

- When servant and Craft Essence icons were upgraded to the official Atlas Academy bordered format, image filenames remained identical (`servants/{ID}/{ascension}.webp`, `craft_essences/128/{ID}.webp`).
- Existing visitors' browsers and HTTP disk caches continued serving stale borderless images from local cache, requiring a manual hard refresh (`Ctrl+F5` / `Ctrl+Shift+R`) to fetch new images with borders.
- Legacy clients who visited before the Astro migration retained active service workers and `CacheStorage` buckets (`fgo-calc-v20`) caching static assets for 1 year.

### What Was Built

- **Image Versioning & Cache Busting**:
  - Added `IMAGE_VERSION = "2"` constant in [`src/scripts/constants.js`](../../src/scripts/constants.js).
  - Appended `?v=${IMAGE_VERSION}` to all servant portraits and Craft Essence icon URLs generated in [`src/scripts/data.js`](../../src/scripts/data.js).
  - Updated inlined image preload script in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro) to match `?v=2` so preloads hit accurately without duplicate network requests.
- **Service Worker & CacheStorage Purge**:
  - Injected an inlined cleanup script in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro) to immediately invoke `navigator.serviceWorker.getRegistrations()` to unregister active service workers and clear all legacy `CacheStorage` entries via `caches.delete()`.
  - Added a retirement killswitch service worker at [`public/sw.js`](../../public/sw.js) to self-unregister and claim/purge caches on any browser background update checks.
- Validated with headless browser test, Prettier format check, ESLint, Stylelint, and production Astro build.

---

## 2026-10-14 — style(event): adjust material-icon to 96px height auto width and mini-icon to 48px height auto width

### What Was Built

- Configured Event Shop material cards and quest drops icons with auto width based on native 112:120 frame aspect ratio:
  - `.material-icon`: height `96px`, width `auto`, `aspect-ratio: 112 / 120` (resolves to `~89.6px`).
  - `.material-icon-wrapper`: `width: fit-content; height: 96px; margin: 0 auto 10px;`.
  - `.material-icon .fg-layer`: `80×80px` ($96 \times \frac{100}{120}$).
  - `.mini-icon`: `display: block; width: auto; height: 48px; aspect-ratio: 112 / 120` (resolves to `~44.8px`).
  - `.mini-icon .fg-layer`: `40×40px` ($48 \times \frac{100}{120}$).
  - Synchronized across [`src/styles/global.css`](../../src/styles/global.css) and inlined styles in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro).
  - Validated with headless browser screenshots (`npm run lint`, `npm run format:check`, `npm run build`).

---

## 2026-10-14 — style(bond): adjust frontline bond badge medal image display size to 24×24px

### What Was Built

- Adjusted servant slot bond badge medal image and item container dimensions in the Bond Calculator:
  - Updated `.servant-slot-frontline-badge img` and `.servant-slot-badge-item img` from `27×27px` to `24×24px`.
  - Updated container `.servant-slot-badge-item` from `27×27px` to `24×24px` to keep text overlays centered.
  - Position remains pinned at `top: 5px; right: 6px;` inside the portrait wrapper.
  - Synchronized across [`src/styles/global.css`](../../src/styles/global.css) and inlined styles in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro).
  - Validated with headless browser screenshots (`npm run lint`, `npm run format:check`, `npm run build`).

---

## 2026-10-14 — style(filters): adjust class icon inner image size to 40×40px

### What Was Built

- Adjusted class filter icon inner image dimensions within the 48×48px button:
  - Updated `.class-btn img` from `38×38px` to `40×40px` (`object-fit: contain;`).
  - Container remains `48×48px` with 2px border, providing crisp 2px internal padding on all sides.
  - Synchronized across [`src/styles/global.css`](../../src/styles/global.css) and inlined styles in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro).
  - Validated with headless browser screenshots (`npm run lint`, `npm run format:check`, `npm run build`).

---

## 2026-10-14 — style(badges): adjust CE badges & chips display height to 48px with auto width

### What Was Built

- Configured Craft Essence badges and chips to only set height (`48px`) with automatic width:
  - CSS variables: added `--ce-badge-h: 48px;` and `--ce-badge-w: calc(var(--ce-badge-h) * 142 / 155);` to `:root`.
  - Badges and chips use `height: var(--ce-badge-h); width: auto; aspect-ratio: 142 / 155;` so width resolves naturally to ~43.97px (~44px) across all browsers.
  - Applied across:
    - Bond Gain CE match badges (`.cefilter-match-badge` & `.cefilter-match-badge-fallback`: height 48px, auto width).
    - Bond Gain CE active CE chips (`.cefilter-chip img`: height 48px, auto width).
    - Bond Results equipped CEs (`.bond-result-ce-img` & `.bond-result-ce-fallback`: height 48px, auto width).
    - Bond Results max bond CE wrapper (`.bond-result-ce-maxbond-wrap`: `width: fit-content; height: var(--ce-badge-h);`).
    - CE badge grid (`.grid-micro`): updated `grid-template-columns` from `minmax(0, 48px)` to `minmax(0, var(--ce-badge-w))` so horizontal spacing between badges exactly matches vertical spacing (both 4px).
  - Synchronized in [`src/styles/critical.css`](../../src/styles/critical.css), [`src/styles/global.css`](../../src/styles/global.css), and inlined critical styles in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro).
  - Validated with headless browser screenshots (`npm run lint`, `npm run format:check`, `npm run build`).

---

## 2026-10-13 — style(portraits): adjust servant & CE portrait display height to 96px with auto width

### What Was Built

- Configured servant and Craft Essence bordered portrait display dimensions to only set height (`96px`) with automatic width:
  - CSS variable: `--servant-portrait-h: 96px;` (removed `--servant-portrait-w`).
  - Portraits use `height: var(--servant-portrait-h); width: auto; aspect-ratio: 142 / 155;` so width resolves naturally to ~87.95px across all browsers.
  - Applied across:
    - Bond Calculator servant slots (`.servant-slot-portrait`: height 96px, auto width; `.servant-slot-select-btn`: `width: fit-content;`).
    - Bond Calculator CE slots (`.ce-portrait`: height 96px, auto width).
    - Bond Calculator results servant cards (`.bond-result-servant-card .servant-slot-portrait`: height 96px, auto width).
    - Bond Gain CE servant result cards (`.cefilter-servant-card img.servant-slot-portrait`: height 96px, auto width).
    - Servant and CE Selector Modal items (`.servant-picker-grid--servant`, `.servant-picker-grid--ce`: height 96px, auto width, card height 136px).
    - CE Overlap Modal filter items (`.ceoverlap-ce-filter .servant-picker-item img`: height 96px, auto width, card height 136px).
  - Adjusted `.cefilter-servant-card` `min-height: 208px; contain-intrinsic-size: auto 208px;` for CLS prevention with 96px portraits.
  - Synchronized in [`src/styles/critical.css`](../../src/styles/critical.css), [`src/styles/global.css`](../../src/styles/global.css), and inlined critical styles in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro).
  - Validated with headless browser screenshots (`npm run lint`, `npm run format:check`, `npm run build`).

---

## 2026-10-13 — style(filters): adjust class icon button display size to 48px with 38px icon

### What Was Built

- Adjusted class filter button dimensions across all filter interfaces (Bond Gain CE, Servant Modal Picker, CE Overlap Modal):
  - `.class-btn`: updated container dimensions from 60×60px to 48×48px to match the 48px footprint of CE badges.
  - `.class-btn img`: updated inner icon dimensions from 48×48px to 38×38px, providing clean proportional padding (~3-4px from borders).
  - Synchronized in [`src/styles/global.css`](../../src/styles/global.css) and inline critical styles in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro).
  - Result: 15 class buttons fit in a single neat row on desktop modals, and 6 per row on mobile (6+6+3), significantly improving visual harmony with rarity and count filters.
  - Validated with headless browser screenshots (`npm run lint`, `npm run format:check`, `npm run build`).

---

## 2026-10-13 — feat(bond): bond badge overlay redesign with centered text, multi-line scope, and 27px compact size

### What Was Built

- Redesigned servant slot bond badges in the Bond Calculator (`#panel-bond`):
  - Placed bond badges directly inside the servant portrait button container (`.servant-slot-select-btn`) inset at `top: 5px; right: 6px;`.
  - Sized bond badge icons to 27px (25% reduction from 36px) with proportional typography.
  - Text overlay behavior:
    - Unified typography across both All and Self to a consistent `0.52rem` font size for clean visual balance.
    - **Self** (Starting Member normal servant, `+20%`): single line centered directly over the bond medal icon (`font-size: 0.52rem;`).
    - **All** (Starting Member support `+4%` or Bond >= 15 `+25%`): two stacked lines centered directly over the icon with `"All"` on line 1 and percentage on line 2 (both `font-size: 0.52rem;`).
    - Added crisp 4-way white text shadow (`text-shadow: 0 1px 2px #fff, 0 -1px 2px #fff, 1px 0 2px #fff, -1px 0 2px #fff;`) with `#1a1a2e` text color for high legibility against the gold medal icon.
  - Restored `.servant-remove-btn` to the top-right corner (`top: 4px; right: 4px;`) as before, maintaining clean spacing from the centered portrait.
  - Updated inline critical styles in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro) and [`src/styles/global.css`](../../src/styles/global.css).
  - Validated with headless browser screenshots and passed `npm run lint` (`lint:js`, `lint:css`) and `npm run build`.

---

## 2026-10-13 — feat(ui): increase all image display sizes by 50% and unify CE icons to original resolution

### What Was Built

- Scaled all image and portrait display sizes across the application up by 50%:
  - CSS variables: `--servant-portrait-w: 106.5px` and `--servant-portrait-h: 116.25px` (from 71×77.5px), `--portrait-lg: 96px` (from 64px).
  - Frontline and Bond >= 15 servant slot badges: sized to compact 18×18px with `0.55rem` text and `0.45rem` overlay font to fit cleanly inside the slot margin space without overlapping the centered 106.5px servant portrait.
  - Maxbond overlay badge: sized to 16×16px (`top: -3px; right: -3px;`) to fit neatly in the corner of 48px CE cards without overlapping neighboring items.
  - Class filter buttons: enlarged from 40×40px to 60×60px with 48×48px icon images.
  - Event shop material icons: scaled from 56×60px (50×50px fg) to 84×90px (75×75px fg).
  - Drop mini-icons: scaled from 28×30px (24×24px fg) to 42×45px (36×36px fg).
  - Modal servant and CE picker cards: enlarged to 140×144px (default) and 140×156px (servant/CE) with `.grid-sm` minmax 140px and `.grid-mini` minmax 96px.
  - Bond Gain CE chips: enlarged to 48px icons with 0.85rem text; CE match badges 48px (`aspect-ratio: 142 / 155`).
  - `.cefilter-servant-card`: updated intrinsic height and min-height to 228px for zero CLS.
  - Desktop media queries: `.ceoverlap-ce-filter` cards sized to 140×156px with minmax 140px grid.
- Unified Craft Essence asset loading and removed thumbnail folder:
  - Deleted `public/craft_essences/64/` (46 small WebP files).
  - Updated [`src/scripts/data.js`](../../src/scripts/data.js) `thumbImage` to point directly to `craft_essences/128/{id}.webp`.
  - Updated preload script in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro) to preload `craft_essences/128/`.
  - Updated [`scripts/fetch_bordered_ces.py`](../../scripts/fetch_bordered_ces.py) to save only native `128/` icons.
- Updated documentation in [`.claude/docs/data-rules.md`](data-rules.md) and [`.claude/docs/fetch-data-guideline.md`](fetch-data-guideline.md).

---

## 2026-10-13 — feat(assets): migrate Craft Essence icons to Atlas Academy bordered format (Option A)

### What Was Built

- Migrated all 46 Craft Essence icon assets (92 WebP images across `public/craft_essences/128/` and `public/craft_essences/64/`) to the official in-game bordered card format (`https://static.atlasacademy.io/JP/Faces/f_{long_id}_bordered.png`).
- High-res full icons (`public/craft_essences/128/`): saved at native `142×155` RGBA WebP (quality 80, method 6).
- Thumbnail icons (`public/craft_essences/64/`): scaled proportionally via Lanczos to `71×78` WebP (quality 80, method 6).
- Created multi-threaded batch fetch and conversion utility [`scripts/fetch_bordered_ces.py`](../../scripts/fetch_bordered_ces.py) with automatic retry and unbordered fallback.
- Added BEM modifier class `.servant-picker-grid--ce` to `#cePickerGrid`, `#ceSubPickerGrid`, and `#ceFilterPickerGrid` in [`src/pages/index.astro`](../../src/pages/index.astro).
- Updated [`src/styles/global.css`](../../src/styles/global.css) and inlined critical styles in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro):
  - `.ce-portrait`, `.ce-portrait-fallback`: `width: var(--servant-portrait-w); aspect-ratio: 142 / 155; height: auto; border: none; object-fit: contain;`
  - `.servant-picker-grid--ce .servant-picker-item`: `width: 100px; height: 108px; padding: 6px 4px;`
  - `.servant-picker-grid--ce .servant-picker-item img`: `width: var(--servant-portrait-w); aspect-ratio: 142 / 155; height: auto; border: none; object-fit: contain; margin-bottom: 4px;`
  - `.cefilter-chip img`: `width: 32px; aspect-ratio: 142 / 155; height: auto; border: none; object-fit: contain;`
  - `.cefilter-match-badge`, `.cefilter-match-badge-fallback`: increased by 50% from 32px to `48px; aspect-ratio: 142 / 155; height: auto; border: none; object-fit: contain;`
  - `.bond-result-ce-img`, `.bond-result-ce-fallback`, `.bond-result-ce-maxbond-wrap`: increased by 50% from 32px to `48px; aspect-ratio: 142 / 155; border: none; object-fit: contain;` with 20px maxbond overlay icon.
  - `.grid-micro`: updated to `repeat(auto-fit, minmax(0, 48px))`.
  - `.cefilter-servant-card`: updated intrinsic and min-height to 174px.
  - `.ceoverlap-ce-filter .servant-picker-item` and image updated for both mobile and desktop viewports.
- Updated documentation in [`.claude/docs/fetch-data-guideline.md`](fetch-data-guideline.md) and [`.claude/docs/data-rules.md`](data-rules.md).

---

## 2026-10-13 — feat(assets): migrate servant icons to Atlas Academy bordered format (Option A)

### What Was Built

- Migrated all 522 servant face icon assets across 471 servant folders in `public/servants/` to the official in-game bordered card format (`https://static.atlasacademy.io/JP/Faces/f_{base}{asc}_bordered.png`).
- Converted all downloaded 142×155 RGBA assets to WebP (quality 80, method 6) via Pillow.
- Created batch download & conversion utility [`scripts/fetch_bordered_servants.py`](../../scripts/fetch_bordered_servants.py) supporting multi-threaded fetching with fallback handling.
- Updated [`src/styles/global.css`](../../src/styles/global.css), [`src/styles/critical.css`](../../src/styles/critical.css), and [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro) for Option A native proportional scaling:
  - Added CSS variables `--servant-portrait-w: 71px` and `--servant-portrait-h: 77.5px` (consistent with 50% / 2x Retina scale of 142×155, scaled up from 64×64 proportionally).
  - `.servant-slot-portrait`: `width: var(--servant-portrait-w); aspect-ratio: 142 / 155; height: auto; border: none; object-fit: contain;`
  - `.bond-result-servant-card .servant-slot-portrait`: `width: var(--servant-portrait-w); aspect-ratio: 142 / 155; height: auto; object-fit: contain;`
  - `.cefilter-servant-card img.servant-slot-portrait`: `width: var(--servant-portrait-w); aspect-ratio: 142 / 155; height: auto; object-fit: contain;`
  - `#servantPickerGrid .servant-picker-item, #ascensionPickerGrid .servant-picker-item`: `width: 100px; height: 108px; padding: 6px 4px;`
  - `#servantPickerGrid .servant-picker-item img`, `#ascensionPickerGrid .servant-picker-item img`: `width: var(--servant-portrait-w); aspect-ratio: 142 / 155; height: auto; border: none; object-fit: contain;`
  - Adjusted `.cefilter-servant-card` intrinsic and min height to 156px for zero CLS.
- Updated [`.claude/docs/fetch-data-guideline.md`](fetch-data-guideline.md#L525-L570) with `_bordered.png` URLs and fixed reference table row 425/426.

---

## 2026-04-18 — feat(servant-info): servant data pipeline

**Branch:** `feat/servant-info` (not merged)

### What Was Built

Python pipeline to fetch Atlas Academy API data and convert to formatted markdown info sheets.

### Files Created/Modified

| File | Action |
|------|--------|
| `data/servant-data/convert_servant.py` | New — fetch + convert script |
| `data/servant-data/effect_map.py` | New — ID-based effect/buff/func mappings |
| `data/servant-data/USAGE.md` | New — usage guide |
| `data/servant-data/raw/106600.json` | New — Jacques raw JSON |
| `data/servant-data/raw/306400.json` | New — Demeter raw JSON |
| `data/servant-data/raw/605200.json` | New — Snake Wife raw JSON |
| `data/servant-data/information/466.md` | New — Jacques info sheet |
| `data/servant-data/information/465.md` | New — Demeter info sheet |
| `data/servant-data/information/463.md` | New — Snake Wife info sheet |
| `.claude/docs/fetch-data-guideline.md` | Renamed from `image-download-guideline.md`; added API fetch section |

### Pipeline Design

- `convert_servant.py <long_id> [--availability Label] [--name "Name"]` — fetches API + saves JSON + generates MD
- `convert_servant.py path/to/file.json` — converts local JSON only
- `--name` override for JP-only servants where API returns no English name
- Effect mappings keyed by numeric ID (`buff.id`, `funcId`) — more stable than string type names
- New effects: add to `effect_map.py` only, no code changes needed for known patterns

### Key API Facts

- Endpoint: `https://api.atlasacademy.io/nice/JP/svt/{long_id}?lore=false&lang=en`
- Card types: 1=Arts, 2=Buster, 3=Quick, 4=Extra
- `svals[0]` = level 1, `svals[-1]` = level 10 (min→max range)
- `buff.id` (not `buff.type`) is stable identifier for buff effects
- `funcTargetType` stays string-keyed (no numeric IDs in API)
- `ascensionAdd.attribute.ascension` contains per-ascension attribute overrides

### Servant ID Reference

| Short ID | Long ID | Name |
|----------|---------|------|
| 466 | 106600 | Jacques de Molay |
| 465 | 306400 | Demeter |
| 463 | 605200 | Snake Wife |

---

## 2026-04-18 — feat(servant-info): pipeline expansion — NP, Passives, images, 2 new servants

**Branch:** `feat/servant-info` (not merged)

### What Changed

Extended `convert_servant.py` and `effect_map.py` with NP parsing, passives, ascension image downloads, and folder-per-servant output. Tested with Richard I (432) and Raikou/Ushi Gozen (403).

### Output Structure Change

`information/{collectionNo}.md` → `information/{collectionNo}/data.md` + ascension PNGs in same folder.
Existing sheets for 466, 465, 463 migrated to folder structure.

### New Pipeline Features

| Feature | Detail |
|---------|--------|
| Noble Phantasm section | Card type, scope (AOE/Single), hits, NP Gain%, effect lines |
| Passives section | `classPassive` only; `extraPassive` skipped (event/bond skills) |
| Ascension images | `extraAssets.charaGraph.ascension` → `{label}_Ascension.png` |
| OC-scaling buff detection | Compare `svals[0].Value` vs `svals5[0].Value`; tag `<effect increases with Overcharge>` |
| Rate-based chance buffs | 4th element `use_rate=True` in BUFF_TYPE_INFO → reads `Rate` field (e.g. Stun) |
| `attackBeforeFunction` hardcodes | funcId 22443 (Richard sk1 crit star), 20955 (Raikou sk2 Quick crit) — Value field is internal ref ID, not displayable |
| Attribute ordinals | `fmt_attribute` uses 1st/2nd/3rd labels; excludes 4th ascension |
| Multi-trait join | `ckOpIndv` traits joined with ` with ` (was `, `) |
| `OnField` condition | Appended as " when you are on the field" after target |

### New effect_map.py Entries

**SKIP_FUNC_IDS added:** 216, 308, 3121 (hidden crit rate buffs, Raikou NP downCriticalpoint)

**BUFF_TYPE_INFO added:** 148 (DEF Down), 230 (Nullify Buff), 162 (Debuff Resist Up), 136 (Damage Plus), 158 (Debuff Success Rate Up), 140 (NP Gain Up), 117 (Star Drop Rate Up), 115 (Star Absorption), 720 (Buster Star Absorption), 952 (Buster Crit Damage Up), 504/505/506 (card DEF Down), 124 (Burn), 145 (Crit Rate Down), 178 (Stun rate-based), 169 (Debuff Resist Down demerit), 228 (NP on hit /10), 389 (Quick Crit Damage Up)

**FUNC_TYPE_NO_BUFF added:** 474 (delayNpturn), 476 (gainStar), 501 (shortenSkill)

**TRAIT_ID_LABELS added:** 3007 (DEF Buffs), 1000 (Servants), 200–204 (attributes), 100–112 (classes), 300–306 (alignments), 1–2 (gender)

### New Servants Processed

| Short ID | Long ID | Name |
|----------|---------|------|
| 432 | 106100 | Richard I |
| 403 | 1101800 | Minamoto-no-Raikou/Ushi Gozen |

### Key Fixes

- `fmt_condition` grammar: `"1 turns"` → `"1 turn"` (singular check)
- buff 228 divisor: /1 → /10 (shows 14% not 140)
- Passive order: API order preserved (reorder logic reverted)
- `on_field_str` placement: after target, not before

---

## 2026-04-18 — feat(servant-info): generic attackBeforeFunction handler (session 5)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Replaced two hardcoded `funcId` blocks with a fully generic `attackBeforeFunction` resolver. Explored Atlas Academy API to find the key insight: outer `svals[0].Value` = inner skill ID → fetch `/nice/JP/skill/{id}` → parse `functions[]` via existing BUFF_TYPE_INFO.

### API Endpoints Explored

| Endpoint | Result |
|----------|--------|
| `/nice/JP/function/{func_id}?lang=en` | Container buff metadata only — no inner effect info |
| `/nice/JP/buff/{buff_id}?lang=en` | Same metadata as /function — no new info |
| `/nice/JP/skill/{skill_id}?lang=en` | Full skill with svals — key endpoint for resolution |

### New Code in convert_servant.py

| Addition | Detail |
|----------|--------|
| `API_SKILL` | `https://api.atlasacademy.io/nice/JP/skill` |
| `_inner_skill_cache` | Module-level dict; skips refetch for same skill ID |
| `CARD_TRIGGER_PHRASES` | Trait ID → trigger phrase: 4001=Arts, 4002=Buster, 4003=Quick, empty=any |
| `fetch_inner_skill(skill_id)` | Fetches `/skill/{id}?lang=en` with cache |
| `fmt_attack_before_function(fn, outer_svals)` | Full resolver: inner skill ID from `svals[0].Value`, card trigger from `buff.ckSelfIndv`, inner effects via BUFF_TYPE_INFO, outer condition only when `Count > 0` |
| Detection in `fmt_function` | `if buff["type"] == "attackBeforeFunction": return fmt_attack_before_function(fn, svals)` |

### Removed Hardcodes

- funcId 22443 (Richard I sk1 crit star drop rate) — now auto-resolved
- funcId 20955 (Raikou sk2 Quick crit strength) — now auto-resolved

### Key Logic Decisions

- **Outer condition rule:** Show only when `Count > 0`. Avoids "…(3 turns) (3 turns)" duplication when outer Turn=inner Turn but no Count limit.
- **Card trigger:** Read `buff.ckSelfIndv` trait IDs. 4003=Quick, empty=any card ("when attacking before damage").

### Verified Outputs

- Richard sk1: `Apply a state that "Increase Critical Star Drop Rate by 30% (3 turns) for yourself when attacking before damage"`
- Raikou sk2: `Apply a state that "Increase Critical Strength by 10-20% (3 turns) for yourself before dealing Quick Card damage" (5 times, 3 turns)`

---

## 2026-04-18 — feat(servant-info): Soujuurou (No.414) + new buff/func handlers (session 6)

**Branch:** `feat/servant-info` (not merged)

### Completed Servant

**Soujuurou (No.414 / svtId 704900)** — fully converted and verified.

### New Handlers Added to `convert_servant.py`

| Handler | Detail |
|---|---|
| `gainMultiplyNp` | `Value/1000+1` = multiplier; formats as "1.5-2x" |
| `delayFunction` buff | ActSelectIndex=0 only; fetches inner skill via `sv0.Value`; 2-line quoted output |
| `damageNpStateIndividualFix` | Fixed Correction% + NP-level Value scaling; hardcoded "to a single enemy" |
| `TriggeredTargetHpRateRange` | Changed from suffix to **prefix** format: "When HP is below X%, ..." |
| `DAMAGE_FUNC_TYPES` | Added `damageNpStateIndividualFix` for correct NP header hits count |

### New Entries in `effect_map.py`

**SKIP_FUNC_IDS:** `214` (upCriticalrate passive, hidden, Soujuurou), `7204` (downCriticalStarDamageTaken passive, hidden, Soujuurou)

**BUFF_TYPE_INFO:** `189` (Ignore Invincible), `5560` (Pierce Damage Cut), `5567` (Evade Death Damage), `2888` (incoming Critical Resistance), `2889` (C.Star Gen Taken, hidden), `3377` (Fear Immune), `4344` (Confusion Immune), `1459` (Skill Seal Immune)

**TRAIT_ID_LABELS:** `3058` (DEF Up)

**TARGET_LABELS:** `"enemy": "for one enemy"`

### Format Rules Confirmed

| Rule | Value |
|---|---|
| HP conditional | Prefix `"When HP is below X%, ..."` |
| NP header scope | `"Single-Target"` (hyphenated) |
| NP header singular | `"1 Hit"` not `"1 Hits"` |
| damageNpStateIndividualFix | `"Deal significant Special Attack by {correction}% [{trait}] by {val}% <effect increases with Level> to a single enemy"` |
| delayFunction line 1 | ends at `{target}` (no closing quote) |
| delayFunction line 2 | ends with `\" {target}` |

### Hardcode Audit

Only `func_id == 7015` (Miss Crane Spiritron Dress) — justified, target label would produce redundant "excluding yourself for all allies excluding yourself".

### Servant ID Reference Addition

| Short ID | Long ID | Name |
|----------|---------|------|
| 414 | 704900 | Shizuki Soujuurou |

---

## 2026-04-18 — feat(servant-info): Kuonji Alice (No.415) + new buff/func handlers (session 7)

**Branch:** `feat/servant-info` (not merged)

### Completed Servant

**Kuonji Alice (No.415 / svtId 505500)** — fully converted and verified.

### New Handlers Added to `convert_servant.py`

| Handler | Detail |
|---|---|
| `specialInvincible` buff | `Apply [{buff.name}] (N times, M turns) {target}` — name from buff.name field |
| `selfturnendFunction` buff 243 | `Inflict Fear by {UseRate//10}% {fmt_condition(Turn, Count)} {target}` |
| `addIndividuality` buff | ShowState=1 + non-empty name → `Apply {name} (N times)`; else skip |
| `donotSkillSelect` / `continueFunction` buff types | Always skip (return None) |
| `displayBuffstring` funcType | Skip (added to existing skip list) |
| buff 5559 (Instant Death Guts) | `Apply a Guts by {Value} state ({Count} times) that only activates when [Death] is applied` |
| `shortenBuffcount` funcType | `Decrease {CounterName} by N {target}` — counter name from `_servant_counter_name` |
| `funcquestTvals` field condition | `only when on a [X], [Y], or [Z] field` — inserted before target in BUFF_TYPE_INFO return |
| `fmt_passives` rewrite | Index loop (while i < len) to combine consecutive 5559 + 5601 into one line |
| `_servant_counter_name` extraction | Scanned in `convert()` from classPassive addIndividuality with ShowState=1 + Count>0 |

### New Entries in `effect_map.py`

**BUFF_TYPE_INFO:** `154` (Sure Hit), `5602` (ATK Up variant), `5603` (DEF Up variant), `5568` (Damage Cut excl. NP, divisor=1), `5569` (Damage Cut vs ailments, divisor=1), `5601` (Guts HP restore string — no-value entry)

**TRAIT_ID_LABELS:** `1001` (Human), `2073` (Forest), `2392` (City), `2884` (Darkness)

### Format Rules Confirmed

| Rule | Value |
|---|---|
| Instant Death Guts value position | `"Apply a Guts by {val} state ({count} times) ..."` — val between "Guts" and "state" |
| gutsFunction HP restore | Inner skill fetched for gainHp value: `"restores HP by {val} when Guts is activated"` |
| addIndividuality count word | `"times"` not `"uses"` |
| 5568 / 5569 | Show value (divisor=1), not zero |
| selfturnendFunction (Fear) | Use UseRate//10 for %, fmt_condition(Turn,Count) for duration |

### Servant ID Reference Addition

| Short ID | Long ID | Name |
|----------|---------|------|
| 415 | 505500 | Kuonji Alice |

---

## 2026-04-18 — fix(fonts): swap font-display + SW v20

**Commit:** `be5147d` on `develop`, merged → `main`, pushed, Pages build queued.

### Problem
Custom fonts (DM Sans, Space Mono) not always rendering. Root cause: `font-display: optional` gives browser ~100ms block period then never swaps — permanent system font fallback on cache miss.

### Fix
- `styles.css` — all 6 `@font-face` declarations: `optional` → `swap`
- `index.html` — critical inline CSS (line 16): 4 `@font-face` `optional` → `swap`; CSP style hash updated `sha256-F1KEEi2Lo2O9bXQOvRranFLUVMJsh43m1ViqMbke6OU=` → `sha256-gNsmPoV2FzVcpsieUtn5fDaCdxEckurAswZ+1j1f2Zg=`
- `styles.min.css` — rebuilt via `npx cleancss`
- `sw.js` — cache `fgo-calc-v19` → `fgo-calc-v20`
- `.prettierignore` — new; excludes `app.js`, `app.min.js`, `ce-match-worker.min.js`, `styles.min.css`, `chunks/`, `node_modules/`
- `.claude/CLAUDE.md` — SW cache value corrected to `v20`; CSP style hash updated

### Verification
Hard-refresh live site (`Ctrl+Shift+R`) — DM Sans/Space Mono render on first load. No CSP violations in console. Network tab: woff2 files fetched.

---

## 2026-04-18 — feat(servant-info): pipeline fixes + damage NP format overhaul (session 8)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Polish pass on `convert_servant.py` and `effect_map.py`: file sorting, image skip, trait label fix, damage NP output format corrections.

### `effect_map.py` Changes

- All numeric-keyed dicts/sets (`SKIP_FUNC_IDS`, `FUNC_TYPE_NO_BUFF`, `BUFF_TYPE_INFO`, `TRAIT_ID_LABELS`) sorted ascending by key
- Duplicate key `887` merged — kept single entry with combined comment "upToleranceSubstate / Buff Removal Resist Up"
- Added `3004: "Buffs"` to `TRAIT_ID_LABELS` (buff categories section) — fixes `buffPositiveEffect` raw API name appearing in `subState` NP output

### `convert_servant.py` Changes

| Change | Detail |
|---|---|
| Image skip | `download_images()`: `if dest.exists(): continue` — prevents redownload when converting local JSON |
| `dmg_target` | Computed once in `fmt_np_function` after `target`; maps `enemyAll`→"to all enemies", `enemyOne`/`enemy`→"to a single enemy" |
| `damageNp` | `{target}` → `{dmg_target}` ("for all enemies" → "to all enemies") |
| `damageNpIndividualSum` | `{target}` → `{dmg_target}` |
| `damageNpIndividual` | "heavy"→"significant"; removed "Enemies with"; OC tag conditional (only when corr varies across OC); reordered to `by {corr}% [{trait}]`; hardcoded "to a single enemy" |

### Format Rules Confirmed

| Rule | Correct |
|---|---|
| Damage NP preposition | "to all enemies" / "to a single enemy" (not "for") |
| `damageNpIndividual` word | "significant Special Attack" (not "heavy") |
| Condition label in output | No "Enemies with" prefix — just `[Trait]` |
| OC tag | Only shown when correction% differs across OC levels (`corr_oc1 != corr_oc5`) |
| Correction position | `by {corr}%{oc_tag} [{trait}] damage by {val}%` |

### Key Code Pattern

```python
# fmt_np_function():
target = TARGET_LABELS.get(target_type, target_type)
dmg_target = {"enemyAll": "to all enemies", "enemyOne": "to a single enemy", "enemy": "to a single enemy"}.get(target_type, target)
```

---

## 2026-04-19 — feat(servant-info): AOE/ST damage word rule (session 9)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Added `damage_word` variable to `fmt_np_function()` in `convert_servant.py` to differentiate AOE vs single-target NP wording. Applied to all 4 damage func type handlers.

### Rule

| NP target | `target_type` | `damage_word` |
|---|---|---|
| AOE | `enemyAll` | `"heavy"` |
| Single-target | `enemyOne` / `enemy` | `"significant"` |

### `convert_servant.py` Changes

- Added `damage_word = "heavy" if target_type == "enemyAll" else "significant"` after `dmg_target` in `fmt_np_function()`
- `damageNp`: uses `{damage_word}` (was hardcoded)
- `damageNpIndividual`: uses `{damage_word}` (was hardcoded "significant")
- `damageNpIndividualSum`: uses `{damage_word}` (was hardcoded "significant")
- `damageNpStateIndividualFix`: uses `{damage_word}` (was hardcoded "significant")

### Key Code Pattern

```python
damage_word = "heavy" if target_type == "enemyAll" else "significant"
```

---

## 2026-04-19 — feat(servant-info): DRY NP handlers + attackAfterFunction + inner target fix (session 10)

**Branch:** `feat/servant-info` (not merged)

### What Changed

DRY pass on `fmt_np_function`, removed `CARD_COND_PHRASES`, fixed `fmt_attack_before_function` format + inner target, added `attackAfterFunction` handler, new buff mapping.

### `convert_servant.py` Changes

| Change | Detail |
|---|---|
| `_oc_last(fn, svals)` helper | Returns last non-null svals array (svals5→svals4→…→svals); used in `gainNp` and `damageNpIndividual` OC detection |
| Hoisted vars in `fmt_np_function` | `sv0`, `sv_np5`, `val_np1`, `val_np5`, `val_str` computed once before damage if-chain; all 4 damage handlers use them |
| Removed `CARD_COND_PHRASES` | Dict and `card_cond_str` removed from `fmt_function` — buff names already encode card type (e.g. "Buster Critical Strength") |
| `fmt_attack_before_function` format | `Apply a state that "..."` → `Apply "A state that ..."` + `{outer_cond_str} for yourself` at end |
| `outer_cond_str` fix | Was gated on `Count > 0`; now uses `fmt_condition(outer_turn, outer_count)` — shows turn-only conditions too |
| `inner_target` fix | Was hardcoded `"for yourself"`; now `TARGET_LABELS.get(inner_fn["funcTargetType"], ...)` — correct for enemy-targeting inner effects |
| `default_trigger` param | `fmt_attack_before_function(fn, svals, default_trigger="when attacking before damage")` — reused for `attackAfterFunction` |
| `attackAfterFunction` handler | In `fmt_function`: `return fmt_attack_before_function(fn, svals, default_trigger="when attacking")` |

### `effect_map.py` Changes

- Added `5245: ("Apply Poison Immune", 0, False)` to `BUFF_TYPE_INFO` (ascending order, between 4344 and 5560)

### Format Rules Confirmed

| Rule | Value |
|---|---|
| `attackBeforeFunction` quote format | `Apply "A state that {inner}" {outer_cond} for yourself` |
| `attackAfterFunction` trigger phrase | `"when attacking"` (not "before damage") |
| Inner target | Derived from `inner_fn["funcTargetType"]` — e.g. "for one enemy" for burn-on-attack effects |
| Outer cond | Shown when Turn OR Count is set (not just Count) |

### Verified Outputs

- Dantes sk2: `Apply "A state that Inflict Burn by 500 (3 turns) for one enemy when attacking" (3 turns) for yourself`
- Richard sk1: `Apply "A state that Increase Critical Star Drop Rate by 30% (3 turns) for yourself when attacking before damage" (3 turns) for yourself`

---

## 2026-04-19 — feat(servant-info): Cagliostro (No.410) + gutsFunction/commandattackAfterFunction handlers (session 11)

**Branch:** `feat/servant-info` (not merged)

### Completed Servant

**Alessandro di Cagliostro (No.410 / svtId 2800700)** — fully converted and verified.

### New Handlers Added to `convert_servant.py`

| Handler | Detail |
|---|---|
| `funcTargetTeam == "enemy"` skip | Universal skip in `fmt_function` — NPC-mode-only functions never shown to players |
| `gutsFunction` buff type | `fmt_attack_before_function(fn, svals, default_trigger="when Guts is activated")` |
| `commandattackAfterFunction` buff type | `fmt_attack_before_function(fn, svals, default_trigger="when normal attacking after damage")` |
| Buff-less inner func handling | `fmt_attack_before_function` inner loop extended: `if not inner_buffs:` now handles `FUNC_TYPE_NO_BUFF` lookup AND explicit `gainNp` funcType (no buffs[] in API response) |
| `inner_target` placement fix | Moved before `if not inner_buffs:` check so target_str is available in buff-less branch |
| Redundant "for yourself" suppression | `target_str = "" if inner_target == "for yourself" else f" {inner_target}"` — avoids double "for yourself" in inner content when outer wrapper already appends it |

### New Entries in `effect_map.py`

**BUFF_TYPE_INFO:**
- `1624: ("Increase Arts Card Critical Strength by {val}", 10, True)` — upCriticaldamage Arts variant
- `4051: ("Decrease Buff Success Rate by {val}", 10, True)` — upTolerance (enemy-applied, misleading name); fixed missing `{val}` placeholder

### Key Technical Insight

`funcTargetTeam` field distinguishes player-facing vs NPC-only functions. Both 5544 and 5547 share buff type `gutsFunction` and inner skill 970480, but 5547 has `funcTargetTeam: "enemy"` → NPC mode only → skip. The universal `funcTargetTeam == "enemy"` guard handles this cleanly without per-ID hardcodes.

### API Detail

`gainNp` funcType has no `buffs[]` array in Atlas Academy API responses. Must detect via `funcType` string, not via buff lookup.

### Verified Outputs

- Skill 2 line 3: `Apply "A state that Increase NP Gauge by 30% when Guts is activated" (1 time, 5 turns) for yourself`
- Skill 3 line 3: `Apply "A state that Decrease Buff Success Rate by 10% (1 turn) for one enemy when normal attacking after damage" (3 turns) for yourself`
- Passive last line: `Increase Arts Card Critical Strength by 10% for yourself`

### Servant ID Reference Addition

| Short ID | Long ID | Name |
|----------|---------|------|
| 410 | 2800700 | Alessandro di Cagliostro |

---

## 2026-04-19 — feat(servant-info): trait separator logic, field-conditional ATK, card trigger phrases (session 12)

**Branch:** `feat/servant-info` (not merged)

### Completed Servants

| Short ID | Long ID | Name |
|----------|---------|------|
| 272 | 203800 | Super Orion |
| 403 | 1101800 | Minamoto-no-Raikou/Ushi Gozen (reconverted) |
| 408 | 605000 | Hassan of the Shining Star |

### `convert_servant.py` Changes

| Change | Detail |
|---|---|
| `COMMAND_CARD_TRIGGER_PHRASES` dict | Added after `CARD_TRIGGER_PHRASES`; same IDs (4001/4002/4003) but phrases include "normal" prefix |
| `CARD_TRIGGER_PHRASES` updated | `"when Quick cards attacking before damage"` format (not `"before dealing Quick Cards damage"`) |
| `card_phrases` param in `fmt_attack_before_function` | Default `None`; when set, overrides `CARD_TRIGGER_PHRASES` for `ckSelfIndv` lookup |
| `commandattackBeforeFunction` handler | Passes `card_phrases=COMMAND_CARD_TRIGGER_PHRASES` |
| `gainStar` funcType explicit handler | In `fmt_function` before `FUNC_TYPE_NO_BUFF` lookup; no target appended (gainStar has no target in API) |
| `ckOpIndv` AND/OR separator | `buff.script.checkIndvType == 1` → `" with "` (AND); absent → `" and "` (OR) |
| `field_cond_str` placement | Before target in format string: `{template}{cond_str}{op_cond_str}{field_cond_str} {target}{on_field_str}` |
| `field_cond_str` wording | `" only when on a {joined} field"` (keeps "when") |

### `effect_map.py` Changes

- Added `2005: "Wild Beasts"` to `TRAIT_ID_LABELS` (between 1001 and 2019)
- Added `5541: ("Increase ATK by {val}", 10, True)` to `BUFF_TYPE_INFO` with comment `# upAtk conditional (field-restricted)`

### Key Technical Details

- `buff.script.checkIndvType == 1` = AND logic for `ckOpIndv` (all traits required); absent = OR logic (any trait matches)
- `gainStar` funcType has no target in API response — must handle before FUNC_TYPE_NO_BUFF (which would append target)
- `CARD_TRIGGER_PHRASES` vs `COMMAND_CARD_TRIGGER_PHRASES`: separate dicts for `attackBeforeFunction` vs `commandattackBeforeFunction`
- `funcquestTvals` on function = quest field type restriction → `field_cond_str` rendered before target

### Verified Outputs

- Super Orion sk1: `Apply Special Attack [Wild Beasts and Demonic] by 30-50% (1 turn) for yourself`
- Super Orion sk2: `Gain Critical Stars by 10-20`
- Super Orion sk3: `Apply "A state that Increase Critical Strength by 50-100% (1 turn) for yourself when normal Buster cards attacking before damage" (3 times, 3 turns) for yourself`
- Raikou sk2: `Apply "A state that Increase Critical Strength by 10-20% (3 turns) for yourself when Quick cards attacking before damage" (5 times, 3 turns) for yourself`
- Hassan sk1: `Increase ATK by 20% (3 turns) only when on a [Darkness] field for yourself`

### Remaining Unknowns

- No.408 NP: `[unknown func id: 21454 (lossHp)]` — not yet handled
- No.272 passive: `[unknown buff id: 850 (upFuncHpReduce)]` — not yet handled

---

## 2026-04-19 — feat(servant-info): FUNC_TYPE_NO_BUFF refactor + dynamic handlers + inner skill cache (session 14)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Pipeline refactor: `FUNC_TYPE_NO_BUFF` keyed by funcType string (not funcId), dynamic handlers for 5 new patterns, `--update` flag, inner skill disk cache, `SKIP_FUNC_IDS` reduced via `funcTargetTeam=="enemy"` universal guard.

### `effect_map.py` Changes

| Change | Detail |
|---|---|
| `FUNC_TYPE_NO_BUFF` keys | Changed from numeric funcId → funcType string: `"gainHp"`, `"gainNp"`, `"subState"`, `"delayNpturn"`, `"shortenSkill"` |
| `SKIP_FUNC_IDS` reduced | Down to 2 entries (308, 469) — player-target only. 13 others removed; covered by `funcTargetTeam=="enemy"` universal skip in `fmt_function` |
| `BUFF_TYPE_INFO` removals | Removed avoidState entries: 171, 230, 1459, 3377, 4344, 5245 (handled by new `avoidState+ckOpIndv` code handler) |
| `BUFF_TYPE_INFO` removals | Removed reduceHp entries: 124, 125 (Burn, Curse — handled by new `reduceHp` code handler) |
| `BUFF_TYPE_INFO` removals | Removed donotAct entry: 178 (Stun — handled by new `donotAct` code handler) |
| `TRAIT_ID_LABELS` additions | 3005="Debuff", 3011="Poison", 3025="Skill Seal", 3049="Fear", 3052="Confusion" |

### `convert_servant.py` Changes

| Change | Detail |
|---|---|
| `_AILMENT_IGNORE` constant | `{2729, 3005, 3010, 2191, 3045}` — shared by `donotAct` and `reduceHp` handlers |
| `fetch_inner_skill` disk cache | Saves to `raw/inner_skill/{id}.json`; memory + disk two-tier cache |
| `--update` flag | Numeric ID form only: re-fetches from Atlas API and overwrites `raw/{id}.json` |
| `overwriteClassRelation` handler | `atkSide` keys camelCase→Title Case: `"Gain advantage against ({Class}) class ({N} turns) {target}"` |
| `downTolerance+ckOpIndv` handler | `"Decrease {traits} Resist by {val}{cond} {target}"` |
| `donotAct` handler | vals filtered by `_AILMENT_IGNORE`; rate shown as chance%; enemy target uses "to a/all" |
| `avoidState+ckOpIndv` handler | `"Apply {TRAIT_ID_LABELS[id]} Immune{cond} {target}"` |
| `reduceHp` handler | vals filtered by `_AILMENT_IGNORE`; `"Inflict {ailment} by {val}{cond} {target}"` |
| Inner loop `reduceHp` | Same handler added to `fmt_attack_before_function` inner loop (fixes `[unknown buff id: 124]`) |

### Key Technical Decisions

- `FUNC_TYPE_NO_BUFF` string keys are more stable than funcId — any funcId of that type resolves correctly
- `funcTargetTeam=="enemy"` universal guard in `fmt_function` replaces all per-ID SKIP entries for NPC functions
- `_AILMENT_IGNORE` = `{2729, 3005, 3010, 2191, 3045}` — internal marker IDs that don't represent ailment names
- Inner skill cache: check memory dict → check `raw/inner_skill/{id}.json` → fetch API → write disk

### Pending: Complete BUFF_TYPE_INFO Removal

Remaining entries to migrate:
| ID | Type | Plan |
|---|---|---|
| 149 | `subSelfdamage` | Move to `BUFF_TYPE_MAP` (generic) |
| 256 | `selfturnendFunction` Confusion | Code handler extension |
| 950 | misleading `downTolerance` | Code handler (buff_id check) |
| 4051 | misleading `upTolerance` | Code handler (buff_id check) |
| 2888 | `downCriticalRateDamageTaken` | Move to `BUFF_TYPE_MAP` |
| 2889 | `downCriticalStarDamageTaken` | Move to `BUFF_TYPE_MAP` |
| 5567 | `avoidanceAttackDeathDamage` | Move to `BUFF_TYPE_MAP` |
| 5568 | `subSelfdamage` + `ckOpIndv=[4007]` | Code handler |
| 5569 | `subFuncHpReduce` | Move to `BUFF_TYPE_MAP` |
| 5601 | `gutsFunction` | Move to `BUFF_TYPE_MAP` |

---

## 2026-04-19 — feat(servant-info): dynamic card buffs + dynamic demerit labeling (session 13)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Deep refactoring of the servant data conversion pipeline to move from rigid ID-based detection to dynamic type-based detection for card-specific buffs and demerits. Fixed a KeyError crash in NP scaling paths.

### New Logic in `convert_servant.py`

| Addition | Detail |
|---|---|
| `_get_card_prefix(buff)` | Unified helper: Finds Arts (4001)/Buster (4002)/Quick (4003) traits in `ckSelfIndv` or `ckOpIndv`. Works for buffs AND enemy debuffs. |
| `_apply_card_prefix(...)` | Unified helper: Injects card name into templates (e.g., "Decrease Card resistance" → "Decrease Buster Card resistance"). |
| `_is_demerit(fn)` | Unified helper: Returns `True` if any buff has `3005` (`buffNegativeEffect`) or if `funcType` is a direct loss (`lossHp`, `lossNp`, etc.) on a party member. Excludes enemy targets. |
| Specialized handlers removed | Redundant `if` blocks for `upStarweight`, `upCriticalpoint`, `upCommandall`, `upCriticaldamage`, and `downDefencecommandall` removed in favor of generic lookup with prefix injection. |
| `fmt_np_function` fix | Both OC and Level scaling paths now use prefix helpers. Templates in map cleaned to prevent `KeyError: 'card'`. |

### `effect_map.py` Cleanup

- **BUFF_TYPE_INFO Overrides Removed**: 30+ redundant entries (e.g. 389, 504, 952, 1624) deleted; now handled dynamically by `BUFF_TYPE_MAP`.
- **BUFF_TYPE_MAP Templates**: `upCommandall` and `downDefencecommandall` templates changed to standard `{val}`-only format (removed `{card}`).
- **TARGET_LABELS**: Removed hardcoded ` [Demerit]` from `ptOtherFull` entry.

### Format Rules Confirmed

| Rule | Value |
|---|---|
| Card Crit Phrasing | `"{Card} Card Critical Strength"` (per user request) |
| Demerit Placement | Dynamically appended as ` [Demerit]` to the end of the line for negative effects only. |

### Verified Servants

| ID | Name | Verification Focus |
|---|---|---|
| 432 | Richard I | NP Overcharge scaling (Buster Resist Down) — **Fixed crash**. |
| 403 | Ushi Gozen | Passives: Dynamic demerit detection on ally debuff; dynamic card detection on Quick Crit. |
| 307 | Miss Crane | Party buffs for "allies except self": Confirmed no erroneous `[Demerit]` tag. |
| 415 | Kuonji Alice | Buster Card Effectiveness overcharge scaling. |

---

## 2026-04-19 — feat(servant-info): trigger func map, strengthen labels, dynamic handlers (session 15)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Continued refactoring of `convert_servant.py` and `effect_map.py`: unified all `*Function` buff types into `_TRIGGER_FUNC_MAP`, added skill/NP strengthen labeling, added dynamic handlers for `subFuncHpReduce`, `subSelfdamage+ckOpIndv negative`, `downTolerance+ckOpIndv=[3004]`, and completed migration of remaining `BUFF_TYPE_INFO` entries to `BUFF_TYPE_MAP`.

### `convert_servant.py` Changes

| Change | Detail |
|---|---|
| `_TRIGGER_FUNC_MAP` dict | New: maps `*Function` buff types → `(default_trigger, card_phrases)`. Replaces 6 individual `if buff["type"] == ...` blocks in `fmt_function`. |
| `fmt_trigger_function` rename | `fmt_attack_before_function` → `fmt_trigger_function`; signature unchanged |
| `damageFunction` handler | Added to `_TRIGGER_FUNC_MAP` with trigger `"when damaged"` |
| Strengthen labeling — skills | `fmt_skills` groups by `num`, sorts by `id`; labels `Skill N`, `Skill N [Strengthen]`, `Skill N [1st Strengthen]`, etc. |
| Strengthen labeling — NPs | `fmt_np` + `_fmt_single_np(label)`: same grouping logic; labels `Noble Phantasm`, `Noble Phantasm [Strengthen]`, etc. |
| `downTolerance + ckOpIndv=[3004]` | Branch inside `downTolerance+ckOpIndv` handler: `"Increase Buff Success Rate when receiving a Buff by {val} {target}"` |
| `subFuncHpReduce` dynamic handler | Reads `ckSelfIndv` traits: `"Apply Damage Cut against [{traits}] by {val} {target}"` |
| `subSelfdamage` NP-exclusion handler | Reads `ckOpIndv` with `negative: true`: `"Apply Damage Cut that excludes [{excluded}] by {val} {target}"` |
| `fmt_trait_name` fallback | Changed to `f"{tid}:{name}"` (no brackets); callers wrapping in `[...]` now produce `[id:name]` not `[[id:name]]` |
| All `TRAIT_ID_LABELS.get(t["id"], ...)` | Replaced with `fmt_trait_name(t)` |
| All id-only fallbacks | `TRAIT_ID_LABELS.get(trait_id, f"[{trait_id}]")` |

### `effect_map.py` Changes

| Change | Detail |
|---|---|
| `BUFF_TYPE_MAP` additions | `"downCriticalRateDamageTaken"`, `"downCriticalStarDamageTaken"`, `"subSelfdamage"` (generic), `"avoidanceAttackDeathDamage"` — migrated from `BUFF_TYPE_INFO` |
| `BUFF_TYPE_INFO` removals | 149 (`subSelfdamage` generic), 2888, 2889, 5567, 5568, 5569, 5601 — migrated to BUFF_TYPE_MAP or code handlers |
| `subFuncHpReduce` removed from BUFF_TYPE_MAP | Now code handler |
| `TRAIT_ID_LABELS` addition | `4007: "NP"` (Card types section) |
| Header comment fix | Corrected to "checks BUFF_TYPE_INFO first (per-id override), then BUFF_TYPE_MAP by type string" |

### Remaining `BUFF_TYPE_INFO` Entries (3 — acknowledged hardcodes)

| ID | Type | Reason kept |
|---|---|---|
| 256 | `selfturnendFunction` | Type not in BUFF_TYPE_MAP; code handler planned |
| 950 | misleading `downTolerance` | Buff ID 950 actually means "Buff Success Rate Up" |
| 4051 | misleading `upTolerance` | Buff ID 4051 actually means "Buff Success Rate Down" |

### Key Technical Decisions

- `_TRIGGER_FUNC_MAP` dict lookup replaces 6+ if-blocks; adding new `*Function` types needs only a new dict entry
- Strengthen detection: `strengthenState` field unreliable in API — detect by multiple entries sharing same `num`, sort by `id` (lower = base)
- `negative: true` in `ckOpIndv` = exclusion condition (e.g. `id:4007 negative:true` = "excludes NP")
- `fmt_trait_name` returns bare `{tid}:{name}`; all display-level wrappers supply the `[...]` brackets

---

## 2026-04-19 — feat(servant-info): buff_id removal, donotSkill, selfturnendFunction rewrite (session 16)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Removed all remaining buff_id-based branching from pipeline. Added `donotSkill` to `BUFF_TYPE_MAP`. Rewrote `selfturnendFunction` handler with generic ailment extraction + inner skill fetch.

### `effect_map.py` Changes

- Added `"donotSkill": ("Inflict Skill Seal", 0, False)` to `BUFF_TYPE_MAP` Debuff/Resist section

### `convert_servant.py` Changes

| Change | Detail |
|---|---|
| `buff_id` removed from `fmt_function` | `buff_id = buff["id"]` line deleted; error message updated to `[unknown buff type: {buff_type_str}]` |
| Instant Death Guts in `fmt_function` | `if buff_id == 5559:` → `if buff["type"] == "guts" and buff.get("ckOpIndv"):` |
| Instant Death Guts in `fmt_passives` | `buff_id = bufs[0]["id"]` deleted; same type+ckOpIndv detection |
| buff 5601 lookahead in `fmt_passives` | `if nb and nb[0]["id"] == 5601:` → `if nb and nb[0]["type"] == "guts" and not nb[0].get("ckOpIndv"):` |
| `_AILMENT_IGNORE` update | Added `3063` — appears in Fear + Confusion buff vals as meta-marker |
| `selfturnendFunction` handler rewrite | Generic: extracts ailment from `buff.vals` (filtered by `_AILMENT_IGNORE`), fetches inner skill, looks up inner effect via `BUFF_TYPE_MAP` or trait ID fallback |

### `selfturnendFunction` Output Format

```
Inflict [{ailment}] ({rate}% Chance to {inner_effect} each turn) {cond} {target}
```

Examples:
- `Inflict [Fear] (60% Chance to Inflict Stun each turn) (1 time, 3 turns) to all enemies`
- `Inflict [Confusion] (30% Chance to Inflict Skill Seal each turn) (3 turns) to all enemies`

### Key Technical Decisions

- Instant Death Guts detection: `type=="guts"` AND `ckOpIndv` present (normal guts has no `ckOpIndv`)
- `selfturnendFunction` inner effect: two-tier lookup — (1) `BUFF_TYPE_MAP[inner_buff_type]` with divisor=0 → use template; (2) filter inner buff `vals` by `_AILMENT_IGNORE`, look up remaining trait ID in `TRAIT_ID_LABELS` via `fmt_trait_name`
- `3063` in `_AILMENT_IGNORE`: internal marker in both Fear and Confusion `buff.vals`; must exclude to get correct ailment trait IDs

---

## 2026-04-19 — feat(servant-info): functvals/funcquestTvals/INDIVIDUALITIE/addFieldChangeToField (session 17)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Hoisted three target-modifying conditions into `target` variable early in both `fmt_function` and `fmt_np_function`. Added `addFieldChangeToField` funcType handler. All changes verified with servant 351 (Archetype: Earth).

### New Helper in `convert_servant.py`

```python
def _apply_tvals_target(target, tvals):
    tval_str = " ".join(f"[{fmt_trait_name(t)}]" for t in tvals)
    mod = target.replace("all allies", f"all {tval_str} allies", 1)
    return mod if mod != target else f"{target} [{tval_str}]"
```

### Hoisted Block in `fmt_function` (and `fmt_np_function`)

```python
tvals = fn.get("functvals", [])
if tvals:
    target = _apply_tvals_target(target, tvals)

quest_fields = fn.get("funcquestTvals", [])
if quest_fields:
    labels = [f"[{fmt_trait_name(t)}]" for t in quest_fields]
    joined = (", ".join(labels[:-1]) + f", or {labels[-1]}") if len(labels) > 1 else labels[0]
    target = f"only when on a {joined} field {target}"
elif buffs:
    indv = buffs[0].get("script", {}).get("INDIVIDUALITIE")
    if indv:
        target = f"only when on a [{fmt_trait_name(indv)}] field {target}"
```

(`fmt_np_function` uses `np_buffs` instead of `buffs`)

### `addFieldChangeToField` Handler

Inside `if buffs:` block before BUFF_TYPE_MAP lookup:

```python
if func_type == "addFieldChangeToField":
    field_ids = [v for v in buff.get("vals", []) if v["id"] != 3079]
    field_name = fmt_trait_name(field_ids[0]) if field_ids else "Unknown"
    return f"Change field to [{field_name}] state{cond_str}"
```

### Key Technical Details

| Concept | Detail |
|---|---|
| `functvals` | Target trait filter — which allies/enemies receive effect; modifies `target` inline |
| `funcquestTvals` | Quest field restriction — function only fires on specific field; prefix injected into `target` |
| `buff.script.INDIVIDUALITIE` | Buff-level field restriction (passives); same suffix format as `funcquestTvals` |
| `addFieldChangeToField` | Field change funcType; trait IDs in `buff.vals` (ignore 3079); turn from `svals[0].Turn` |
| `gainStar` compat | Uses `functvals` for counting not targeting; hoisted modification harmless, cleaned duplicate `tvals` read |

### Verified Outputs (servant 351 Archetype: Earth)

```
Skill 3
Apply Invincible (1 time, 3 turns) for all allies
Increase Buff Removal Resist by 50-100% (1 turn) for all [Good] allies
Increase NP Gauge by 20-30% only when on a [Millennium Castle] field for all allies excluding yourself

Noble Phantasm
Change field to [Millennium Castle] state (3 turns)
Deal heavy Special Attack [Chaotic] by 150% damage by 300-500% <effect increases with Level> to all enemies
Increase NP Gauge by 20-40% <effect increases with Overcharge> for all [Modern Human (certain Pseudo-Servants, Demi-Servants, etc.)] allies excluding yourself

Passives
Increase Quick Card effectiveness by 30% only when on a [Millennium Castle] field for yourself
Increase Arts Card effectiveness by 30% only when on a [Millennium Castle] field for yourself
Increase Buster Card effectiveness by 30% only when on a [Millennium Castle] field for yourself
```

### Servant ID Reference Addition

| Short ID | Long ID | Name |
|----------|---------|------|
| 351 | 2300500 | Archetype: Earth |

---

## 2026-04-19 — feat(servant-info): trait name fallback, gutsBlock fix, upFuncHpReduce, lossNp skip (session 18)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Five targeted fixes to `convert_servant.py` and `effect_map.py`. Verified with servant 407 (Marie Antoinette Alter / svtId 1101300).

### `convert_servant.py` Changes

| Change | Detail |
|---|---|
| `fmt_trait_name` prefix-strip removed | Loop that stripped `attribute`/`class`/`alignment` prefixes deleted; fallback always `f"{tid}:{name}"` |
| `_INDIVIDUALITIE_IGNORE` constant | `{3086}` — `gutsBlock` is internal API marker, must never become `only when on a [3086:gutsBlock] field` prefix |
| INDIVIDUALITIE guard updated | `if indv and indv.get("id") not in _INDIVIDUALITIE_IGNORE:` in both `fmt_function` and `fmt_np_function` |
| Instant Death Guts format simplified | Removed verbose `"state that only activates when [Death] is applied"` template; uses `fmt_condition(Turn, Count)` for clean `(N times, M turns)` output |
| `upFuncHpReduce` handler added | Before `upDamage`/`upDamageIndividuality`; reads `ckSelfIndv` trait IDs → `HP_REDUCE_LABELS` → `"Inflict {label} by {val}% {cond} {target}"` (no brackets around label) |
| `_ENEMY_TEAM_ALLOWED` constant | `{"delayNpturn"}` — bypasses `funcTargetTeam=="enemy"` universal skip for player-visible effects |
| `funcTargetTeam` guard updated | `if fn.get("funcTargetTeam") == "enemy" and func_type not in _ENEMY_TEAM_ALLOWED:` |
| `lossNp + enemyAll` skip | Explicit `if func_type == "lossNp" and target_type == "enemyAll": return None` — internal NP charge effect, not player-visible |
| `HP_REDUCE_LABELS` import | Added to `from effect_map import (...)` |

### `effect_map.py` Changes

| Change | Detail |
|---|---|
| `delayNpturn` template | `("Decrease 1 Charge", 0, False)` — fixed wording, divisor=0 (no value shown) |
| `HP_REDUCE_LABELS` dict added | `{3011: "Corroding Poison", 3015: "Spreading Fire", 3026: "Disastrous Curse"}` — maps `ckSelfIndv` trait ID → descriptive label |

### Key Technical Decisions

- `gutsBlock` (id=3086) is injected by API into `buff.script.INDIVIDUALITIE` for Instant Death Guts — it is NOT a quest field restriction; `_INDIVIDUALITIE_IGNORE` guards it
- Instant Death Guts detection: `buff["type"] == "guts" and buff.get("ckOpIndv")` — normal Guts has no `ckOpIndv`
- `upFuncHpReduce` label never gets `[...]` brackets (user preference: display name not trait label)
- `delayNpturn` has `funcTargetTeam=="enemy"` in API; `_ENEMY_TEAM_ALLOWED` prevents it from being silently dropped
- `lossNp + enemyAll` is a paired internal function with `delayNpturn`; must be explicitly skipped

### Verified Outputs (servant 407 Marie Antoinette Alter)

```
NP:
Decrease 1 Charge for all enemies        ← delayNpturn (was disappearing)
60% chance to Inflict Death for all enemies
(no lossNp line)                          ← explicit skip working

Passives:
Increase the amount of NP gain by 17% when damaged for yourself   ← upDamagedropnp (no gutsBlock field prefix)
```

### Servant ID Reference

| Short ID | Long ID | Name |
|----------|---------|------|
| 407 | 1101300 | Marie Antoinette (Alter) |

---

## 2026-04-20 — Session 19: card trigger phrase refactor + gainStar inner loop fix

### What Changed

Fixed missing `commandattackAfterFunction` line in BB (No.220) Skill 1 [Strengthen], then refactored all card trigger phrase generation to be dynamic.

### Root Causes Fixed

1. **`gainStar` not handled in inner loop** — `fmt_trigger_function` fetches an inner skill and iterates its functions. `gainStar` has no buffs array so it falls into the no-buffs branch, but there was no handler for it. `inner_parts` stayed empty → `return None` → line dropped silently.

2. **Extra card id 4004 missing from phrase maps** — `CARD_TRIGGER_PHRASES` and `COMMAND_CARD_TRIGGER_PHRASES` only had 4001/4002/4003. Extra card (id 4004) produced no phrase match.

3. **`commandattackAfterFunction` passed `None` for `card_phrases`** — old `_TRIGGER_FUNC_MAP` left both `attackBefore/After` entries with `None`, meaning card-specific phrases were never resolved even when `ckSelfIndv` contained a card ID.

### Code Changes

**`data/servant-data/convert_servant.py`**

Replaced `CARD_TRIGGER_PHRASES` + `COMMAND_CARD_TRIGGER_PHRASES` static dicts with `CARD_ID_NAMES` + generator:

```python
CARD_ID_NAMES = {
    4001: "Arts",
    4002: "Buster",
    4003: "Quick",
    4004: "Extra",
}

def _make_card_phrases(is_normal, timing):
    prefix = "normal " if is_normal else ""
    return {
        cid: f"when {prefix}{name} cards attacking {timing}"
        for cid, name in CARD_ID_NAMES.items()
    }
```

Updated `_TRIGGER_FUNC_MAP` — all 4 attack variants now pass generated dicts:

```python
_TRIGGER_FUNC_MAP = {
    "attackBeforeFunction":        ("when attacking before damage",        _make_card_phrases(False, "before damage")),
    "attackAfterFunction":         ("when attacking after damage",         _make_card_phrases(False, "after damage")),
    "damageFunction":              ("when damaged",                        None),
    "gutsFunction":                ("when Guts is activated",              None),
    "commandattackBeforeFunction": ("when normal attacking before damage", _make_card_phrases(True, "before damage")),
    "commandattackAfterFunction":  ("when normal attacking after damage",  _make_card_phrases(True, "after damage")),
}
```

Phrase lookup updated (`card_phrases` is now never `None` for attack variants):

```python
phrase = card_phrases.get(indv["id"]) if card_phrases else None
```

`gainStar` handler added in inner loop no-buffs branch:

```python
if inner_func_type == "gainStar":
    val = inner_sv0.get("Value", 0)
    inner_parts.append(f"Gain Critical Stars by {val}{target_str} {trigger_phrase}")
elif inner_func_type in FUNC_TYPE_NO_BUFF:
    ...
else:
    inner_parts.append(f"[trigger: unknown inner funcType: {inner_func_type}]")
```

Three silent `return None` / `continue` paths converted to debug strings:

```python
# 1. No inner_skill_id
return f"[trigger: no inner_skill_id in svals[0]]"

# 2. Unknown inner funcType
inner_parts.append(f"[trigger: unknown inner funcType: {inner_func_type}]")

# 3. Empty inner_parts
return f"[trigger: inner skill {inner_skill_id} produced no output]"
```

### Verified Output (BB No.220 Skill 1 [Strengthen])

```
Apply "A state that Gain Critical Stars by 20 when normal Extra cards attacking after damage" (3 turns) for yourself
```

### Servant ID Reference

| Short ID | Long ID | Name |
|----------|---------|------|
| 220 | 2300200 | BB |

---

## 2026-04-20 — feat(servant-info): Rate prefix + upGrantstate ckSelfIndv handler (session 20)

**Branch:** `feat/servant-info` (not merged)

### Key Accomplishments

#### 1. Rate < 1000 "xx% Chance to" Prefix

Effects with `Rate < 1000` in svals now show `"XX% Chance to {effect}"` (Rate ÷ 10).

**Approach:** Renamed `fmt_function` → `_fmt_function_core`, added thin wrapper:

```python
_RATE_PREFIX_EXEMPT_BUFFS = {"donotAct", "selfturnendFunction"}


def fmt_function(fn):
    result = _fmt_function_core(fn)
    if result is None:
        return None
    sv0 = (fn.get("svals") or [{}])[0]
    rate0 = sv0.get("Rate", 1000)
    if rate0 >= 1000:
        return result
    func_type = fn.get("funcType", "")
    buff_type = ((fn.get("buffs") or [{}])[0]).get("type", "")
    if func_type == "instantDeath" or buff_type in _RATE_PREFIX_EXEMPT_BUFFS:
        return result
    return f"{rate0 // 10}% Chance to {result}"
```

**Exclusions:**
- `instantDeath` — template already embeds `"{val}% chance to Inflict Death"`
- `donotAct` — already prepends its own `"{rate // 10}% chance to "` internally
- `selfturnendFunction` — uses `UseRate` field (not `Rate`) internally

**`fmt_np_function` coverage:** Falls back to `fmt_function(fn)` at line 977 — wrapper catches automatically.

**Verified (BB No.220 NP):**
```
Decrease Charge for all enemies          ← Rate=1000, no prefix
10% Chance to Decrease Charge for all enemies  ← Rate=100
```

#### 2. `upGrantstate` + `ckSelfIndv` Handler

Special case before `BUFF_TYPE_MAP` general lookup. When `ckSelfIndv` present, resolves trait names via `fmt_trait_name` (reads `TRAIT_ID_LABELS` from `effect_map.py`):

```python
if buff["type"] == "upGrantstate" and buff.get("ckSelfIndv"):
    ck = buff["ckSelfIndv"]
    traits = " / ".join(fmt_trait_name(t) for t in ck)
    val_str = fmt_val_range(val0, val9, 10, True)
    return f"Increase {traits} Success Rate by {val_str}{cond_str} {target}"
```

`BUFF_TYPE_MAP` generic fallback `"Increase Debuff Success Rate by {val}"` still used when no `ckSelfIndv`.

**Verified (Nikola Tesla No.77 Skill 1 [2nd Strengthen]):**
```
Increase Debuff Success Rate by 20-40% (1 turn) for yourself   ← ckSelfIndv id=3005
Increase Buff Success Rate by 10-20% (3 turns) for all allies  ← ckSelfIndv id=3004
```

### Files Modified

| File | Action |
|---|---|
| `data/servant-data/convert_servant.py` | Rename `fmt_function` → `_fmt_function_core`; add `_RATE_PREFIX_EXEMPT_BUFFS` + wrapper `fmt_function`; add `upGrantstate` + `ckSelfIndv` handler |

### Servant ID Reference

| Short ID | Long ID | Name |
|----------|---------|------|
| 77 | 201100 | Nikola Tesla |

---

## 2026-04-20 — feat(servant-info): handle fixCommandcard buff/funcType (session 21)

**Branch:** `feat/servant-info` (not merged)

### What Changed

Fixed BB (No.220) Skill 3 dual-function pattern where `addState` buff and raw funcType both produced output. Now outputs single clean line: `Lock the entire Party's Command Card deck <...> (3 turns) for yourself`

### Root Cause

Skill 3 contains two functions:

| funcId | funcType | Purpose | Issue |
|--------|----------|---------|-------|
| 2547 | `addState` | UI display (buff with Turn=3) | buff.type `"fixCommandcard"` not in BUFF_TYPE_MAP → `[unknown buff type]` |
| 2546 | `fixCommandcard` | Engine call (no Turn/Count) | funcType not in skip list → `[unknown func type]` line |

### Solution

**`effect_map.py`** — Add to BUFF_TYPE_MAP:
```python
"fixCommandcard": ("Lock the entire Party's Command Card deck <effect is removed if a Party member changes or if the cards are shuffled>", 0, False),
```
Divisor=0 → static template. `fmt_condition(Turn=3)` → appends `(3 turns)`.

**`convert_servant.py`** — Add `"fixCommandcard"` to early funcType skip list (line 385):
```python
if func_type in ("hastenNpturn", "moveToLastSubmember", "none", "displayBuffstring", "fixCommandcard"):
    return None
```

### Why This Works

- funcId 2547: funcType `"addState"` → not skipped → buff.type in BUFF_TYPE_MAP → single line ✓
- funcId 2546: funcType `"fixCommandcard"` → early skip → `None` → not rendered ✓

### Verified Output

```
Skill 3
Cooldown 8-6 turns
Lock the entire Party's Command Card deck <effect is removed if a Party member changes or if the cards are shuffled> (3 turns) for yourself
Gain Critical Stars each turn by 5-10 (3 turns) for yourself
```

### Files Modified

| File | Action |
|---|---|
| `data/servant-data/effect_map.py` | Added `"fixCommandcard"` entry to BUFF_TYPE_MAP |
| `data/servant-data/convert_servant.py` | Added `"fixCommandcard"` to funcType skip list |

### Servant ID Reference

| Short ID | Long ID | Name |
|----------|---------|------|
| 220 | 2300200 | BB |

---

## 2026-04-20 — feat(servant-info): OC Count scaling for avoidance/invincible/specialInvincible (session 22)

**Branch:** `feat/servant-info` (not merged)

### Key Accomplishment

Implemented OC Count scaling for count-based buffs (`specialInvincible`, `avoidance`, `invincible`) in NPs. Altria Caster (No.284) NP now shows: `Apply Anti-Enforcement DEF (1-5 times, 3 turns) <times increase with Overcharge> for all allies`

### Problem

Three count-based buff types have Count values that scale with OC level (svals→svals2→svals3→svals4→svals5):
- `specialInvincible` (buff id 2926, Anti-Enforcement DEF): Count 1→5 across OC1-5
- `avoidance` (Evade): Count varies
- `invincible` (Invincible): Count varies

Existing code only showed `(1 time, 3 turns)` from OC1 svals. Needed to detect and format as `(1-5 times, 3 turns) <times increase with Overcharge>`.

### Root Cause

| Issue | Location |
|-------|----------|
| `_oc_last()` helper exists but wasn't used for Count scaling | `convert_servant.py` line 824 |
| `specialInvincible` handler hardcoded condition from OC1 | `convert_servant.py` lines 514-516 |
| `avoidance` / `invincible` reach BUFF_TYPE_MAP divisor=0 return without OC detection | `convert_servant.py` line 722 |
| `fmt_np_function` OC detection only checks `Value` field, not `Count` | `convert_servant.py` lines 936-965 |

### Solution — `convert_servant.py` Three-Part Fix

**Part 1: Pre-compute OC Count detection (after line 470, in `_fmt_function_core`)**

```python
_oc_last_sv = _oc_last(fn, svals)
_count_oc5 = _oc_last_sv.get("Count")
oc_times_cond = None
oc_times_tag = ""
if count != -1 and _count_oc5 is not None and count != _count_oc5:
    _times_str = f"{count}-{_count_oc5} times"
    _turn_str = f"{turn} turn{'s' if turn != 1 else ''}" if turn > 0 else None
    oc_times_cond = f" ({_times_str}, {_turn_str})" if _turn_str else f" ({_times_str})"
    oc_times_tag = " <times increase with Overcharge>"
```

**Part 2: `specialInvincible` handler (lines 514-516, updated)**

```python
if buff["type"] == "specialInvincible":
    name = buff.get("name", "Special Invincible")
    if oc_times_cond:
        return f"Apply {name}{oc_times_cond}{oc_times_tag} {target}"
    return f"Apply [{name}]{cond_str} {target}"
```

**Part 3: BUFF_TYPE_MAP divisor=0 return (line 722, updated)**

```python
if divisor == 0:
    _cond = oc_times_cond if oc_times_cond else cond_str
    return f"{hp_prefix}{template}{_cond}{oc_times_tag}{op_cond_str} {target}{on_field_str}{demerit_suffix}"
```

### Why This Works

- `_oc_last(fn, svals)` returns OC5 svals for NPs (svals5), or OC1 svals for skills (no svals2-5)
- Skills: `count == _count_oc5` → `oc_times_cond = None` → all existing paths unchanged (backward compatible)
- NPs with OC Count: `1 != 5` → `oc_times_cond` set → both handlers inject range + OC tag
- `specialInvincible`: uses OC format (no brackets), or falls back to original format
- `avoidance` / `invincible`: both divisor=0 → uses OC format or falls back to `cond_str`

### Verified Output

**Altria Caster No.284 NP (was servant 504500, now added to information/284/):**
```
Increase ATK by 30-50% (3 turns) <effect increases with Level> for all allies
Remove Debuff for all allies
Apply Anti-Enforcement DEF (1-5 times, 3 turns) <times increase with Overcharge> for all allies
```

Regression tested: Servants with static (non-OC) `invincible`/`avoidance` in skills (e.g., servant 351 Archetype: Earth) still show `(1 time, 3 turns)` format unchanged.

### Files Modified

| File | Action |
|---|---|
| `data/servant-data/convert_servant.py` | Added OC Count detection block; updated `specialInvincible` handler; updated divisor=0 return in `_fmt_function_core` |

### Servant ID Reference

| Short ID | Long ID | Name |
|----------|---------|------|
| 284 | 504500 | Altria Caster |

---

## 2026-04-20 — feat(servant-info): changeCommandCardType + delayFunction + multi-option skills (session 23)

**Branch:** `feat/servant-info` (not merged)

### Problem Scope

Three related display issues + bonus cardReset fix:

1. **Altria Pendragon Ruler (No.265 / svtId 100100) Skill 2 [Strengthen]:**
   - `[unknown buff type: changeCommandCardType]` → should show: `Change all Command Cards to Buster type (1 turn) for yourself`

2. **Soujuurou (No.414 / svtId 704900) Skill 3:**
   - Multi-option skill with 3 `delayFunction` buffs, each with `ActSelectIndex` 0/1/2
   - Should display: "Select 3 Options" header + per-option labeled effects with inner skill processing

3. **Kukulcan (No.373 / svtId 2501100) Skill 1:**
   - Mixed functions with `ActSelectIndex` (lossStar) and without (upAtk)
   - `[unknown func type: lossStar (id: 1300)]` → should show: `Expend 10 Critical Stars`
   - Should display: "Select 2 Options" header with common + per-option effects

4. **Bonus: Altria Pendragon Ruler cardReset fix**
   - `Redistribute Command Cards for yourself` → should be: `Redistribute Command Cards` (no target suffix)

### Root Causes

| Issue | Location | Fix |
|-------|----------|-----|
| `changeCommandCardType` not in BUFF_TYPE_MAP | `_fmt_function_core` buffs branch | Add handler: `Value → 4000 + Value → CARD_ID_NAMES` |
| `lossStar` funcType not handled | `_fmt_function_core` funcType branch | Add handler: `"Expend {Value} Critical Stars"` |
| `delayFunction` with `ActSelectIndex != 0` returns `None` | Hardcoded inner parsing | Genericize to `_fmt_delay_fn` helper; return `None` for multi-option (handled by `fmt_skills`) |
| `fmt_skills` no multi-option detection | Linear function iteration | Detect `ActSelectIndex` presence; group by option index; label `[Option K]` |
| `cardReset` appends target suffix | BUFF_TYPE_MAP divisor=0 return | Special case: skip target for this funcType only |

### Implementation — 6 Changes to `convert_servant.py`

**Change 1: `changeCommandCardType` handler**

In `_fmt_function_core` after `upDamage`/`upDamageIndividuality` (line ~626):

```python
if buff["type"] == "changeCommandCardType":
    card_val = sv0.get("Value", 0)
    card_name = CARD_ID_NAMES.get(4000 + card_val, "Unknown")
    return f"Change all Command Cards to {card_name} type{cond_str} {target}"
```

**Change 2: `lossStar` handler**

In `_fmt_function_core` after `gainStar` handler (line ~454):

```python
if func_type == "lossStar":
    val = sv0.get("Value", 0)
    return f"Expend {val} Critical Stars"
```

**Change 3: `_fmt_delay_fn` helper function**

New module-level helper before `_fmt_function_core` (line ~382):

```python
def _fmt_delay_fn(fn):
    sv0 = (fn.get("svals") or [{}])[0]
    inner_skill_id = sv0.get("Value")
    if not inner_skill_id:
        return None
    inner_skill = fetch_inner_skill(inner_skill_id)
    delay_turn = sv0.get("Turn", 1)
    delay_str = f"After {delay_turn} turn{'s' if delay_turn > 1 else ''}"
    outer_cond = fmt_condition(sv0.get("Turn", -1), sv0.get("Count", -1))
    outer_cond_str = f" {outer_cond}" if outer_cond else ""
    target_type = fn.get("funcTargetType", "")
    outer_target = TARGET_LABELS.get(target_type, f"for {target_type}")
    inner_parts = []
    for ifn in inner_skill.get("functions", []):
        r = _fmt_function_core(ifn)
        if r:
            inner_parts.append(r)
    if not inner_parts:
        return None
    return f'{delay_str} "{" & ".join(inner_parts)}"{outer_cond_str} {outer_target}'
```

**Change 4: `delayFunction` handler rewrite**

In `_fmt_function_core` (lines 529–536, replace 31-line hardcoded block):

```python
if buff["type"] == "delayFunction":
    act_idx = sv0.get("ActSelectIndex")
    if act_idx is not None:
        return None  # multi-option: handled by fmt_skills
    return _fmt_delay_fn(fn)
```

**Change 5: Multi-option grouping in `fmt_skills`**

Rewrite per-skill function iteration (lines 1127–1166):

```python
# detect skills with ActSelectIndex options
has_options = any(
    (fn.get("svals") or [{}])[0].get("ActSelectIndex") is not None
    for fn in sk["functions"]
)

if has_options:
    max_idx = max(
        (fn.get("svals") or [{}])[0].get("ActSelectIndex", -1)
        for fn in sk["functions"]
    )
    lines.append(f"Select {max_idx + 1} Options")
    # common effects (no ActSelectIndex) first
    for fn in sk["functions"]:
        if (fn.get("svals") or [{}])[0].get("ActSelectIndex") is None:
            result = fmt_function(fn)
            if result:
                lines.append(result)
    # option-specific effects grouped by ActSelectIndex
    option_fns = {}
    for fn in sk["functions"]:
        ai = (fn.get("svals") or [{}])[0].get("ActSelectIndex")
        if ai is not None:
            option_fns.setdefault(ai, []).append(fn)
    for ai in sorted(option_fns):
        opt_label = f"[Option {ai + 1}]"
        for fn in option_fns[ai]:
            bufs = fn.get("buffs", [])
            if bufs and bufs[0]["type"] == "delayFunction":
                text = _fmt_delay_fn(fn)
                if text:
                    lines.append(f"{opt_label} {text}")
            else:
                result = fmt_function(fn)
                if result:
                    lines.append(f"{opt_label} {result}")
else:
    for fn in sk["functions"]:
        result = fmt_function(fn)
        if result:
            lines.append(result)
```

**Change 6 (bonus): cardReset fix**

In `_fmt_function_core` at divisor=0 return (lines 767–770):

```python
if divisor == 0:
    if func_type == "cardReset":
        return f"{template}{cond_str}"
    return f"{template}{cond_str} {target}{on_field_str}{demerit_suffix}"
```

### Verification

All 5 test cases pass:

| Servant | Test | Output |
|---------|------|--------|
| Altria Pendragon (100100) | changeCommandCardType | `Change all Command Cards to Buster type (1 turn) for yourself` ✓ |
| Soujuurou (704900) | 3-option delayFunction | Select 3 Options + per-option formatted delay effects ✓ |
| Kukulcan (2501100) | 2-option mixed (lossStar + upAtk) | Select 2 Options + common + [Option 2] labeled effects ✓ |
| Ishtar (202000) | Single delayFunction (regression) | `After 1 turn "{effects}" (1 turn) for yourself` ✓ |
| Altria Pendragon Ruler (900900) | cardReset | `Redistribute Command Cards` (no target) ✓ |

### Files Modified

| File | Action |
|---|---|
| `data/servant-data/convert_servant.py` | 6 changes (1 handler + 1 helper + 2 handler rewrites + 1 multi-option detection) |

---

## 2026-04-20 — feat(servant-info): HP threshold conditions + selfturnendFunction rewrite (session 24)

**Branch:** `feat/servant-info` (not merged)

### Key Accomplishment

Implemented two distinct HP-threshold condition handlers:
- **Case 1:** `buff.script.HP_LOWER/HP_HIGHER` fields (0-1000 scale) in BUFF_TYPE_MAP type buffs → display as suffixes
- **Case 2:** `selfturnendFunction` with `displayBuffstring` gate + inner skill → display as quoted prefix format

### Technical Overview

#### Case 1 — HP Condition Suffix Handler

**Problem:** Buffs like `upAtk` with `buff.script.HP_LOWER: 990` should display as "while HP is 99% or less" suffix.

**Solution:** New helper `_fmt_hp_cond(buff)` at line 392:

```python
def _fmt_hp_cond(buff):
    script = buff.get("script", {})
    hp_lower = script.get("HP_LOWER")
    hp_higher = script.get("HP_HIGHER")
    if hp_lower is not None:
        pct = hp_lower // 10
        return f" while HP is {pct}%" if pct == 1 else f" while HP is {pct}% or less"
    if hp_higher is not None:
        pct = hp_higher // 10
        return f" while HP is {pct}%" if pct == 100 else f" while HP is {pct}% or more"
    return ""
```

Extraction at line 533 (after `buff = buffs[0]`):
```python
hp_cond = _fmt_hp_cond(buff)
```

Injection at two BUFF_TYPE_MAP generic return statements (divisor=0 and val_str paths):
```python
return f"{template}{_cond}{oc_times_tag}{op_cond_str}{hp_cond} {target}..."
```

#### Case 2 — selfturnendFunction with displayBuffstring Gate

**Problem:** Skills with `selfturnendFunction` + inner skill containing `displayBuffstring` HP gate should format as:
```
Apply a state that "When HP is above 99.9%, Gain Critical Stars by 10 for all allies" at the end of turn (3 turns) for yourself
```

**Solution:** Complete rewrite of selfturnendFunction handler (lines 549–587, ~62 lines):

Key logic:
1. Fetch inner skill via `sv0.get("Value")`
2. Scan inner skill functions for `displayBuffstring`:
   - Extract `TriggeredTargetHpRateRange` (e.g., `"<999"`) → parse direction + numeric value
   - Invert direction logic: `<999` = "when HP is NOT below 99.9%" = "When HP is above 99.9%,"
   - Extract `funcTargetType` for target label (e.g., ptAll → "for all allies")
3. Format remaining inner functions via `_fmt_function_core`
4. Assemble: `hp_prefix + " & ".join(inner_parts) + hp_target_str`
5. Output: `'Apply a state that "{inner_str}" at the end of turn{cond} {target}'`
6. Fallback (no inner_parts): extract ailment from `buff.vals`, derive inner effect from inner buff, same format

### Verified Test Cases

| Servant | Test Case | Output |
|---------|-----------|--------|
| 505300 (Aesc) | HP_LOWER (Skill 2) | `Increase ATK by 50% (3 turns) while HP is 99% or less for yourself` ✓ |
| 505300 (Aesc) | selfturnendFunction (Skill 1) | `Apply a state that "When HP is above 99.9%, Gain Critical Stars by 10 for all allies" at the end of turn (3 turns) for yourself` ✓ |
| 2300900 (C.I.E.L) | HP_HIGHER (Skill 2) | `Increase Critical Strength by X% (T turns) while HP is 50% or more for yourself` & `while HP is 100%` ✓ |
| 106100 (Richard I) | Regression test | No impact on unrelated servants ✓ |

### Files Modified

| File | Action |
|---|---|
| `data/servant-data/convert_servant.py` | Added `_fmt_hp_cond` helper; modified BUFF_TYPE_MAP generic returns; rewrote selfturnendFunction handler |

### Servant ID Reference

| Short ID | Long ID | Name |
|----------|---------|------|
| 385 | 505300 | Aesc the Rain Witch |
| 418 | 2300900 | Mysterious Executor C.I.E.L |

---

## 2026-09-12 — feat(bond-calculator): Servant Mode Selection, decoupled Max Bond & Bond ≥15 checkboxes, card height 200px, dev port 3000

**Branch:** `develop`

### Key Accomplishment

1. **Servant Mode Selection:**
   - Streamlined dropdown to two options: **Normal Servant** and **Support Servant** (removed old "Max Bond Servant" option).
   - Added automatic backward compatibility migration in `loadState()` for existing localStorage data having `type: "maxbond"` (migrates to `type: "normal"`, `maxBond: true`, `bond15: true`).

2. **Decoupled "Max Bond" and "Bond ≥15" Checkboxes:**
   - Added two independent checkboxes to each Normal Servant slot:
     - **"Max Bond"**: When checked, hides/removes the "Bond Needed" input box and skips run calculations for this servant.
     - **"Bond ≥15"**: When checked, grants the party +25% Bond bonus (and to the servant themselves if leveling).
   - **Decoupled behavior**: In the FGO update allowing bond leveling up to 16, clicking "Bond ≥15" does **not** auto-check "Max Bond". A servant can be at Bond ≥15 while still leveling (e.g. 15 → 16) and have required bond points entered.
   - Preserves required bond validation (`Please enter required bond points for <servant>`) when a Normal servant is not marked Max Bond and has `0` or empty bond points entered.

3. **UI & Drag Interaction:**
   - Updated `ServantDrag.onHoldStart` in `selectors.js` to ignore clicks on `input, select, option, label` so tapping checkboxes and labels does not accidentally trigger drag-and-drop reorder timers.
   - Styled `.bond-checkbox-row`, `.bond-checkbox-label`, and `.bond-checkbox` with smooth hover states and accent colors.
   - Set `.servant-slot` fixed height to **200px** in both `global.css` and `BaseLayout.astro` critical CSS so all cards in all rows remain perfectly aligned based on the card with the "Bond Needed" input box.

4. **Dev Server Configuration:**
   - Updated `package.json` scripts (`dev` and `preview`) to run on **port 3000** (`--port 3000`).

### Files Modified

| File | Action |
|---|---|
| `src/scripts/bond-app.js` | Updated Servant Mode dropdown, added decoupled checkboxes, updated calculation logic & migration |
| `src/scripts/selectors.js` | Ignored inputs, selects, and labels in drag reorder onHoldStart |
| `src/styles/global.css` | Added checkbox styles, updated `.servant-slot` height to 200px |
| `src/layouts/BaseLayout.astro` | Updated critical inline CSS for servant slot height and checkbox styles |
| `package.json` | Updated dev & preview scripts to `--port 3000` |
| `README.md` | Updated features and usage documentation for Bond Calculator |
| `.claude/CLAUDE.md` | Updated servant types and port 3000 references |

---

## 2026-09-12 — feat(bond-calculator): Bond All +25% visual slot badge

**Branch:** `develop`

### Key Accomplishment

1. **Bond All +25% Badge on Servant Slots:**
   - When "Bond ≥15" is checked on a Normal Servant, the slot now displays a visual **"Bond All +25%"** badge (bond icon with "All" overlay and `+25%` text below), identical in styling to the Support Servant frontline badge.
   - **All Slots Supported:** The "Bond All +25%" badge is displayed on any slot (Starting Member slots 0–2 or Sub Member slots 3–5) where "Bond ≥15" is checked.
   - **Starting Member Stacking:** When a servant with "Bond ≥15" checked is in the starting member (slots 0–2), both badges are displayed:
     - Top badge: `+20%` (frontline self bonus).
     - Bottom badge: `+25%` (with "All" overlay on bond icon), positioned neatly below `+20%`.
   - **Responsive & Clean Positioning:** Badge items are wrapped in `.servant-slot-badge-item` inside `.servant-slot-frontline-badge` with `gap: 2px` and `pointer-events: none` to preserve drag-and-drop and slot selection interactions.
   - Synchronized CSS in both `src/styles/global.css` and `src/layouts/BaseLayout.astro`.

### Files Modified

| File | Action |
|---|---|
| `src/scripts/bond-app.js` | Added Bond All +25% badge rendering and stacking logic below +self 20% in starting member |
| `src/styles/global.css` | Added `.servant-slot-badge-item` and `.servant-slot-badge-text`, updated container gap and pointer-events |
| `src/layouts/BaseLayout.astro` | Synchronized critical inline CSS for badge items and text |
| `README.md` | Added documentation for visual slot badges in Bond Calculator features |

---

## 2026-09-12 — feat(bond-calculator): "Bond Needed" text displayed on input box border

**Branch:** `develop`

### Key Accomplishment

1. **Border Label Implementation:**
   - Transformed the bond points input on Normal Servant slots from a horizontal label-and-input row to a full-width input box with the label **"Bond Needed"** centered directly on the top border.
   - Positioned `.bond-input-box-label` with `top: -6px`, `left: 50%`, `transform: translateX(-50%)`, and `background: var(--bg)` to break the top border line cleanly.
   - Stretched the numeric input field (`.bond-input-box-field`) to 100% width, matching the servant mode select dropdown above it.
   - Maintained hover state consistency (`.servant-slot:hover .bond-input-box-label { background: var(--border); }`) and focus styling (`.bond-input-box:focus-within .bond-input-box-label { color: var(--accent); }`).
   - Synchronized CSS in both `src/styles/global.css` and `src/layouts/BaseLayout.astro` critical CSS.

### Files Modified

| File | Action |
|---|---|
| `src/scripts/bond-app.js` | Updated DOM structure to `.bond-input-box` with `.bond-input-box-label` and `.bond-input-box-field` |
| `src/styles/global.css` | Added styles for `.bond-input-box`, `.bond-input-box-label`, `.bond-input-box-field`, and hover/focus-within states |
| `src/layouts/BaseLayout.astro` | Synchronized inline critical CSS for border label and full-width input field |

---

## 2026-09-12 — feat(bond-calculator): "Bond Required" left-aligned border label and right-aligned input

**Branch:** `develop`

### Key Accomplishment

1. **"Bond Required" Label Text & Left Alignment:**
   - Changed the label text from `"Bond Needed"` to `"Bond Required"`.
   - Shifted `.bond-input-box-label` alignment along the top border from centered (`left: 50%; transform: translateX(-50%);`) to left-aligned (`left: 8px;`).
2. **Right-Aligned Numeric Input:**
   - Changed text alignment in `.bond-input-box-field` from `text-align: center;` to `text-align: right;`.
   - Adjusted padding to `padding: 6px 10px;` to give numbers proper spacing from the right border edge.
   - Synchronized CSS in both `src/styles/global.css` and `src/layouts/BaseLayout.astro` critical CSS.

### Files Modified

| File | Action |
|---|---|
| `src/scripts/bond-app.js` | Changed label text to `"Bond Required"` |
| `src/styles/global.css` | Updated `.bond-input-box-label` (`left: 8px;`) and `.bond-input-box-field` (`text-align: right; padding: 6px 10px;`) |
| `src/layouts/BaseLayout.astro` | Synchronized inline critical CSS for label and input field |

---

## 2026-09-12 — feat(bond-calculator): 100% height servant slots with layout preservation via visibility: hidden

**Branch:** `develop`

### Key Accomplishment

1. **Fluid Height (`height: 100%`) with Zero Layout Shift:**
   - Changed `.servant-slot` from a fixed `height: 200px` to `height: 100%` in both `src/styles/global.css` and `src/layouts/BaseLayout.astro`.
   - Utilized persistent DOM structures combined with `visibility: hidden; pointer-events: none;` (`.bond-checkbox-row--hidden`, `.bond-input-box--hidden`) rather than omitting DOM elements.
   - When "Max Bond" is checked or servant mode is switched to "Support Servant", elements retain their exact spatial layout geometry, preventing height collapse or shift.
2. **Empty Slot Alignment:**
   - Added invisible dummy control elements to empty slots (`.servant-add-slot`) so empty slots and rows containing only empty/support slots naturally establish and match the identical height of filled normal servant cards.
3. **Validation & Dev Server:**
   - Tested in browser via dev server running at `http://localhost:3000/fgo-calculator/`.
   - Confirmed cards maintain constant, uniform height across normal, max bond, support, and empty states.

### Files Modified

| File | Action |
|---|---|
| `src/styles/global.css` | Changed `.servant-slot` to `height: 100%`; added `.bond-checkbox-row--hidden` and `.bond-input-box--hidden` |
| `src/layouts/BaseLayout.astro` | Synchronized inline critical CSS for `.servant-slot` height and hidden classes |
| `src/scripts/bond-app.js` | Updated DOM creation to preserve geometry with hidden utility classes and dummy spacers |

---

## 2026-09-12 — refactor(bond-calculator): align alert dialog text with "Bond Required" terminology

**Branch:** `develop`

### Key Accomplishment

1. **Terminology Consistency Across Alerts:**
   - Updated validation alert dialogs in `src/scripts/bond-app.js` to consistently use `"bond required"` instead of outdated `"bond points needed"` / `"required bond points"`, matching the UI input label `"Bond Required"`.
   - `alert("Please select servants and enter bond required.");` (was `"bond points needed"`).
   - `alert(\`Please enter bond required for \${name || "servant in slot " + (i + 1)}.\`);` (was `"required bond points"`).
   - Updated internal comment to `// Controls: checkboxes + bond required input`.
2. **Native Dialog Preservation:**
   - Kept native `window.alert(...)` dialogs intact per user preference without custom modal abstractions.

### Files Modified

| File | Action |
|---|---|
| `src/scripts/bond-app.js` | Updated alert messages and code comment to use `"bond required"` |

---

## 2026-09-13 — feat(event-shop): border-labeled input boxes with "Required, Held, Bonus" labels

**Branch:** `develop`

### Key Accomplishment

1. **Border Label Input Boxes for Event Shop Cards:**
   - Redesigned the input controls in all three material cards (Bronze, Silver, Gold) from horizontal label-and-input rows (`.input-row`) to full-width border-labeled input boxes (`.material-input-box`) matching the Bond Calculator's `"Bond Required"` design.
   - Updated the label texts from `"Need"`, `"Have"`, `"Bonus"` to **`"Required"`**, **`"Held"`**, and **`"Bonus"`**.
   - Positioned `.material-input-box-label` with `top: -6px`, `left: 8px`, and `background: var(--tier-bg, var(--bg))` to cleanly break the top border line while matching the card's tier background (Bronze, Silver, Gold).
   - Stretched numeric fields (`.material-input-box-field`) to 100% width with right-aligned monospace (`Space Mono`) numbers.
   - Preserved all input IDs (`bronzeNeed`, `bronzeHave`, `bronzeBonus`, etc.) and data schemas to maintain 100% backward compatibility with `localStorage` and `event-shop.js` calculations.
2. **Critical CSS Synchronization:**
   - Synchronized CSS rules across both `src/styles/global.css` and `src/layouts/BaseLayout.astro` inline critical CSS to prevent FOUC.

### Files Modified

| File | Action |
|---|---|
| `src/pages/index.astro` | Converted 9 material card inputs to `.material-input-box` with "Required", "Held", "Bonus" labels |
| `src/styles/global.css` | Added `.material-input-box*` styles grouped with `.bond-input-box*` and `var(--tier-bg, var(--bg))` |
| `src/layouts/BaseLayout.astro` | Synchronized inline critical CSS for `.material-input-box*` |
| `.claude/docs/progress.md` | Documented implementation and verification |

---

## 2026-09-18 — feat(data): servant 482 (Daedalus), spiritron dresses, update_traits.py, servant 311 costume

**Branch:** `develop`

### Key Accomplishment

1. **Added Servant 482 (Daedalus):**
   - Added servant 482 in `src/scripts/data/servants.js` with traits `["0001", "0002", "0106", "0202", "0302", "0304", "0405"]` (sorted ascending).
   - Downloaded face asset via Atlas Academy API and saved to `public/servants/482/000.webp`.
   - Updated Servant ID Reference table in `.claude/docs/fetch-data-guideline.md`.

2. **Added Spiritron Dresses Trait (2780):**
   - Appended trait `"2780"` to the base trait array for servants 075 (Jack the Ripper), 298 (Watanabe-no-Tsuna), 311 (Baobhan Sith), 373 (Kukulcan), and 427 (Tutankhamun).

3. **Created `update_traits.py` Utility in `.claude/docs/`:**
   - Created a CLI & interactive Python script for modifying servant traits in `servants.js`.
   - Supports `add`, `remove`, `set`, `view`, and `list-traits` subcommands.
   - Automatically handles bracketed format (`[Gender:Male]`, `[Class:Berserker]`), trait names, aliases, and numeric IDs.
   - Automatically maintains numerical ascending sort order.

4. **Added Costume 300 ("Bloody Bunny") for Servant 311 (Baobhan Sith):**
   - Configured multi-ascension traits: base retains all standard traits + `2780`, costume `300` adds `["2821"]` (`Beast Servants`).
   - Configured `optionLabels: { 300: "Bloody Bunny" }`.
   - Set base name to `"Baobhan Sith"` with `optionNames: { "000": "Tam Lin Tristan" }` so 001, 002, and 300 display as "Baobhan Sith".
   - Downloaded face assets for `001.webp`, `002.webp`, and `300.webp` into `public/servants/311/`.

### Files Modified

| File | Action |
|---|---|
| `src/scripts/data/servants.js` | Added servant 482, trait 2780 to 075/298/311/373/427, costume 300 & optionNames for 311 |
| `public/servants/482/000.webp` | New portrait asset for Daedalus |
| `public/servants/311/001.webp` | New 2nd ascension portrait asset for Baobhan Sith |
| `public/servants/311/002.webp` | New 3rd ascension portrait asset for Baobhan Sith |
| `public/servants/311/300.webp` | New costume portrait asset for "Bloody Bunny" |
| `.claude/docs/update_traits.py` | New traits update CLI utility script |
| `.claude/docs/fetch-data-guideline.md` | Added Daedalus to Servant ID Reference table |
| `.claude/docs/progress.md` | Documented implementation and verification |

## 2026-11-06 — Total AP, Custom AP/Run, and Golden Fruit Conversion in Bond Calculator

### Work Done

1. **Total AP Calculation & Custom AP Input:**
   - Free Quest default AP = 22, Grand Duel = 40 (`BOND_CONSTANTS.FREE_QUEST_AP`, `BOND_CONSTANTS.GRAND_DUEL_AP`).
   - Added `#customApPerRun` input to `#customQuestSection` allowing custom AP/run (default: 22, max: 999).
   - Added `Quest.apPerRun({ questMain, questSub }, customAp)` in `src/scripts/domain.js`.
   - Calculated party total AP as `max(slotTotalRuns) * apPerRun`.

2. **Golden Fruit Requirement & Max AP Config:**
   - Downloaded and converted `https://static.atlasacademy.io/JP/Items/100_bordered.png` to `public/icons/100_bordered.webp`.
   - Added `.bond-max-ap` input box (`#maxApInput`, label "Max AP", default 152) to the bottom-left of Party Setup without a toggle switch.
   - Kept Stargazer's Teapot on the bottom-right adjacent to "Calculate Quest Runs".
   - Added `Quest.goldenFruit(totalAp, maxAp)` (`Math.ceil(totalAp / maxAp)`).
   - Displayed 2-line summary badge `.bond-total-ap` / `.bond-ap-badge` below results:
     - Line 1: `Total AP: X AP (Y runs)`
     - Line 2: `Use N Golden Fruit` + 48px `100_bordered.webp`.

3. **Static Status Badge for Teapot Exhaustion:**
   - Changed `.bond-teapot-remove` from clickable button to static status badge `.bond-teapot-badge` ("Out of Stargazer's Teapot" + 48px teapot icon).

4. **Updated `scripts/merge_code_only.sh`:**
   - Added support for custom commit message via argument 2 (`scripts/merge_code_only.sh [source] [commit_message]`).

### Files Modified

| File | Action |
|---|---|
| `public/icons/100_bordered.webp` | Downloaded and converted Golden Fruit icon |
| `src/scripts/constants.js` | Added AP constants |
| `src/scripts/domain.js` | Added `Quest.apPerRun` and `Quest.goldenFruit` |
| `src/pages/index.astro` | Added `#customApPerRun` and `#maxApInput` markup |
| `src/layouts/BaseLayout.astro` | Styled `.bond-max-ap`, `.bond-total-ap`, `.bond-ap-badge`, `.bond-teapot-badge` |
| `src/scripts/bond-app.js` | Handled state persistence, input sync, and result badge generation |
| `tests/bond-quest.test.js` | Added unit tests for AP and Golden Fruit calculations |
| `scripts/merge_code_only.sh` | Supported optional commit message argument |
| `scripts/build_baseline.json` | Updated baseline |
| `README.md` | Updated feature list |
| `.claude/CLAUDE.md` | Updated architecture documentation |
| `.claude/docs/fetch-data-guideline.md` | Added Golden Fruit item documentation |
| `.claude/docs/progress.md` | Documented implementation |





## 2026-11-06 — Modal Action Footers, Deferred Filter Application, and CE Bonus Disabling Consistency

### Work Done

1. **CE Bonus Chip Disabling Consistency:**
   - In Bond Gain CE filter settings modal (`#cefilterFilterModal`), changed unavailable CE bonus count chips from hiding to disabling (`.ce-count-btn--disabled`), consistent with `.class-btn--disabled` and `.ce-group-btn--disabled`.

2. **Filter Settings Modal Action Footers & Draft Filtering:**
   - Added action footers to both `#cefilterFilterModal` (Bond Gain CE tab) and `#servantFilterModal` (Servant Picker):
     - Bottom-left: **Default** (clears modal filter selections), **Select All** (selects all valid/enabled options).
     - Bottom-right: **Cancel** (discards draft changes and closes modal), **OK** (applies draft filters to background and closes modal).
   - Changed filtering logic to use draft state (`draftFilters`), deferring background recalculation and re-rendering until user clicks "OK".
   - Aligned button styling across modals (36px height, 2px border, 8px radius, 0.85rem font-weight 600, primary accent fill for OK).
   - Removed separator bar (`border-top: 2px solid var(--border)`) on `.cefilter-modal-footer`, adjusting `padding-top` to 4px.

3. **Craft Essence Picker Modal Footers & Draft Filtering:**
   - Added action footer to `#ceFilterModal` (Add CE modal in Bond Gain CE tab):
     - Bottom-left: **Default** (clears draft CE selections).
     - Bottom-right: **Cancel** (discards draft CE selections), **OK** (applies selected CEs to background and closes modal).
   - Removed instant live `onApply()` calls on every CE chip click; selections stay draft (`tempSelected`) until "OK" is clicked.

4. **Verification & Baseline:**
   - Updated `scripts/verify_render.js` to click "OK" in test flows.
   - Updated `scripts/build_baseline.json` for new HTML markup and chunk sizes.

### Files Modified

| File | Action |
|---|---|
| `src/layouts/BaseLayout.astro` | Added footer styles (`.cefilter-modal-footer`, `.cefilter-footer-btn`, `.cefilter-footer-btn--primary`), disabled chip styles (`.ce-count-btn--disabled`), adjusted modal body max-height |
| `src/pages/index.astro` | Added footers with Default, Select All, Cancel, and OK buttons to `#servantFilterModal`, `#cefilterFilterModal`, and `#ceFilterModal` |
| `src/scripts/ce-filter-app.js` | Implemented draft filtering and modal footer handlers for Bond Gain CE filter modal; updated CE bonus count disabling logic |
| `src/scripts/selectors.js` | Implemented draft filtering and modal footer handlers for `#servantFilterModal` and `#ceFilterModal` |
| `scripts/verify_render.js` | Updated headless tests to confirm filter application via OK button |
| `scripts/build_baseline.json` | Updated baseline hashes and chunk sizes |
| `README.md` | Documented modal action buttons, deferred filtering, and CE bonus chip disabling |
| `.claude/CLAUDE.md` | Documented draft filter state and action footers in filter settings and CE picker modals |
| `.claude/docs/progress.md` | Documented implementation and verification |

## 2026-11-07 — Servant Select Hybrid CE Intersection & Same-Member Pruning

### Overview
Replaced the unoptimized Cartesian class intersection walk in `ServantComboCalculator.buildSharedCEGroups` with a hybrid closed-itemset approach featuring unshared CE pre-filtering, same-member pruning, and `seen` memoization.

### Work Done
1. **Pre-Filtering Unshared CEs (`_filterSharedCESet`, `_mapCEServants`):**
   - Collects CEs usable by ≥2 distinct picked servants. CEs appearing on only one picked servant cannot form any combo and are discarded upfront, collapsing servant equivalence classes before enumeration.
2. **Equivalence Classes & Member Order (`_buildEquivalenceClasses`, `_collectMembers`):**
   - Deduplicates array/Set `matchingCEIds` with `[...new Set(rawCeIds)].filter(...)`.
   - Groups interchangeable members with identical shared CE signatures into equivalence classes.
3. **Closed Intersection Walk & Memoization (`_exploreCombinations`, `_walkCombinations`):**
   - Walks pairwise intersections of equivalence classes with `seen` Set memoization, skipping redundant search branches and respecting `MAX_COMBO_NODES`.
4. **Same-Member Pruning (`_recordCandidateGroup`, `_isBetterCEIds`, `_evaluateCandidateGroup`):**
   - Keys combo candidate groups by member index signature (`memberKey`). When multiple candidate CE subsets match the exact same subset of members, retains only the maximal CE set (with deterministic lexicographical tie-breaking on equal length).
5. **Clean Code Decomposition & Testing:**
   - Decomposed into 11 focused helper methods on `ServantComboCalculator`, each strictly ≤18 lines.
   - Updated node-budget truncation tests in `tests/servant-combo.test.js` to assert bounded search without relying on unshared CE Cartesian explosion. Added regression assertions for duplicate array inputs and multi-ascension single-servant isolation.
   - 107/107 unit tests passing across all test suites.

### Files Modified
| File | Action |
|---|---|
| `src/scripts/domain.js` | Implemented hybrid CE-intersection, pre-filtering, same-member pruning, and equivalence memoization in `ServantComboCalculator` |
| `tests/servant-combo.test.js` | Updated budget truncation tests and added coverage for CE pre-filtering, same-member pruning, seen-key memoization, and duplicate inputs |
| `.claude/CLAUDE.md` | Documented hybrid intersection algorithm and same-member pruning in Servant Select specification |
| `.claude/docs/progress.md` | Documented implementation and verification |


## 2026-11-07 — Servant Select All-Servant Default, 5-Row Pagination & Staged Multi-Select Footer

### Overview
Enhanced the Servant Select sub-tab to default to evaluating all servants when 0 picks are selected, introduced 5-row responsive pagination (`cols * 5`), and added a staged multi-select footer to `#servantModal`.

### Work Done
1. **All-Servant Default Evaluation:**
   - When `pickedIds` is empty, defaults to evaluating the full servant roster (`ServantData.servants.map(s => s.id)`) instead of sitting empty. Prompts "Add one more servant…" when exactly 1 servant is picked.
2. **5-Row Pagination:**
   - Replaced "Show N more" button with top and bottom pagination controls (`#cefilterComboPaginationTop`, `#cefilterComboPaginationBottom`) matching `CEFilterApp`'s 5-row pagination (`cols * 5`). Resets `currentPage` to 1 on pick modifications or sub-tab switch.
3. **Staged Multi-Select Footer:**
   - Enabled `multi: true` mode in `ServantSelector` with staged selection (`_selectedIds`) and action footer (`#servantModalFooter`: Default, Select All, Cancel, OK). Selections commit to background only on "OK".

### Files Modified
| File | Action |
|---|---|
| `src/scripts/ce-servant-select.js` | Added all-servant fallback, 5-row pagination controls, and staged modal opening |
| `src/scripts/selectors.js` | Added multi-select mode and modal footer actions to `ServantSelector` |
| `src/pages/index.astro` | Added `#servantModalFooter` markup and pagination containers |
| `tests/ce-servant-select.test.js` | Added coverage for all-servant default and 5-row pagination |
| `tests/servant-selector-reset.test.js` | Added tests for staged multi-select and footer actions |

## 2026-11-07 — Bitset Closed-Intersection Engine for ServantComboCalculator

### Overview
Refactored `ServantComboCalculator` to use a high-performance 32-bit `Uint32Array` bitset closed-intersection engine, drastically speeding up combo computation across large rosters.

### Work Done
1. **Bitset Equivalence & Intersection (`_buildBitsetClasses`, `_intersectBitsets`, `_isSubsetMask`):**
   - Encoded shared CE lists into bitset masks, enabling bitwise `&` operations for intersection and fast subset checks.
2. **Closed-Itemset Pruning:**
   - Replaced iterative array comparisons with bitwise masking, ensuring maximal CE sets are identified and non-maximal subsets pruned efficiently within node budgets.
3. **Unit Testing:**
   - Added exhaustive bitset correctness tests and large-roster performance verification in `tests/servant-combo.test.js`.

### Files Modified
| File | Action |
|---|---|
| `src/scripts/domain.js` | Implemented bitset closed-intersection engine in `ServantComboCalculator` |
| `tests/servant-combo.test.js` | Added unit tests covering bitset operations, subset pruning, and equivalence classes |

## 2026-11-07 — Unified Servant 467 (François / Francesca Prélat) Blinking Swap Display

### Overview
Unified Servant 467 into a single entry with dual persona representation (François and Francesca Prélat) featuring synchronized 8-second CSS cross-fade swap animation.

### Work Done
1. **Unified Data Model & Sync:**
   - Merged split records ("467" and "467-1") into unified servant entry "467" with top-level `altName: "Francesca Prélat"` and swap portrait `"002-1"` alongside `"002"`.
   - Updated `sync_atlas_data.py` and `validate_data.js` to validate and generate unified asset mappings.
2. **Synchronized Cross-Fade Swap Display:**
   - Added `DOMFactory.createSwapImg` and `DOMFactory.fillSwapName` generating `.servant-swap-wrap` and `.servant-swap-name` elements with CSS keyframe animation (`servant-swap-a`, `servant-swap-b`, 8s loop, disabled under `prefers-reduced-motion`).
3. **App Integration:**
   - Integrated swap rendering across BondApp, CEFilterApp, ServantSelect, and Selectors.

### Files Modified
| File | Action |
|---|---|
| `scripts/sync_atlas_data.py` | Unified servant 467 data sync and dual-persona asset extraction |
| `scripts/validate_data.js` | Updated schema validation for unified dual-persona entries |
| `src/layouts/BaseLayout.astro` | Added CSS keyframe animations and layout rules for `.servant-swap-*` |
| `src/scripts/presentation.js` | Implemented `createSwapImg` and `fillSwapName` helpers |
| `tests/servant-467-unified.test.js` | Added comprehensive test suite for unified data and DOM rendering |

## 2026-11-07 — Modal Width Scale Unification, ARIA Dialog Attributes & 3×5 Class Filter Grid

### Overview
Unified modal width scaling across breakpoints, capped compact filter sub-modals at 540px, added accessible ARIA dialog attributes across all modals, and updated the 15 class filter buttons into a structured 3×5 grid.

### Work Done
1. **Modal Width Scale Unification:**
   - Standardized `.servant-modal-content` max-width scale (`360px` / `>=580px: 480px` / `>=760px: 540px` / `>=940px: 720px` / `>=1120px: 900px`).
   - Capped filter and compact sub-modals (`#servantFilterModal`, `#cefilterFilterModal`, `#ceOverlapFilterModal`, `#ascensionModal`, `#ceSubModal`) at `540px` on wide screens (`>=940px`).
   - Unified nested filter modal stacking with `z-index: 1050`. Removed dead `.ceoverlap-grid` styles.
2. **ARIA Dialog Attributes:**
   - Added `role="dialog" aria-modal="true" aria-labelledby="..."` to all 6 remaining modals (`#servantModal`, `#ascensionModal`, `#ceModal`, `#ceSubModal`, `#ceFilterModal`, `#ceOverlapModal`) and associated title IDs.
3. **3×5 Class Filter Grid:**
   - Formatted `.class-filter` as `display: grid; grid-template-columns: repeat(5, 48px); justify-content: center; gap: 4px;` so 15 class icons render in 3 neat rows of 5 icons.
4. **Verification:**
   - 144/144 unit tests passing across all test suites; `verify_render.js` passing.

### Files Modified
| File | Action |
|---|---|
| `src/layouts/BaseLayout.astro` | Updated modal width scales, breakpoint rules, and `.class-filter` grid CSS |
| `src/pages/index.astro` | Added `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` across modals |
| `.claude/docs/code-style.md` | Documented updated modal width scales and 3×5 class grid |


## 2026-11-07 — Servant Atlas ID Migration

### Overview
Migrated servant identification and asset folder structure from 3-digit zero-padded collection numbers (`"001"`, `"467"`) to official Atlas Academy servant IDs (`"100100"`, `"505600"`), storing `collectionNo` as an explicit integer field and keeping dual-persona Servant 467 unified via `altId: "505700"`.

### Work Done
1. **Schema & Extraction:**
   - Updated `scripts/sync_atlas_data.py` to key `SERVANT_DATA` and `BOND_TABLE_BY_SVT` by Atlas servant IDs.
   - Preserved `collectionNo: <int>` on each servant record; sorted servant arrays ascending by `collectionNo`.
   - Asset portraits organized in `public/servants/{atlasId}/{stage}.webp`.
2. **Backwards Compatibility & App Controllers:**
   - Updated `src/scripts/data.js` and `src/scripts/domain.js` with collection number to Atlas ID resolution maps.
   - Sanitized and migrated legacy saved parties and picks in `BondApp` and `CEFilterApp`.
3. **Verification:**
   - 150/150 unit tests passing; `scripts/validate_data.js` and `verify_render.js` clean.

### Files Modified
| File | Action |
|---|---|
| `scripts/sync_atlas_data.py` | Extracted Atlas svt IDs, output `collectionNo: <int>` |
| `scripts/validate_data.js` | Updated schema validation for Atlas svt IDs |
| `src/scripts/data.js` | Built `cnoToId` reverse mapping and servant lookup |
| `src/scripts/domain.js` | Adapted validators and calculators to Atlas svt IDs |
| `tests/*` | Updated unit test fixtures and assertions |

## 2026-11-08 — Craft Essence Atlas ID Migration with Collection Number Ordering & Back-Compat

### Overview
Migrated Craft Essences from 4-digit collection numbers (`"0099"`, `"0910"`) to 7-digit Atlas equip IDs (`"9400970"`, `"9401970"`), matching the servant architecture pattern. Added robust `localStorage` backwards compatibility and preserved in-game collection number display and LCP preload order.

### Work Done
1. **Schema & Extraction:**
   - Updated `scripts/sync_atlas_data.py` to extract 7-digit Atlas equip IDs as keys, emit `collectionNo: <int>` on base entries and campaign series group `options`.
   - Updated `scripts/fetch_bordered_ces.py` to key face icon mappings by Atlas ID and migrated all 59 WebP assets in `public/craft_essences/` to 7-digit filenames (`9400970.webp`, etc.).
2. **Data & State Migration Layer:**
   - In `src/scripts/data.js`, implemented `CEData.cnoToId` reverse map and exported `CEData.migrateId(oldId)` and `CEData.migrateEntry(entry)` supporting both string IDs and numeric primitive literals.
   - Enforced `CEList` sorting by `(a.collectionNo - b.collectionNo) || a.id.localeCompare(b.id)` so UI ordering, LCP preloads, and modal grids follow in-game collection numbers rather than lexical Atlas ID strings.
   - Indexed raw `collectionNo`, 4-digit zero-padded `collectionNo`, Atlas equip ID, and name in `_search` token sets.
3. **Application Controllers:**
   - Updated `BondApp.loadState()` to sanitize and migrate slot `ces` via `CEData.migrateEntry()`.
   - Updated `CEFilterApp._loadPicks()` to migrate saved `cePicks` via `CEData.migrateId()`.
4. **Validation & Testing:**
   - Updated `scripts/validate_data.js` with 5-8 digit numeric ID format and positive integer `collectionNo` assertions.
   - Created comprehensive adversarial regression harness `tests/ce-atlas-id-migration.test.js` covering sorting stability, grouped CE option migrations, search tokenization, and numeric primitive migration.
   - Updated `tests/bond-slot-ces.test.js`, `tests/ce-filter-store.test.js`, `tests/servant-filters.test.js`, and `tests/validate-picks.test.js`.
   - 162/162 unit tests pass; ESLint clean; build baseline and Puppeteer render gates clean.

### Files Modified
| File | Action |
|---|---|
| `scripts/sync_atlas_data.py` | Extracted Atlas equip IDs, exported `collectionNo` on entries and grouped options |
| `scripts/fetch_bordered_ces.py` | Migrated CE face mapping and 59 WebP image assets to 7-digit Atlas IDs |
| `scripts/validate_data.js` | Added Atlas ID format and integer `collectionNo` validation |
| `src/scripts/data.js` | Built `CEData.cnoToId`, `migrateId`, `migrateEntry`, `collectionNo` sorting, and search indexing |
| `src/scripts/domain.js` | Updated `Validator.validatePicks` docstring to cite 7-digit Atlas IDs |
| `src/scripts/bond-app.js` | Migrated legacy `ces` entries in `loadState()` |
| `src/scripts/ce-filter-app.js` | Migrated legacy `cePicks` in `_loadPicks()` |
| `.claude/docs/data-rules.md` | Updated `CE_DATA` schema, fields, and image asset paths |
| `.claude/docs/structure.md` | Updated asset layout and image conventions |
| `.claude/CLAUDE.md` | Aligned asset paths, bond table ID references, and removed token gate policy |
| `README.md` | Updated asset paths to `{atlasId}` |
| `tests/*` | Added 12 new migration regression tests, updated existing test fixtures |

## 2026-11-08 — style(ui): Bond Gain CE Sub-Tab Unified Segmented Track (Mobile Full Bar & Desktop Pill Bar)

### Overview
Converted the "Craft Essence Select" and "Servant Select" sub-tab buttons in `#panel-cefilter` from an uncontained right-aligned row into a unified tactile segmented control track across all viewports: top-center full-width bar on small devices (<760px), and top-right positioned segmented track on desktop (>=760px).

### Work Done
1. **Mobile (<760px) Full Bar Segmented Track:**
   - `.cefilter-subtabs`: full width (`width: 100%`), tactile recessed container track with `background: var(--bg)`, `border: 2px solid var(--border)`, `border-radius: var(--radius-sm)`, `padding: 4px`, `gap: 4px`, `box-sizing: border-box`, `margin-bottom: 12px`.
   - `.cefilter-subtab-btn`: equal distribution (`flex: 1 1 0; min-width: 0`), centered text, `padding: 8px 4px`, `font-size: 0.8rem`, `border-radius: calc(var(--radius-sm) - 2px)`.
   - Active state `#cefilterSubtabs .cefilter-subtab-btn.active`: `background: var(--accent); color: #fff; font-weight: 600;`, overriding the generic navbar tab-switching reset rule.
   - Text fits comfortably across mobile viewports down to 320px with zero overflow.
2. **Desktop (>=760px) Segmented Track:**
   - `#panel-cefilter > .card:first-child .cefilter-subtabs`: retains the segmented track container (`background: var(--bg); border: 2px solid var(--border); border-radius: var(--radius-sm); padding: 4px; gap: 4px; box-sizing: border-box;`), positioned absolute at `top: -11px; right: 0; margin-bottom: 0; overflow-x: visible; width: auto;`.
   - `.cefilter-subtab-btn`: natural content width (`flex: initial`), `padding: 6px 14px`, `font-size: 0.85rem`, `border-radius: calc(var(--radius-sm) - 2px)`.
   - Vertically optically centered with `.card-title` ("Craft Essences" / "Servant Select").
3. **Verification:**
   - Verified across viewports (320px, 375px, 760px, 940px, 1120px, 1400px) with Puppeteer; 0px text overflow, 0px card overflow, optical vertical centering.
   - All 162 unit tests pass (`npm test`).
   - Production build baseline check (`npm run check:build`), ESLint, and browser render verification (`scripts/verify_render.js`) pass cleanly.

### Files Modified
| File | Action |
|---|---|
| `src/layouts/BaseLayout.astro` | Added mobile full bar and desktop segmented track in inline `<style>` |
| `scripts/verify_render.js` | Updated subtab layout comment to reflect unified segmented track |
| `.claude/docs/progress.md` | Documented responsive design enhancement |


## 2026-11-08 — fix(ui): Mobile Card Layout Hardening & 2-1 Pyramid Centering

### Overview
Audited and resolved 5 mobile card layout anomalies across Event Shop Calculator, Bond Calculator, and Bond Gain CE tabs for mobile viewports (<580px, <380px, 320px–360px).

### Work Done
1. **2-Column Grid Centering (2-1 Pyramid Hierarchy) (<580px):**
   - Centered odd 3rd card in 2-column mobile grids across `#materialsGrid`, `#questDropsGrid`, `#deficitGrid`, `#questGrid`, and `#servantGrid` (slots 2 & 5) using `grid-column: 1 / -1; justify-self: center; width: 100%;`.
   - Set `max-width: 160px` for materials, deficit, quest, and servant slots (ensuring 1:1 visual parity across Bronze, Silver, Gold tiers in a balanced 2-1 pyramid).
   - Set `max-width: 328px` for quest drops to give horizontal drop rows ample room.
   - Clean desktop reset at `@media (width >= 580px)`: `grid-column: auto; justify-self: auto; max-width: none;`.
2. **Combo Card Grid Overflow Protection (320px Viewports & Modals):**
   - Replaced rigid `minmax(280px, 320px)` with `minmax(min(100%, 280px), 320px)` in `.cefilter-combo-grid`.
   - Added narrow mobile override (<380px): `#ceOverlapModal .cefilter-combo-grid, .cefilter-combo-grid { grid-template-columns: minmax(0, 1fr); padding: 4px; }`.
3. **Combo Card CE Portrait Scaling (<580px):**
   - Applied `@media (width < 580px) { .cefilter-combo-ce-img { height: var(--slot-ce-h); } }` (64px) so 3 CEs fit horizontally on a single line without wrapping.
4. **Bond Party Actions Stacked Layout (<380px):**
   - Eliminated zig-zag alignment on narrow screens with `.bond-teapot { margin-left: 0; }` and full-width calculate CTA `.bond-card-actions .calculate-btn { width: 100%; }`.
5. **Servant Slot Internal Overflow Prevention (320px–360px):**
   - Enabled `flex-wrap: wrap; gap: 6px;` on `.bond-checkbox-row` to prevent text truncation on narrow slots.
   - Set `max-width: 100%; flex-wrap: wrap;` on `.slot-ce-strip` to contain multi-CE Grand Servants.
   - Reduced `.quest-drops-item` padding to `10px 8px` on `<380px`.
6. **CSS Cascade Precedence:**
   - Positioned component `@media (width < 380px)` downstream after all base component and modal declarations in `src/layouts/BaseLayout.astro`.
7. **Verification & Testing:**
   - Created regression harnesses `scripts/test_repro_mobile_cascade_bug.js` and `scripts/test_mobile_cards_qa.js` testing 9 viewport sizes (320px–1120px) with 0px overflow and optical centering verified.
   - 162/162 unit tests, ESLint, production build baseline, and Python test suites pass cleanly.

### Files Modified
| File | Action |
|---|---|
| `src/layouts/BaseLayout.astro` | Added mobile centering, portrait scaling, and narrow-screen layout overrides in inline `<style>` |
| `scripts/test_repro_mobile_cascade_bug.js` | Added regression test for media query cascade precedence |
| `scripts/test_mobile_cards_qa.js` | Added 9-viewport responsive layout testing harness |
| `.claude/docs/progress.md` | Documented mobile card layout fixes |

## 2026-11-08 — build(deploy): Scrub Develop-Only Puppeteer Tests from Main and Enforce In Merge Tooling

### Overview
Scrubbed develop-only puppeteer test harnesses (`scripts/test_*.js`) from `main` to align with the repository contract that public `main` only tracks deploy/build scripts and CI-executed Python self-checks.

### Work Done
1. **Scrub from `main`**:
   - Removed `scripts/test_bond_layout_shift.js`, `scripts/test_mobile_cards_qa.js`, `scripts/test_repro_mobile_cascade_bug.js`, and `scripts/test_subtabs_adversarial.js` from `main`'s git index.
   - Preserved files on disk via `--cached`.
   - Updated `main`'s `.gitignore` to ignore `scripts/test_*.js`.
   - Committed (`b51592b`) and pushed to `origin/main`.
2. **Harden `scripts/merge_code_only.sh`**:
   - Added `'scripts/test_*.js'` to `HIDDEN_PATHS` array so future merges automatically drop all local JavaScript test harnesses alongside `tests/` and `scripts/verify_render.js`.
3. **Synchronize Documentation**:
   - Updated `AGENTS.md` to explicitly state `scripts/test_*.js` are develop-only and ignored on `main`.

### Files Modified
| File | Action |
|---|---|
| `scripts/merge_code_only.sh` | Added `'scripts/test_*.js'` to `HIDDEN_PATHS` |
| `AGENTS.md` | Documented `scripts/test_*.js` develop-only status alongside `verify_render.js` |
| `.gitignore` (on `main`) | Added `scripts/test_*.js` ignore rule |
| `.claude/docs/progress.md` | Documented scrub and tooling hardening |

## 2026-11-08 — fix(modals): Disable Click-Outside Dismiss and Convert Ascension & CE Group to True Sub-Modals

### Overview
Addressed user-reported accidental dismissals during item selection in modals by disabling backdrop click-to-close across all modals, and refactored the Ascension Selector and CE Group Selector into non-destructive layered sub-modals over their parent pickers.

### Problem
1. **Misclick Dismissals**: Users browsing items or scrolling on touch/trackpad devices frequently hit the modal margin/backdrop, accidentally closing the picker and losing their place.
2. **State Destruction on Secondary Selection**: Clicking a multi-ascension servant or a group CE previously closed the parent picker modal (`ServantSelector.close()` / `CESelector.close()`), destroying the search input, active filter pill selections, and scroll position. Hitting Back re-opened the parent picker from scratch.

### Work Done
1. **Backdrop Click Immunity (Solution 1)**:
   - Removed `if (e.target === modal)` / `if (e.target === subModal)` backdrop click event listeners across all 9 modals:
     - `servantModal`, `servantFilterModal`, `ascensionModal`, `ceModal`, `ceSubModal`, `ceFilterModal`, `ceOverlapModal`, `ceOverlapFilterModal` (`src/scripts/selectors.js`)
     - `cefilterFilterModal` (`src/scripts/ce-filter-app.js`)
   - Modals now only close via deliberate user interaction (`✕` close button, `Back`/`Cancel` button, or `Escape` key).
2. **Ascension Selector as a True Sub-Modal**:
   - Updated `src/layouts/BaseLayout.astro` CSS rule: `#servantFilterModal, #ceOverlapFilterModal, #ascensionModal, #ceSubModal { z-index: 1050; }`.
   - `ServantSelector._handleSingleItemClick`: Kept `servantModal` open underneath when opening `AscensionSelector`.
   - `AscensionSelector.back()`: Closes `ascensionModal` directly without rebuilding `ServantSelector`. The parent picker remains immediately visible with search query, active filters, and scroll position intact.
   - `AscensionSelector` Close (`✕`): Closes both `ascensionModal` and `servantModal`, properly cleaning up any `pendingSlot`.
   - `ServantSelector._handleKeydown`: Hierarchical LIFO `Escape` stack (dismisses filter sub-modal first, then ascension sub-modal, then parent servant modal).
3. **CE Group Sub-Selector as a True Sub-Modal**:
   - `CESelector.renderGrid`: Kept `ceModal` open underneath on group CE selection.
   - `CESubSelector.back()`: Closes `ceSubModal` directly without rebuilding `CESelector`.
   - `CESubSelector` Close (`✕`): Closes both `ceSubModal` and `ceModal` with pending slot cleanup.
   - `CESelector`: Added keydown `Escape` listener that unwinds `ceSubModal` first before closing `ceModal`.

### Files Modified
| File | Action |
|---|---|
| `src/layouts/BaseLayout.astro` | Added `#ascensionModal` and `#ceSubModal` to `z-index: 1050` rule |
| `src/scripts/selectors.js` | Removed backdrop clicks, implemented sub-modal stacking, back transitions, and Escape stacks |
| `src/scripts/ce-filter-app.js` | Removed backdrop click listener on `#cefilterFilterModal` |
| `.claude/docs/progress.md` | Documented modal click-outside immunity and sub-modal architecture |

## 2026-11-08 — fix(selectors): Restore Standalone onBack Navigation for Multi-Ascension Servants

### Overview
Fixed bug where clicking a multi-ascension servant already placed in party setup opened `AscensionSelector`, but clicking Back (`←`) failed to open `ServantSelector`, leaving the user unable to change the servant.

### Root Cause
During the sub-modal refactoring, `AscensionSelector.back()` and `CESubSelector.back()` unconditionally closed the sub-modal without checking if the parent modal (`#servantModal` / `#ceModal`) was already open. When invoked directly from the party card portrait/chip (standalone mode), the parent modal was not open in the DOM, so simply closing the sub-modal left no active dialog, dropping `cb.onBack(idx)`.

### Fix
1. **Conditional onBack Dispatch in `AscensionSelector.back()` & `CESubSelector.back()`**:
   - Check if parent modal is active (`parentModal?.classList.contains('open')`).
   - If parent is open (drill-down mode from inside selector), simply close sub-modal to reveal parent without rebuild.
   - If parent is not open (standalone mode from party setup), close sub-modal and execute `cb?.onBack?.(idx)` (or fallback to `ServantSelector.open(idx, ...)`), allowing the player to change the servant or CE.
2. **Keydown Escape Separation**:
   - `Escape` continues to act purely as cancel/dismiss (closes child modal without navigating backwards into servant picker).
3. **Automated Regression Harness**:
   - Added Scenario 7 to `tests/test_servant_submodal_lifecycle.test.js`.
   - Added Scenario 4 to `tests/test_ce_submodal_lifecycle.test.js`.
   - 173/173 tests pass.

## 2026-11-08 — feat(selectors): Direct Main Modal Selection from Party Cards and Sub-Modal X Fix

### Overview
Refactored party setup servant/CE click interactions to always pop up the main selection modal, removed redundant Back buttons from sub-modals, and fixed sub-modal close button (`✕`) behavior so dismissing a sub-modal leaves the parent picker open underneath.

### Work Done
1. **Direct Main Modal on Slot Replace**:
   - In `src/scripts/bond-app.js`, clicking a servant portrait (`portraitArea`) now always opens `ServantSelector` directly regardless of `servant.hasAscensions`.
   - Clicking a CE chip now always opens `CESelector` directly regardless of `ce.isGroup`.
2. **Removed Redundant Back Buttons**:
   - Removed `#ascensionModalBack` and `#ceSubModalBack` buttons from `src/pages/index.astro`. Sub-modals now feature a clean header with title and close (`✕`) button only.
3. **Sub-Modal X Isolation Fix**:
   - In `src/scripts/selectors.js`, `ascensionModalClose` and `ceSubModalClose` now invoke `this.close()` only, properly dismissing the sub-modal without closing `ServantSelector` or `CESelector`.
4. **Verification & Baseline**:
   - Updated `tests/test_servant_submodal_lifecycle.test.js` and `tests/test_ce_submodal_lifecycle.test.js` (169/169 unit tests passing).
   - Rebuilt static distribution via Astro in 652ms; refreshed build baseline via `check_build_output.js --write`.

## 2026-11-10 — feat(bond): Per-Card AP + Golden Fruit Overlay, Total AP Badge Removed

### Overview
Each Bond Calculator servant result card now prices its own runs: an `<ap> AP` line plus the Golden Fruit count as an `x<n>` overlay on a 48px fruit icon, flush with the image's bottom-right corner. The aggregate Total AP badge was removed at the user's direction — its max-runs-based total repeated the longest card's own line (team farms in parallel; the sum of per-card AP is deliberately not the session figure).

### Work Done
1. **`src/scripts/bond-app.js`**:
   - New `buildCardAp(runs)` + `buildCardFruit(fruitCount)` closures inside `calculate()`; appended to every result card (teapot-boosted and continuation segments each price their own runs) under the guard `apPerRun > 0 && runs > 0`.
   - Deleted `buildTotalApBadge`, its call site, and the trailing `maxRuns`/`totalAp` computation. Teapot-exhaust chip unchanged.
   - Overlay: `img` (`icons/100_bordered.webp`, `alt="Golden Fruit"`, `onerror` hides the IMG only — the count survives) + `span.bond-result-fruit-count` `x${fruitCount.toLocaleString()}` via `Quest.goldenFruit(cardAp, state.maxAp)`. Fragment built with `appendChild` (unit-harness stub has no `.append`).
2. **`src/layouts/BaseLayout.astro`** (single inline `<style>`):
   - Added `.bond-result-ap` (0.7rem mono secondary, margin-top 4px), `.bond-result-fruit` (relative fit-content wrapper, 48px = `--ce-badge-h`), `.bond-result-fruit-img`, `.bond-result-fruit-count` (absolute `right: 0; bottom: 0`, 1rem/700, white text-shadow stack per `.servant-slot-badge-overlay` precedent, nowrap, pointer-events none).
   - Deleted dead rules: `.bond-total-ap`, `.bond-ap-badge`, `.bond-ap-line`, `.bond-ap-fruit-line`, `.bond-ap-fruit-img`.
3. **`scripts/test_bond_card_ap.js`** (new, develop-only puppeteer suite, 213 asserts):
   - Per-card exact text/structure; icon load (naturalWidth > 0, 48px computed) and abort-hide (overlay persists with correct count); corner-flush geometry (dx/dy 0.00 vs img and wrapper); extreme `x8,123` pinned against the card (span wider than img by design, zero overflow at 375/900px); customAp=0 → neither element; teapot split segments; badge-absence pins; row uniformity relational (heights 333px).
4. **Verification**: unit 199/199, ESLint clean, `check:build` SUCCESS (bond-lazy 25211 B, −186 B vs pre-feature baseline after badge deletion), repro suite 213/213 across repeated runs.

### Known / Deferred
- Overlay contrast over arbitrary icon pixels is visual-only (house shadow stack, not pixel-verified).
- If the icon fails to load, the wrapper collapses and the count floats at the card centre line, fully visible (measured).

## 2026-11-10 — style(layout): Uniform 8px Servant Card Padding + CE Select Row Height From Tallest Card

### Overview
Owner reported that on the Craft Essence Select sub-tab the bottom of a result card showed more inset than its 8px top. Measured in headless Chromium against the live DOM, the bottom inset was `8px padding + 4px .ce-badges margin-bottom (it is the card's last child) + flex free space`, reaching 12px on the tallest card of a row and up to 150.34px on shorter ones. Computed `padding-top`/`padding-bottom` were already equal, so padding was never the cause. Owner's chosen contract: rows equalize to the tallest card (grid stretch), content stays flush to the top, leftover space pools below the badges.

### Work Done
1. **`src/layouts/BaseLayout.astro`** (single inline `<style>`, all six edits on that one minified line):
   - `.cefilter-servant-card` `padding: 10px 8px` → `8px`; `.bond-result-servant-card` `padding: 12px 8px` → `8px`; `.servant-slot` `padding: 10px 8px` → `8px`.
   - Added `.cefilter-servant-card .ce-badges:last-child { margin-bottom: 0; }`. Scoped to `.cefilter-servant-card` because `.ce-badges` is shared with bond result cards, which keep their 4px. It also matches CE-overlap combo cards (they carry the same class), so their trailing `.ce-badges` servant row lost the same 4px; measured harmless, their own `min-height: 208px` floor holds.
   - Removed `min-height: 208px` from `.cefilter-servant-card`; `content-visibility: auto` and `contain-intrinsic-size: auto 208px` deliberately kept.
   - Deleted the now-dead `padding: 10px 8px` from `.cefilter-combo-card`. Combo cards carry both `cefilter-combo-card` and `cefilter-servant-card` (`src/scripts/presentation.js:169`), `.cefilter-servant-card` sits ~5.4 KB later in the same inline block at equal specificity, so it already won the cascade and combo cards computed `padding: 8px`; the declaration was dead code that mislead readers. Its `min-height: 208px` stays.
2. **Reverted scope leak (recorded so it is not repeated)**: `align-items: start` was briefly added to the shared base rule `.grid, .bond-result-servant-grid, .cefilter-results-grid`, which leaked into five Bond-tab grids (`#servantGrid`, `#materialsGrid`, `#questDropsGrid`, `#deficitGrid`, `#questGrid`) and broke their row equalization (bond result cards `[306, 306, 306]` → `[186, 306, 246]`). Removed; that rule is byte-identical to HEAD. CE-only layout changes must be scoped to `.cefilter-results-grid` or `.cefilter-servant-card`, never to the shared `.grid` selector list.
3. **Verification**: real DOM, 4 viewports (360/580/940/1120) × 2 CE-selection states = 160 cards over 40 rows. Top inset 8px content-box (10px border-box) on every card; bottom inset exactly 8px on the tallest card of all 40 rows, max deviation 0px; row height equals the row's max natural height in all 40 rows. Ad-hoc untracked puppeteer harnesses under `/tmp/opencode` (`test_ce_card_inset_symmetry.mjs`, 49 asserts; `test_grid_scope_regression.mjs`, 5 asserts) exit 0 — the durable, tracked pin is the `scripts/verify_render.js` block recorded in item 4. `npm run test` 199/199, `npm run lint` clean, `npm run build` exit 0, `npm run check:build` SUCCESS, `node scripts/verify_render.js` prints `SUCCESS: rendered UI verified` exit 0 with the new `NOTE: ce card css — grid normal, 7 grid(s) read, card padding ["8px 8px 8px 8px"], min-height ["auto"], ... tallest-card bottom inset [8], combo 8px 8px 8px 8px/208px` line.
   - **CLS finding settled against the production build, not the dev server**: fresh loads with zero prior scrolling and no `scrollIntoView`, at 1120x900, 1600x900 (`html` zoom 1.14286) and 1920x1000 (zoom 1.37143) plus 360/580/940, both CE states, shipped vs a `min-height: 208px` counterfactual injected as a stylesheet. Chrome skipped **0 cards in all 24 runs**, so `contain-intrinsic-size` never entered layout; a single one-step jump to the bottom gave Δdocument scrollHeight 0px, Δgrid height 0px, Δ`#cefilterPaginationBottom` position 0px, ΔCLS 0.000. The predicted −33.2px first-reveal error only reproduces under a forced `content-visibility: hidden` skip, and the floored counterfactual measures −20px in the same probe — the floor never matched the placeholder either. Real effect of removing it: on the default unfiltered list at ≤940px a row whose tallest card is 194.8px is no longer lifted to 208px, so the grid and page are 13.21px shorter (one row per page), ΔCLS 0.000. At ≥1120px every row already holds a ≥246.8px card, so the floor was dead there.
4. **Reviewer round 1 follow-ups**:
   - `src/scripts/ce-filter-app.js:746` — one comment line above `const badges = DOMFactory.el("div", ["ce-badges", "grid-micro"]);` naming the invariant the new CSS rule depends on (the badge grid must stay the card's last child, or the bottom inset silently returns to 12px).
   - `scripts/verify_render.js` — one additive assertion block (168 insertions, 0 deletions, no existing assertion touched) after the `#cefilterResults` card-count asserts, pinning in the repo's own browser gate: `#cefilterResults` computed `align-items` is `normal`/`stretch`; none of the seven `.grid` containers (`#cefilterResults`, `#servantGrid`, `#materialsGrid`, `#questDropsGrid`, `#deficitGrid`, `#questGrid`, `.bond-result-servant-grid`) computes `start`; `.cefilter-servant-card` padding `8px` all sides and `min-height` `auto`; `.servant-slot` and `.bond-result-servant-card` padding `8px`; `.cefilter-combo-card` padding `8px` with `min-height: 208px`; per row one shared height with the zero-free-space card's bottom inset exactly 8px; every card's computed `justify-content` is `normal`/`flex-start`; every card's top inset is exactly 8px; and at least 7 grid containers were read, so the leak check cannot pass vacuously on an empty list. The flush-to-top pair matters: under an injected `justify-content: center` every other assert in the block still passes (the tallest card has zero free space, rows stay equalized) while the 10 slack-carrying cards move their first child to 34/36px — the owner's original symptom reintroduced through the other end of the card. This is what stops the shared-`.grid` leak from recurring unnoticed.

### Known / Deferred
- CE badges still fit only 2 per row. `.grid-micro` track space is 132px (160px track − 4px border − 16px card padding − 8px grid padding) against the 139.92px needed for 3 × 43.97px badges + 2 × 4px gap. Reaching 3 per row needs card track ≥ 172px or `:root --ce-badge-h` ≤ 45.09px (≤ 40.65px on a 360px phone, ≤ 37.09px on 320px). Owner has not chosen; `--ce-badge-h` must be changed at `:root`, because `--ce-badge-w` is computed there.
- `contain-intrinsic-size: auto 208px` on `.cefilter-servant-card` is stale but measured harmless: `_getPageSize() = _getCols() × 5 ≤ 30` cards over a 1282-2000px grid, so Chrome never skips one and the placeholder never drives layout. Forced-skip ceiling is a 228px reserved box vs 194.8-333.14px real (−33.2…+70.8px per card), and the removed floor was equally wrong there (−20px). Drop the `content-visibility` / `contain-intrinsic-size` pair, or retune it, the next time that rule is touched — retuning now buys 0px. Re-check if `_getPageSize()` ever exceeds 30 cards.
- Shorter cards in a tall row keep up to 138.34px of bottom slack. Accepted by the owner under the equal-rows contract, not a defect.
- Combo cards in the CE-overlap modal keep their own `min-height: 208px` and show up to 208px of floor slack (pre-existing). They are NOT padding-untouched: `.cefilter-servant-card { padding: 8px }` comes later in the inline stylesheet at equal specificity, so combo cards now compute `padding: 8px` instead of `10px 8px`. The dead `padding: 10px 8px` was deleted from `.cefilter-combo-card`; only their 208px floor was measured, not the 2px vertical padding shift.
- Uncommitted on `develop`. Ship with `scripts/merge_code_only.sh` per AGENTS.md; `scripts/verify_render.js` and this log are develop-only and must not reach `main`.
- Pre-existing, found while measuring and deliberately not fixed here: pressing the bottom `›` pagination while sitting at the document bottom changes page length by up to −208px (ΔCLS ≤ 0.04), same class of shift with and without the 208px floor. Needs its own ticket if scroll-position stability across pages matters.
- `scripts/verify_render.js` is flaky for reasons that predate this work: `Error: Node is detached from document` around line 923 (`page.click(".servant-add-slot")` right after `select("#bondQuestSelect", "gd")`) and `No element found for selector: .servant-slot .slot-ce-block .bond-checkbox` around line 1025. Cause: `bond-app` rebuilds the party rack asynchronously after a quest-select change and after restoring `fgo_bond_calculator_data`, so `waitForSelector` can resolve against a node that is then replaced. Measured with a HEAD copy lacking the new block: 2/3 green, versus 2/3 green for the shipped file in the lead's own runs — the new block is not implicated (it contains no `click`, and its probes live in `display:none` subtrees, appended and removed inside one synchronous `evaluate`). Re-check any red gate by re-running 3× before blaming a CSS commit. Needs its own ticket.
- Deferred 🔵 nit, unreachable today: the new block indexes `c.children[0]` and `tallest.children[tallest.children.length - 1]` unguarded, so a zero-child card would throw inside `page.evaluate`, abort the gate with a confusing error, and leave the two probes mounted. `ce-filter-app.js` always appends portrait then name, so it cannot happen now. Guard it, or wrap the probe cleanup so it runs on the throw path, next time that block is edited.

## 2026-11-11 — Fixed-slot data-poll schedule (replaces */10 cron)

- **Change:** `.github/workflows/deploy.yml` cron `*/10 * * * *` → `10 9,11,15,19 * * *` (UTC). Four daily polls aligned to JP/NA maintenance ends: 09:10 UTC = 16:10 ICT / 18:10 JST (JP typical end), 11:10 = 18:10 ICT / 20:10 JST (JP extension; NA typical end 04:00 PT), 15:10 = 22:10 ICT / 00:10 JST (late extensions), 19:10 = 02:10 ICT / 04:10 JST (NA anniversary end 12:00 PT).
- **Why:** `gh run list --event=schedule` (Nov 4–11 2026) showed GitHub throttled the */10 cron to 3–5 runs/day at random times (gaps 3.2–10.4h, avg 5.8h) — configured 144/day never happened. Fixed slots cost the same and land when Atlas data actually changes. Atlas has no outbound webhook; raw data lives on git.atlasacademy.io (not GitHub), so push-triggered sync is impossible without an external poller + repository_dispatch (considered, deferred).
- **Gate logic unchanged:** /info hash check, DO_WORK/DEPLOY gates, self-test skip-on-schedule all untouched. `scripts/test_deploy_workflow.py` gains scenario 10 pinning the cron string, trigger set, and UTC→ICT/JST mapping.
- **Known limit:** GitHub schedule is best-effort — a slot may be delayed or dropped under load; worst-case staleness ~14h (overnight gap 19:10→09:10 UTC). Hourly cron rejected: same throttling, no freshness guarantee. NA ends follow US Pacific time: in PST months (Nov–Mar) they land +1h UTC later than the PDT-based slot math, and the next slot catches them (NA typical ~3h, NA anniversary ~13h).
- **Docs synced:** AGENTS.md layout row, .claude/CLAUDE.md (browser-gate note, branch-flow trigger list, schedule bullet), fetch-data-guideline.md intro (was stale "hourly cron").

## 2026-11-12 — Event Shop planner: Atlas auto-sync + per-currency config modal

- **Feature:** Event tab gains a live event shop planner. `sync_event_shop()` (sync_atlas_data.py step 3, `--skip-event-shop` / `--event-id`) auto-picks the latest JP eventQuest (today: 80639 ぐだぐだぷにぷにウォーズ！), fetches its 55-item shop (3 currencies: MISOおでん bronze / SHIMONITAネギ silver / YAKIまんじゅう gold), resolves reward icons (item map / per-id equip faces / costume→servant face), downloads bordered-first WebP icons (plain fallback on 404 only — coins have no bordered asset; non-404 re-raises so the next sync retries), and generates `src/scripts/data/event_shop.js` (gitignored, zero-commit, CI-cached, in the deploy data-hash gate). Outage stub keeps builds alive; stub → legacy generic tier calculator.
- **UI (user directives, two rounds):** (1) planner card: items grouped by currency, filter chips, live totals. (2) Amendment A: "Shop Requirements" + "Drop Rates per Run" wear event currency images/names; Required became a read-only display; all configuration moved into per-currency draft modal #eventShopModal (house .servant-modal pattern, footer Default / Select All / Cancel / Done); planner rows became displays opening the same modal; card Buy all/Clear removed — modal is the sole mutation surface (`EventPlanner.applyRequires`). Plans persist per event (`fgo_event_shop_data`), reset on rotation. Buy-out totals verified from data: MISO 5740, SHIMONITA 5390, YAKI 6610.
- **New modules:** event-planner.js (app), event-planner-view.js + event-planner-parts.js (DOM, both ≤200 lines), event-shop-modal.js (draft controller, callback injection — no circular imports), event-shop-tier.js (tier skin); domain gains EventShop (maxRequire/clampRequire/rowCost/totals/clearRequires/sanitizeRequires/currencyForTier) + Schema.shopRequire; event-lazy wires planner→App order.
- **Gates (lead fresh runs):** npm run test 227/227; lint, validate_data, format:check exit 0; python suites: test_sync_event_shop 10, adversarial 5, deploy_workflow 10 (now pins the three deploy.yml edits), check_data_version 8, drift 10; build exit 0; check:build SUCCESS after two sanctioned drift-only baseline re-captures (planner card text, then modal text + event-lazy 5194→28263 B; zero assertion failures). Designer measured 46/46 on dev (draft isolation, clamp, footer semantics, tier Required=total, persistence, keyboard, 360/1120 zero overflow, zero pageerrors). QA browser gate scripts/test_event_shop.js rewritten to Amendment A contract, mutation-proven; final anchor recorded at delivery.
- **Known / deferred:** event names JP-only until Atlas EN translation lands; AC7 stub empty-state is code-read verified (bundled data can't exercise it in a prod browser); tier Required shows raw numbers (number input) while chips show formatted — intentional; event-shop.js 293 lines (pre-existing 260-line shape, legacy debt); main.js scroll-lock whitelist needed the .cefilter-modal-body co-class on #eventShopModalList (load-bearing, commented in index.astro).
- **Ops lesson:** two simultaneous `astro preview` launches race the daemon lock (second times out); preview binds IPv6-only by default — use `--host 0.0.0.0` for IPv4 clients. Kill daemons by PID only; `astro preview stop` kills every preview including the owner's.
- **Final QA anchor (lead re-run, 2026-11-12):** `node scripts/test_event_shop.js http://localhost:4173/fgo-calculator/` → exit 0, `SUCCESS: event shop Amendment A planner + modal verified`. Gate mutation-proven: 3 patched-dist mutants red exactly at their pins (clamp removed, onCommit no-op, stub data). Legacy fallback live-pinned against a string-patched bundle copy (recipe in gate header). Lead-fresh suite: 227/227 unit, lint/validate/check:build/format:check green, python suites 12+5+10+8+10 all exit 0. verify_render.js 0/6 red — all in pre-existing bond/CE flake zones (2026-11-11 ticket), zero planner-related reds. Review: 3 rounds (REJECT→7 fixes, REJECT→2 fixes, PASS zero findings).

## 2026-11-12 — Amendment B: planner card removed, modal-only Event Shop surface

- **User directive:** remove the standalone "Event Shop" planner card (the per-currency modal is the configuration surface); Required box height consistent with Held/Bonus; item icons displayed alone with bordered art, no grey background.
- **Changes:** #eventPlannerCard deleted from index.astro; event-planner-view.js deleted; EventPlanner state-only (70 lines: load/sanitize/applyRequires/itemsFor/persist); event-planner-parts.js pruned to the modal draft chain (99 lines, exports fmt + buildDraftRow); event-shop-tier.js adds material-icon--event on mapped tier icon boxes; BaseLayout: input.eshop-require-display stripped to editability cues (dashed border, cursor pointer — geometry inherited from .material-input-box-field, parity by construction), .material-icon--event { background: transparent }, .eshop-item-icon-fallback transparent + dashed badge, 23 dead card rules purged, dead reduced-motion selector removed. Legacy stub mode byte-identical (grey plate + editable Required stay).
- **Measured:** Required = Held = Bonus = 34×132px all three tiers; tier icon boxes + modal icons + fallback computed rgba(0,0,0,0); event imgs decoded 142px; 360/1120/1400 zero overflow, zero pageerrors.
- **Gates (lead fresh):** QA anchor `node scripts/test_event_shop.js http://127.0.0.1:4173/fgo-calculator/` exit 0 (gate re-targeted: card ABSENCE pins + parity + transparency; modal contract whole; legacy live-pinned; 3 mutants red at target pins only — min-height→7 parity errors, grey plate→4 icon errors, onCommit no-op→26 agreement errors). Build + check:build green (CSS-only change, no re-capture); 227/227 unit; lint/validate/format:check exit 0; python suites 12+5+10+8+10 exit 0. verify_render.js reds exclusively pre-existing bond/CE flake zones (§2026-11-11 ticket), zero planner mentions.
- **Review:** round 1 REJECT 8 🔵 (dead reduced-motion selector + 7 stale doc refs; code audit clean) → 8/8 fixed; round 2 PASS zero findings. Docs synced: README, CLAUDE.md, structure.md, code-style.md (card/view refs grepped empty; historical progress entries exempt).
- **Known / deferred:** hover background tint returns instantly while border animates 0.2s (🔵 accepted polish debt); headless Chrome reports (hover: hover)=false — gate pins hover via CSSOM rule scan; event-shop.js 293-line legacy shape unchanged.
