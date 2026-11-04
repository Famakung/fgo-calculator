# Astro 5 → 7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move fgo-calculator from Astro 5.18.1 to Astro 7.4.5 with the rendered site byte-for-byte equivalent in behaviour, and keep it that way with a committed build-output gate.

**Architecture:** Two new throwaway-proof checks run against `dist/`: one static (`scripts/check_build_output.js`, chunk names + visible-text signature vs a committed baseline) and one browser-driven (`scripts/verify_render.js`, Puppeteer against `astro preview`). The upgrade itself is a version bump plus one config port: Rollup's `manualChunks` becomes Rolldown's `output.codeSplitting.groups`. The static check is written and green on the OLD version first, so every failure after the bump is a real finding instead of a guess.

**Tech Stack:** Astro 7.4.5, Vite 8 (Rolldown bundler), Node >= 22.23.4, Puppeteer (existing devDependency), GitHub Actions Pages workflow.

**Spec:** none — this plan carries its own rationale in Context below. File is the spec of record.

## Context

Facts this plan was built on (all verified 2026-11-02):

- Installed `astro@5.18.1` + `vite@6.4.2`. Latest 5.x is `5.18.2`; `6.4.8` last shipped 2026-06-17 (superseded by 7.0.0 five days later — the 6 line is abandoned). `7.4.5` shipped today.
- npm advisories cover `astro <= 7.3.1`, so 5.18.2 and 6.4.8 are permanently on the vulnerable list. Only 7.x is patched. That is the whole reason to migrate.
- None of those advisories are reachable from this site's output (`output: "static"`, no islands, no SSR, no `define:vars`, no `astro:assets`/sharp, no `src/fetch.*`). This is hygiene, not a fire.
- Astro 7 = Vite 8 = **Rolldown**, which removes `build.rollupOptions` (renamed `build.rolldownOptions`), removes the object form of `output.manualChunks`, and deprecates the function form. `astro.config.mjs:13` uses the function form and is the sole definition of the lazy-loading chunk layout — `rollupOptions` on `:11`, the six `return "<name>"` literals on `:14-19`.
- Astro 7 raises the Node floor to `>=22.23.4` (local: `22.14.0` at `~/.local/node`).
- Astro 7's default `compressHTML` changes from `true` to `'jsx'`; the Rust compiler replaces the Go one and rejects unclosed tags it used to auto-correct.
- `dist/_astro/` today holds 10 JS chunks, 6 of them named by that `manualChunks` function.

## Global Constraints

- Node `>=22.23.4` everywhere: local (`~/.local/node`), `.nvmrc`, `package.json` `engines.node`, and CI via `node-version-file` — one value, no drift.
- Branch `feat/*` into `develop`; `develop` into `main`. Never build on `main`.
- No new runtime dependency. Puppeteer stays dev-only and never runs in CI (see Task 6).
- JS in `scripts/`: shebang `#!/usr/bin/env node`, ESM `import`, double quotes, semicolons, 2-space indent, `process.exit(1)` on failure — match `scripts/validate_data.js`. Prettier's globs do not cover `scripts/`, so formatting is manual there.
- Never `innerHTML` in any new browser code: `textContent` / `evaluate()` reads only.
- `docs/` is gitignored (`.gitignore:6`), so this file is a working-copy document. Everything the plan commits lives in tracked paths.

## Review Focus

The failure modes below are not covered by any single task's happy path. Each line names the expected behaviour a user would notice, and the task that pins it.

1. **Lazy tabs load nothing** — clicking Bond or Event shows an empty panel, silently, because `bond-lazy.*.js` / `event-lazy.*.js` disappeared from `dist/_astro/` after the chunking port. Pinned by Task 2 (chunk-presence check) and Task 3 (real click).
2. **CE Filter returns zero cards** — `ce-match-worker` is built as a classic worker instead of ES module, `new Worker(url, { type: "module" })` throws, and the results grid stays empty with the error only in the console. Pinned by Task 3 (worker message interception + `pageerror`).
3. **Chunk content drifts while names stay right** — a regex that matches too broadly moves game data into `main-entry`, names still pass, payload triples on first paint. Pinned by Task 2 (per-chunk byte floor + total-size delta report).
4. **Invisible whitespace changes break inline labels** — `compressHTML: 'jsx'` restores or removes spaces between adjacent inline nodes, so badge strings like `+20%` / `Bond All +25%` and tab labels render run-together or gapped. Pinned by Task 2 (raw vs normalised text signature) and the decision rule in Task 5.
5. **Critical CSS or the update prompt loses its slot in `<head>`** — script/style emit order changed in Astro 6, and an inlined-`<style>` or the `fgo_build_etag` poller moving after first paint means unstyled content or no stale-version banner. Pinned by Task 2 (`<head>` order assertions) and Task 3 (computed `--bg` + poller presence).

---

### Task 1: Toolchain floor and version pin

**Files:**
- Create: `.nvmrc`
- Modify: `package.json` (deps + new `engines` block)
- Modify: `.github/workflows/deploy.yml:121-123` (`setup-node` step's `with:` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `.nvmrc` containing the single line `22.23.4`, read by CI as `node-version-file`. `package.json` `engines.node` = `">=22.23.4"`. `astro` dependency range = `"^5.18.2"` (Task 4 is the only place it becomes `^7.4.5`).

- [ ] **Step 0 (human, outside the repo): raise the local Node.** `~/.local/node` is a hand-placed tarball install, so this is a system-level change and needs your approval before it happens: download the `node-v22.23.4-linux-x64` tarball from nodejs.org, verify its sha, and replace the contents of `~/.local/node`. Confirm with `node --version` printing `v22.23.4`. Do not proceed to Step 3 on an older runtime — npm only warns on `EBADENGINE`, so the build would appear to work on an unsupported version.

- [ ] **Step 1: Write the version gate as a failing check.** Create `.nvmrc` with exactly `22.23.4` and no other content (the trailing newline is required by `setup-node`'s parser).

- [ ] **Step 2: Verify it is read correctly.**

Run: `node -e "const v=require('fs').readFileSync('.nvmrc','utf8').trim(); console.log(process.version.slice(1) >= v ? 'OK '+process.version : 'FAIL '+process.version+' < '+v)"`
Expected: `OK v22.23.4` (FAIL means Step 0 is incomplete)

- [ ] **Step 3: Add `engines` and patch the same-major Astro.** In `package.json`, add beside `"type": "module"`:

```json
"engines": { "node": ">=22.23.4" }
```

Then run `npm install astro@^5.18.2` so the range and the lockfile agree on `5.18.2`.

- [ ] **Step 4: Point CI at the same file.** In the `setup-node@v4` step's `with:` block (`.github/workflows/deploy.yml:121-123`), replace `node-version: 22` (line 122) with `node-version-file: .nvmrc`, keep `cache: npm`, leave the step's `if:` on line 120 untouched.

- [ ] **Step 5: Verify the workflow self-tests still pass.**

Run: `python3 scripts/test_deploy_workflow.py && python3 scripts/test_check_data_version.py && python3 scripts/test_drift.py`
Expected: each ends with its own pass count and exit 0 (they were green at HEAD: 9 tests in `test_deploy_workflow.py`). They assert on YAML steps, not on `node-version`, so a failure here means the edit landed on the wrong step.

- [ ] **Step 6: Verify a real build on the new runtime.**

Run: `npm run build && ls dist/_astro/*.js | wc -l`
Expected: exit 0, `10`

- [ ] **Step 7: Commit**

```bash
git add .nvmrc package.json package-lock.json .github/workflows/deploy.yml
git commit -m "chore: pin Node 22.23.4 and bump astro to 5.18.2

Prep for the Astro 7 upgrade: astro 7 requires Node >= 22.23.4 and CI ran a
floating node-version: 22 with no local counterpart."
```

### Task 2: Static build-output gate

**Files:**
- Create: `scripts/check_build_output.js`
- Create: `scripts/build_baseline.json` (generated, then committed)
- Modify: `package.json` (add `check:build` script)

**Interfaces:**
- Produces: `node scripts/check_build_output.js` → exit 0 + `SUCCESS: build output matches baseline` or exit 1 + one `[ERROR]` line per failure. Baseline JSON keys, consumed by Task 4 and 5: `astroVersion`, `chunks` (array of base names), `chunkMinBytes` (object keyed by base name), `rawTextSha`, `normalisedTextSha`, `headMarkers` (array of strings that must appear, in order, inside `<head>`).
- The chunk base name of `data-chunk.0JmB4njH.js` is `data-chunk`: strip the trailing `/[-.][A-Za-z0-9_-]{8}\.js$/`.

- [ ] **Step 1: Write the failing test — the checker against an empty baseline.** Implement `scripts/check_build_output.js` with this behaviour, no flags and no options:
  - Read `dist/index.html` and `dist/_astro/*.js`. If either is missing, `[ERROR] dist/ not built — run npm run build`.
  - Derive chunk base names (rule above), require the 6 `manualChunks` names plus `bond-lazy`, `event-lazy`, `ce-match-worker`, and the `index.astro_astro_type_script_index_0_lang` chunk. Report each missing name as `[ERROR] missing chunk: <name>`.
  - Per chunk, fail under `chunkMinBytes`; also print `NOTE: <name> <bytes> (baseline <bytes>)` for every chunk so a size swing is visible in the log even when it passes.
  - Visible text: parse `dist/index.html`, drop `<script>`/`<style>` contents, join surviving text nodes. `rawTextSha` = sha256 of that join untouched; `normalisedTextSha` = sha256 after collapsing every whitespace run to one space and trimming. Both must equal baseline.
  - `headMarkers`: assert each string occurs inside `<head>` and that their indices are non-decreasing.
  - Compare `astroVersion` in the baseline against `node_modules/astro/package.json` and print `NOTE: baseline captured on astro X, running Y` when they differ. Never a failure — Task 4 depends on that being information only.

Run: `npm run build && node scripts/check_build_output.js`
Expected: FAIL exit 1, `[ERROR] no baseline` (baseline file does not exist yet)

- [ ] **Step 2: Generate the baseline on Astro 5.18.2.** Add `--write` handling: with that one argument the script writes the JSON it just computed to `scripts/build_baseline.json` instead of comparing. Set `chunkMinBytes` from the captured sizes at 25% of observed (generous floor that still catches a chunk emptied of its contents — Review Focus 3). Set `headMarkers` from the three things that must stay in order in the current `<head>`: the `fetchpriority="high"` font preload, the opening of the `is:inline` critical-CSS block, and `fgo_build_etag` from the stale-version poller.

Run: `node scripts/check_build_output.js --write && git add -f scripts/build_baseline.json`
Expected: file written, `astroVersion` = `5.18.2`, `chunks` has 10 entries. `git add -f` is needed only if a `dist/`-style ignore pattern catches it; check `git check-ignore -v scripts/build_baseline.json` first and skip `-f` when it prints nothing.

- [ ] **Step 3: Verify it passes and can fail.**

Run: `node scripts/check_build_output.js`
Expected: exit 0, `SUCCESS: build output matches baseline`

Then prove the assertions are live, not decorative: in `astro.config.mjs:15` temporarily rename `"data-chunk"` → `"data-chunk-Z"`, rebuild, run the checker.
Expected: exit 1 with `[ERROR] missing chunk: data-chunk`. Revert the rename, rebuild, checker exit 0.

- [ ] **Step 4: Expose it as a script.** In `package.json`, add `"check:build": "node scripts/check_build_output.js"`.

Run: `npm run check:build`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add scripts/check_build_output.js scripts/build_baseline.json package.json
git commit -m "test: add build-output gate with baseline captured on astro 5.18.2"
```

### Task 3: Browser verifier against the production build

**Files:**
- Create: `scripts/verify_render.js`

**Interfaces:**
- Consumes: a running preview server (started by the operator, not the script), the DOM contracts in `src/scripts/main.js:42,51` (`import("./bond-lazy.js")`, `import("./event-lazy.js")`) and `src/scripts/ce-filter-app.js:13` (`new Worker(new URL("./ce-match-worker.js", import.meta.url), { type: "module" })`).
- Produces: `node scripts/verify_render.js [url]` (default `http://localhost:4173/fgo-calculator/`) → exit 0 + `SUCCESS: rendered UI verified`, or exit 1 + `[ERROR] <check>`. Checks, in order: zero `pageerror` events; `document.body` computed `background-color` is not `rgba(0, 0, 0, 0)` (critical CSS applied — Review Focus 5); `sessionStorage`-driven poller script contains `fgo_build_etag` (Review Focus 5); clicking the Bond tab fires a network request whose URL matches `/bond-lazy/` and yields `#servantSlots` with more than 0 children (Review Focus 1); clicking the CE Filter tab produces at least one `.cefilter-card` and at least one intercepted worker `message` event carrying a non-empty array (Review Focus 2).

- [ ] **Step 1: Write it.** Launch Puppeteer headless with `args: ["--no-sandbox"]`. Install the worker interceptor with `page.evaluateOnNewDocument()` exactly as `.claude`-documented in the repo skill `verify-fgo-ui` (wrap `self.Worker`, log `message` data). Collect `pageerror` messages into an array and assert on it last. Read every value with `page.evaluate()` returning `.textContent` / `getComputedStyle` results — never inject markup. `await puppeteer.close()` on every path, including failures (`try/finally`).

Run: `npm run build && npx astro preview --port 4173 & node scripts/verify_render.js`
Expected: exit 0 on Astro 5.18.2. A connect-refused error means the preview server is not up; the repo's own `astro preview` script uses port 3000, so pass `--port 4173` explicitly to avoid the running `npm run dev` server.

- [ ] **Step 2: Verify the checks bite.** With the preview still running, break one contract in the built output rather than the source: run `node scripts/verify_render.js http://localhost:3000/fgo-calculator/` (the HMR dev server) and read the report.
Expected: the script reports at least one difference or passes while the console notes duplicate module instances — the point being documented proof that the dev server is not a valid target (see `verify-fgo-ui`: "Use the HMR dev server to prove what ships" is forbidden). Record the observation in the commit body, keep 4173 as the only supported target, and add the same one-line warning to the script's header comment.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify_render.js
git commit -m "test: add puppeteer verifier for tabs, worker and critical CSS on the production build"
```

### Task 4: Upgrade to Astro 7.4.5 and port the chunking config

**Files:**
- Modify: `package.json` (`astro` range), `package-lock.json`
- Modify: `astro.config.mjs:10-23` (the `build:` block; `worker.format` on `:7-9` is untouched)

**Interfaces:**
- Consumes: `node scripts/check_build_output.js` (Task 2) and `node scripts/verify_render.js` (Task 3) as the red/green gates.
- Produces: `astro.config.mjs` with `vite.build.rolldownOptions.output.codeSplitting.groups` — the `manualChunks` function and `build.rollupOptions` are both gone (Vite 8 removed the object form and deprecated the function form; `rollupOptions` is renamed). The six group entries keep their exact `name` values from the current function: `constants-chunk`, `data-chunk`, `selectors-chunk`, `tab-navigator-chunk`, `ce-filter-chunk`, `main-entry`, each with a `test` regex anchored to the module path so `data-chunk` cannot swallow the `src/scripts/data/` files that the old `includes("data.js")` also matched. `worker.format: "es"` stays as-is; Vite 8 does not document a change to it.

- [ ] **Step 1: Confirm the gates are red for the right reason — record the pre-upgrade baseline run.**

Run: `npm run build && node scripts/check_build_output.js && node -e "process.exit(0)"`
Expected: exit 0 (this is the reference log for Step 5)

- [ ] **Step 2: Upgrade.**

Run: `npm install astro@^7.4.5`
Expected: `added/changed` lines, `node -e "console.log(require('./node_modules/astro/package.json').version)"` prints `7.4.5`, `node -e "console.log(require('./node_modules/vite/package.json').version)"` prints `8.x`. If npm prints `EBADENGINE`, Node is still 22.14.0 — stop, finish Task 1 Step 0.

- [ ] **Step 3: Build, and capture the config's failure.**

Run: `npm run build`
Expected: either success with a `manualChunks is deprecated` warning, or a hard error naming `rollupOptions`. Both mean the port is due. Do not ship the deprecated form even if it works: it is deprecated upstream and the warning is the only signal you get.

- [ ] **Step 4: Port to `codeSplitting.groups`.** Replace `vite.build.rollupOptions` with `vite.build.rolldownOptions.output.codeSplitting.groups`, six entries, `priority` descending in the old function's evaluation order so the first matching group wins where paths overlap. Keep the `id.includes(...)` semantics only where they were already correct — for `data.js` use the anchored form, since the old `includes("data.js")` would also grab any nested `…/data.js`.

- [ ] **Step 5: Verify the port.**

Run: `npm run build && node scripts/check_build_output.js`
Expected: exit 0. If `normalisedTextSha` matches and only `rawTextSha` differs, the change is whitespace-only — go to Task 5, do not chase it here. If a chunk name is missing or a chunk falls under its byte floor, the regex port is wrong: fix `groups`, rebuild.

- [ ] **Step 6: Verify behaviour, not just output.** Start the preview server on 4173 and run `node scripts/verify_render.js`.
Expected: exit 0. A missing `bond-lazy` request here is Review Focus 1 arriving exactly as predicted.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json astro.config.mjs
git commit -m "fix(build): port manual chunking to rolldown codeSplitting for astro 7

Astro 7 ships Vite 8 (Rolldown): build.rollupOptions is renamed to
build.rolldownOptions and the output.manualChunks function form is deprecated.
Chunk names and layout are asserted by scripts/check_build_output.js."
```

### Task 5: HTML strictness and whitespace equivalence

**Files:**
- Modify: `src/layouts/BaseLayout.astro` and/or `src/pages/index.astro` (only where the compiler reports a violation)
- Modify: `astro.config.mjs` (only if `compressHTML` must be set explicitly)
- Modify: `scripts/build_baseline.json` (only if a signature legitimately changed and the new output is proven correct in the browser)

**Interfaces:**
- Consumes: Task 2's two signatures and Task 4's gates.
- Produces: a green `check_build_output.js` under Astro 7 with a decision recorded for every signature delta.

- [ ] **Step 1: Find compiler violations.**

Run: `npm run build 2>&1 | tail -30`
Expected: exit 0. If the Rust compiler reports an unclosed or semantically invalid tag, fix that tag in the reported file — the Go compiler corrected it silently, so the file has always been wrong.

- [ ] **Step 2: Resolve a whitespace-only delta.** If `rawTextSha` differs while `normalisedTextSha` matches, set `compressHTML: true` in `astro.config.mjs` to restore the pre-7 default, rebuild, and re-run the checker.
Expected: exit 0 with both signatures matching the Task 2 baseline. Use the baseline as truth here, not the new output: `'jsx'` is the direction upstream is going, so if you would rather adopt it, say so in the commit message and refresh the baseline in Step 3 instead.

- [ ] **Step 3: Refresh the baseline only with evidence.** If any signature must change for a non-whitespace reason (a real template fix from Step 1), first run `node scripts/verify_render.js` and read every reported label in the browser, then `node scripts/check_build_output.js --write` and inspect `git diff scripts/build_baseline.json` line by line.
Expected: the diff is small and every changed line is one you can tie to a step above. Commit the refreshed baseline. Never `--write` to make a gate go quiet.

- [ ] **Step 4: Commit**

```bash
git add astro.config.mjs src/layouts/BaseLayout.astro src/pages/index.astro scripts/build_baseline.json
git commit -m "fix(build): satisfy astro 7 html compiler and keep inline whitespace identical"
```

Skip this commit if Steps 1-3 all came back clean; there is nothing to commit.

### Task 6: Gate the deploy pipeline

**Files:**
- Modify: `.github/workflows/deploy.yml:176-180` (after `Build`, before `Verify build outputs`)

**Interfaces:**
- Consumes: `npm run check:build` (Task 2).
- Produces: one CI step, no browser check. Puppeteer is deliberately kept out of the pipeline: `npm ci` would have to fetch a Chromium build on every data-changed deploy, and the schedule runs every 10 minutes — a flaky download there blocks Pages deploys for a reason unrelated to the site. `verify_render.js` stays a local pre-merge gate.

- [ ] **Step 1: Add the step.** Insert, between `Build` and `Verify build outputs`, a step named `Check build output` running `npm run check:build`, carrying the same `if: steps.data_change.outputs.DEPLOY == 'true'` condition as its neighbours.

- [ ] **Step 2: Verify the workflow's own tests.**

Run: `python3 scripts/test_deploy_workflow.py`
Expected: exit 0. This suite parses the step list (its `would_run()` helper evaluates the same conditions), so a mis-indented step or a missing `if` surfaces here rather than on the next deploy.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: run the build-output gate between build and pages upload"
```

### Task 7: Release verification and doc sync

**Files:**
- Modify: `.claude/CLAUDE.md` (untracked working-copy doc — `.gitignore:1`, so this step commits nothing)
- Modify: `.claude/docs/progress.md` (same)

**Interfaces:**
- Consumes: every gate above.
- Produces: a merge-ready `develop` with docs naming Astro 7 and `rolldownOptions`/`codeSplitting` instead of Rollup `manualChunks`.

- [ ] **Step 1: Full clean rebuild from scratch.** `rm -rf dist .astro && npm ci && npm run build && npm run lint && npm run data:validate && node scripts/check_build_output.js`
Expected: every command exit 0.

- [ ] **Step 2: Full browser pass, every tab.** Serve 4173 and run `node scripts/verify_render.js`. Then click by hand through the things no automated assertion covers: CE Filter's spiritron combined label (`1st Ascension / 2nd Ascension / Serious Mode`), a starting-member slot showing both `+20%` and `Bond All +25%` badges stacked, the overlap modal, pagination after refresh, and the `A new version is available` banner path (the poller is the piece Task 2 only checks for presence).
Expected: labels spelled with their spaces, modals open, page state survives reload, zero console errors.

- [ ] **Step 3: Update the local docs.** In `.claude/CLAUDE.md`, change `Astro 5` to `Astro 7`, and rewrite the "Vite manual chunk splitting" wording to name `rolldownOptions.output.codeSplitting.groups`. Files are gitignored — no commit.

- [ ] **Step 4: Merge, and watch the first gated deploy.**

```bash
git checkout develop && git merge --no-ff feat/astro-7 && git push
```
Expected: PR/CI green, including `Check build output`. Then the usual `develop` → `main` ship. Warn users still on a stale tab: the deploy changes asset hashes, so the new-version banner will fire and the old tab's chunks will 404 until it reloads.

## Self-Review

- **Spec coverage:** the four Astro 7 breaking surfaces named in Context — Rolldown chunking (Task 4), Node floor (Task 1), HTML strictness (Task 5 Step 1), `compressHTML` (Task 5 Step 2) — each have a task. 6.x is deliberately not a step (abandoned line, and the 6 script-order change is absorbed by Task 2's `<head>` markers instead of being migrated twice).
- **Step scan:** every step names one action plus its expected output. Step 4 of Tasks 4 and 5 give the target shape and let the implementer write the config, because the exact `groups` object is determined by the anchored-regex decision recorded in Interfaces.
- **Type consistency:** `check:build`, `scripts/check_build_output.js`, `scripts/build_baseline.json`, and the JSON keys (`chunks`, `chunkMinBytes`, `rawTextSha`, `normalisedTextSha`, `headMarkers`, `astroVersion`) are used with the same spelling in Tasks 2, 4, 5, 6, 7. Chunk base names match `astro.config.mjs` values exactly.
- **Review Focus:** all five lines have a pinning test — 1 and 5 in Task 2 plus Task 3, 2 in Task 3, 3 in Task 2's byte floor and per-chunk size notes, 4 in Task 2's dual signature with Task 5's decision rule.
- **Proportion:** 7 tasks, one config port, two new scripts, one CI step. The plan is shorter than the verification session it produces.
