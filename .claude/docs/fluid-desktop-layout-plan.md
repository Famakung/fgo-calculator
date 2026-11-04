# Fluid Desktop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status (2026-11-04): do not start this plan as written.** The owner chose magnification instead; `zoom` on `<html>` = `window.innerWidth / 1400` (first shipped as `/ 1280`) capped at 2, starting from `02df7e8` (merged to `main` as `a8f7185`), so the Global Constraint "Do not use `zoom`" is already lifted by the site itself, and Task 1's rail/column numbers were measured on a page that now renders the 1280 layout scaled. If this plan is picked up later, re-baseline every CSS-px expectation against the zoom script first, and note that viewport units must use `--screen-h`, not `vh`. See "Wide-screen magnification" in `.claude/CLAUDE.md`.

**Goal:** Let the desktop layout use its width up to a 1600px content rail with fluid card columns, raise desktop type with the root font size, put a 12px floor under every label, and make CE Filter pagination follow the columns it actually rendered.

**Architecture:** CSS only for layout and type, in two synchronized copies (`src/styles/global.css` is the editable source, the flattened copy of it inside the `<style is:inline>` at `src/layouts/BaseLayout.astro:18` is what ships). One new pure helper in the Domain layer (`domain.js`) counts grid tracks from a computed style string; the Application layer (`ce-filter-app.js`) calls it instead of its own `window.innerWidth` staircase.

**Tech Stack:** Astro 7 + Vite 8 (Rolldown), vanilla ES modules, no TypeScript at runtime, `node --test` for pure-domain tests, Puppeteer for the browser gate.

**Spec:** `.claude/docs/fluid-desktop-layout-design.md` (same directory). Read it before Task 1; the values here come from it.

## Global Constraints

- Node >= 22.23.4 (`node --version` before trusting any build). Build and dev from `/home/famakung/dev/fgo-calculator`, not the `/mnt/storage` copy.
- Shipped CSS is only the single `<style is:inline>` line at `src/layouts/BaseLayout.astro:18`. `src/styles/global.css` and `src/styles/critical.css` are **not linked or imported anywhere** — editing them alone ships nothing. Every CSS declaration changed in this plan is changed in both `global.css` and the inline block.
- The inline block is `global.css` with line breaks collapsed: it keeps `property: value; ` spacing, so the strings in this plan match in both files. Never rewrite the inline block wholesale; use `Edit` on the exact declaration.
- DOM safety: no `innerHTML`, `createElement()` + `textContent` + `setAttribute()` only (`code-style.md`).
- JS style: double quotes, semicolons, 2-space indent, `printWidth: 120`. File names kebab-case.
- Never shorten or delete an existing comment.
- Do not use `zoom`, no `resolution: 1dppx` gate, no device-scale detection.
- Commit per task with the repo's Conventional Commits style, ending with the `Co-Authored-By: Claude Code <noreply@anthropic.com>` line the session reminder supplies.

## Review Focus

Failure classes the spec implies that no task's own test list covers by default. Each line gets its test in the named task.

1. **Sparse grid stretching.** One or two servant slots in `.grid` must stay card-sized and centred, never split the row. `auto-fill`, not `auto-fit`. Expected: 2 slots at 1920 render 2 cards of <=220px with empty space beside them, not 2 cards of ~790px. (Task 1)
2. **Sub-12px text surviving the floor on the small screen.** The floor applies at every width, so a phone's `.cefilter-trait-tag`, `.cefilter-ascension-label` and slot badges get taller inside 176px cards. Expected: nothing wraps to a second line, nothing clips, no card grows past its neighbour's row. (Task 2)
3. **Measuring a grid that is not laid out.** `getComputedStyle(...).gridTemplateColumns` returns `"none"` while the panel is hidden, and a naive count then says 1 column, which turns a 30-item page into 45 pages. Expected: 2 columns (today's phone value) as fallback, never 1. (Task 4)
4. **The two CSS copies disagreeing.** A declaration added to `global.css` and missed in the inline block ships nothing, or ships a first paint that the async stylesheet then corrects, which is a layout shift for exactly the users this work is for. Expected: the sync grep reports every new string present in both files, on every CSS task. (Tasks 1, 2, 5)
5. **The 1600px rail and very wide windows.** At 2560 CSS px the content must stop at 1600 and centre, with no horizontal scroll and no row of 14 unreadably thin cards. Expected: 9 columns at 1600, 9 at 2560, content centred. (Task 1)

**Deferred from this plan** (the spec left each to the builder; these are the calls, so a reviewer does not hunt for them): portraits and CE badges keep `--servant-portrait-h: 96px` and `--ce-badge-h: 48px` — the wider cards are what give the lifted labels room, and growing art at the same time would confound the clipping check. `.card-inner`'s stepped margin (6.4/12.4/18.4/24.4/30.4px) stays stepped, because it sizes the outer `.card` and has nothing to do with column count. `.servant-modal-content` keeps its 360/540/720/900px steps; the CE picker is the only modal that would want the 1600 rail, and that is a separate complaint.

---

### Task 1: Fluid result grids and the 1600px rail

**Files:**
- Modify: `src/styles/global.css:506-516` (the shared `.grid` block)
- Modify: `src/styles/global.css:2365-2371`, `2393-2401`, `2442-2450`, `2462-2478` (the `grid-template-columns` lines inside the four tier blocks)
- Modify: `src/styles/global.css:2464` (`.container { max-width: 1120px; }` in the `>=1120px` block)
- Modify: `src/layouts/BaseLayout.astro:18` (same five edits inside the inline block: the `.grid, .bond-result-servant-grid, ... { grid-template-columns: repeat(2, minmax(0, 160px)); }` rule and the `@media (width >= 580px)`, `>=760px`, `>=940px`, `>=1120px` blocks)
- Test: none (pure CSS; the check is the browser gate in Task 6 and the greps below)

**Interfaces:**
- Consumes: nothing.
- Produces: the rule `repeat(auto-fill, minmax(160px, 220px))` on `.grid` and friends. Task 4 counts the tracks this rule produces, through `getComputedStyle` on `#cefilterResults` (which carries `class="cefilter-results-grid grid"`, `src/pages/index.astro:568`).

- [ ] **Step 1: Confirm the starting state**

Run: `grep -n "minmax(0, 160px)" src/styles/global.css | wc -l`
Expected: `7`

Run: `awk 'NR==18' src/layouts/BaseLayout.astro | grep -o "minmax(0, 160px)" | wc -l`
Expected: `7` — the two copies really do agree today.

- [ ] **Step 2: Rewrite the shared grid rule in `global.css:506-516`**

Only the `grid-template-columns` line changes, and the comment situation stays as it is. New value:

```css
  grid-template-columns: repeat(auto-fill, minmax(160px, 220px));
```

Keep `display: grid`, `justify-content: center`, `gap: 8px` exactly as written. The `.grid-sm` rule at `:519-528` is a different grid (class/rarity chips) and does not change.

- [ ] **Step 3: Delete the per-tier column staircases**

Remove the `grid-template-columns` declarations at these sites, and only these:

| Line | Selector group | Declaration to delete |
|------|----------------|---------------------|
| 2371 | `.grid, .bond-result-servant-grid, .ce-grid, .cefilter-results-grid, .ceoverlap-grid` | `repeat(3, minmax(0, 160px))` |
| 2397 | `.bond-result-servant-grid, .ce-grid, .cefilter-results-grid` | `repeat(4, minmax(0, 160px))` |
| 2401 | `.ceoverlap-grid` | `repeat(3, minmax(0, 160px))` |
| 2446 | `.bond-result-servant-grid, .ce-grid, .cefilter-results-grid` | `repeat(5, minmax(0, 160px))` |
| 2450 | `.ceoverlap-grid` | `repeat(4, minmax(0, 160px))` |
| 2470 | `.bond-result-servant-grid, .ce-grid, .cefilter-results-grid` | `repeat(6, minmax(0, 160px))` |
| 2478 | `.ceoverlap-grid` | `repeat(5, minmax(0, 160px))` |

Where deleting a declaration empties a rule, drop the whole rule (the `>=940px` and `>=1120px` `.ceoverlap-grid` rules go entirely). Leave everything else in those blocks untouched: `.navbar-tabs`, `.navbar-hamburger`, `.card-inner` margins, `.container` caps, `.servant-modal-content`, `.grid-sm`, and the `.ceoverlap-ce-filter` rules (its `minmax(0, 140px)` is not one of the seven).

Note for the reviewer: `.ceoverlap-grid` loses its one-column-behind behaviour and now takes the shared track rule. That is intentional — it is the same card at the same width, and the modal's own `max-width` is what limits it.

- [ ] **Step 4: Widen the rail**

At `global.css:2464`, replace the `>=1120px` block's container cap:

```css
  .container {
    max-width: min(1600px, 100%);
  }
```

`>=580px` (580), `>=760px` (760) and `>=940px` (940) keep their caps: with a fluid track count the cap is a readability rail, not a column switch, and the small-screen ramp stays as it is today.

- [ ] **Step 5: Mirror all of it into the inline block**

Apply steps 2-4 to the `<style is:inline>` content at `src/layouts/BaseLayout.astro:18`. The strings to look for there, flat form:

```
.grid, .bond-result-servant-grid, .ce-grid, .cefilter-results-grid, .ceoverlap-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 160px));
```
```
@media (width >= 1120px) { .card-inner { margin: 30.4px; } .container { max-width: 1120px; }
```
and the four `grid-template-columns: repeat(N, minmax(0, 160px));` occurrences inside the `>=580px`, `>=760px`, `>=940px`, `>=1120px` blocks.

- [ ] **Step 6: Verify the two copies agree**

Run: `grep -c "minmax(0, 160px)" src/styles/global.css` and `awk 'NR==18' src/layouts/BaseLayout.astro | grep -c "minmax(0, 160px)"`
Expected: both exit non-zero with `0` — no old track rule left in either copy.

Run: `for f in src/styles/global.css src/layouts/BaseLayout.astro; do printf "%s " "$f"; grep -o "repeat(auto-fill, minmax(160px, 220px))" "$f" | wc -l; done`
Expected: `1` then `1`.

Run: `for f in src/styles/global.css src/layouts/BaseLayout.astro; do printf "%s " "$f"; grep -o "max-width: min(1600px, 100%)" "$f" | wc -l; done`
Expected: `1` then `1`. (Review Focus 4)

- [ ] **Step 7: Build and look at it**

```bash
npm run lint:css
npm run build
npx astro preview
node scripts/verify_render.js
```
Expected: lint clean, build green, the gate prints its usual pass list. `astro.config.mjs` sets `preview.port` to 3000 and `verify_render.js` defaults to `http://localhost:3000/fgo-calculator/`, so no flag is needed — 3000 is the only port this project serves on.

Then check the widths by hand, with a throwaway Puppeteer probe (Review Focus 1, 5):

```bash
node -e '
const puppeteer = require("puppeteer");
(async () => {
  const b = await puppeteer.launch(), p = await b.newPage();
  for (const w of [360, 580, 760, 940, 1120, 1440, 1920, 2560]) {
    await p.setViewport({ width: w, height: 900 });
    await p.goto("http://localhost:3000/fgo-calculator/", { waitUntil: "networkidle0" });
    const m = await p.evaluate(() => {
      const g = document.getElementById("cefilterResults");
      const c = getComputedStyle(g).gridTemplateColumns;
      return { tracks: c.split(" ").filter(Boolean).length, trackW: Math.round(parseFloat(c)),
               scroll: document.documentElement.scrollWidth > window.innerWidth,
               container: Math.round(document.querySelector(".container").getBoundingClientRect().width) };
    });
    console.log(w, JSON.stringify(m));
  }
  await b.close();
})();'
```
Expected: 360 → 2 tracks, 580 → 3, 760 → 4, 940 → 5, 1120 → 6 (today's counts, slightly wider cards), 1440 → 7, 1920 → 8, 2560 → 9 with `container: 1600`, `scroll: false` everywhere, `trackW` never above 220.

Also visit the Bond tab with one or two servants and confirm those slot cards stay card-sized and centred, not stretched (Review Focus 1).

- [ ] **Step 8: Commit**

```bash
git add src/styles/global.css src/layouts/BaseLayout.astro
git commit -m "feat(layout): fill desktop width with fluid card columns"
```

---

### Task 2: Desktop type scale and the 12px floor

**Files:**
- Modify: `src/styles/global.css:455, 501, 644, 651, 725, 805, 1279, 1295, 1311, 1377, 1496, 1779, 1827, 1860, 2009` and the ten `font-size: 0.7rem` rules at `421, 434, 673, 695, 707, 788, 795, 1285, 2080, 2146`
- Modify: `src/styles/global.css` inside the `>=760px` and `>=1120px` tier blocks (`:2385`, `:2458` area after Task 1 shifted lines)
- Modify: `src/layouts/BaseLayout.astro:18` (every matching rule, plus the two `:root` steps)
- Test: the greps in Step 4

**Interfaces:**
- Consumes: Task 1's wider cards, which is what gives the lifted labels room.
- Produces: no new export; type values only. Task 5 re-measures card height against this.

- [ ] **Step 1: Lift the floor**

In `src/styles/global.css`, change every `font-size` value below `0.75rem` to `font-size: 0.75rem`. 26 rules: `0.52rem` (2), `0.55rem` (1), `0.6rem` (4), `0.65rem` (6), `0.68rem` (1), `0.7rem` (10), and `font-size: 10px` (1, `.mini-icon .icon-fallback:2009`). `0.75rem` and above stay as written. The line numbers above are from before Task 1's deletions — locate each rule by its selector, not by line.

Keep any comment that sits above a rule you touch.

- [ ] **Step 2: Add the desktop steps**

Inside the `>=760px` block and the `>=1120px` block, add one declaration each:

```css
  :root {
    font-size: 17px;
  }
```

and `font-size: 18px;` in the `>=1120px` block. The base stays unset (16px), so phones keep their current scale and receive only the floor.

- [ ] **Step 3: Mirror into the inline block**

The inline `<style>` holds a flattened copy of these same rules — it contains `.cefilter-trait-tag` and `.servant-slot-badge-scope` today — so each of the 26 values and both `:root` steps must be written there too. The head copy also carries the `>=760px` sub-tab pin rules; do not disturb them.

- [ ] **Step 4: Verify no sub-12px type remains in either copy**

Run:

```bash
for f in src/styles/global.css src/layouts/BaseLayout.astro; do
  printf "%s " "$f"
  grep -oE "font-size: *0\.[0-6][0-9]*rem|font-size: *(8|9|10|11)px" "$f" | wc -l
done
```
Expected: `0` then `0`. (Review Focus 4)

Run: `for f in src/styles/global.css src/layouts/BaseLayout.astro; do printf "%s " "$f"; grep -o "font-size: 1[78]px" "$f" | wc -l; done`
Expected: `1` then `1` per file.

- [ ] **Step 5: Check for wrapping and clipping, small screens included**

```bash
npm run build && npx astro preview && node scripts/verify_render.js
```
Expected: gate green.

Then the phone pass, which is the point of Review Focus 2: at 360 and 414 CSS px, open CE Filter, pick a servant, and look at `.cefilter-trait-tag`, `.cefilter-ascension-label`, `.ce-filter-check`, the slot badges (`.servant-slot-badge-scope`, `.servant-slot-badge-percent--single`) and `.material-input-box-label` on the Event tab. Nothing may wrap to a second line, clip, or push a card past `min-height: 208px` unevenly.

Run: `node -e` with the Task 1 probe at widths 360 and 414, extended with
`document.querySelectorAll(".cefilter-trait-tag").length` and each element's `scrollWidth > clientWidth` count.
Expected: `0` overflowing elements. Any selector that fails gets its own value walked back in place, with a `shortcut:` comment naming the component, rather than shipping clipped text.

- [ ] **Step 6: Commit**

```bash
git add src/styles/global.css src/layouts/BaseLayout.astro
git commit -m "feat(styles): raise desktop type scale and put a 12px floor under every label"
```

---

### Task 3: `GridColumns` in the Domain layer

**Files:**
- Create: `tests/grid-columns.test.js`
- Modify: `src/scripts/domain.js` (add one export beside `Validator` and `TraitMatcher`)

**Interfaces:**
- Consumes: nothing.
- Produces: `GridColumns.count(trackStyle: string | null) -> number` — the number of tracks in a computed `grid-template-columns` value; `0` when there is nothing to count. Task 4 is its only caller.

- [ ] **Step 1: Write the failing test**

`tests/grid-columns.test.js`, following `tests/servant-combo.test.js` (`import { test } from "node:test"`, `import assert from "node:assert/strict"`, import from `../src/scripts/domain.js`):

```js
test("counts the tracks a computed grid value describes", () => {
  assert.equal(GridColumns.count("166px 166px 166px 166px"), 4);
  assert.equal(GridColumns.count("160px"), 1);
});

test("counts nothing when the grid has no layout", () => {
  // A hidden panel reports "none", and an element off the document reports "".
  assert.equal(GridColumns.count("none"), 0);
  assert.equal(GridColumns.count(""), 0);
  assert.equal(GridColumns.count(null), 0);
});

test("tolerates the whitespace browsers vary on", () => {
  assert.equal(GridColumns.count("  160.5px   160.5px "), 2);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test`
Expected: FAIL, `GridColumns is not exported` / not defined.

- [ ] **Step 3: Implement `GridColumns.count`**

In `src/scripts/domain.js`, one small object export named `GridColumns`, with `count(trackStyle)` returning the count of non-empty, non-`"none"` whitespace-separated tokens (`String(trackStyle).trim().split(/\s+/).filter(...)`, with the empty input guarded so `null` and `""` yield 0). One `/* ... */` line above it saying why it exists: the shipped grid now decides its own column count, so the JS must read that number instead of re-deriving it from `window.innerWidth`.

- [ ] **Step 4: Run the tests**

Run: `npm run test`
Expected: PASS, all four files green.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/domain.js tests/grid-columns.test.js
git commit -m "feat(domain): count rendered grid tracks"
```

---

### Task 4: Pagination follows the rendered columns

**Files:**
- Modify: `src/scripts/ce-filter-app.js:1-12` (the `domain.js` import) and `:92-96` (`_getPageSize`)
- Modify: `scripts/verify_render.js` (one new assertion, next to the existing `#cefilterResults` check at `:107`)
- Modify: `scripts/build_baseline.json` (via `--write`, Step 5)

**Interfaces:**
- Consumes: `GridColumns.count(trackStyle)` from Task 3; the track rule from Task 1, through `getComputedStyle` on `#cefilterResults`.
- Produces: `_getPageSize() -> number`, still `columns * 5`, used unchanged at `:616-622`.

- [ ] **Step 1: Write the failing browser assertion**

In `scripts/verify_render.js`, after the block that reads `#cefilterResults > .cefilter-servant-card` (line 107), assert the page holds whole rows:

```js
const pageRows = await page.evaluate(() => {
  const g = document.getElementById("cefilterResults");
  const tracks = getComputedStyle(g).gridTemplateColumns.split(" ").filter((t) => t && t !== "none").length;
  return { tracks, cards: g.children.length };
});
```

The probe counts tracks itself rather than calling `GridColumns.count`, so the check stays independent of the code under test.

Fail the run when `tracks < 2`, when `pageRows.cards !== pageRows.tracks * 5`, or when `tracks <= 6` at the gate's viewport — the gate runs at a wide viewport today, and this change is what makes the columns exceed six. Match the file's existing failure style (it prints a labelled problem and exits non-zero; no new framework).

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run build && npx astro preview
node scripts/verify_render.js
```
Expected: FAIL — `cards` is still `30` (6 columns x 5) while `tracks` is now 8, so the whole-row check trips.

- [ ] **Step 3: Rewrite `_getPageSize()`**

Add `GridColumns` to the existing `import { TraitMatcher, Validator } from "./domain.js";` line, then replace the body of `_getPageSize()` at `ce-filter-app.js:92-96` so that it:

1. reads `document.getElementById("cefilterResults")`;
2. counts tracks with `GridColumns.count(getComputedStyle(grid).gridTemplateColumns)`;
3. falls back to `2` columns when the count is `0` — a hidden panel reports `"none"`, and 1 column would multiply the page count for no reason (Review Focus 3);
4. returns `columns * 5`, keeping today's row count;
5. keeps the existing `const w = window.innerWidth;` removed rather than left as dead code, and carries a `shortcut: <limit>, <when to upgrade>` comment naming the one known limit — a render that happens while the panel is hidden pages 10 at a time until the next render.

The existing comment above `_getPageSize`, if any, stays.

- [ ] **Step 4: Run it to make sure it passes**

```bash
npm run test
npm run lint:js
npm run build && npx astro preview
node scripts/verify_render.js
```
Expected: unit tests green, lint clean, gate green including the new whole-row assertion.

- [ ] **Step 5: Re-capture the chunk baseline**

`ce-filter-chunk` bytes move, because JavaScript changed. The gate will fail on the ceiling/floor pair first:

```bash
npm run check:build
node scripts/check_build_output.js --write
npm run check:build
```
Expected: the first run reports the drift, `--write` records the new measurement, the second exits 0. Commit the regenerated `scripts/build_baseline.json` — the spec's own note that no re-capture was needed was wrong, and this is the correction.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/ce-filter-app.js scripts/verify_render.js scripts/build_baseline.json
git commit -m "feat(ce-filter): page by rendered columns, not innerWidth"
```

---

### Task 5: Card height hints after the growth

**Files:**
- Modify: `src/styles/global.css` — both `min-height: 208px` and both `contain-intrinsic-size: auto 208px` sites (`:890`/`:893` and `:1231`/`:1233` before Task 1 shifted lines)
- Modify: `src/layouts/BaseLayout.astro:18` (same four values)

**Interfaces:**
- Consumes: the final card width (Task 1) and the final type (Task 2).
- Produces: nothing consumed later; it keeps the scrollbar and the off-screen grid honest.

- [ ] **Step 1: Measure what a card really is now**

With the build from Task 4 still served on 3000:

```bash
node -e '
const puppeteer = require("puppeteer");
(async () => {
  const b = await puppeteer.launch(), p = await b.newPage();
  await p.setViewport({ width: 1920, height: 900 });
  await p.goto("http://localhost:3000/fgo-calculator/", { waitUntil: "networkidle0" });
  console.log(await p.evaluate(() => [...document.querySelectorAll("#cefilterResults > *")].slice(0, 6)
    .map((el) => Math.round(el.getBoundingClientRect().height))));
  await b.close();
})();'
```
Expected: a list of heights. If every value is `<= 208`, the current hint is still right and this task ends here: write nothing, commit nothing, say so in the PR note.

- [ ] **Step 2: Update both hint pairs**

Otherwise, set `min-height` and `contain-intrinsic-size` to the tallest measured height rounded up to the next 8px, in all four declarations across both files. The two properties belong to the same card and must not drift apart.

- [ ] **Step 3: Verify**

Run: `for f in src/styles/global.css src/layouts/BaseLayout.astro; do printf "%s " "$f"; grep -o "auto 208px" "$f" | wc -l; done`
Expected: `0` then `0`, or `2` then `2` if step 1 stopped the task.

Run: `npm run lint:css && npm run build && npx astro preview && node scripts/verify_render.js`
Expected: all green, and the CE Filter results page shows no vertical jump while scrolling (the `content-visibility: auto` rows keep their reserved height).

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css src/layouts/BaseLayout.astro
git commit -m "fix(styles): match card height hints to the grown card"
```

---

### Task 6: Whole-sweep proof

**Files:**
- Modify: `.claude/docs/fluid-desktop-layout-design.md` (only if a stated value turned out wrong — record the correction there, not in chat)

- [ ] **Step 1: Every check in the repo**

```bash
node --version          # expect v22.23.4 or newer
npm run lint
npm run test
npm run format:check
npm run build
npm run check:build
npx astro preview
node scripts/verify_render.js
```
Expected: all green. `npm run format:check` on a CSS file this large may flag lines this plan did not touch — if so, note it and do not reformat unrelated rules.

- [ ] **Step 2: Screens for the owner**

Capture the four surfaces at 1366, 1536, 1920 and 2560 CSS px at devicePixelRatio 1, plus 1920 at devicePixelRatio 1.25 (the owner's own setting, to confirm the change helps rather than fights it), plus 360 and 414 for the floor: Event Shop with data, Bond with 6 slots and one with 2, CE Filter Craft Essence Select with results, CE Filter Servant Select with a row. Save under `scratch/` (untracked) and hand the owner the list, since 220px and the 17/18px steps were my numbers, not measured ones.

- [ ] **Step 3: Performance, not assumed**

`lighthouse-runner.js` expects a server on `localhost:3000`. `astro preview` is a detached daemon and now defaults to 3000 from `astro.config.mjs`, so no `--port` flag and no `&`:

```bash
npx astro preview
npm run lighthouse
npx astro preview stop
```
Expected: LCP and CLS within the project's current numbers. Bigger above-fold portraits and a wider container can move both. Report the actual figures; if CLS regressed, the cause is almost certainly the two CSS copies disagreeing or a stale `contain-intrinsic-size`, so return to Task 1 Step 6 and Task 5.

- [ ] **Step 4: Commit any doc correction and report**

```bash
git add -f .claude/docs/fluid-desktop-layout-design.md 2>/dev/null; git status --short
```
Expected: a clean tree apart from intentional doc tracking, then a summary of what shipped, what the owner must still look at, and every value the screens changed from the plan.
