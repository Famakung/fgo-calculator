---
name: fgo-servant-data-converter
description: >-
  Provides comprehensive architecture guidelines, CLI conversion workflows, web server and UI standards,
  Happy Eyeballs networking procedures, and formatting conventions for FGO Servant Data Converter and Viewer.
  Use this skill when developing, testing, maintaining, or refactoring the FGO Servant Data Converter repository.
---

# FGO Servant Data Converter & Viewer Skill

This guide outlines architecture conventions, formatting schemas, networking rules, and UI standards for the **FGO Servant Data Converter & Viewer** repository (`fgo-servant-data-converter`).

---

## 1. System Architecture & Components

The project provides dual interfaces (Web UI and CLI) with zero external runtime dependencies, built purely on Python's standard library and Vanilla JavaScript ES Modules.

| Layer / File | Responsibility | Standards & Constraints |
| :--- | :--- | :--- |
| `web_server.py` | `ThreadingHTTPServer` serving the web UI and REST API (`/api/servants`, `/api/servant/<id>`, `/api/health`, `/<id>/raw.txt`). | Must run on port 3000 by default. Streams CDN assets without saving locally. 100% in-memory RAM caching. Returns structured `formatted` presentation models and `formConfig`. |
| `web/` (`index.html`, `style.css`, `app.js`) | Single-page servant explorer and markdown converter viewer. | Zero emojis, native system fonts, exterior navigation buttons, uncropped Saint Graph artwork, URL-driven raw mode. Mounts directly from `svt.formatted` with zero regex text parsing. |
| `servant_formatter.py` | Master presentation builder (`build_formatted_servant`, `format_profile_structured`) and markdown serializer (`formatted_to_md`, `convert`). | Implements `api -> formatted -> md` data pipeline; web server runs purely in memory without disk writes. |
| `fetcher.py` | Network engine with Happy Eyeballs curl acceleration and in-memory session caching. | Uses system curl with HTTP/2 and Happy Eyeballs to prevent IPv6 peering stall bugs. Zero local disk writes to `raw/`. |
| `function_formatter.py` | Effect-to-text dispatch engine parsing skill/NP functions. | Uses `_CoreCtx` dataclass and handler dispatch table pattern. |
| `skill_formatter.py` | Structured presentation builders (`format_skills_structured`, `format_passives_structured`) and markdown serializers (`skills_to_markdown`, `passives_to_markdown`). | Groups by `num` and `strengthStatus`. Handles multi-form passive generation and costume unlock deduplication. |
| `np_formatter.py` | Structured presentation builder (`format_np_structured`) and markdown serializer (`np_to_markdown`). | Resolves dynamic card/scope labels, overcharge scaling, and card-variant NP normalization (`_normalize_noble_phantasms`). |
| `effect_map.py` | Dictionaries mapping API buff/function IDs to human-readable strings. | Named tuples: `FuncTypeEntry` and `BuffTypeEntry`. Access attributes by name. |
| `mapper.py` | Bidirectional mapping between `collectionNo` and internal Atlas Academy `id`. | In-memory mapping dictionary `_in_memory_mapping`. Zero disk writes to `servant_id.json`. |

### Structured Presentation Pipeline (`api -> formatted -> md`)
1. **Raw API Ingestion**: API payloads are fetched and processed via `FetchContext`.
2. **Direct Structured Presentation Extraction (`api -> formatted`)**:
   - `servant_formatter.format_profile_structured`: Builds `formatted["profile"]` containing full form stats, decks, and hits.
   - `skill_formatter.format_skills_structured`: Extracts and groups active skills with multi-tier and multi-form support into slot models.
   - `np_formatter.format_np_structured`: Extracts Noble Phantasms with overcharge scaling and card variants into slot models.
   - `skill_formatter.format_passives_structured`: Extracts Class Passives with multi-form branch separation into slot models.
   - `servant_formatter.build_formatted_servant`: Combines profile and slots into `formatted` and returns `(formatted, form_config)`.
3. **Frontend Direct Rendering**: `web/app.js` renders directly from `svt.formatted.slots` and `svt.formatted.profile`, avoiding regular expression string parsing over markdown files.
4. **Markdown Serialization (`formatted -> md`)**: `servant_formatter.formatted_to_md` converts the structured presentation dictionary into GitHub Flavored Markdown for raw web viewing (`/<id>/raw.txt` or `/api/servant/<id>/raw.txt`) with guaranteed 100% byte-for-byte parity.

---

## 2. Strict UI & Formatting Rules

### A. Zero Emoji Policy
- **Absolute prohibition**: No emojis in UI buttons, titles, status banners, logs, docstrings, or markdown files.
- Use clean SVGs (e.g. Feather-style stroke SVGs) or plain text badges for visual indicators.

### B. Typography & Font Stacks
- Use native system font stacks exclusively:
  ```css
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  ```
- **No `@font-face` rules** or external webfont downloads (ensures instant zero-latency rendering).

### C. Saint Graph Display Standards
- **Uncropped Artwork**: Saint Graph cards must render uncropped at 448px width:
  ```css
  .showcase-image-container {
    width: 448px;
    max-width: 100%;
    aspect-ratio: 512 / 724;
    border-radius: 0;
    overflow: visible;
    border: none;
    box-shadow: none;
    background: transparent;
  }
  .showcase-img {
    width: 448px;
    max-width: 100%;
    height: auto;
    aspect-ratio: 512 / 724;
    border: none;
    border-radius: 0;
    object-fit: contain;
  }
  ```
- **Exterior Navigation Controls**: Previous and Next buttons are circular (`.showcase-arrow-btn`) and placed outside the artwork container on the left and right, within `.showcase-canvas`.
- **Top-Left Stage Indicator**: Badge placed at top-left of `.showcase-canvas` showing current ascension/costume name (`.showcase-stage-badge`).
- **No Lightbox / Popup**: Clicking the showcase image does not trigger modals or popups.

### D. Servant Avatars & Icons
- Always utilize the official bordered face asset:
  ```javascript
  const borderedUrl = svt.faceUrl.replace(".png", "_bordered.png");
  ```
- Remove CSS borders, backgrounds, and shadows from `.servant-bordered-icon` to preserve the native game border at 71px width:
  ```css
  .servant-bordered-icon {
    width: 71px;
    height: auto;
    aspect-ratio: 142 / 155;
    border: none !important;
    background: transparent !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    object-fit: contain;
  }
  ```

### E. Strengthen Icons & Multi-Tier Display Standards
- **CDN Assets**:
  - Skill Strengthen: `https://static.atlasacademy.io/JP/Items/9.png`
  - NP Strengthen: `https://static.atlasacademy.io/JP/Items/8.png`
- **Slot Grouping & Default State**:
  - Skills and Noble Phantasms are grouped by slot (Skill 1, Skill 2, Skill 3, Noble Phantasm).
  - Default view always displays the **latest strengthened** version.
- **Interactive Icon Toggle & Multi-Strengthen Stepping**:
  - Single Strengthen ($N=1$): Clicking the icon toggles grayscale (`inactive`) / color (`active`) and swaps card content between Base and Strengthened.
  - Multiple Strengthens ($N \ge 2$, e.g. Emiya Skill 3):
    - Initial Tier 2: Both icons colored. Clicking 2nd icon steps down to Tier 1 (Icon 1 colored, Icon 2 B&W).
    - At Tier 1: Clicking 1st icon steps down to Tier 0 (both B&W, un-strengthened).
    - At Tier 0 (un-strengthened): Clicking 2nd icon jumps to Tier 2 (both colored). Clicking 1st icon jumps to Tier 1.
    - At Tier 2: Clicking 1st icon steps down to Tier 0 (both B&W).
    - State transition formula: `newTier = currentTier >= clickedTier ? clickedTier - 1 : clickedTier;`

### F. Class & Rarity Filter Standards (Consistent with `fgo-calculator`)
- **Row Layout**: Class buttons are arranged in two distinct rows:
  - Standard (7 classes): Saber, Archer, Lancer, Rider, Caster, Assassin, Berserker.
  - Extra (8 classes): Shielder, Ruler, Avenger, Moon Cancer, Alter Ego, Foreigner, Pretender, Beast.
- **Rarity Coverage**: Buttons include all rarities: `0*`, `1*`, `2*`, `3*`, `4*`, `5*`.
- **Zero "All" Buttons**: "All" buttons are omitted entirely. When no filters in a group are active, all items match by default.
- **Multi-Select Toggle**:
  - Filter state uses `classes: new Set()` and `rarities: new Set()`.
  - Clicking any button toggles its active state (`.active` class).
  - Multiple selections apply `OR` logic within each group and `AND` logic across search, class, and rarity filters.
- **Beast & Caster Variant Normalization**:
  - `beast` matches all 13 Beast variants (e.g. `beastI`–`beastVI`, `beastEresh`, `beastOlgaMarieFlare`).
  - `caster` matches standard `caster` and `loreGrandCaster`.
- **Picker Icon & Clean Card Presentation**:
  - Picker grid items (`.picker-servant-icon`) use `width: 71px; height: auto; aspect-ratio: 142 / 155;` for consistent high-density servant avatar display.
  - Class name text below the servant name is omitted in the picker grid for a cleaner, streamlined card presentation.
- **Persistent Filter State**:
  - Filter and search inputs are preserved across modal sessions (`openPicker()` does not reset `state.filters.search`, `state.filters.classes`, or `state.filters.rarities`).
  - Users can reopen the picker and continue browsing or refine their previous filter selection without re-entering criteria.
- **Same-Servant Selection & Avatar Opacity Persistence**:
  - In `updateServantIdentity`, when `data-current-src` matches `targetFace`, the avatar face icon opacity is strictly guaranteed (`style.opacity = "1"`) before returning early, preventing the avatar from remaining hidden at `opacity: 0`.
  - In `loadServant`, media blanking (`.loading` class, loader spinner, and `opacity: 0`) is guarded by `!isSameServant`, preventing visual flashing or blank face avatars when reloading or staying on the active servant.
  - In `selectServantFromPicker`, selecting the currently active servant on 1st ascension immediately closes the picker without redundant network requests, or resets to 1st ascension smoothly in-memory if previously on a non-1st ascension or form.

### G. Artwork Showcase Navigation & Loading Standards
- **Boundary Arrow Visibility**:
  - The Left Arrow (`#cgPrevBtn`) is hidden when displaying the first image (`activeCgIndex === 0`).
  - The Right Arrow (`#cgNextBtn`) is hidden when displaying the last image (`activeCgIndex === list.length - 1`).
  - Both arrows are hidden if a servant has only 1 artwork (`list.length <= 1`).
  - Boundary wrap-around is disabled in `stepCharaGraph()` (clicking left at start or right at end does not cycle).
- **Layout Balance**:
  - Arrow hiding uses `visibility: hidden; opacity: 0; pointer-events: none;` via `.showcase-arrow-btn.hidden` to preserve the 44px flex footprint on both sides so the central Saint Graph artwork never shifts horizontally.
- **Instant Image Reset & Preloading**:
  - As soon as a servant change begins, previous Saint Graph artwork and face icons are immediately hidden (`.loading` class / `opacity: 0`), and an in-place spinner (`#showcaseLoader`) is displayed inside `.showcase-image-container`.
  - The primary artwork is preloaded via `preloadImage()` during the initial data fetch (up to 1.5s safeguard) so the new servant reveals with its artwork already loaded.

### H. Multi-Option Skill & Translation Standards
- **Dynamic $N \ge 2$ Option Branching**:
  - The skill option parser dynamically parses any number of choices using regex `Select (\d+) Options \((.+)\)`.
  - Supports 2, 3, or more branching options (e.g. Servant 425 Kishinami Hakuno with 3 branches: `STR Up [Heaven]`, `STR Up [Earth]`, and `STR Up [Human]`).
  - `.f-option-selector-bar` dynamically renders buttons for all $N$ options, applying active state styling (`.active`) to the selected branch and filtering bullet effects accordingly.
- **Core Japanese Labels & Button Asset Resolution**:
  - Skills with option branches (e.g. `ActSelectIndex`, `sk.script.SelectAddInfo.btn`) extract Japanese option labels directly from game data by default (`消費しない`, `10個消費する`).
  - When option buttons use battle image assets instead of text (e.g. Servant 448 Jade Rabbit), `BTN_SELECT_IMAGE_MAP` in `effect_map.py` maps the asset to its authentic Japanese label:
    - `btn_select_003` -> `月下(全体タイプ)`
    - `btn_select_004` -> `日輪(単体タイプ)`
  - Raw markdown header: `Select 2 Options ([月下(全体タイプ)] / [日輪(単体タイプ)])`.
  - Addition effects are prefixed with the authentic Japanese tag (e.g. `[10個消費する]`, `[日輪(単体タイプ)]`).
- **Translation File (`web/translations.json`)**:
  - Maps Japanese option labels to English display text (e.g. `"消費しない": "Do not expend"`, `"10個消費する": "Expend 10 Critical Stars"`, `"月下(全体タイプ)": "Under the Moonlight (AOE)"`, `"日輪(単体タイプ)": "Under the Sunlight (Single-Target)"`).
  - Web viewer fetches `/translations.json` during initialization and translates button labels, falling back to Japanese if unmapped.
- **Selectable Button Bar (Two-Tier Architecture: Forms Above Header, Options Inside Effects)**:
  - **Form / Ascension Selector Bar (`.f-form-selector-bar`)**:
    - Placed directly **above `.f-section-header`** on cards.
    - Used for forms or ascensions that alter the card identity, skill name, or cooldown (e.g. Servant 312 Melusine Skill 3 & NP, Servant 467 François Prélati Skill 1 & NP, Servant 413 Aozaki Aoko Class Passives).
    - Contains pure button chips without static text headers or labels (zero `[ Form / Ascension Selector Bar ]`).
  - **Option Skill Selector Bar (`.f-option-selector-bar`)**:
    - Placed directly **inside `.f-effects-container`** below the effects.
    - Used for variant effects, star-expend choices, or branch actions within a specific form (e.g. Servant 467 Prélati Skill 1 Switch vs Do not switch, Servant 373 Kukulcan star expend, Servant 425 Kishinami Hakuno card choices).
    - Contains pure button chips without static text headers or labels (zero `[ Option Skill Selector Bar ]`).
  - **Ascension-Based Multi-Form Skills (e.g. Servant 312 Melusine Skill 3, Servant 444 U-Olga Marie)**:
    - In `utils.py`, `group_and_label_items` sorts ascension sub-groups using `_asc_sort_key` (`min_asc`, `priority`, `id`) so lower ascensions (`[1st&2nd Ascension]`) consistently precede higher ascensions (`[3rd Ascension]`), preventing inverted ordering when higher ascension skills have lower database IDs (e.g. Servant 444).
    - In `web/app.js`, `parseSections` parses individual ascension forms with their own cooldowns and effect sets, applying defense-in-depth ascension sorting to guarantee `|[1st&2nd Ascension]|[3rd Ascension]|` button alignment.
    - Updates card header title to the active form's name (`Skill 3 (Ray Horizon A)`) and cooldown text.
    - Buttons display authentic ascension tags (`[ 1st&2nd Ascension ]` / `[ 3rd Ascension ]`), switching active effects smoothly.
  - **Additive Choice (e.g. Servant 373 Kukulcan)**:
    - Option 1 displays base effects.
    - Option 2 displays base effects + star spend addition effects without divider lines.
  - **Mutually Exclusive Choice (e.g. Servant 448 Jade Rabbit, Servant 425 Kishinami Hakuno)**:
    - Option 1 displays Option 1 effects.
    - Option 2 displays Option 2 effects.
    - Option $N$ displays Option $N$ effects.
  - Drawback tags like `[Demerit]` are formatted with `.f-demerit-tag` (`background: #fee2e2`, `color: #b91c1c`).
  - **Activation Requirements & Gauge Conditions (e.g. Servant 444 U-Olga Marie Skill 3)**:
    - Skills with activation requirements in `sk.script` (e.g. `NP_HIGHER`, `STAR_HIGHER`, `NP_LOWER`) format authentic prerequisite tags directly under the cooldown line: `[Usable only when your NP Gauge is 100% or higher]`. In both CLI and Web UI, this presents as the initial requirement line preceding skill effects.
  - Swapping applies a subtle 0.15s opacity fade animation (`.f-option-swapping`).
  - Standard skills without options remain clean bullet lists with zero button overhead.

### I. Multi-Form Noble Phantasm Standards
- **In-Battle Card-Variant NP Normalization**:
  - In `np_formatter.py`, `_normalize_noble_phantasms(nps)` handles servants whose NP card types change in-battle (e.g. Space Ishtar Servant 268, Emiya Servant 11):
    - Atlas Academy represents primary NPs with `num < 90` and variant NPs with `num >= 90` (e.g. 97, 98) with `strengthStatus = 0`.
    - Normalization matches each variant NP to its parent primary NP via `script.tdTypeChangeIDs` and `condQuestId`.
    - Inherits `num`, `strengthStatus`, and `condQuestId` from the primary NP, tagging with `_is_variant = True`.
    - In `utils.py`, `_asc_sort_key` sorts primary cards (`_is_variant = False` $\rightarrow$ 0) before variant cards (`_is_variant = True` $\rightarrow$ 1).
    - Unifies multi-tier + multi-card servants (e.g. Servant 11 Emiya) into a single Noble Phantasm card on the page across un-strengthened (`300-500%` Buster, `450-750%` Arts) and strengthened (`400-600%` Buster, `600-900%` Arts) tiers with interactive strengthen icon stepping.
    - Early-return guard ensures 99.9% of standard servants with all `num < 90` bypass normalization untouched.
- **Dynamic NP Card & Scope Resolution (`_resolve_np_variant_labels`)**:
  - In `np_formatter.py`, `_resolve_np_variant_labels(np_list)` examines card colors (`Arts`, `Buster`, `Quick`) and scopes (`Special`, `AOE`, `Single-Target`) across variant Noble Phantasms:
    - If both card and scope differ (e.g. Mash Paladin changing from Arts non-damage to Buster all-enemies): dynamically emits `[<Card> <Scope>]` (e.g. `[Arts Special]`, `[Buster AOE]`).
    - If only card differs (e.g. Space Ishtar Servant 268: Arts, Buster, Quick; Emiya Servant 11: Buster, Arts): dynamically emits `[<Card>]` (e.g. `[Arts]`, `[Buster]`, `[Quick]`).
    - If only scope differs (e.g. Jade Rabbit Servant 448 Single-Target vs AOE, BB Dubai Servant 421 AOE vs Special): dynamically emits `[<Scope>]` (e.g. `[Single-Target]`, `[AOE]`, `[Special]`).
    - If neither differs: falls back cleanly to `[Form 1]`, `[Form 2]`.
- **Selector Placement (Ascension / Form Base vs Option Base)**:
  - In `web/app.js`, `isNpAscensionOrFormBase(variant)` differentiates between two distinct categories:
    - **Ascension / Form Base NP (e.g. Servant 312 Melusine, Servant 467 François Prélati)**:
      - Occurs when forms alter the servant's ascension, Saint Graph, or character identity (detected via differing NP names or `ascension`/`if ` form tags).
      - Renders in `.f-form-selector-bar` directly **above `.f-section-header`** on the NP card.
      - Selecting a form updates the header title to that form's NP name (e.g. `Innocence Arondight` vs `Hollow Heart Albion`).
    - **Option Base NP (e.g. Servant 1 Mash Paladin, Servant 268 Space Ishtar, Servant 448 Jade Rabbit)**:
      - Occurs when the NP type changes in-battle by skill use or under a specific form (e.g. `[Arts Special]` / `[Buster AOE]` via Holy Sword Loaded, `[Arts]` / `[Buster]` / `[Quick]` via Space Ishtar Skill 2, or `[Single-Target]` / `[AOE]` via Jade Rabbit Skill 3).
      - Renders in `.f-np-options-bar` directly **below `.f-section-header`** and above `.f-np-meta`.
      - Header title displays the active form or shared NP name.
  - Buttons display authentic NP cards (`[ Arts ]` / `[ Buster ]`), scope combinations (`[ Arts Special ]` / `[ Buster AOE ]`), or ascension tags as pure button chips with zero static label text.
- **Split NP Badges & Effects**:
  - Selecting a form/option updates both `.f-np-meta` (e.g. card type, scope, hits, NP gain for that specific form) and `.f-effects-container` (the specific bullet list of effects and card damage multipliers for that form).
  - Both badges and effects apply `.f-option-swapping` animation upon toggle.
  - Standard single-form NPs render without button overhead.

### J. Profile & Status Form Standards & Ascension Trait Splitting
- **Mash Kyrielight Profile & Status 2-Button Rule**:
  - In `servant_formatter.py` (`format_profile_structured`), Mash Kyrielight (Servant 1 / 800100) profile forms are strictly limited to 2 buttons: **`([All Ascensions], [Spiritron Dress: Paladin])`**.
  - **Ortinax is omitted** from Profile & Status cards because it shares identical base stats, attribute (`Earth`), alignment (`Lawful-Good`), card deck (`QAABB`), and hits (`B1 A2 Q2 EX3`) with All Ascensions.
  - Skills and Noble Phantasms retain all 3 forms: `[All Ascensions]`, `[Spiritron Dress: Ortinax]`, and `[Spiritron Dress: Paladin]`.
  - **Two-Way Form Synchronization**:
    - The profile buttons carry `globalFormIndex = 0` for All Ascensions and `globalFormIndex = 2` for Paladin.
    - When the active servant form is Ortinax (`globalFormIndex = 1`), Profile & Status gracefully highlights `[All Ascensions]`.
    - When clicking `[Spiritron Dress: Paladin]` in Profile & Status, the global form index switches to 2 (`Paladin`), synchronizing Skills, NP, and showcase artwork.
- **Transform Multi-Form Profiles (e.g. Servant 413 Aozaki Aoko, Servant 467 François Prélati, Servant 81 Jekyll & Hyde)**:
  - When `transform_data` exists, `servant_formatter.py` formats full distinct profile blocks (`[If {main_name}]` and `[If {trans_name}]`), capturing complete stat differences: HP, ATK, Sub-Attribute, Card Deck (`QAABB` vs `QAAAB`), and Hits distribution.
  - **Clean Button Labeling**: Buttons omit `"If "` text prefixes (e.g. `[ Normal Aoko ]`, `[ Super Aoko ]`, `[ François Prélati ]`, `[ Francesca Prélati ]`, `[ Dr. Jekyll ]`, `[ Mr. Hyde ]`), automatically resolved and synchronized via `formConfig`.
  - In `web/app.js`, `.f-form-selector-bar` renders directly **above `.f-section-header`** on the Profile & Status card, dynamically swapping Class, Alignment, Sub-Attribute, Gender, HP, ATK, Card Deck chips, and Hit badges.
- **Ascension Trait Splitting Without Duplication (e.g. Servant 465 Demeter)**:
  - For standard non-transform servants whose Sub-Attribute, Alignment, or Gender varies across ascensions, `servant_formatter.py` calls `fmt_attribute_blocks`, `fmt_alignment_blocks`, and `fmt_gender_blocks` to emit inline `[1st&2nd Ascension]` and `[3rd Ascension]` blocks ONLY for the varying traits.
  - Generates clean markdown without duplicating the entire card:
    ```markdown
    Alignment: Lawful-Balanced
    [1st&2nd Ascension]
    Sub-Attribute: Heaven
    [3rd Ascension]
    Sub-Attribute: Star
    Gender: Female
    ```
  - In `web/app.js`, `renderFormattedText` parses these trait-level ascension blocks and propagates common properties (Class, Alignment, Gender, HP, ATK, Cards, Hits) across all created `profileForms` via `defaultProfile` fallbacks, rendering pure button chips (`[ 1st&2nd Ascension ] [ 3rd Ascension ]`) that cleanly toggle the variant traits without stat loss.

### K. Trait & Buff Formatting Standards
- **Beast & Divine Class Normalization and Deduplication**:
  - In `utils.py` and `function_formatter.py`, Beast class variants (`124:classBeastDraco`, `129:classBeastEresh`, `132:classUnBeastOlgaMarie`, `133:classBeastLost`, `135:classBeastOther`) and Demon God Pillar (`111:classPillar`) are mapped directly to their clean class names (`Beast` and `Demon God Pillar`).
  - Target class lists in `Increase ATK against [...]` automatically deduplicate entries so multiple Beast sub-classes collapse into a single `Beast` entry without numeric IDs or duplicate names.
- **Plot Armor Buff (`avoidFunctionExecuteSelf`)**:
  - Formatted to official game text:
    `Apply [Plot Armor] <nullifies Demerit effects from your skills and Noble Phantasm (excludes certain Demerit effects such as applying Death to yourself or other sacrifices)>`.
  - Excluded from `apply_card_prefix` in `utils.py` to prevent prefix corruption from `3098:demeritFunction`.
- **Anti-Enforcement DEF Buff Formatting**:
  - Buff ID 3064 (`specialInvincible`) is formatted to official servant description:
    `Apply Anti-Enforcement DEF <disregard [Ignore Invincible] and reduce ATK damage received to 0>` (e.g. Servant 284 Altria Caster and Servant 428).
- **Dynamic Buff Conversion (`buffConvert`)**:
  - `buffConvert` scripts format dynamically in official localization style: `Convert {from} effects granted to yourself into {to} for yourself` (e.g. Servant 413 Aozaki Aoko converting Invincible into Anti-Enforcement DEF).
  - In `utils.py`, `apply_card_prefix` skips `buffConvert` to prevent card name corruption.
- **HP-Scaling Buff Formatting (`RatioHPLow` & `RatioHPHigh`)**:
  - In `function_formatter.py`, `_handle_buff_type` detects `RatioHPLow` and `RatioHPHigh` in `sv0`.
  - Computes the dynamic value range (`val0` to `val0 + RatioHPLow/High`) and formats as:
    `{min_str}-{max_str} <effect increases when HP is low>` (or `<effect increases when HP is high>`).
  - Guards `hide_zero_val` so that zero base values (`val0 == 0`) scaling up to non-zero values are preserved.
- **HP-Ratio Noble Phantasm Damage Formatting (`damageNpHpratioLow` & `damageNpHpratioHigh`)**:
  - In `np_formatter.py`, registered in `DAMAGE_FUNC_TYPES` so hit counts (`6 Hits`, `9 Hits`) and scopes (`Single-Target`, `AOE`) resolve accurately without falling back to `Special`.
  - In `fmt_np_function`, extracts the HP-ratio scaling multiplier from `Target` across Overcharge tiers (`svals` to `svals5`).
  - Formatted in `NP_TYPE_MAP` with official FGO localization:
    `Deal {damage_word} damage by {val_str}% <effect increases with Level> that gets more powerful when your HP is low (up to +{corr_str}%){oc_tag} {dmg_target}`.
  - When Overcharge increases the HP scaling bonus (`corr_oc1 != corr_oc5`, e.g. Servant 66, 161, 248), appends `<strength increases with Overcharge>`. When fixed (e.g. Servant 131), omits the Overcharge tag on the damage line.
- **Consecutive Chained Conditional Roll Folding (`Rate < 0`)**:
  - In `utils.py`, `fold_chained_functions` groups consecutive functions where an initial `Rate > 0` is followed by $N-1$ functions with `Rate == -abs(initial_rate)` sharing identical buff, target, duration, and magnitude.
  - Used in both `np_formatter.py` and `skill_formatter.py` to format chained rolls with official game localization:
    `<applied again if successful, up to a maximum of {count} times>`.
  - In `function_formatter.py`, `fmt_function` guards rates with `abs(rate0)` to guarantee negative percentage strings (e.g. `-80% Chance`) are permanently prevented.
- **Attack-Triggered Stack Consumption & Target Guards**:
  - Universal parsing of attack triggers consuming counter stacks:
    - Normal attack: `When normal attacking, consume 1 [{trait}] to increase ATK by {val}% (1 time) for yourself`.
    - Extra Attack: `When performing an Extra Attack, consume all [{trait}] to increase ATK by {val}% per [{trait}] consumed (1 time) for yourself`.
  - `_parse_stack_consumption_loop` enforces strict guards:
    - `subState` and `addState` must both target `self` or party (`ptOne`/`ptAll`), ignoring enemy targets.
    - Generic buff/debuff removals (`3004 buffPositiveEffect`, `3005 buffNegativeEffect`) are excluded.
    - `entry.template` must contain `{val}` and cannot contain unformatted `{traits}`.
    - This protects enemy-targeted triggers (e.g. Kingprotea Summer Skill 2 removing 1 buff and applying Target Acquisition to enemy) from false positive stack loop matches.
  - In `function_formatter.py`, `_is_engine_cleanup_hook` automatically suppresses internal post-attack trait cleanup functions (`commandattackAfterFunction` removing tracking traits >= 2000) from polluting output.
- **Trait Label Prioritization for `addIndividuality`**:
  - In `fmt_trigger_function`, check `TRAIT_ID_LABELS.get(trait_id)` before raw Japanese buff names (`inner_buffs[0].get("name")`), ensuring traits like `10051: "Target Acquisition"` format consistently in English across skills and Noble Phantasms.
- **Buff Tagging & Audio Suppression**:
  - Trait `2911` (`Normal Aoko Buff`): formats states and values with `with [Normal Aoko Buff]`, and formats `subState` with trait 2911 as `Remove Buffs with [Normal Aoko Buff] for yourself`.
  - Audio buff `changeBgm` is suppressed universally via `BuffTypeEntry("NONE", 0, False)`.
- **Suppression of Enemy-Side `delayNpturn`**:
  - When formatting player buffs targeting `self`, `ptOne`, or `ptAll`, enemy-side delayed NP drain effects (`delayNpturn`) are filtered from the player description to prevent misleading bullet lines.
- **Negative Critical Star Trigger Formatting**:
  - Negative critical star check conditions format naturally as: `If there are less than {N} Critical Stars, gain Critical Stars by {val}` instead of raw numeric inequality strings.
- **Card Attack to All Enemies / AOE Formatting (`overwriteSvtCardType`)**:
  - `overwriteSvtCardType` (e.g. Servant 444 U-Olga Marie Class Passive `Defender of Humanity EX`) formats in official FGO NA localization style: `Change {target_cards} to attack all enemies for yourself`.
  - Dynamically resolves target cards from card traits (`ckSelfIndv` / `ckOpIndv`), function value (`svals[0].Value`), or buff name:
    - Extra $\rightarrow$ `Extra Attacks` (`Change Extra Attacks to attack all enemies for yourself`)
    - Buster / Arts / Quick $\rightarrow$ `Buster Cards` / `Arts Cards` / `Quick Cards`
    - Fallback $\rightarrow$ `Command Cards`
  - In `utils.py`, `apply_card_prefix` skips `overwriteSvtCardType` to ensure clean card naming without duplicated prefixes.

### L. Multi-Form Class Passives Standards
- **Transform Passives Detection**:
  - In `servant_formatter.py`, checks `svt.get("relateId", {}).get("transform")` for secondary servant IDs (e.g. Servant 413 Aozaki Aoko `2501400` -> Super Aoko `2501500`).
  - Fetches the transform servant payload and extracts `classPassive`.
  - In `skill_formatter.py`, `fmt_passives(data, ctx, transform_passives=...)` compares both lists; if distinct, emits `[If {main_name}]` and `[If {trans_name}]` sections with line deduplication via `_fmt_passive_skill_list`.
- **Web UI Form Switching**:
  - In `web/app.js`, `parseSections` detects `[If ...]` / `[Form 1]` / `[Form 2]` in the `Passives` section and populates `current.forms`.
  - Renders `.f-form-selector-bar` directly above `.f-section-header` on the Class Passives card with pure button chips `[ Normal Aoko ] [ Super Aoko ]` and smooth opacity swapping.
  - Single-form servants continue rendering plain Class Passives without button overhead.

### M. Dynamic Identity Engine & Form/Spiritron Dress Synchronization
- **Separation of Form Types**:
  - `data-servant-form="true"`: Used exclusively for multi-form transform servants (e.g. `If François Prelati` / `If Francesca Prelati`, `If Henry Jekyll` / `If Hyde`). Managed by `setServantForm(nextIdx)`. Clicking synchronizes all other section form bars across Profile, Skills, and NP without locking or desync.
  - `data-ascension-form="true"`: Used for ascension-based variations across Profile, Skills, and Noble Phantasms (e.g. `[1st&2nd Ascension]` vs `[3rd Ascension]` for Mélusine, U-Olga Marie, Demeter). Managed by `setServantAscensionStage(stageStr, syncShowcase = true)`.
- **Bidirectional Showcase Artwork & Form Synchronization**:
  - Stepping through CharaGraph showcase artworks (or pressing Left/Right keyboard arrows) automatically extracts `getAscensionStageForCg(cg)` and aligns all cards with `data-ascension-form="true"` to match the active stage.
  - Clicking an ascension form chip on any card steps the showcase artwork to the corresponding ascension stage, triggering instant title name, original Japanese name, and bordered face icon updates.
  - Re-entrancy guard `isSyncingAscension` prevents infinite bubbling loops when synthetic button clicks occur across cards.
- **Spiritron Dress Skill & Ascension Reference Resolution**:
  - In `web_server.py`, `_resolve_costume_ascension_stage` universally resolves which ascension stage a Spiritron Dress refers to using:
    1. Skill/NP release conditions (`condType == "equipWithTargetCostume"` and `condNum == costume_id`). For example, Mélusine's Costume 13 (`Red Hot Deviation`) shares the release condition unlocking 3rd Ascension Skill 3 and NP.
    2. Title and name keywords (`First Ascension` / `第一再臨` -> 1, `Second Ascension` / `第二再臨` -> 2, `Third Ascension` / `第三再臨` -> 3).
    3. VoicePrefix mappings (`11` -> 1, `12` -> 2, `13` -> 3).
  - In `web/app.js`, `getAscensionStageForCg` reads `cg.ascensionStage` or falls back to costume title inspection. When viewing a Spiritron Dress in the showcase, skills and NP automatically synchronize to the referenced ascension (e.g. `Tam Lin Lancelot (First Ascension)` & `(Second Ascension)` sync to `[ 1st & 2nd Ascension ]`; `Red Hot Deviation` syncs to `[ 3rd Ascension ]`).
- **Artwork Fallbacks for Servants Without Standalone Art**:
  - Servants like Henry Jekyll & Hyde (081) have no standalone card art for Hyde in Atlas Academy CDN (`600710` URLs return 404).
  - In `web_server.py`, `FORM_IDENTITY_CONFIG` flags `fallbackBaseImage: True` to fall back Hyde's artwork to Jekyll's base card art (`600700a@1.png` - `600700b@2.png`), while accurately displaying Hyde's unique stage face icons (`f_6007100_bordered.png` to `f_6007103_bordered.png`) including Final Ascension.
- **Stage-Dependent Name Resolution (`_resolve_stage_name`)**:
  - In `web_server.py`, handles both 0-indexed and 1-indexed Atlas Academy `ascensionAdd` maps:
    - 474 (Hassan / Azrael): Stage 1 = `Hassan-i Sabbah`, Stage 2 = `Azrael`, Stage 3 = `Sidra Azrael`, Final Ascension = `Azrael the Pale`.
    - 312 (Mélusine): Stage 1 = `Tam Lin Lancelot`, Stages 2-4 and costumes fall back cleanly to `Mélusine` / `Tam Lin Lancelot` depending on costume title.

### N. Dynamic Costume Form Detection & Form-Aware Strengthen Isolation
- **Dynamic Costume & Release Condition Form Detection**:
  - Dynamically detects multi-form servant identities from costume and release condition data (`equipWithTargetCostume`) for servants with multiple distinct skill/NP identities (e.g. Servant 1 Mash Kyrielight: `Default`, `Ortinax`, `Paladin`) with zero hardcoded form definition files (`form_definitions.py` eliminated).
  - Form detection resolves forms from `condType == 'equipWithTargetCostume'` (`condNum in (12, 13, 18)` -> Ortinax, `condNum in (17, 19, 20)` -> Paladin, fallback -> Default).
- **Dynamic Artwork Filtering, Unified Showcase Sequence & Bidirectional Navigation**:
  - `web_server.py` filters duplicate artwork (Ortinax `800151` byte-identical duplicate of `800150`) and hides story NPC assets (Paladin NPC art `800200`).
  - Tags `cg["form"]` based on dynamic costume mapping.
  - In `web/app.js`, `getAvailableCharaGraphs` detects Mash Kyrielight (`isMashServant`) and keeps all 11 artworks in a single unified showcase sequence instead of isolating them per form:
    - 0-3: 1st, 2nd, 3rd, Final Ascension (Default, form 0)
    - 4: Spiritron Dress: Swimsuit of Everlasting Summer (Default, form 0)
    - 5-6: Spiritron Dress: Ortinax, Ortinax (Refurbished) (Ortinax, form 1)
    - 7-8: Spiritron Dress: Swimsuit of Everlasting Summer Ver. 02, Bright Voyager (Default, form 0)
    - 9-10: Spiritron Dress: Paladin, Spiritron Dress: Swimsuit of Everlasting Summer Ver. 03 (Paladin, form 2)
  - **Bidirectional Showcase & Form Synchronization**:
    - Stepping through artworks with Left/Right arrows or keyboard arrows auto-detects form transitions (`cg.form !== state.activeFormIndex`) and calls `setServantForm(cg.form, false)`, synchronizing Profile, Skills, and NP cards to the corresponding form in real time.
    - Clicking any form button (`[ Default ]`, `[ Ortinax ]`, or `[ Paladin ]`) on any section bar calls `setServantForm(nextIdx, true)`, jumping the showcase directly to the matching form's artwork while remembering the user's last viewed artwork for each form in `state.lastCgIndexByForm`.
- **Form-Aware Strengthen Icon Isolation & Defaults (`getSupportedTiersForForm` & `updateCardStrengthenUI`)**:
  - Eliminates cross-form strengthen icon bleeding where forms without strengthenings (e.g. Paladin) erroneously inherited strengthen icons from other forms.
  - Dynamically computes `validTiers` and `maxEffectiveTier` for each slot under the active servant form:
    - **Default Form**: Skill 1 [0, 1] (1 strengthen icon, defaults to Strengthened), Skill 2 [0] (0 icons), Skill 3 [0] (0 icons), NP [0, 1] (1 strengthen icon, defaults to Strengthened).
    - **Ortinax Form**: Skill 1 [0, 1] (1 strengthen icon, defaults to Strengthened), Skill 2 [0] (0 icons), Skill 3 [0, 1] (1 strengthen icon, defaults to Strengthened), NP [0, 1] (1 strengthen icon, defaults to Strengthened; strictly NO 2nd strengthen).
    - **Paladin Form**: Skill 1 [0] (0 icons), Skill 2 [0] (0 icons), Skill 3 [0] (0 icons), NP [0] (0 strengthen icons).
  - Defaults cards to the maximum supported strengthen tier (`maxEffectiveTier`) upon form switch or servant load. Manual toggles are tracked per form in `slot.activeTierByForm[formIdx]`.
  - **Universal Form Selector Bar Persistence**: The top `.f-form-selector-bar` buttons (`[ Default ] [ Ortinax ] [ Paladin ]`) are resolved globally across all tiers and sections, guaranteeing all 3 form buttons remain visible across every card and strengthen tier without disappearing when viewing a strengthened tier that only contains a subset of forms.
- **In-Form NP Option Toggles (`renderNpContent` with `.f-np-options-bar`)**:
  - For Noble Phantasms with in-form branch options (e.g. Paladin NP option between `[ Arts / Lord Chaldeas ]` and `[ Buster / Rayproof Kyrielight ]`), `parseSections` groups options under the parent form `If Paladin`.
  - Top `.f-form-selector-bar` cleanly preserves the 3 servant forms (`Default`, `Ortinax`, `Paladin`).
  - `.f-np-options-bar` renders below the section header, seamlessly toggling card metadata and effects between Arts and Buster.
- **Paladin Skill 2 Transformation Options**:
  - Skill 2 provides an in-effects option selector between `[ Normal ]` (`Obscurant Wall of Chalk A`) and `[ When loaded with the Holy Sword ]` (`Timeworn Bullet Kindling of Amethyst B`, ID `2477450`).
  - Effects containers swap smoothly via `.f-option-swapping`.
- **In-Battle Transformation Functions**:
  - `gainNpCriticalstarSum`: Formats to `"Consume up to {max_stars} Critical Stars to Increase NP Gauge by {val_str} per Critical Star consumed for {target}"`. Redundant `lossStar` is suppressed when `gainNpCriticalstarSum` is present.
  - `skillRankUp`: Formats to `"Change Skill {num} to [{skill_name}]"`.
  - `shortenSkill`: Formats to `"Reduce cooldown of Skill {target_skill} by {val} turns"`.
  - `tdTypeChange`: Handled with `聖剣装填` to format `"Apply [聖剣装填] (Holy Sword Loaded) & Change Noble Phantasm to [Rayproof Kyrielight] (3 turns) for yourself"`.

---

## 3. Network Architecture & Happy Eyeballs

To prevent IPv6 peering hangs and timeout stalls on Linux hosts when connecting to Atlas Academy API (such as Servant 315 / Habetrot):

1. **System `curl` with Happy Eyeballs**:
   ```python
   res = subprocess.run(
       ["curl", "-s", "-f", "-m", str(timeout), "--compressed", url],
       capture_output=True,
       text=True,
       check=True,
   )
   ```
2. **Transparent Fallback**: If `curl` is unavailable, falls back to `urllib.request` with explicit `User-Agent` and `gzip` decompression.
3. **Streamed Artwork**: In the web interface, image URLs point directly to `https://static.atlasacademy.io/` without writing files to disk.

---

## 4. Common Workflows & Runbooks

### Starting the Web Server
```bash
python3 web_server.py --port 3000
```
- Bound to `0.0.0.0:3000`.
- API & Web endpoints:
  - `GET /api/health`
  - `GET /api/servants`
  - `GET /api/servant/<collectionNo|id|name>`
  - `GET /?svt=<id>/raw.txt` (switches web UI to raw text mode; serves plain text via curl)
  - `GET /<id>/raw.txt` (returns plain text converted markdown)

### Fetching Servant Markdown via Web Server
The web server generates converted GitHub Flavored Markdown on-demand in memory with zero local disk writes.

```bash
# Start the web server (if not already running)
python3 web_server.py --port 3000

# Fetch servant markdown by collection number
curl -s http://localhost:3000/1/raw.txt

# Fetch servant markdown by internal ID or name
curl -s http://localhost:3000/800100/raw.txt
curl -s "http://localhost:3000/Mélusine/raw.txt"

# Save converted markdown directly to a file
curl -s http://localhost:3000/315/raw.txt > 315-data.md
```

- **Strict Architecture Rule**: **Do NOT use `convert_servant.py` anymore.** The web server is the single runtime authority, generating byte-identical markdown on demand without disk writes or local image downloads.

### Adding a New Effect or Buff Type
1. When encountering `[unknown buff type: X]`:
   - Inspect the buff type from Atlas Academy API payload.
   - Add a `BuffTypeEntry` to `BUFF_TYPE_MAP` in `effect_map.py`:
     ```python
     "newBuffType": BuffTypeEntry("{val} Effect Description", divisor=100, is_pct=True),
     ```
2. When encountering `[unknown func type: X]`:
   - Add a `FuncTypeEntry` to `FUNC_TYPE_NO_BUFF` in `effect_map.py`:
     ```python
     "newFuncType": FuncTypeEntry("{val} Effect Description", divisor=1, is_pct=False),
     ```
3. If custom logic or complex conditions are needed:
   - Add `_handle_new_type(core)` in `function_formatter.py`.
   - Dispatch to it within `_fmt_function_core`.
