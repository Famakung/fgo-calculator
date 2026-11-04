#!/usr/bin/env bash
# Merge a source branch into main carrying code only.
#
# The agent-doc tree (.claude/, AGENTS.md, GEMINI.md) is tracked on develop
# alone, so a plain `git merge develop` drags it onto the public branch. This
# script runs the merge and drops those paths from the merge result before the
# commit, and keeps main's own .gitignore (its blanket `.claude` line is what
# hides the leftover files on disk).
#
# Usage: scripts/merge_code_only.sh [source]   # default: develop
# Nothing is pushed — the script prints the push command when it is done.
set -euo pipefail

SRC="${1:-develop}"
TARGET="main"
DOC_PATHS=(.claude AGENTS.md GEMINI.md)

cd "$(git rev-parse --show-toplevel)"

git rev-parse --verify --quiet "refs/heads/$SRC" >/dev/null || {
  echo "merge_code_only: no local branch '$SRC' — $0 must run in the clone that has it" >&2
  exit 1
}
[ -z "$(git status --porcelain --untracked-files=no)" ] || {
  echo "merge_code_only: working tree not clean — commit or stash first" >&2
  exit 1
}

git checkout --quiet "$TARGET"

behind=0
git rev-parse --verify --quiet "origin/$TARGET" >/dev/null &&
  behind="$(git rev-list --count "HEAD..origin/$TARGET")"
[ "$behind" = 0 ] || {
  echo "merge_code_only: local '$TARGET' is $behind commit(s) behind origin/$TARGET — pull it first" >&2
  exit 1
}

ahead="$(git rev-list --count "$TARGET..$SRC")"
if [ "$ahead" = 0 ]; then
  echo "merge_code_only: nothing in '$SRC' that '$TARGET' does not already have"
  exit 0
fi

# Conflicts leave the merge in progress, so set -e must not trip here.
git merge --no-ff --no-commit "$SRC" || true
[ -e "$(git rev-parse --git-path MERGE_HEAD)" ] || {
  echo "merge_code_only: merge of '$SRC' did not start — see the message above" >&2
  exit 1
}

if [ "$(git rev-parse "$SRC:.gitignore")" != "$(git rev-parse "HEAD:.gitignore")" ]; then
  echo "merge_code_only: note — '$SRC' and '$TARGET' disagree on .gitignore; '$TARGET' keeps its own. Port any code-relevant line by hand."
fi
git checkout --quiet HEAD -- .gitignore

# --cached keeps the files on disk: '$TARGET' ignores them, so the tree stays clean.
# -f resolves them even if the merge marked them unmerged (an add/add conflict).
git rm --quiet -r -f --cached --ignore-unmatch -- "${DOC_PATHS[@]}"

conflicts="$(git diff --name-only --diff-filter=U)"
if [ -n "$conflicts" ]; then
  echo "merge_code_only: code conflicts left to resolve — fix them, then 'git commit' (or 'git merge --abort'):" >&2
  echo "$conflicts" >&2
  exit 1
fi

git commit --no-edit --quiet

leftover="$(git ls-tree -r --name-only HEAD -- "${DOC_PATHS[@]}")"
if [ -n "$leftover" ]; then
  echo "merge_code_only: FAILED, docs reached '$TARGET' — undo with 'git reset --hard HEAD~1'" >&2
  echo "$leftover" >&2
  exit 1
fi

echo "merge_code_only: '$TARGET' took $ahead commit(s) from '$SRC', code only. Push with: git push origin $TARGET"
