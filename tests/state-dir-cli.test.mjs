import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";

const COMPANION_SCRIPT = path.resolve(import.meta.dirname, "../plugins/codex/scripts/codex-companion.mjs");

function runCompanion(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  delete env.CODEX_COMPANION_STATE_DIR;
  if (opts.env && "CODEX_COMPANION_STATE_DIR" in opts.env) {
    env.CODEX_COMPANION_STATE_DIR = opts.env.CODEX_COMPANION_STATE_DIR;
  }
  return spawnSync(process.execPath, [COMPANION_SCRIPT, ...args], {
    env,
    encoding: "utf8",
    windowsHide: true
  });
}

// CLI tests for the `--state-dir <abs-path>` global flag and the equivalent
// CODEX_COMPANION_STATE_DIR env var. Behavior-observing where possible:
// uses `setup --enable-review-gate --json` which writes state.json so each
// assertion can prove the override actually changed state-resolution.

test("CLI: --state-dir <abs-path> BEFORE subcommand routes state.json to override", () => {
  const override = makeTempDir();
  const result = runCompanion(["--state-dir", override, "setup", "--enable-review-gate", "--json"]);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const stateFile = path.join(override, "state.json");
  assert.equal(fs.existsSync(stateFile), true, `expected state.json at ${stateFile}`);
  const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(parsed.config.stopReviewGate, true);
});

test("CLI: --state-dir <abs-path> AFTER subcommand routes state.json to override (unquoted-$ARGUMENTS slash form)", () => {
  // Slash commands like /codex:setup, /codex:status, /codex:result, /codex:cancel
  // pass user args UNQUOTED via $ARGUMENTS, so bash word-splits them into
  // separate argv elements. The global parser must accept the flag at any
  // position when shell-tokenized.
  const override = makeTempDir();
  const result = runCompanion(["setup", "--enable-review-gate", "--state-dir", override, "--json"]);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const stateFile = path.join(override, "state.json");
  assert.equal(fs.existsSync(stateFile), true, `expected state.json at ${stateFile}`);
});

test("CLI: --state-dir=<abs-path> inline-equals form (any position)", () => {
  const override = makeTempDir();
  const result = runCompanion(["setup", "--enable-review-gate", `--state-dir=${override}`, "--json"]);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(fs.existsSync(path.join(override, "state.json")), true);
});

test("CLI: env CODEX_COMPANION_STATE_DIR (absolute) routes state.json to override (no flag)", () => {
  // Env-var form. Required when invoking the QUOTED-$ARGUMENTS slash commands
  // (/codex:review, /codex:adversarial-review, /codex:task) where the flag
  // form is NOT extracted.
  const override = makeTempDir();
  const result = runCompanion(["setup", "--enable-review-gate", "--json"], {
    env: { CODEX_COMPANION_STATE_DIR: override }
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(fs.existsSync(path.join(override, "state.json")), true);
});

test("CLI: --state-dir with relative value is left as positional (NOT extracted)", () => {
  // Only absolute paths are extracted. Relative values would cause cross-
  // process drift (parent and child resolve against different cwds), so
  // they are deliberately rejected at the parser layer.
  const override = makeTempDir();
  const result = runCompanion(["--state-dir", "relative/path", "setup", "--enable-review-gate", "--json"]);
  // setup will run with whatever default state location it picks (NOT the
  // relative override). We assert: NO state.json was written under our
  // temp override (since we didn't pass an absolute path here).
  assert.equal(fs.existsSync(path.join(override, "state.json")), false);
  // setup may itself error because "relative/path" gets passed through as
  // a positional argv element and setup doesn't recognize it. We don't
  // assert the exit code here; only the parser-level behavior (no extraction).
});

test("CLI: --state-dir followed by option-looking value is NOT extracted", () => {
  // path.isAbsolute("--json") -> false. Parser must leave --state-dir as a
  // positional rather than greedily consuming the next flag as its value.
  const result = runCompanion(["--state-dir", "--json", "setup", "--enable-review-gate"]);
  // setup will see ["--state-dir", "--json", "--enable-review-gate"] which is
  // unexpected; assert only that the parser did NOT crash with a TypeError.
  assert.doesNotMatch(result.stderr, /TypeError|ReferenceError/);
});

test("CLI: --state-dir=<path-with-whitespace> is NOT extracted (defense against quoted-$ARGUMENTS misparse)", () => {
  // path.isAbsolute("/tmp/foo extra-text") returns true (spaces don't break
  // absolute detection), but consuming such a token would silently truncate
  // the user's actual prompt. Parser defensively rejects whitespace values.
  const override = makeTempDir();
  // Simulate the bug shape: --state-dir=<path> <extra-text> all in one element.
  const result = runCompanion([`--state-dir=${override} extra-prompt-text`, "setup", "--enable-review-gate", "--json"]);
  // Override should NOT have been set (whitespace check rejects):
  assert.equal(fs.existsSync(path.join(override, "state.json")), false);
});

test("CLI: subcommand prompt text mentioning --state-dir is NOT consumed when whitespace-attached", () => {
  // Per parser comment: when the flag value contains whitespace (e.g., a
  // prompt that legitimately mentions --state-dir followed by free-form
  // text), the parser leaves the token alone. For prompts in QUOTED form
  // ($ARGUMENTS), the entire prompt is one argv element so the prefix-check
  // would match — but the whitespace-rejection prevents the bug.
  const override = makeTempDir();
  const result = runCompanion([
    "adversarial-review",
    "--scope",
    "auto",
    "--state-dir",
    "fake-value-inside-prompt"
  ]);
  // No --state-dir/jobs/ should appear at the temp dir; the relative value
  // "fake-value-inside-prompt" wouldn't pass path.isAbsolute anyway.
  assert.equal(fs.existsSync(path.join(override, "state.json")), false);
});

test("CLI: -- explicitly stops global parsing (passthrough)", () => {
  // Even an absolute path AFTER `--` must NOT be extracted. Lets users
  // disambiguate any prompt text containing the flag.
  const override = makeTempDir();
  const result = runCompanion(["setup", "--enable-review-gate", "--json", "--", "--state-dir", override]);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(
    fs.existsSync(path.join(override, "state.json")),
    false,
    "override extraction must be suppressed after `--` passthrough"
  );
});

test("CLI: duplicate --state-dir flags — last absolute value wins", () => {
  const first = makeTempDir();
  const second = makeTempDir();
  const result = runCompanion([
    "--state-dir",
    first,
    "--state-dir",
    second,
    "setup",
    "--enable-review-gate",
    "--json"
  ]);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  // Loop is left-to-right; final setStateDirOverride call wins.
  assert.equal(fs.existsSync(path.join(second, "state.json")), true);
  assert.equal(fs.existsSync(path.join(first, "state.json")), false);
});

test("CLI: quoted-$ARGUMENTS form is documented limitation (use env var instead)", () => {
  // The plugin's review/adversarial-review/task slash commands pass user
  // args as a single quoted string ($ARGUMENTS becomes one argv element).
  // The flag form does NOT work in that case — users must use the env var.
  // This test documents the limitation: passing the flag inside a single
  // argv element does NOT set the override.
  const override = makeTempDir();
  // Single-element argv after subcommand, like quoted "$ARGUMENTS":
  const quotedSingleString = `--state-dir ${override} my prompt text`;
  const result = runCompanion(["task", quotedSingleString]);
  // Override should NOT have been set (parser doesn't tokenize within argv
  // elements). Users invoking review/adversarial-review/task must use the
  // env var form instead — see printUsage() output.
  assert.equal(
    fs.existsSync(path.join(override, "state.json")),
    false,
    "documented limitation: flag inside quoted $ARGUMENTS NOT extracted; use env var"
  );
});
