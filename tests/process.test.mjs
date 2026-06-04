import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

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

test(
  "terminateProcessTree reaps a detached process group on POSIX",
  { skip: process.platform === "win32" },
  async () => {
    // Mirrors how the codex app-server is spawned: `detached` so the child
    // leads its own process group and the whole subtree (the two `sleep`s
    // stand in for the MCP servers codex spawns) is reaped by a single group
    // signal. Without `detached`, the child shares the parent group, the
    // `kill(-pid)` group signal returns ESRCH, and the grandchildren leak.
    const child = spawn("sh", ["-c", "sleep 30 & sleep 30 & wait"], {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {});
    // A detached child is its own group leader, so its pgid equals its pid.
    const pgid = child.pid;
    // Let the grandchildren come up, then confirm the group is alive.
    await delay(200);
    assert.doesNotThrow(() => process.kill(-pgid, 0));

    const outcome = terminateProcessTree(child.pid);
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.method, "process-group");

    // The entire group — leader and both grandchildren — must be gone.
    let groupGone = false;
    for (let i = 0; i < 50; i += 1) {
      try {
        process.kill(-pgid, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          groupGone = true;
          break;
        }
        throw error;
      }
      await delay(100);
    }
    assert.equal(groupGone, true, "detached process group should be fully terminated");
  }
);
