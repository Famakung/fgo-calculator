# Atlas Data Version Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make idle hourly CI runs stop after one ~230-byte `GET https://api.atlasacademy.io/info` call when the JP game-data version is unchanged, cutting the idle run from ~72s to ~15s.

**Architecture:** A small stdlib-only Python script (`scripts/check_data_version.py`) fetches `/info`, compares `JP.hash` against a hash stored in `.cache/atlas/data_version.txt` (inside the existing `actions/cache` entry), and prints a `CHECK` status. The workflow moves cache restore to the front, runs the gate after it, and stops the job on `schedule` + `UNCHANGED`. Everything downstream (setup-node, npm ci, sync, build, deploy) is unchanged and only runs when the gate says the data may have changed.

**Tech Stack:** Python 3 stdlib only (`urllib`, `json`, `argparse`, `os`) — the runner has python3 preinstalled, so the gate step needs no setup steps. No new npm or pip dependencies.

**Spec:** No separate spec file; the design was agreed in-conversation. Key facts: `/info` returns `{"JP":{"hash":"ee73b6","timestamp":...},...}` (231 bytes, no auth, no ETag needed). The site consumes JP data only. The existing post-sync data-hash gate (`.cache/atlas/data_hash.txt`) already protects the build, so a false-positive version bump costs at most one wasted sync run.

## Global Constraints

- Python: stdlib only; 4-space indent; no new dependencies.
- No test framework in the repo — self-checks are plain-assert scripts run with `python3 <file>`.
- The gate must never fail the workflow: network errors and malformed responses yield `CHECK=UNKNOWN`, which means "continue exactly as before."
- Push and `workflow_dispatch` runs are never blocked by the gate (they must build regardless; `force_sync: true` passes `--force`).
- The image/JSON cache key (`hashFiles('scripts/sync_atlas_data.py')`) must not change — the new gate file must not invalidate the cached 470+ webp images.
- Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Never use `innerHTML` etc. — not relevant here, no DOM code.

## Review Focus

1. **`/info` unreachable or times out** (API down, runner network hiccup) → gate prints `CHECK=UNKNOWN`, exits 0, workflow continues to full sync. A skipped run due to API flakiness would silently drop real game-data updates.
2. **`/info` returns malformed JSON or is missing the `JP` key** → `CHECK=UNKNOWN`, continue. Same rationale as (1).
3. **Version file missing, empty, or corrupt** (partial cache restore, first run ever) → treated as "no stored version" → `CHECK=CHANGED` → full sync re-establishes the file. Self-healing, no manual recovery.
4. **JP hash bumps for data the site does not use** (e.g. event/quest data) → one wasted full sync run, then `UNCHANGED` again; the post-sync data-hash gate prevents a deploy. Acceptable, by design.
5. **Cache key unchanged** → adding the gate file must not change `hashFiles('scripts/sync_atlas_data.py')`, or every run loses the image cache and re-downloads all webp (~minutes, worse than today).

---

### Task 1: Gate script with self-checks

**Files:**
- Create: `scripts/check_data_version.py`
- Test: `scripts/test_check_data_version.py`

**Interfaces:**
- Consumes: nothing (new file).
- Produces:
  - `fetch_latest(url: str) -> str | None` — GET `url`, parse JSON, return `JP.hash` or `None` on any failure (network error, timeout, bad JSON, missing key). Two attempts, 3s between.
  - `decide(latest: str | None, stored: str | None, force: bool) -> str` — pure function returning `"UNKNOWN"` (latest is None), `"CHANGED"` (force, or stored is None/different), else `"UNCHANGED"`.
  - CLI: `python3 scripts/check_data_version.py [--version-file PATH] [--force]`. Defaults: `--version-file .cache/atlas/data_version.txt`, URL from env `ATLAS_INFO_URL` (default `https://api.atlasacademy.io/info`). Prints exactly one line `DATA_VERSION=<hash or ->` and one line `CHECK=<UNCHANGED|CHANGED|UNKNOWN>` to stdout; additionally appends `CHECK=<status>` to `$GITHUB_OUTPUT` when that env var is set (GitHub Actions pattern). Writes the new hash to the version file only when `CHECK=CHANGED` (creates parent dirs). Always exits 0.

- [ ] **Step 1: Write the failing test**

Create `scripts/test_check_data_version.py`. It must:
- `import check_data_version as m` (same directory — add `sys.path.insert(0, os.path.dirname(__file__))` first).
- `test_decide`: assert the truth table — `(None, "x", False) → "UNKNOWN"`, `("a", "a", False) → "UNCHANGED"`, `("b", "a", False) → "CHANGED"`, `("a", None, False) → "CHANGED"`, `("a", "a", True) → "CHANGED"`, `(None, None, True) → "UNKNOWN"` (Unknown beats force).
- `test_unchanged_keeps_file`: start an in-thread `http.server` serving `{"JP": {"hash": "abc123"}}` on 127.0.0.1 at a free port; pre-write `abc123\n` to a tmp version file; run `m.main(["--version-file", tmp])` with `ATLAS_INFO_URL` pointed at the server (save/restore `os.environ`); assert printed status is `UNCHANGED` and the file content is byte-identical afterward.
- `test_changed_updates_file`: same server, version file pre-written with `old999`; assert status `CHANGED`, `DATA_VERSION=abc123` printed, and the file now contains `abc123`.
- `test_missing_file_is_changed`: no version file; assert `CHANGED` and file created with `abc123`.
- `test_malformed_is_unknown`: server responds with body `not json` (one test) and a second variant responding `{"NA": {"hash": "x"}}` (no `JP` key); both assert `UNKNOWN`, exit 0, no file written.
- `test_network_error_is_unknown`: `ATLAS_INFO_URL=http://127.0.0.1:9/` (closed port); assert `UNKNOWN`, exit code 0, and no version file written.
- End with `print(f"{n} tests passed")` and use bare asserts; no pytest.

Run the server helper once for the first four tests (one server, sequential requests is fine) or spin one per test — either way, start/stop in the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 scripts/test_check_data_version.py`
Expected: `ModuleNotFoundError: No module named 'check_data_version'`

- [ ] **Step 3: Implement `scripts/check_data_version.py`**

Structure: module docstring (one line: what + when run), `fetch_latest`, `decide`, `main(argv: list[str] | None = None) -> int`, `if __name__ == "__main__": raise SystemExit(main())`.

Implementation notes that the tests do not pin down:
- `fetch_latest`: `urllib.request.Request(url, headers={"User-Agent": "fgo-calculator-ci"})`, `urlopen(req, timeout=10)`; read body, `json.loads`, return `data["JP"]["hash"]`. Wrap the two attempts in try/except returning `None`; `time.sleep(3)` between attempts.
- Reading `stored`: return `None` if the file is missing; otherwise `read().strip() or None`.
- Writing on CHANGED: `os.makedirs(os.path.dirname(path), exist_ok=True)` (guard: only if dirname is non-empty), write `hash + "\n"`.
- `CHECK` to `$GITHUB_OUTPUT`: `if os.environ.get("GITHUB_OUTPUT"): open(..., "a").write(f"CHECK={status}\n")`.
- Print `DATA_VERSION=` + (latest or `-`).

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 scripts/test_check_data_version.py`
Expected: `5 tests passed`

- [ ] **Step 5: Smoke-test against the live API**

Run: `python3 scripts/check_data_version.py --version-file /tmp/atlas_version_test.txt` (twice).
Expected: first run `CHECK=CHANGED` + `DATA_VERSION=<6-char hash>`; second run `CHECK=UNCHANGED`.

- [ ] **Step 6: Commit**

```bash
git add scripts/check_data_version.py scripts/test_check_data_version.py
git commit -m "feat(ci): add Atlas /info data-version gate script

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Wire the gate into the workflow + doc update

**Files:**
- Modify: `.github/workflows/deploy.yml` (build job step order; add 2 steps; update the schedule comment)
- Modify: `CLAUDE.md` (Deployment section, one line)

**Interfaces:**
- Consumes: `scripts/check_data_version.py` CLI from Task 1 — `--force` flag, stdout `CHECK=...`, and `$GITHUB_OUTPUT` `CHECK` key.
- Produces: workflow step id `data_version` with output `CHECK` (`UNCHANGED` | `CHANGED` | `UNKNOWN`); a `Stop if data unchanged` step; the `build` job's existing `outputs.DEPLOY` gate is untouched and remains the deploy gate.

- [ ] **Step 1: Reorder + insert in `.github/workflows/deploy.yml`**

Target step order in the `build` job (only the changes from today's file, in words):
1. `checkout` (unchanged, first).
2. `Restore Atlas Data & Asset Cache` — moved here, directly after checkout. Its cache `key` line and the "Primary key only (no restore-keys)" comment stay byte-identical (Review Focus 5).
3. New `Check Atlas data version`, `id: data_version`:
   ```yaml
   - name: Check Atlas data version
     id: data_version
     run: |
       FORCE_FLAG="${{ github.event.inputs.force_sync == 'true' && '--force' || '' }}"
       python3 scripts/check_data_version.py $FORCE_FLAG
   ```
4. New `Stop if data unchanged`:
   ```yaml
   - name: Stop if data unchanged
     if: github.event_name == 'schedule' && steps.data_version.outputs.CHECK == 'UNCHANGED'
     run: echo "Atlas data version unchanged. Nothing to do."
   ```
   (A plain successful step — the job ends green, `data_change` never runs, its `DEPLOY` output stays empty, so the existing deploy gate skips deploy.)
5. `Set up Python`, `Install Python dependencies`, `setup-node`, `npm ci` — unchanged, now after the gate.
6. `Sync latest game data from Atlas Academy` — unchanged body, except `FORCE_FLAG` is re-declared in-step (shell vars do not persist across steps): keep the existing `${{ github.event.inputs.force_sync == 'true' && '--force' || '' }}` expression.
7. Everything from `Check if generated data changed` onward — untouched.

Also: extend the `schedule:` cron comment to say the run stops after the `/info` version check when `JP.hash` is unchanged.

- [ ] **Step 2: Verify the workflow**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml')); print('YAML OK')"`
Expected: `YAML OK`. Then eyeball `git diff .github/workflows/deploy.yml`: cache `key:` line unchanged, `deploy` job `if:` line unchanged, all original steps still present.

- [ ] **Step 3: Update `CLAUDE.md`**

In the "Deployment & CI/CD Pipeline" section, after the "ETag revalidation + build gate" bullet, add one bullet:

```markdown
- `/info` version gate: before any env setup or sync, one ~230-byte `GET /info` compares `JP.hash` with `.cache/atlas/data_version.txt` (in the cached `.cache/atlas/`). Idle `schedule` runs stop green on `UNCHANGED` (~15s); push/dispatch/`force_sync` always continue. Network/parse failures report `UNKNOWN` and fall through to the full sync.
```

- [ ] **Step 4: Local end-to-end of the gate path**

Run: `python3 scripts/check_data_version.py --version-file .cache/atlas/data_version.txt` (twice; `.cache/atlas/` already exists with real data — the file it writes is the real one, which is correct: it records the current live hash).
Expected: first run `CHANGED` (no file yet), second `UNCHANGED`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml CLAUDE.md
git commit -m "perf(ci): stop idle schedule runs on Atlas /info version check

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 6: CI verification (after this branch lands on main — the workflow only executes there)**

1. The push run to main must build and deploy exactly as before (gate can never block pushes; confirm `Check Atlas data version` ran and the run is green).
2. The next hourly `schedule` run (~15 min later at :13) must go green in ~15s with `Stop if data unchanged` executed and no build/deploy jobs beyond it.
3. Verify with: `gh run list --branch main --limit 3` and `gh run view <run> --json jobs -q '.jobs[].steps[] | select(.name | test("Atlas|unchanged")) | .name + " " + .status'`.

_Skipped in plan: no unit test of the workflow YAML beyond parse + eyeball (no actionlint in the repo; the CI runs in Step 6 are the real test). Risk: a YAML wiring bug would only show on merge — worst case one or two idle red runs, fixed by a follow-up commit, no data or deploy harm because the gate can only stop, never alter, downstream steps._
