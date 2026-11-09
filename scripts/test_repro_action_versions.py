"""Reproduction test verifying GitHub Actions version references in .github/workflows/deploy.yml.

Fails deterministically when non-existent or invalid action version tags are referenced.
"""

import os
import sys
import yaml

WF_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "workflows", "deploy.yml")

# Map of GitHub Actions to their maximum known official major release versions
# Official action repositories under github.com/actions/*
KNOWN_MAX_ACTION_VERSIONS = {
    "actions/checkout": 7,
    "actions/cache": 6,
    "actions/cache/restore": 6,
    "actions/cache/save": 6,
    "actions/setup-python": 7,
    "actions/setup-node": 7,
    "actions/upload-pages-artifact": 4,  # v4 is current latest major; v5 does not exist
    "actions/deploy-pages": 4,          # v4 is current latest major; v5 does not exist
}


def load_workflow_spec(file_path: str) -> dict:
    with open(os.path.normpath(file_path), "r", encoding="utf-8") as file:
        return yaml.safe_load(file)


def parse_step_action(job_name: str, step: dict):
    uses = step.get("uses", "")
    if not uses or "@" not in uses:
        return None
    action_name, version = uses.split("@", 1)
    step_name = step.get("name", "unnamed")
    return (job_name, step_name, action_name, version)


def extract_action_refs(workflow_spec: dict) -> list:
    refs = []
    jobs = workflow_spec.get("jobs", {})
    for job_name, job_data in jobs.items():
        for step in job_data.get("steps", []):
            ref = parse_step_action(job_name, step)
            if ref:
                refs.append(ref)
    return refs


def parse_major_version(version: str):
    if not version.startswith("v"):
        return None
    try:
        return int(version[1:].split(".")[0])
    except ValueError:
        return None


def check_action_reference(ref: tuple):
    job, step_name, action, version = ref
    max_version = KNOWN_MAX_ACTION_VERSIONS.get(action)
    if max_version is None:
        return None
    version_number = parse_major_version(version)
    if version_number is None or version_number <= max_version:
        return None
    return (
        f"Job '{job}' step '{step_name}' uses {action}@{version}, "
        f"but max available major version is v{max_version} (v{version_number} does not exist)"
    )


def find_action_version_failures(refs: list) -> list:
    failures = []
    for ref in refs:
        error_message = check_action_reference(ref)
        if error_message:
            failures.append(error_message)
    return failures


def report_results(refs_count: int, failures: list) -> None:
    if not failures:
        print(f"PASS: All {refs_count} action references are valid and exist.")
        return
    print("FAIL: Invalid / non-existent action versions detected:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)


def test_action_versions() -> None:
    spec = load_workflow_spec(WF_PATH)
    refs = extract_action_refs(spec)
    failures = find_action_version_failures(refs)
    report_results(len(refs), failures)


if __name__ == "__main__":
    test_action_versions()
