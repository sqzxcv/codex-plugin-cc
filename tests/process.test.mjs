import test from "node:test";
import assert from "node:assert/strict";

import { inspectProcess, normalizePid, terminateProcessTree } from "../plugins/codex/scripts/lib/process.mjs";

test("normalizePid rejects missing and invalid pid values", () => {
  assert.equal(normalizePid(null), null);
  assert.equal(normalizePid(""), null);
  assert.equal(normalizePid(-1), null);
  assert.equal(normalizePid("123.9"), 123);
});

test("inspectProcess reports missing and dead pids deterministically", () => {
  assert.deepEqual(inspectProcess(null), {
    pid: null,
    live: false,
    reason: "missing_pid",
    detail: "Job has no valid pid."
  });

  const dead = inspectProcess(1234, {
    killImpl() {
      const error = new Error("no such process");
      error.code = "ESRCH";
      throw error;
    }
  });

  assert.equal(dead.pid, 1234);
  assert.equal(dead.live, false);
  assert.equal(dead.reason, "dead_pid");
  assert.match(dead.detail, /not running/);
});

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
