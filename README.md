# FGO Calculator

A web-based calculator for Fate/Grand Order with two tools: **Event Shop Calculator** for optimizing event item farming and **Bond Calculator** for planning bond point farming.

**Live at:** https://famakung.github.io/fgo-event-calculator/

## Features

### Event Shop Calculator
- Input bronze, silver, and gold event items needed/owned
- Configure bonus drop amounts per material type
- Adjust base drops and primary/secondary multipliers
- Automatically calculates optimal quest runs
- Saves inputs to localStorage

### Bond Calculator
- Dynamic servant slots (add/remove, no limit) with portraits
- Three servant types: Normal, Support (no calculation), Max Bond (+25% to all)
- Craft Essence bonus system with trait-based matching
- Frontline bonus (+20%) for first 3 slots
- Frontline support bonus (+4%) when support is in frontline
- Quest presets (FreeQuest Lv.83/84, GrandDuel Lv.100) or custom bond per run
- Per-servant results with bond breakdown and run count

## Usage

### Event Shop
1. Enter shop requirements (items needed) and current holdings
2. Set bonus amounts and drop rate multipliers
3. Click "Calculate Quest Runs"

### Bond Calculator
1. Add servants and select from the portrait modal
2. Choose servant type (Normal/Support/Max Bond)
3. For Normal servants, enter bond points needed
4. Add Craft Essences for bonus traits
5. Select a quest
6. Click "Calculate Runs"

## CE Trait Matching

Craft Essences apply bonuses based on servant traits with three modes:

| Mode | Field | Behavior |
|------|-------|----------|
| **OR** | `traits` array | Servant needs ANY matching trait |
| **AND** | `traits` + `matchAll: true` | Servant must have ALL traits |
| **AND/OR** | `traitGroups` | Each group OR-matched; ALL groups must match |

## File Structure

```
fgo-event-calculator/
├── index.html              # Main HTML with tab panels and modals
├── styles.css              # CSS with custom properties and grid layouts
├── app.js                  # All logic in single IIFE (~1670 lines)
├── data/
│   ├── traits.js           # Trait ID to display name mapping
│   ├── servants.js         # Servant data with trait arrays
│   └── craft_essences.js   # CE data with traits/matchAll/traitGroups
├── servants/               # Servant portraits ({ID}_1.webp)
├── craft_essences/         # CE images ({ID}.webp)
└── icons/                  # UI icons (bond_icon.webp, fp_icon.webp)
```

## Architecture

The application follows a clean 3-layer architecture within a single IIFE:

| Layer | Modules | Purpose |
|-------|---------|---------|
| **Domain** | Schema, Validator, Calculator | Pure business logic, no DOM |
| **Application** | StateManager, Persistence, App, BondApp | State management and coordination |
| **Presentation** | DOMFactory, UIBuilder, ViewManager, EventHandler, TabNavigator, ServantSelector, CESelector | DOM manipulation, modals, events |

## Technical Details

- Vanilla JavaScript with no external dependencies (except Google Fonts)
- All images in WebP format
- Content Security Policy (CSP) for XSS protection
- All DOM elements created safely with `createElement()` (no innerHTML)
- Data files use `var` globals via `<script>` tags for `file://` compatibility
- Schema-based input validation with localStorage sanitization
- Debounced input handlers (100ms)
