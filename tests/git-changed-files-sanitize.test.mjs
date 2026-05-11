import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { collectReviewContext, resolveReviewTarget } from "../plugins/codex/scripts/lib/git.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

test("collectReviewContext sanitizes Changed Files in working-tree mode", (t) => {
  if (process.platform === "win32") {
    t.skip("bidirectional override filenames are not portable on Windows");
    return;
  }

  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  try {
    fs.writeFileSync(path.join(cwd, "evil‮reversed.ts"), "malicious");
  } catch (error) {
    t.skip(`failed to create bidi filename: ${error.message}`);
    return;
  }

  // Given: working tree with evil‮reversed.ts
  // When:  sanitize path flows through collectReviewContext(..., { includeDiff: false })
  // Then:  raw bidi char is absent and escaped filename is present
  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target, { includeDiff: false });

  assert.equal(target.mode, "working-tree");
  assert.equal(context.content.includes("‮"), false);
  assert.equal(context.content.includes("evil\\u202ereversed.ts"), true);
});

test("collectReviewContext sanitizes Changed Files in branch mode", (t) => {
  if (process.platform === "win32") {
    t.skip("bidirectional override filenames are not portable on Windows");
    return;
  }

  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });

  try {
    fs.writeFileSync(path.join(cwd, "evil‮reversed.ts"), "malicious");
  } catch (error) {
    t.skip(`failed to create bidi filename: ${error.message}`);
    return;
  }
  run("git", ["add", "evil‮reversed.ts"], { cwd });
  run("git", ["commit", "-m", "add malicious filename"], { cwd });

  // Given: branch diff with evil‮reversed.ts
  // When:  sanitize path flows through collectReviewContext(..., { includeDiff: false })
  // Then:  raw bidi char is absent and escaped filename is present
  const target = resolveReviewTarget(cwd, { base: "main" });
  const context = collectReviewContext(cwd, target, { includeDiff: false });

  assert.equal(target.mode, "branch");
  assert.equal(context.content.includes("‮"), false);
  assert.equal(context.content.includes("evil\\u202ereversed.ts"), true);
});
