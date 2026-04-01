import test from "node:test";
import assert from "node:assert/strict";

import { terminateProcessTree } from "../plugins/codex/scripts/lib/process.mjs";

test("terminateProcessTree uses taskkill on Windows", () => {
  let captured = null;
  const outcome = terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl(command, args) {
      captured = { command, args };
      return {
        command,
        args,
        status: 0,
        signal: null,
        stdout: "",
        stderr: "",
        error: null
      };
    },
    killImpl() {
      throw new Error("kill fallback should not run");
    }
  });

  assert.deepEqual(captured, {
    command: "taskkill",
    args: ["/PID", "1234", "/T", "/F"]
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.method, "taskkill");
});

test("terminateProcessTree treats missing Windows processes as already stopped", () => {
  const outcome = terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl(command, args) {
      return {
        command,
        args,
        status: 128,
        signal: null,
        stdout: "ERROR: The process \"1234\" not found.",
        stderr: "",
        error: null
      };
    }
  });

  assert.equal(outcome.attempted, true);
  assert.equal(outcome.method, "taskkill");
  assert.equal(outcome.result.status, 128);
  assert.match(outcome.result.stdout, /not found/i);
});

import { binaryAvailable, formatCommandFailure, runCommand, runCommandChecked } from "../plugins/codex/scripts/lib/process.mjs";

// ---------------------------------------------------------------------------
// terminateProcessTree — Unix paths
// ---------------------------------------------------------------------------

test("terminateProcessTree uses process-group SIGTERM on Unix", () => {
  let capturedPid = null;
  let capturedSignal = null;
  const outcome = terminateProcessTree(5678, {
    platform: "linux",
    killImpl(pid, signal) {
      capturedPid = pid;
      capturedSignal = signal;
    }
  });

  assert.equal(capturedPid, -5678);
  assert.equal(capturedSignal, "SIGTERM");
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.method, "process-group");
});

test("terminateProcessTree falls back to individual process SIGTERM when group kill fails with a non-ESRCH error", () => {
  let killCallCount = 0;
  const outcome = terminateProcessTree(9999, {
    platform: "linux",
    killImpl(pid, signal) {
      killCallCount += 1;
      if (pid < 0) {
        const err = new Error("EPERM");
        err.code = "EPERM";
        throw err;
      }
    }
  });

  assert.equal(killCallCount, 2);
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.method, "process");
});

test("terminateProcessTree returns not-delivered for process-group when group kill throws ESRCH", () => {
  const outcome = terminateProcessTree(1111, {
    platform: "linux",
    killImpl(pid) {
      const err = new Error("ESRCH");
      err.code = "ESRCH";
      throw err;
    }
  });

  assert.equal(outcome.attempted, true);
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.method, "process-group");
});

test("terminateProcessTree returns not-attempted for a non-finite pid", () => {
  const outcome = terminateProcessTree(NaN, { platform: "linux" });
  assert.equal(outcome.attempted, false);
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.method, null);
});

// ---------------------------------------------------------------------------
// binaryAvailable
// ---------------------------------------------------------------------------

test("binaryAvailable returns available:true for a known binary", () => {
  // node is always available in this environment
  const result = binaryAvailable("node", ["--version"]);
  assert.equal(result.available, true);
  assert.match(result.detail, /v\d+/);
});

test("binaryAvailable returns available:false for a non-existent binary", () => {
  const result = binaryAvailable("__this_binary_does_not_exist__");
  assert.equal(result.available, false);
  assert.equal(result.detail, "not found");
});

// ---------------------------------------------------------------------------
// formatCommandFailure
// ---------------------------------------------------------------------------

test("formatCommandFailure includes command and exit code", () => {
  const msg = formatCommandFailure({ command: "git", args: ["status"], status: 128, signal: null, stdout: "", stderr: "fatal: not a git repo" });
  assert.match(msg, /git status/);
  assert.match(msg, /exit=128/);
  assert.match(msg, /fatal: not a git repo/);
});

test("formatCommandFailure uses signal instead of exit code when a signal is present", () => {
  const msg = formatCommandFailure({ command: "node", args: ["app.js"], status: null, signal: "SIGTERM", stdout: "", stderr: "" });
  assert.match(msg, /signal=SIGTERM/);
  assert.doesNotMatch(msg, /exit=/);
});

test("formatCommandFailure falls back to stdout when stderr is empty", () => {
  const msg = formatCommandFailure({ command: "echo", args: ["hi"], status: 1, signal: null, stdout: "hi", stderr: "" });
  assert.match(msg, /hi/);
});

// ---------------------------------------------------------------------------
// runCommand / runCommandChecked
// ---------------------------------------------------------------------------

test("runCommand returns stdout, stderr, and status 0 for a successful command", () => {
  const result = runCommand("node", ["--version"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /v\d+\.\d+\.\d+/);
  assert.equal(result.error, null);
});

test("runCommandChecked throws on non-zero exit", () => {
  assert.throws(
    () => runCommandChecked("node", ["-e", "process.exit(1)"]),
    /exit=1/
  );
});

test("runCommandChecked throws when the binary is not found", () => {
  assert.throws(
    () => runCommandChecked("__totally_missing_binary__", [])
  );
});
