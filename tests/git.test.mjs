import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { collectReviewContext, resolveReviewTarget } from "../plugins/codex/scripts/lib/git.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

test("resolveReviewTarget prefers working tree when repo is dirty", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");

  const target = resolveReviewTarget(cwd, {});

  assert.equal(target.mode, "working-tree");
});

test("resolveReviewTarget falls back to branch diff when repo is clean", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "change"], { cwd });

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.mode, "branch");
  assert.match(target.label, /main/);
  assert.match(context.content, /Branch Diff/);
});

test("resolveReviewTarget honors explicit base overrides", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "change"], { cwd });

  const target = resolveReviewTarget(cwd, { base: "main" });

  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
});

test("resolveReviewTarget requires an explicit base when no default branch can be inferred", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["branch", "-m", "feature-only"], { cwd });

  assert.throws(
    () => resolveReviewTarget(cwd, {}),
    /Unable to detect the repository default branch\. Pass --base <ref> or use --scope working-tree\./
  );
});

import { ensureGitRepository, getWorkingTreeState, getCurrentBranch } from "../plugins/codex/scripts/lib/git.mjs";

// ---------------------------------------------------------------------------
// ensureGitRepository
// ---------------------------------------------------------------------------

test("ensureGitRepository returns the repo root for a valid git repo", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "file.txt"), "hello\n");
  run("git", ["add", "file.txt"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  const root = ensureGitRepository(cwd);
  // The returned root should be a non-empty path that contains our file
  assert.ok(typeof root === "string" && root.length > 0);
  assert.ok(fs.existsSync(path.join(root, "file.txt")));
});

test("ensureGitRepository throws when the directory is not a git repo", () => {
  const cwd = makeTempDir(); // plain directory, no git init
  assert.throws(
    () => ensureGitRepository(cwd),
    /This command must run inside a Git repository\./
  );
});

// ---------------------------------------------------------------------------
// getWorkingTreeState
// ---------------------------------------------------------------------------

test("getWorkingTreeState reports clean state after initial commit", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "a.js"), "console.log(1);\n");
  run("git", ["add", "a.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  const state = getWorkingTreeState(cwd);
  assert.equal(state.isDirty, false);
  assert.deepEqual(state.staged, []);
  assert.deepEqual(state.unstaged, []);
  assert.deepEqual(state.untracked, []);
});

test("getWorkingTreeState detects staged changes", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "a.js"), "v1\n");
  run("git", ["add", "a.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  fs.writeFileSync(path.join(cwd, "a.js"), "v2\n");
  run("git", ["add", "a.js"], { cwd });

  const state = getWorkingTreeState(cwd);
  assert.equal(state.isDirty, true);
  assert.ok(state.staged.includes("a.js"));
});

test("getWorkingTreeState detects unstaged changes", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "b.js"), "v1\n");
  run("git", ["add", "b.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  fs.writeFileSync(path.join(cwd, "b.js"), "v2\n");

  const state = getWorkingTreeState(cwd);
  assert.equal(state.isDirty, true);
  assert.ok(state.unstaged.includes("b.js"));
});

test("getWorkingTreeState detects untracked files", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "tracked.js"), "v1\n");
  run("git", ["add", "tracked.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "new.js"), "new file\n");

  const state = getWorkingTreeState(cwd);
  assert.equal(state.isDirty, true);
  assert.ok(state.untracked.includes("new.js"));
});

// ---------------------------------------------------------------------------
// getCurrentBranch
// ---------------------------------------------------------------------------

test("getCurrentBranch returns the current branch name", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "x.js"), "x\n");
  run("git", ["add", "x.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  const branch = getCurrentBranch(cwd);
  assert.equal(branch, "main");
});

test("getCurrentBranch returns the name of a checked-out feature branch", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "x.js"), "x\n");
  run("git", ["add", "x.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/my-work"], { cwd });

  const branch = getCurrentBranch(cwd);
  assert.equal(branch, "feature/my-work");
});

// ---------------------------------------------------------------------------
// resolveReviewTarget — additional scope cases
// ---------------------------------------------------------------------------

test("resolveReviewTarget honours explicit working-tree scope even when repo is clean", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "v1\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  const target = resolveReviewTarget(cwd, { scope: "working-tree" });

  assert.equal(target.mode, "working-tree");
  assert.equal(target.explicit, true);
});

test("resolveReviewTarget throws for an unsupported scope string", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "v1\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  assert.throws(
    () => resolveReviewTarget(cwd, { scope: "staged" }),
    /Unsupported review scope/
  );
});
