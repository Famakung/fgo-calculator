# Bond Slot Craft Essence Rework Implementation Plan

**Status: executed 2026-11-05, merged to `develop` in `d1c15c7` (commits `50e745e..7ab4a60`). Do not re-implement** — shipped behaviour is recorded in `.claude/CLAUDE.md` under **Bond Calculator** and the run log in `.claude/docs/progress.md`. Deviations from this plan are the `Ruling:` lines in `.superpowers/sdd/2026-11-05-bond-slot-ce-rework-plan/progress.md` while that scratch dir survives.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Bond Calculator's craft essence pickers out of their own card and into each servant slot, with a per-slot **Grand Servant** checkbox that raises that slot's capacity from one essence to two, and reorder the Bond tab so **Select Quest** sits above **Party Setup** with **Calculate Quest Runs** at the bottom right of the Party Setup card.

**Architecture:** Three-layer split already in place. The new rules (capacity, trimming, the party-wide pool, storage sanitising) go in `src/scripts/domain.js` as one pure object, `SlotCEs`, so they are unit-tested with `node --test` and no browser. `src/scripts/bond-app.js` keeps state + rendering: each slot owns `ces: []` and `grand: false`, and `calculate()` walks `SlotCEs.partyPool(slots)` instead of the old flat `state.ces`. Markup moves in `src/pages/index.astro`; every new rule goes into the single `<style is:inline>` block in `src/layouts/BaseLayout.astro`, which is the site's only stylesheet.

**Tech Stack:** Astro 7 static output, Vite 8 (Rolldown `codeSplitting.groups`), vanilla JS ES modules, no framework, no TypeScript at runtime, Puppeteer for the local browser gate.

**Spec:** `.claude/bond-grand-ce-slot.html` — the approved mock. Open it in a browser; it is interactive, renders at the site's real sizes, and carries the settled decisions this plan implements.

## Global Constraints

- Node >= 22.23.4 (`.nvmrc`). Run `node --version` before trusting a build.
- Build and dev from `/home/famakung/dev/fgo-calculator` (the btrfs clone). `astro build` fails on the `/mnt/storage` copy — see CLAUDE.md Known Issues.
- **Never `innerHTML`, `outerHTML` or `insertAdjacentHTML`.** `DOMFactory.el()` + `textContent` + `setAttribute()`; batch heavy renders with `DocumentFragment` → `replaceChildren()`.
- No external resources: no CDN scripts, fonts, or images. All assets same-origin `.webp`.
- JS: ES modules, 2-space indent, semicolons required, double quotes, `prefer-const`, `no-var`. `npm run lint` must stay clean; `npm run format` before committing.
- CSS: written once, in the `<style is:inline>` block in `src/layouts/BaseLayout.astro` (line 18). There is no `.css` file and no `npm run lint:css`. `:hover` rules go inside `@media (hover: hover)`, with `:active` after them for touch.
- Essence chip size: **64px tall**, `aspect-ratio: 142 / 155` (~58.6px wide). Do **not** raise `--ce-badge-h` (48px) — it also sizes the bond results card (`.bond-result-ce-img`, `.bond-result-ce-fallback`, `.bond-result-ce-maxbond-wrap`) and the Bond Gain CE tab (`.cefilter-chip img`, `.cefilter-match-badge`, `.grid-micro`, `.cefilter-combo-servant`). Add a new `--slot-ce-h` / `--slot-ce-w` pair.
- Essence chips show **portrait only** — no name, no bonus line in the slot. Name and bonus live in `alt` / `title` and in the results card.
- **The maths does not move.** Every equipped essence keeps boosting every servant, exactly as `calculate()` does today. This is a layout rework; `SlotCEs.partyPool()` exists to guarantee that.
- Old saves start **empty**: the top-level `ces[]` in `fgo_bond_calculator_data` is dropped on load, not dealt out to the cards. Every slot loads with `ces: []` and `grand: false`.
- Unticking **Grand Servant** with two essences equipped removes the **second** and keeps the **first**. No confirmation, no restore.
- A **Support** slot shows no Max Bond / Bond >= 15 row. A **Max Bond** slot keeps that row (the tick must stay undoable) but shows no level selects and no point box. In both cases those fields leave the layout, so the essence block moves up.
- Commit after every task. Branch: `feat/bond-slot-ce` off `develop`; `develop` is local-only, never merge it into `main` by hand (use `scripts/merge_code_only.sh`).

## Review Focus

The spec settles the happy path; these are the inputs most likely to bite, and each is pinned by a named test in the task that owns the code.

1. **A save that holds more essences than the slot's capacity** (three chips, `grand: false`) — load must clamp to one, keep the first, and render without throwing. Pinned in Task 2.
2. **An essence id in storage that no longer resolves in `CEById`** — the chip must still render (fallback tile with the id), still be removable, and `calculate()` must skip it rather than add a phantom bonus. Pinned in Task 1 (shape) and Task 3 (render).
3. **A support or Max Bond slot's essences** — collapsing those fields must not drop the slot's chips from the party pool; a support card that wears an essence still lifts the whole party, as today. Pinned in Task 1 and Task 4.
4. **A grouped essence entry (`{ groupId, optionId }`)** — the chip shows that option's image and name; an entry with `groupId` but no `optionId` is dropped at load, matching today's sanitiser. Pinned in Task 2.
5. **An empty slot** — no essence block at all (the card is the "Add Servant" tile), and a party of six blanks still reaches the existing `alert("Please select servants and enter bond required.")` path. Pinned in Task 3.

---

### Task 1: `SlotCEs` — the pure essence rules

Capacity, trimming, the party-wide pool and the storage shape live in one domain object so Tasks 2-4 have a single home to call and so every rule above is testable without a browser.

**Files:**
- Modify: `src/scripts/constants.js` (inside `BOND_CONSTANTS`, after `BOND_BONUS_LEVEL`)
- Modify: `src/scripts/domain.js` (add `export const SlotCEs` beside `BondLevelCalculator`)
- Test: `tests/bond-slot-ces.test.js` (create)

**Interfaces:**
- Consumes: nothing outside this task.
- Produces:
  - `BOND_CONSTANTS.MAX_CE_SLOTS = 1`, `BOND_CONSTANTS.GRAND_MAX_CE_SLOTS = 2`
  - `SlotCEs.capacity(slot) -> 1 | 2`
  - `SlotCEs.trim(slot) -> slot` (mutates `slot.ces` down to `capacity`, keeps the leading entries)
  - `SlotCEs.partyPool(slots) -> Array<entry>` (every slot's `ces`, slot order then position order, `null` holes skipped)
  - `SlotCEs.sanitize(rawCes, rawGrand) -> { ces: Array<entry>, grand: boolean }`
  - `SlotCEs.isValidEntry(entry) -> boolean`

- [ ] **Step 1: Write the failing test — capacity and trim**

`tests/bond-slot-ces.test.js`, matching the house style (`node:test` + `assert/strict`, no browser):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SlotCEs } from "../src/scripts/domain.js";

const slot = (ces, grand) => ({ ces, grand });

test("capacity is one, or two for a grand servant", () => {
  assert.equal(SlotCEs.capacity(slot(["2645"], false)), 1);
  assert.equal(SlotCEs.capacity(slot(["2645", "2198"], true)), 2);
});

test("unticking grand keeps the first essence and drops the second", () => {
  const trimmed = SlotCEs.trim(slot(["2645", "2198"], false));
  assert.deepEqual(trimmed.ces, ["2645"]);
});

test("trim never touches a list already inside its capacity", () => {
  assert.deepEqual(SlotCEs.trim(slot(["2645"], true)).ces, ["2645"]);
  assert.deepEqual(SlotCEs.trim(slot([], false)).ces, []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bond-slot-ces.test.js`
Expected: FAIL — `The binding 'SlotCEs' is not exported` (or `undefined`), not a passing run.

- [ ] **Step 3: Write the failing tests — pool, sanitiser, review-focus cases**

Append to the same file. These pin Review Focus 1, 3 and 4:

```js
test("the party pool keeps every slot's essence, in slot then position order", () => {
  const slots = [slot(["2645", "2198"], true), slot([], false), slot(["3031"], false)];
  assert.deepEqual(SlotCEs.partyPool(slots), ["2645", "2198", "3031"]);
});

test("a support slot's essence still joins the pool", () => {
  const slots = [slot(["2645"], false), slot(["3031"], false)];
  slots[1].type = "support";
  assert.deepEqual(SlotCEs.partyPool(slots), ["2645", "3031"]);
});

test("a missing or non-array list sanitises to empty", () => {
  assert.deepEqual(SlotCEs.sanitize(undefined, false), { ces: [], grand: false });
  assert.deepEqual(SlotCEs.sanitize("2645", true), { ces: [], grand: true });
});

test("sanitize drops malformed entries and keeps ids and group options", () => {
  const raw = ["2645", "", null, 42, { groupId: "0330", optionId: "0331" }, { groupId: "0330" }];
  assert.deepEqual(SlotCEs.sanitize(raw, "yes").ces, ["2645", { groupId: "0330", optionId: "0331" }]);
  assert.equal(SlotCEs.sanitize(raw, "yes").grand, true);
});

test("sanitize clamps a saved list to the slot's capacity, keeping the first", () => {
  assert.deepEqual(SlotCEs.sanitize(["2645", "2198", "3031"], false).ces, ["2645"]);
  assert.deepEqual(SlotCEs.sanitize(["2645", "2198", "3031"], true).ces, ["2645", "2198"]);
});
```

- [ ] **Step 4: Implement `SlotCEs` in `src/scripts/domain.js` and the two constants in `src/scripts/constants.js`**

`isValidEntry` is the shape rule `loadState()` already applies to the old pool (a non-empty string, or an object carrying both `groupId` and `optionId`) — copy that test rather than inventing a stricter one. `sanitize` runs `isValidEntry` then `trim`, so a save with three chips and `grand: false` clamps to one. `partyPool` reads `slot.ces || []` and skips falsy entries so a pending `null` hole never reaches `calculate()`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bond-slot-ces.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the whole suite and lint**

Run: `npm run test && npm run lint`
Expected: all existing suites still pass; no new lint warnings.

- [ ] **Step 7: Commit**

```bash
npm run format
git add src/scripts/domain.js src/scripts/constants.js tests/bond-slot-ces.test.js
git commit -m "feat(bond): add SlotCEs — per-slot essence capacity, pool and sanitising"
```

---

### Task 2: Per-slot essence state and persistence

Slots own their essences now. The top-level pool goes away, and an old save loads empty rather than being dealt out.

**Files:**
- Modify: `src/scripts/bond-app.js:8-20` (`defaultSlot`), `:72-81` (`init` state literal), `:1055-1113` (`loadState`)
- Test: `tests/bond-slot-ces.test.js` (append; reuse the Map-backed `localStorage` stub pattern from `tests/ce-filter-store.test.js:4-13`)

**Interfaces:**
- Consumes: `SlotCEs.sanitize`, `SlotCEs.trim`, `BOND_CONSTANTS.MAX_CE_SLOTS`, `BOND_CONSTANTS.GRAND_MAX_CE_SLOTS` (Task 1).
- Produces: `BondApp.state.slots[i].ces: Array<entry>`, `BondApp.state.slots[i].grand: boolean`. `BondApp.state.ces` no longer exists.

- [ ] **Step 1: Write the failing test — a save with the old pool loads empty**

Seed `fgo_bond_calculator_data` through the stub, then call `BondApp.loadState()`. It touches no DOM, so the stub is the whole harness:

```js
const blobs = new Map();
globalThis.localStorage = {
  getItem: (key) => (blobs.has(key) ? blobs.get(key) : null),
  setItem: (key, value) => blobs.set(key, String(value)),
};
const { BondApp } = await import("../src/scripts/bond-app.js");
const KEY = "fgo_bond_calculator_data";

test("the old top-level pool is dropped, not dealt out to the slots", () => {
  blobs.set(
    KEY,
    JSON.stringify({ slots: [{ servantId: "105", ces: ["2645"], grand: true }], ces: ["2198", "3031"] }),
  );
  const state = BondApp.loadState();
  assert.equal(state.ces, undefined);
  assert.deepEqual(state.slots[0].ces, ["2645"]);
  assert.equal(state.slots[0].grand, true);
  assert.deepEqual(state.slots[1].ces, []);
  assert.equal(state.slots[1].grand, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bond-slot-ces.test.js`
Expected: FAIL — `state.ces` is still the filtered old pool and `slots[1].ces` is `undefined`.

- [ ] **Step 3: Add the two fields to `defaultSlot()` and sanitise them in `loadState()`'s `sanitize()`**

`defaultSlot()` gains `ces: []` and `grand: false` (this is the house's single slot-shape home — every create, clear and padding path already routes through it). In `loadState`'s `sanitize(s)`, spread the result of `SlotCEs.sanitize(s.ces, s.grand)` into the returned slot, and delete the `ces:` key from the object `loadState` returns plus the `Array.isArray(data.ces)` filter block. A save whose `grand` is a stray string becomes `true` through `Boolean`, which is what `sanitize` already does.

- [ ] **Step 4: Drop the pool from `init()`'s fresh state literal**

Remove `ces: []` from the object built at `bond-app.js:76-81`. Leave `buildCESlots()` in place for now — Task 3 removes it along with its caller at `:103`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bond-slot-ces.test.js`
Expected: PASS.

- [ ] **Step 6: Prove a round-trip clamps over-capacity saves**

Add to the test file: write `{ slots: [{ servantId: "105", ces: ["2645", "2198", "3031"], grand: false }] }`, load, assert `slots[0].ces` is `["2645"]` (Review Focus 1). Then `saveState()` and re-read the blob to confirm the clamped list is what persists, not the original three.

- [ ] **Step 7: Run the suite, lint, commit**

```bash
npm run test && npm run lint && npm run format
git add src/scripts/bond-app.js tests/bond-slot-ces.test.js
git commit -m "feat(bond): store craft essences per servant slot"
```

---

### Task 3: Render the essence block inside the slot

The card gains a bordered **Craft Essence** block holding the Grand Servant tick and up to two 64px portrait chips; the separate "Craft Essences Bonus" card and the flat pool renderer go.

**Files:**
- Modify: `src/scripts/bond-app.js:51-70` (`_createCECallbacks`), `:166-301` (`buildCESlots`, `setCE`, `removeCE` — delete and replace), `:639-660` (end of the point box, where the block is appended), `:700-870` (`calculate()`'s pool loop)
- Modify: `src/pages/index.astro:421-427` (delete the Craft Essences Bonus card)
- Modify: `src/layouts/BaseLayout.astro` (the `<style is:inline>` block: new tokens + chip rules)
- Modify: `scripts/verify_render.js` (new assertions in the bond block at `:558-588`)
- Test: `scripts/verify_render.js` is the test for this task — the DOM has no unit-test harness in this repo.

**Interfaces:**
- Consumes: `SlotCEs.capacity`, `SlotCEs.trim`, `SlotCEs.partyPool` (Task 1); `slot.ces` / `slot.grand` (Task 2); `CEById`, `TraitNames`, `DOMFactory.createLazyImg`, `DOMFactory.addSimpleFallback`.
- Produces:
  - `BondApp.setCE(slotIndex, position, ceId, optionId)`
  - `BondApp.removeCE(slotIndex, position)`
  - `BondApp.addCE(slotIndex, position)` — writes a `null` hole at `position`, opens the picker pending, and `onPendingRemove` splices it back out (the house **Pending Slot** pattern)
  - `BondApp._buildSlotCEs(slotData, slotIndex) -> HTMLElement` (`.slot-ce-block`)
  - `BondApp._ceBonusText(ce, ceEntry) -> string` — the `title` / `alt` text, moved verbatim out of the deleted `buildCESlots()` name/bonus branch
  - CSS tokens `--slot-ce-h: 64px`, `--slot-ce-w: calc(var(--slot-ce-h) * 142 / 155)`

- [ ] **Step 1: Add the failing browser assertions**

In `scripts/verify_render.js`, after the existing bond-slot block (it already fills one slot through the picker), assert the shipped page:

```js
// the essence block belongs to the card, not to a card of its own
const ce = await page.evaluate(() => {
  const card = document.querySelector(".servant-slot:not(.servant-add-slot)");
  const block = card && card.querySelector(".slot-ce-block");
  const chips = block ? block.querySelectorAll(".ce-chip").length : 0;
  return {
    grid: !!document.getElementById("ceGrid"),
    inCard: !!block,
    afterPointBox: !!block && !!card.querySelector(".bond-input-box") &&
      Boolean(block.compareDocumentPosition(card.querySelector(".bond-input-box")) & Node.DOCUMENT_POSITION_PRECEDING),
    chipH: chips ? block.querySelector(".ce-chip").getBoundingClientRect().height : 0,
    chips,
    names: block ? block.querySelectorAll(".ce-slot-name, .ce-slot-bonus").length : -1,
  };
});
```

Fail (`errors.push`) when: `ce.grid` is true (the old card survived), `ce.inCard` false, `ce.afterPointBox` false, `ce.chipH` is not `64`, `ce.chips` is not `1` for a non-grand slot, or `ce.names` is not `0` (a name or bonus line leaked back in). Then tick the slot's Grand Servant box (`page.click(".servant-slot .slot-ce-block .bond-checkbox")`), re-read, and require `chips === 2`; untick and require `chips === 1` again (the second chip is gone, the first survives).

- [ ] **Step 2: Run the gate to verify it fails**

Run: `npm run build && npx astro preview --port 4173 && node scripts/verify_render.js http://localhost:4173/fgo-calculator/`
(`astro preview` is a detached daemon in Astro 7, so the chain continues while it serves; stop it with `npx astro preview stop`. The URL is passed because the gate defaults to `http://localhost:3000/fgo-calculator/`.)
Expected: `[ERROR] bond slot: …` for the essence block, exit 1.

- [ ] **Step 3: Add the CSS**

In the `<style is:inline>` block: the two tokens in `:root`, then `.slot-ce-block` (relative, full width, `margin-top: 10px`, `padding: 9px 6px 7px`, `border: 2px solid var(--border)`, `border-radius: 8px`, flex column, `gap: 7px`), its floating label reusing `.bond-input-box-label` unchanged (its `background: var(--bg)` already matches the slot's own background), `.slot-ce-strip` (`display: flex; gap: 4px; justify-content: center`), `.ce-chip` (`width: var(--slot-ce-w); height: var(--slot-ce-h); position: relative; border-radius: 4px; cursor: pointer`), `.ce-chip-img` / `.ce-chip-fallback` (same size, `object-fit: contain`, fallback on `var(--border)`), `.ce-chip--add` (dashed `var(--accent)` on `var(--accent-light)`, `+` glyph), `.ce-chip-x` (15px circle at `top: -5px; right: -5px`, `var(--error)`), and `.ce-chip:hover` **inside `@media (hover: hover)`**. Two chips plus the 4px gap measure 121px against the 124px the block has left, so the gap must stay 4px.

- [ ] **Step 4: Write `_buildSlotCEs(slotData, slotIndex)`**

Build `.slot-ce-block` with `DocumentFragment` and `replaceChildren`. Contents, in order: the `Craft Essence` label, a `.bond-checkbox-row` holding one `.bond-checkbox-label` with the **Grand Servant** checkbox (reuse the existing classes — no new checkbox CSS), then `.slot-ce-strip` with one child per position under `SlotCEs.capacity(slotData)`: a filled chip (`<img class="ce-chip-img">` via `createLazyImg`, `alt` = essence name, `title` = `` `${name} · ${this._ceBonusText(ce, ceEntry)}` ``, a `.ce-chip-x` button, click re-opens the picker) or, for an empty or `null` position, a `.ce-chip--add` tile that calls `addCE(slotIndex, position)`. An entry that `CEById.get()` does not resolve renders `.ce-chip-fallback` with the id as its text (Review Focus 2) and keeps its remove button. `_ceBonusText(ce, ceEntry)` is the flat-bonus / `traitGroups` / `matchAll` branch lifted out of the deleted `buildCESlots()` verbatim — it now feeds `title` instead of a visible `.ce-slot-bonus`.

- [ ] **Step 5: Rewire the picker callbacks to (slot, position)**

Replace `_createCECallbacks(slotIndex)` with `_createCECallbacks(slotIndex, position)`, closing over both and ignoring the index the selector passes back — the same way the current code ignores `_slotIdx`. `CESelector.open()` and `CESubSelector.open()` need no change: they only carry the number through to `onPendingRemove`.

- [ ] **Step 6: Replace `setCE` / `removeCE`, add `addCE`, delete `buildCESlots`**

`setCE(slotIndex, position, ceId, optionId)` writes into `slot.ces[position]` (group entries as `{ groupId, optionId }`), `removeCE(slotIndex, position)` splices that position, `addCE(slotIndex, position)` sets it to `null`, calls `buildServantSlots()` and opens the picker pending with `onPendingRemove` splicing the hole. Delete `buildCESlots()` and its call in `init()`; call `this._buildSlotCEs(...)` from `buildServantSlots()` right after the point box is appended, for filled slots only (Review Focus 5).

- [ ] **Step 7: Point `calculate()` at the pool**

Swap `this.state.ces.forEach((ceEntry) => {` for `SlotCEs.partyPool(this.state.slots).forEach((ceEntry) => {` — the body is untouched, so every servant keeps gaining from every equipped essence. `calculate()` reads `document`, so it has no unit test; the ordering guarantee is already pinned by `partyPool` in Task 1, and Task 4's gate block asserts a support slot's chips survive the collapse.

- [ ] **Step 8: Delete the CE card markup**

Remove the whole `<div class="card">` carrying `Craft Essences Bonus` and `div#ceGrid` from `src/pages/index.astro`. Leave the `.ce-grid` CSS rules alone — they are shared with `.grid`, `.bond-result-servant-grid` and the Bond Gain CE grids.

- [ ] **Step 9: Re-capture the build gate, then run it**

The page's visible text lost the "Craft Essences Bonus" title and `bond-lazy` changed size, so both text signatures and the byte floors move:

```bash
npm run build
node scripts/check_build_output.js            # expected: [ERROR] text signature / bytes drifted
node scripts/check_build_output.js --write    # re-captures measurements only; refuses if a chunk or <head> marker moved
node scripts/check_build_output.js            # expected: SUCCESS
```

- [ ] **Step 10: Run the browser gate and the suite**

Serve `dist/` (`npx astro preview --port 4173`, then `astro preview stop` after) and run `node scripts/verify_render.js http://localhost:4173/fgo-calculator/`; then `npm run test && npm run lint`.
Expected: gate `SUCCESS: rendered UI verified`, 64px chips, second chip on Grand, all unit tests pass.

- [ ] **Step 11: Commit**

```bash
npm run format
git add src/scripts/bond-app.js src/pages/index.astro src/layouts/BaseLayout.astro scripts/verify_render.js scripts/build_baseline.json
git commit -m "feat(bond): move craft essences into the servant slot at 64px"
```

---

### Task 4: Collapse the hidden bond fields

Support and Max Bond slots stop reserving the height of the fields they hide, so the essence block moves up into that space.

**Files:**
- Modify: `src/scripts/bond-app.js:483-487` (support checkbox row), `:557-577` (`levelBox`), `:618-646` (level row + point box)
- Modify: `src/layouts/BaseLayout.astro` (drop the now-unused `--hidden` rules)
- Modify: `scripts/verify_render.js` (new assertions)

**Interfaces:**
- Consumes: `_buildSlotCEs` (Task 3).
- Produces: no `--hidden` classes anywhere in the bond panel; `isBondHidden` gates creation instead of visibility.

- [ ] **Step 1: Write the failing browser assertions**

In the bond block of `scripts/verify_render.js`, for a slot switched to **Support** and for one ticked **Max Bond**, fail when: any `.bond-level-row` or `.bond-input-box` exists inside that `.servant-slot`; a `.bond-checkbox-row` exists inside a **support** slot; a `.bond-checkbox-row` is **absent** from a **Max Bond** slot (the tick must stay undoable); or the slot's `.slot-ce-block` is not the last child of `.servant-slot-info`. Also fail when the support slot's chips are missing — collapsing fields must not collapse the essence block.

- [ ] **Step 2: Run the gate to verify it fails**

Run: `npm run build && npx astro preview --port 4173 && node scripts/verify_render.js http://localhost:4173/fgo-calculator/`
Expected: `[ERROR]` rows naming the reserved-height fields.

- [ ] **Step 3: Create the fields only when they are shown**

In `buildServantSlots()`, wrap the level row and the point box in `if (!isBondHidden) { … }` and the checkbox row in `if (!isSupport) { … }`. Delete the `bond-input-box--hidden` / `bond-checkbox-row--hidden` branches, the `disabled` / `tabIndex = -1` attributes that went with them, and the `this.elements` guards that keyed off `isBondHidden` — an uncreated field is never in `this.elements`, which `flushInputsToState()` and `calculate()` already handle with `if (input)`. `slot.bondLevel`, `slot.targetLevel` and `slot.bondNeeded` stay in state untouched, so switching back to Normal restores the player's figures.

- [ ] **Step 4: Drop the dead CSS**

Remove `.bond-checkbox-row--hidden, .bond-input-box--hidden { visibility: hidden; pointer-events: none; }` from the `<style is:inline>` block. Confirm nothing else references either class:
`grep -rn "bond-input-box--hidden\|bond-checkbox-row--hidden" src/ scripts/`
Expected: no hits.

- [ ] **Step 5: Run the gate and the suite**

Build, preview, `node scripts/verify_render.js http://localhost:4173/fgo-calculator/`, then `npm run test && npm run lint`.
Expected: gate green; the support and Max Bond cards measure shorter than a Normal card (the mock measured 98px on Max Bond, 117px on Support at 64px chips).

- [ ] **Step 6: Re-capture and commit**

```bash
node scripts/check_build_output.js --write
git add src/scripts/bond-app.js src/layouts/BaseLayout.astro scripts/verify_render.js scripts/build_baseline.json
git commit -m "feat(bond): collapse hidden bond fields so the essence block moves up"
```

---

### Task 5: Quest card above Party Setup, calculate button inside it

**Files:**
- Modify: `src/pages/index.astro:414-468` (`#panel-bond` children)
- Modify: `src/layouts/BaseLayout.astro` (`.bond-card-actions`)
- Modify: `scripts/verify_render.js` (order + alignment assertions)

**Interfaces:**
- Consumes: nothing new.
- Produces: `#panel-bond` in the order `Select Quest` card, `Party Setup` card (grid then `#bondCalculateBtn`), results; `#bondResults` and every id unchanged.

- [ ] **Step 1: Write the failing browser assertions**

Fail when: `#bondQuestSelect`'s card does not come before `#servantGrid`'s card in `#panel-bond`; `#bondCalculateBtn` is not a descendant of the Party Setup `.card-inner`; or the button's width is more than half its card's inner width (it must sit bottom-right, not stretch). Keep `#calculateBtn` (Event Shop tab) asserted as full width so the override is proven scoped.

- [ ] **Step 2: Run the gate to verify it fails**

Run: `npm run build && npx astro preview --port 4173 && node scripts/verify_render.js http://localhost:4173/fgo-calculator/`
Expected: `[ERROR]` on the order and the button's parent.

- [ ] **Step 3: Move the markup**

In `#panel-bond`, lift the whole `Select Quest` `<div class="card">` above the `Party Setup` card, and move `<button class="calculate-btn" id="bondCalculateBtn">` out of the section body into a new `<div class="bond-card-actions">` placed after `div#servantGrid`, inside the Party Setup `.card-inner`. Copy the button's label text exactly: `Calculate Quest Runs`.

- [ ] **Step 4: Add the scoped CSS**

`.bond-card-actions { display: flex; justify-content: flex-end; margin-top: 12px; }` and `.bond-card-actions .calculate-btn { width: auto; padding: 12px 24px; }`. The second rule is scoped, so the Event Shop tab's `#calculateBtn` keeps its full-width `.calculate-btn`.

- [ ] **Step 5: Run the gate, the suite, and check the build**

```bash
npm run build
node scripts/check_build_output.js --write && node scripts/check_build_output.js
node scripts/verify_render.js http://localhost:4173/fgo-calculator/          # after `npx astro preview --port 4173`
npm run test && npm run lint
```
Expected: all green. The page text reordered, so the two signatures move again — that is what `--write` is for.

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/pages/index.astro src/layouts/BaseLayout.astro scripts/verify_render.js scripts/build_baseline.json
git commit -m "feat(bond): put quest select above party setup and the calculate button inside it"
```

---

### Task 6: Documentation and live check

**Files:**
- Modify: `.claude/CLAUDE.md` (Bond Calculator feature bullets, Key Files, Known Issues if the collapse surprises anyone)
- Modify: `.claude/docs/progress.md` (mark the rework done, tick the checklist entries it closes)
- Modify: `AGENTS.md`, `GEMINI.md` (same contract for non-Claude agents — all four files are tracked and must stay in step)

**Interfaces:**
- Consumes: the shipped class names, ids and the `SlotCEs` API from Tasks 1-5.
- Produces: docs that match the code.

- [ ] **Step 1: Update the docs**

Record in `CLAUDE.md` under **Bond Calculator**: essences are per-slot (`slot.ces`, `slot.grand`) with capacity 1, or 2 when Grand; the pool is `SlotCEs.partyPool(slots)` and the maths is unchanged (every essence boosts every servant); chips are portrait only at `--slot-ce-h: 64px`; support and Max Bond collapse their fields instead of reserving height; old saves load with nothing equipped; unticking Grand drops the second essence. Note the Bond tab order (Select Quest, then Party Setup with the calculate button bottom right) and that `#ceGrid` is gone. Mirror the same facts into `AGENTS.md` and `GEMINI.md`, and add a line to `progress.md`.

- [ ] **Step 2: Verify the docs name things that exist**

```bash
grep -n "SlotCEs\|slot-ce-block\|ce-chip\|--slot-ce-h" src/scripts/*.js src/layouts/BaseLayout.astro | head
grep -rn "ceGrid\|buildCESlots\|state.ces" src/ scripts/
```
Expected: the first finds every name the docs cite; the second finds nothing.

- [ ] **Step 3: Check the page by eye, then commit**

`npm run build`, `npx astro preview --port 3000`, open `/fgo-calculator/` on the Bond tab, and confirm: quest card first, party cards with essence chips under the point box, Grand adds a second chip, support card shows no checkbox row and no level selects, calculate button bottom right of the party card, results still list the applied bonuses per servant.

```bash
git add .claude/CLAUDE.md .claude/docs/progress.md AGENTS.md GEMINI.md
git commit -m "docs(bond): record the per-slot craft essence rework"
```
