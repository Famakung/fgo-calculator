import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "merge_code_only.sh");

function runMergeScript(args = []) {
  return spawnSync("bash", [SCRIPT_PATH, ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
}

test("merge_code_only: 0 arguments exits 1 and requires commit message", () => {
  const res = runMergeScript([]);
  assert.strictEqual(res.status, 1);
  assert.match(
    res.stderr,
    /commit message required — describe what updated \(e\.g\. 'feat\(scope\): \.\.\.'\), do not use generic 'Merge branch develop'/,
  );
});

test("merge_code_only: 1 argument matching existing local branch exits 1 and requires commit message", () => {
  const res = runMergeScript(["develop"]);
  assert.strictEqual(res.status, 1);
  assert.match(
    res.stderr,
    /commit message required — describe what updated \(e\.g\. 'feat\(scope\): \.\.\.'\), do not use generic 'Merge branch develop'/,
  );

  const resMain = runMergeScript(["main"]);
  assert.strictEqual(resMain.status, 1);
  assert.match(
    resMain.stderr,
    /commit message required — describe what updated \(e\.g\. 'feat\(scope\): \.\.\.'\), do not use generic 'Merge branch develop'/,
  );
});

test("merge_code_only: 1 argument starting with 'Merge branch...' exits 1 with warning", () => {
  const resCapital = runMergeScript(["Merge branch 'develop' into main"]);
  assert.strictEqual(resCapital.status, 1);
  assert.match(resCapital.stderr, /commit message must describe what updated, not 'Merge branch \.\.\.'/);

  const resLower = runMergeScript(["merge branch develop"]);
  assert.strictEqual(resLower.status, 1);
  assert.match(resLower.stderr, /commit message must describe what updated, not 'Merge branch \.\.\.'/);
});

test("merge_code_only: 2 arguments where argument 2 starts with 'Merge branch...' exits 1", () => {
  const res = runMergeScript(["develop", "Merge branch 'feat/some-change'"]);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /commit message must describe what updated, not 'Merge branch \.\.\.'/);

  const resLower = runMergeScript(["develop", "merge branch develop into main"]);
  assert.strictEqual(resLower.status, 1);
  assert.match(resLower.stderr, /commit message must describe what updated, not 'Merge branch \.\.\.'/);
});

test("merge_code_only: nonexistent source branch with valid message exits 1 before checkout", () => {
  const res = runMergeScript(["nonexistent-branch-xyz", "feat(test): valid update message"]);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /no local branch 'nonexistent-branch-xyz'/);
});

test("merge_code_only: empty string arguments exit 1 and require commit message", () => {
  const res1 = runMergeScript([""]);
  assert.strictEqual(res1.status, 1);
  assert.match(res1.stderr, /commit message required/);

  const res2 = runMergeScript(["develop", ""]);
  assert.strictEqual(res2.status, 1);
  assert.match(res2.stderr, /commit message required/);
});

test("merge_code_only: whitespace-only commit messages exit 1 and require commit message", () => {
  const resSpaces = runMergeScript(["   "]);
  assert.strictEqual(resSpaces.status, 1);
  assert.match(resSpaces.stderr, /commit message required/);

  const resTabsNewlines = runMergeScript(["\t\n "]);
  assert.strictEqual(resTabsNewlines.status, 1);
  assert.match(resTabsNewlines.stderr, /commit message required/);

  const resBranchSpaces = runMergeScript(["develop", "   "]);
  assert.strictEqual(resBranchSpaces.status, 1);
  assert.match(resBranchSpaces.stderr, /commit message required/);
});

test("merge_code_only: leading-space regex bypasses exit 1 with warning", () => {
  const resLeadingSpace = runMergeScript(["  Merge branch 'develop'"]);
  assert.strictEqual(resLeadingSpace.status, 1);
  assert.match(resLeadingSpace.stderr, /commit message must describe what updated, not 'Merge branch \.\.\.'/);

  const resLeadingTab = runMergeScript(["\tmerge branch develop"]);
  assert.strictEqual(resLeadingTab.status, 1);
  assert.match(resLeadingTab.stderr, /commit message must describe what updated, not 'Merge branch \.\.\.'/);

  const resMultiSpace = runMergeScript(["develop", "  merge   branch 'feat'"]);
  assert.strictEqual(resMultiSpace.status, 1);
  assert.match(resMultiSpace.stderr, /commit message must describe what updated, not 'Merge branch \.\.\.'/);
});

test("merge_code_only: excessive unquoted arguments (>2) exit 1 with quoting tip", () => {
  const resThreeArgs = runMergeScript(["develop", "arg2", "arg3"]);
  assert.strictEqual(resThreeArgs.status, 1);
  assert.match(resThreeArgs.stderr, /too many arguments \(got 3\) — quote commit message/);

  const resUnquotedWords = runMergeScript(["develop", "feat(shop):", "fix", "layout"]);
  assert.strictEqual(resUnquotedWords.status, 1);
  assert.match(resUnquotedWords.stderr, /too many arguments \(got 4\) — quote commit message/);
});
