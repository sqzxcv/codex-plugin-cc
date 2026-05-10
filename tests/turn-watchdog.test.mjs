import test from "node:test";
import assert from "node:assert/strict";

import { TurnWatchdogError } from "../plugins/codex/scripts/lib/codex.mjs";

test("TurnWatchdogError carries code, exitCode, and metadata", () => {
  const err = new TurnWatchdogError("watchdog fired after 600000ms", {
    watchdogMs: 600000,
    threadId: "thr_123",
    turnId: "turn_456"
  });

  assert.equal(err.name, "TurnWatchdogError");
  assert.equal(err.code, "TURN_WATCHDOG_TIMEOUT");
  assert.equal(err.exitCode, 124);
  assert.equal(err.watchdogMs, 600000);
  assert.equal(err.threadId, "thr_123");
  assert.equal(err.turnId, "turn_456");
  assert.equal(err.message, "watchdog fired after 600000ms");
  assert.ok(err instanceof Error);
});

test("TurnWatchdogError defaults metadata to null when omitted", () => {
  const err = new TurnWatchdogError("silent");

  assert.equal(err.code, "TURN_WATCHDOG_TIMEOUT");
  assert.equal(err.exitCode, 124);
  assert.equal(err.watchdogMs, null);
  assert.equal(err.threadId, null);
  assert.equal(err.turnId, null);
});
