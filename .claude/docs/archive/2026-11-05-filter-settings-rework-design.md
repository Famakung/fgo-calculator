# Filter Settings Rework — Design

Date: 2026-11-05. Status: approved by the owner 2026-11-05. The `<button>` widening stands as written, and
rarity keeps the shipped ★0 → ★5 order. Built natively in the main session, no reviewer subagent.
Plan: `.claude/docs/archive/2026-11-05-filter-settings-rework-plan.md`.

## Intent

The Bond Gain CE "Filter Settings" modal offers three rows (class, rarity, CE match count). A player
looking for a bond CE wants to narrow by what the game itself prints on the servant screen: class
group, the two alignment axes, sub-attribute. This rework turns the modal into seven labelled, divided
sections and makes the same set available in the servant picker's Filter Settings sub-modal, which
today duplicates the class and rarity rows by hand.

## Goals

- Seven sections in one column, each with a centred label above centred chips, hairline rule between sections.
- Class (Group) narrows the class row: chips outside the chosen group render greyed and inert.
- One shared builder for all three places that hand-roll these rows today.
- The rows match on the traits the data already carries. No new data, no sync change.

## Non-goals

- No persistence of these filters. They stay page-scoped and reset on refresh, exactly as today.
- No new `Category` control. The word appears only in the first section's label.
- The CE Overlap modal (`#ceOverlapModal`, `#ceOverlapFilterArea`, `CEServantOverlap` in `selectors.js`) keeps
  its compact class + rarity + count rows. It is not titled "Filter Settings".
- No change to Grand Duel quest pricing, parties, or the Bond tab's slot logic.

## Anti-goals

- Three more copies of the row-building code. There are already three; the rework must not make it four.
- A hand-maintained servant-id list per group. Every group is a list of class trait ids.
- Chip sizes under 48px.

## The sections (eight as built — Gender was added after approval)

| # | Label (centred) | Chips, in this order | State key | Trait ids |
|---|---|---|---|---|
| 1 | Rarity | ★0 ★1 ★2 ★3 ★4 ★5 | `rarityFilters` (exists) | `0400`–`0405` |
| 2 | Class | 7 standard then 8 extra icons | `classFilters` (exists) | `0100`…`0124` |
| 3 | Class (Group) | Three Knights · Four Cavalries · Extra I · Extra II | `groupClassFilters` (new) | class ids |
| 4 | Alignment (Lawful/Neutral/Chaotic) | Lawful · Neutral · Chaotic | `aliFilters` (new) | `0300` `0302` `0301` |
| 5 | Alignment (Good/Balanced/Evil) | Good · Balanced · Evil · Other | `subAliFilters` (new) | `0303` `0305` `0304` + Other |
| 6 | Sub-Attribute | Heaven · Earth · Human · Star · Beast | `subAttrFilters` (new) | `0200`–`0204` |
| 7 | Gender | Male · Female · Unknown | `genderFilters` (added after approval, 2026-11-06) | `0001` `0002` `0003` |
| 8 | CE Bonus | one button per CE count that occurs in the results | `matchCounts` (exists) | — |

Rarity order is ascending (★0 first), as `RARITY_FILTERS` already spells it; the owner's sketch listed ★5
first, which is the open question this document does not settle.

### Group contents (`CLASS_GROUPS`, new, in `constants.js`)

| key | label | classes |
|---|---|---|
| `knight` | Three Knights | `0100` Saber, `0102` Archer, `0101` Lancer |
| `cavalry` | Four Cavalries | `0103` Rider, `0104` Caster, `0105` Assassin, `0106` Berserker |
| `extra1` | Extra I | `GRAND_EXTRA_I` — `0107` `0108` `0110` `0115` |
| `extra2` | Extra II | `GRAND_EXTRA_II` — `0109` `0117` `0120` `0124` |

`GRAND_CLASSES` (Bond tab quest picker) is untouched. The two lists may share arrays; the quest picker is
not the filter modal and must not change behaviour because of it.

### Matching rules

- **Union inside a row, AND across rows.** A servant survives if, for every row with at least one chip
  selected, its merged trait list contains at least one of that row's ids. An empty row is no filter.
- Traits are read from the same list the class and rarity rows already read: the servant's base traits in
  the picker, the resolved ascension's traits on a Bond Gain CE result card.
- **Class scope.** `groupClassFilters` unions into a scope of class ids. The class row renders every class,
  greying those outside the scope; a greyed chip cannot be clicked. Selections already held outside the
  scope are ignored rather than dropped, so clearing the group brings them back. This is
  `Quest.pickedClassIds(picked, scope)` (`domain.js:442`) applied one step outward — the same shape as the
  Grand Duel lock, which today *removes* out-of-scope buttons instead of greying them.
- **Alignment "Other".** The chip is the complement of `0303`/`0304`/`0305`, not a trait id. It covers the
  31 servants with neither Good, Balanced nor Evil (Fionn mac Cumhaill among them) and therefore picks up
  Madness (`0306`, 3 servants) and Summer (`0308`, 28). It is one state value that a predicate resolves,
  because there is no trait to compare against.
- Servants carry both alignment axes at once (`008` Helena Blavatsky: `0301` Chaotic + `0303` Good), so the
  two rows are independent filters, never alternatives of one row.

## Shared builder

`src/scripts/filter-sections.js` (new), Layer 3 presentation — it touches the DOM, so it is not domain.

- Declarative section list: label, chip list, state key, size class (`class-btn` / `rarity-btn` /
  `ce-count-btn`), optional disabled predicate.
- `render(container, state, onChange)` builds every section the caller asks for and wires clicks. `onChange`
  is the caller's existing "state moved, re-render" step (`CEFilterApp._debouncedRender`,
  `ServantSelector.filter`).
- Callers keep their own state objects; the builder reads and writes the named keys only.
- `CEFilterApp` (`ce-filter-app.js:335`, `:376`) drops `buildClassFilter` / `buildRarityFilter` and calls the
  builder with all seven rows, `matchCounts` last.
- `ServantSelector` (`selectors.js:279`, `:319`) drops `_buildClassFilter` / `_buildRarityFilter` and calls it
  with six rows — no CE Bonus, because the picker has no CE picks to count.
- `syncPickerControls()` keeps its job: a quest lock still bounds which classes exist, and now also greys
  every group chip that has no class in common with that lock.
- The CE Bonus row stays the existing `buildMatchCountFilter` (`ce-filter-app.js:471`), relocated into a
  section of its own.

## Markup

`src/pages/index.astro`: both `.cefilter-modal-body` blocks (`#servantFilterModal` line ~703,
`#cefilterFilterModal` line ~825) become a single empty container the builder fills, so the section list has
one home. `#ceOverlapFilterArea` keeps its three hand-built rows.

## CSS

All in the one `<style is:inline>` block in `src/layouts/BaseLayout.astro` (there is no other stylesheet):

- `.cefilter-modal-section` — column, label above chips.
- `.cefilter-modal-label` — centred, small, `--text-secondary`, weight 700.
- `.cefilter-modal-divider` — 1px `--border`, full width of the body.
- `.class-btn--disabled` / `.rarity-btn--disabled` / `.ce-group-btn--disabled` — greyed, `cursor: default`,
  no pointer events, no hover or active border.
- `.ce-group-btn` — text chip on the `.rarity-btn` 48×36 floor, `width: auto` so "Four Cavalries" fits.
- Chip rows keep `display: flex; flex-wrap: wrap; justify-content: center; gap: 4px`.

Modal height is the owner's accepted option A: one column, body scrolls. `.cefilter-modal-body` already has
`overflow-y: auto` and `max-height: calc(var(--screen-h) * 0.8 - 80px)`; nothing new is required, and no
`vh` unit may be introduced (the zoom magnifier only cancels it through `--screen-h`).

## Accessibility

- Section labels are real text nodes associated with their row (`id` + `aria-labelledby` on the row).
- Chips become `<button type="button">` with `aria-pressed`, and the greyed class chips get `disabled`.
  The rows are `<div>`s with click handlers today, which are not keyboard reachable. This is a deliberate
  small widening of scope: the rework is what makes the disabled state load-bearing, and a `<div>` cannot
  carry it. Existing classes and sizes are unchanged.

## Verification

- New unit tests for the pure parts in `tests/`: the class scope rule, the "Other" complement, one AND step
  per selected row, group unions. `npm run test` stays browserless; predicates live in `domain.js` so they
  are testable there.
- `scripts/check_build_output.js`: the new module joins no `codeSplitting.groups` entry, so it lands in a
  shared chunk. Re-run `npm run build && npm run check:build` and confirm the pinned chunk names, floors and
  head order still hold; if the builder must be pinned, that is a baseline update, not an assertion rewrite.
- `scripts/verify_render.js`: add a block that opens `#cefilterFilterModal`, ticks Three Knights, asserts the
  eight out-of-scope class chips are disabled and the six standard-group chips are not, ticks Extra I back on
  and asserts the union, then asserts a Lawful + Good + Earth pick narrows the grid.
- Manual: `npm run build`, `npx astro preview`, then the served build at `localhost:3000`, which the owner
  tests by hand.

## Docs to update after the code lands

`.claude/CLAUDE.md` (Bond Gain CE bullet), `AGENTS.md`, `GEMINI.md`, `.claude/docs/structure.md` (Bond Gain CE
UI paragraph), `.claude/docs/code-style.md` (Patterns: the shared filter builder), and this file's status line.

## Left to the builder

Exact label casing, chip order inside a row where the sketch is silent, the divider's margin, whether the
"Other" chip prints as `Other` or `Other ✕`, and how the greyed chips are grouped in the DOM.

## Open question for the owner

Rarity chips ★0→★5 (as shipped today) or ★5→★0 (as the sketch shows)?
