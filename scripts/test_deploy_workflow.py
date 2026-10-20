"""Self-check for the /info gate wiring in .github/workflows/deploy.yml.

Run: python3 scripts/test_deploy_workflow.py
Pins three scenarios of the build job:
  1. idle schedule (CHECK=UNCHANGED)  -> only the marker step may run after the version check
  2. schedule with CHECK=CHANGED      -> sync and data_change steps must run
  3. push (any CHECK)                 -> no step after the check may be blocked
"""

import os

import yaml

WF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "workflows", "deploy.yml")

VARS = {
    "steps.data_version.outputs.CHECK": "C",
    "steps.data_change.outputs.DATA_DIRTY": "D",
    "github.event_name": "G",
}

MARKER = "Stop if data unchanged"


def would_run(cond, G, C, D):
    """Evaluate a step's `if` (or 'true' when absent) for a scenario. Conditions only use ==/!=, &&, ||, literals."""
    if not cond:
        return True
    expr = cond
    for key, var in sorted(VARS.items(), key=len, reverse=True):
        expr = expr.replace(key, var)
    expr = expr.replace("&&", " and ").replace("||", " or ")
    return bool(eval(expr, {"__builtins__": {}}, {"G": G, "C": C, "D": D}))


def steps_after_check():
    spec = yaml.safe_load(open(os.path.normpath(WF), encoding="utf-8"))
    steps = spec["jobs"]["build"]["steps"]
    idx = next(i for i, s in enumerate(steps) if s.get("name") == "Check Atlas data version")
    return [(s.get("name") or s.get("uses", "?"), s.get("if")) for s in steps[idx + 1 :]]


def main():
    n = 0

    # 1. idle schedule: nothing after the check runs except the marker
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert not would_run(cond, "schedule", "UNCHANGED", ""), f"step {name!r} would run on an idle schedule run: if={cond!r}"
    n += 1

    # 2. schedule with data changed: sync + hash check must run
    for name in ("Sync latest game data from Atlas Academy", "Check if generated data changed"):
        cond = next(c for nm, c in steps_after_check() if nm == name)
        assert would_run(cond, "schedule", "CHANGED", ""), f"step {name!r} is blocked when data changed"
    n += 1

    # 3. push: nothing after the check is blocked (data clean, CHECK stale)
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert would_run(cond, "push", "UNCHANGED", "false"), f"step {name!r} is blocked on a push: if={cond!r}"
    n += 1

    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
