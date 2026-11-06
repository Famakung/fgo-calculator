# Fluid Desktop Layout — Design

Date: 2026-11-04
Status: ready for owner approval
Status note (2026-11-04): **not built, and no longer describing the shipped site.** The owner chose magnification instead — `zoom` on `<html>` = `window.innerWidth / 1400` (it started at 1280), capped at 2, committed as `02df7e8` on `develop` and merged to `main` as `a8f7185`. The "No `zoom`" constraint in Non-goals is therefore already broken by design, and the facts below about `max-height: 80vh` and the 1120px rail have changed: viewport units now run through `--screen-h`, and wide windows render the 1280 layout scaled up rather than the fluid one this document proposes. Read it as the rejected alternative it became; if the fluid rail is ever wanted, re-derive it against the zoom script instead of assuming `zoom` is off. See the "Wide-screen magnification" bullet in `.claude/CLAUDE.md`.
Location note: `.claude/docs/` is tracked now (since 2026-11-04, through `.claude/*` plus negations in `.gitignore`), so this document and its plan commit normally from where they sit — no `git add -f`. Repo-root `docs/` and `design-docs/` stay ignored; superseded implementation plans live in `.claude/docs/archive/`.

File note: every `global.css` line number below (2349, 2385, 2434, 2458, 892-893, 1232-1233, 141) and the `critical.css` reference point at files that have since been **deleted**. `src/styles/` no longer exists; the entire site stylesheet is the single `<style is:inline>` in `src/layouts/BaseLayout.astro`, and there is no `npm run lint:css`. The two-copy symmetry requirement in "Constraints" is gone with them.

## Intent

The site's desktop layout stops growing at 1120px while cards stop growing at 160px. On a 1920px window that is roughly 800px of unused horizontal space, and every label is drawn inside a card that was never allowed to widen. Because the cards are capped, text was pushed down to fit them: 22 rules render at 11.2px or smaller, the smallest at 8.3px.

Two symptoms of one cause:

- The owner reads the site comfortably at Windows 125% display scaling and finds the same page small at 100%.
- Other users report the font looks too small on their screens.

This design fixes the cause: let the layout use the width it is given, and let type rise with the room it then has. It deliberately does not detect the visitor's display scale.

## Goals

1. A desktop window wider than today's cap uses that width, growing toward about 1600px of content instead of leaving dead margins on both sides.
2. Column count is derived from available width rather than hand-tuned per breakpoint, so a wide window shows more than six cards in a row.
3. No user-facing label renders below 12px anywhere, at default browser settings, on any viewport the site supports.
4. Phone and tablet layout is otherwise unchanged: same grid behaviour, same cards per row at the same widths. Because the text floor applies at every width, small-screen labels do get taller, and any selector that then clips or wraps on a 360px or 414px viewport is walked back rather than shipped.
5. Large-display users at Windows 125% get the same improvement: their 1536px effective viewport now uses 1536 instead of 1120. The owner's original wish — "make it look like my screen" — is satisfied by the layout filling width, not by magnification.
6. Paginated grids keep full rows: the number of cards on a CE Filter page follows the columns the grid actually produced.

## Non-goals

- No `zoom`, no `resolution: 1dppx` gate, no JavaScript device-scale detection. Reasons: `1dppx` is a guess at "100% scaling" that misreads 4K panels reporting device pixel ratio 2, Linux fractional scaling, and any visitor using browser zoom; and it would double-magnify visitors already above 100%.
- No migration of layout properties from `px` to `rem`. `global.css` holds about 374 `px` usages against 73 `rem` ones; that refactor is its own project.
- No redesign of the mobile grid. `.grid-sm` and the sub-580px rules keep their structure; only text floors inside them change.
- No change to the Event Shop or Bond calculators' behaviour, state, or math.

## Anti-goals

- A row of two servant slots stretched to half the screen each. That is what `auto-fit` does to a sparse grid; `auto-fill` is required.
- Bigger cards that still contain 8px labels. Growing the card without lifting the text floor would leave the reported complaint unfixed.
- Text raised so far that badges wrap, clip, or overflow their portrait tiles — on desktop or on a phone.
- A page of CE Filter results with a ragged bottom row on every page, because the CSS widened and the JS still thinks there are six columns.
- A layout that only looks right at 1920px, breaks at 2560px, or shifts the page while it loads.

## Repository facts that constrain the change

- Every responsive tier exists twice in CSS: `src/styles/global.css` lines 2349 (`>=580px`), 2385 (`>=760px`), 2434 (`>=940px`), 2458 (`>=1120px`), and a mirror copy inside the inline critical `<style>` in `src/layouts/BaseLayout.astro:18`. They must stay symmetric, or first paint uses one set of thresholds and the async stylesheet corrects it, which is a layout shift for exactly the users this change is for.
- A third copy of the same thresholds lives in JavaScript: `CEFilterApp._getPageSize()` at `src/scripts/ce-filter-app.js:92-96` maps `window.innerWidth` to 2/3/4/5/6 columns, multiplies by 5 rows, and feeds pagination at `:616-622`. It is the only copy that is not CSS, and it is the one nobody remembers.
- `critical.css` contains no media queries; it holds the base shell, including `min-height: 100vh` (lines 65 and 75) and the same in `global.css:141`.
- Root `font-size` is never set, so all 70 `font-size` rules resolve against 16px. The small ones: `0.52rem` (8.3px) on `.servant-slot-badge-scope` and `.servant-slot-badge-percent--single`; `0.55rem` (8.8px) on `.cefilter-trait-tag`; `0.6rem` (9.6px) on `.cefilter-ascension-label`, `.servant-remove-btn`, `.material-input-box-label`, `.ce-filter-check`; `0.65rem` (10.4px) in six rules; `0.7rem` (11.2px) in ten rules.
- The result grids — `.grid`, `.bond-result-servant-grid`, `.ce-grid`, `.cefilter-results-grid`, `.ceoverlap-grid` — share `display: grid`, `justify-content: center`, `gap: 8px`, and a per-tier `grid-template-columns` of `repeat(N, minmax(0, 160px))` (eight such sites).
- Portrait and badge sizes flow from three root custom properties: `--portrait-lg: 96px`, `--servant-portrait-h: 96px`, `--ce-badge-h: 48px`. No JavaScript sets image `width`/`height` attributes, so art sizing is CSS-only.
- `content-visibility: auto` with `contain-intrinsic-size: auto 208px` at `global.css:892-893` and `1232-1233` encodes today's card height.
- `.card-inner` is the content inset inside every `.card`, and its margin is stepped per tier: 6.4px, then 12.4, 18.4, 24.4, 30.4px.
- Modals are `position: fixed; inset: 0`, with `.servant-modal-content` width stepped per tier (360px, 720px at `>=940px`, 900px at `>=1120px`) and `max-height: 80vh`; `.cefilter-modal-body` uses `max-height: calc(80vh - 80px)`.
- The build gate `scripts/check_build_output.js` measures JS chunk names, per-chunk byte floors and ceilings, `<head>` marker order, and page-text hashes recorded in `scripts/build_baseline.json`. Because the pagination change moves JavaScript, `ce-filter-chunk` bytes will move and `--write` re-capture is expected.

## Decisions the owner made

- Fill target: content grows to about 1600px, not edge-to-edge. Rejected: no cap (a 2560px monitor gets one unreadable row), and a 1400px cap (a small step that leaves 1080p and 1440p windows still under-filled).
- Magnification-based approaches were put forward and set aside in favour of the responsive layout.
- Small text is fixed by raising the root font size on desktop, in addition to the floor, rather than by hand-setting 22 individual rules.
- `_getPageSize()` derives its column count from the rendered grid, rather than keeping a staircase in JavaScript or accepting partial rows.
- The 12px floor applies at every width, phones included. Chosen over a desktop-only floor, which would leave a visitor on a 900px window reading 8.3px badges and would mean roughly 22 media-gated duplicates.

## My calls, not the owner's

- `repeat(auto-fill, minmax(160px, 220px))` on the result grids. The `minmax` upper bound of 220px keeps a row of eight or nine cards from looking like stretched posters; `auto-fill` keeps sparse grids card-sized. `justify-content: center` is retained so a partially filled row centres as it does today.
- Root font size steps at 17px from `>=760px` and 18px from `>=1120px`, placed in the existing tier blocks so the dual CSS copies stay symmetric. The base stays 16px, so phones keep their current scale and only receive the floor lift.
- The floor itself is written in `rem` against the 16px base — nothing under `0.75rem` — so it does not depend on the desktop step.
- The staircase inside the tier blocks that carry grid columns is deleted, not extended, because column count no longer depends on it. The declarations sharing those blocks that are not about columns — `.card-inner` margin, `.container` max-width, `.servant-modal-content` width, `.navbar-tabs`, `.grid-sm`, the sub-760px check-mark offsets — keep their behaviour and are re-expressed against the new width range.
- `.container` gets `max-width: min(1600px, 100%)` at the wide end instead of a hard-coded fifth tier, so the 1600px target and the smaller caps coexist.
- `_getPageSize()` reads the number of tracks the grid actually laid out (from the computed `grid-template-columns` of the results container, resolved once per render rather than per card) and keeps 5 rows, so pages stay full at any width. The element is measured only when the grid is in the document, and the existing 2-column value remains the fallback if measurement is unavailable.

## Left to the builder

- Whether `.card-inner`'s stepped margin becomes a `clamp()` and, if so, its endpoints.
- The final type value per component above the floor. `.cefilter-trait-tag` and the slot badges are narrow by design, and lifting their text may need the badge widened as well.
- Whether `--servant-portrait-h` and `--ce-badge-h` rise on wide screens, how far, and how `contain-intrinsic-size: auto 208px` follows the resulting card height.
- Whether `.servant-modal-content` gains a wider step near the 1600px content width. The CE picker is the densest UI in the app.
- How the column count is measured in `_getPageSize()`, as long as it reflects the rendered tracks and is not re-derived from viewport thresholds.

## Verification

- Screenshots at 1366, 1536, 1920 and 2560 CSS px at device pixel ratio 1, plus 1920 at device pixel ratio 1.25 to confirm scaled visitors are unaffected or better.
- Screenshots at 360 and 414 CSS px, since the floor now applies on phones. Every badge, trait tag, and material label is checked for wrapping and clipping at those widths.
- One screenshot per tab (Event Shop, Bond, CE Filter with both sub-tabs) with real data at 1920, plus one sparse Bond slot row of two servants to prove no stretching.
- A CE Filter page at a wide window checked for a full bottom row, which is the thing `_getPageSize()` now has to get right.
- `npm run lint`, `npm run test`, then `npx astro preview` (port 3000, the only port this project serves on) followed by `node scripts/verify_render.js`.
- `npm run check:build`, expecting `ce-filter-chunk` to move and `--write` re-capture to be needed.
- `npm run lighthouse` against a running server, compared with current numbers, watching LCP and CLS.
- No horizontal scroll at any width tested.
