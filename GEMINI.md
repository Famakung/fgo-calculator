# GEMINI.md

The project rules for every AI agent live in [AGENTS.md](AGENTS.md) — read it in full before touching code, along with the four mandatory docs it lists under "Before you write code" (`.claude/docs/code-style.md`, `structure.md`, `data-rules.md`, `security.md`). All paths are relative to the project root.

Non-negotiable, even if you read nothing else:

- Never `innerHTML` / `insertAdjacentHTML` — `createElement()` + `textContent` + `setAttribute()`, or a `DocumentFragment` with one `replaceChildren()`. A Trusted Types policy makes unsanitized sinks throw.
- All CSS is the single inline `<style>` in `src/layouts/BaseLayout.astro` — the site has no `.css` file and no `src/styles/` directory. A stylesheet you create there ships nothing.
- No viewport-unit lengths — use `--screen-h` (the page applies `zoom` on `<html>` above 1400 CSS px).
- JS: ES modules, 2-space indent, semicolons, double quotes. Trait IDs are 4-digit zero-padded strings.
- Generated data (`src/scripts/data/*.js`, `public/servants/`, `public/craft_essences/`) is gitignored — `npm run data:sync` on a fresh clone.
- Build from the native clone, never the `/mnt/storage` ntfs3 checkout (`astro build` dies there).
