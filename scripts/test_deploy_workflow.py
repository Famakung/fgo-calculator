"""Self-check for the /info gate wiring in .github/workflows/deploy.yml.

Run: python3 scripts/test_deploy_workflow.py
Pins six scenarios of the build job (DO_WORK/DEPLOY gates):
  1. idle schedule (CHECK=UNCHANGED)        -> only the decide step may run after the version check
  2. schedule, CHECK=CHANGED, data dirty    -> sync through upload all run
  3. schedule, CHECK=CHANGED, data clean    -> sync + hash check run, build/upload skip
  4. push (any CHECK)                       -> no step after the check may be blocked
  5. workflow_dispatch, no force, UNCHANGED -> only the decide step may run
  6. workflow_dispatch, force_sync (CHECK=CHANGED) -> every step after the check runs
"""

import os

import yaml

WF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "workflows", "deploy.yml")

VARS = {
    "steps.do_work.outputs.DO_WORK": "W",
    "steps.data_change.outputs.DEPLOY": "P",
    "steps.data_change.outputs.DATA_DIRTY": "D",
    "steps.data_version.outputs.CHECK": "C",
    "github.event_name": "G",
}

MARKER = "Decide whether to do work"


def would_run(cond, G, C, D, W, P):
    """Evaluate a step's `if` (or 'true' when absent) for a scenario. Conditions only use ==/!=, &&, ||, literals."""
    if not cond:
        return True
    expr = cond
    for key, var in sorted(VARS.items(), key=len, reverse=True):
        expr = expr.replace(key, var)
    expr = expr.replace("&&", " and ").replace("||", " or ")
    return bool(eval(expr, {"__builtins__": {}}, {"G": G, "C": C, "D": D, "W": W, "P": P}))


def steps_after_check():
    spec = yaml.safe_load(open(os.path.normpath(WF), encoding="utf-8"))
    steps = spec["jobs"]["build"]["steps"]
    idx = next(i for i, s in enumerate(steps) if s.get("name") == "Check Atlas data version")
    return [(s.get("name") or s.get("uses", "?"), s.get("if")) for s in steps[idx + 1 :]]


def scenario_values(G, C, F, D):
    """Derive W (DO_WORK) and P (DEPLOY) exactly as the workflow's bash computes them."""
    W = "true" if (G == "push" or C != "UNCHANGED") else "false"
    P = "true" if (G == "push" or F == "true" or D == "true") else "false"
    return W, P


def main():
    n = 0

    # 1. idle schedule: nothing after the check runs except the marker
    W, P = scenario_values("schedule", "UNCHANGED", "false", "")
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert not would_run(cond, "schedule", "UNCHANGED", "", W, P), f"step {name!r} would run on an idle schedule run: if={cond!r}"
    n += 1

    # 2. schedule, data changed, data dirty: sync through upload must all run
    W, P = scenario_values("schedule", "CHANGED", "false", "true")
    for name in ("Sync latest game data from Atlas Academy", "Check if generated data changed", "Validate data integrity", "Build", "Verify build outputs", "Upload Pages artifact"):
        cond = next(c for nm, c in steps_after_check() if nm == name)
        assert would_run(cond, "schedule", "CHANGED", "true", W, P), f"step {name!r} is blocked when data changed and dirty"
    n += 1

    # 3. schedule, data changed, data clean: sync + hash check run, build/upload skip
    W, P = scenario_values("schedule", "CHANGED", "false", "false")
    for name, cond in steps_after_check():
        if name in ("Validate data integrity", "Build", "Verify build outputs", "Upload Pages artifact"):
            assert not would_run(cond, "schedule", "CHANGED", "false", W, P), f"step {name!r} should skip when generated data is clean: if={cond!r}"
        else:
            assert would_run(cond, "schedule", "CHANGED", "false", W, P), f"step {name!r} should run when data changed (clean): if={cond!r}"
    n += 1

    # 4. push, worst case (data clean, CHECK stale): nothing after the check is blocked
    W, P = scenario_values("push", "UNCHANGED", "false", "false")
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert would_run(cond, "push", "UNCHANGED", "false", W, P), f"step {name!r} is blocked on a push: if={cond!r}"
    n += 1

    # 5. manual dispatch, no force, unchanged: only the decide step may run
    W, P = scenario_values("workflow_dispatch", "UNCHANGED", "false", "")
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert not would_run(cond, "workflow_dispatch", "UNCHANGED", "", W, P), f"step {name!r} would run on a no-force dispatch with unchanged data: if={cond!r}"
    n += 1

    # 6. manual dispatch with force_sync: the check step passes --force, so real
    #    CI yields CHECK=CHANGED even when both hashes match — model that; every
    #    step after the check must run
    W, P = scenario_values("workflow_dispatch", "CHANGED", "true", "false")
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert would_run(cond, "workflow_dispatch", "CHANGED", "false", W, P), f"step {name!r} is blocked on a forced dispatch: if={cond!r}"
    n += 1

    # 7. generated data dir is cached and NOT wiped, so the targeted drift path
    #    (revalidate_servant_traits) runs in CI instead of a full regen; the
    #    cache key must keep hashing sync_atlas_data.py so a format change
    #    invalidates the data cache
    spec = yaml.safe_load(open(os.path.normpath(WF), encoding="utf-8"))
    steps = spec["jobs"]["build"]["steps"]
    cache_step = next(s for s in steps if s.get("name") == "Restore Atlas Data & Asset Cache")
    cache_path = cache_step["with"]["path"]
    cache_key = cache_step["with"]["key"]
    sync_run = next(s for s in steps if s.get("name") == "Sync latest game data from Atlas Academy")["run"]
    assert "src/scripts/data/" in cache_path, "data dir not in cache path"
    assert "rm -f" not in sync_run, "sync still wipes generated data"
    assert "sync_atlas_data.py" in cache_key, "cache key must hash sync_atlas_data.py"
    n += 1

    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
