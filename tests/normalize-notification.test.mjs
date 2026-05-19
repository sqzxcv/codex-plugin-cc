import test from "node:test";
import assert from "node:assert/strict";

import "./helpers.mjs"; // run shared env-isolation side effect
import { normalizeNotification } from "../plugins/codex/scripts/lib/codex.mjs";

function makeState(overrides = {}) {
  return {
    threadId: "thr_main",
    threadTurnIds: new Map(),
    threadLabels: new Map(),
    ...overrides
  };
}

test("normalizeNotification: thread/started carries thread id and starting phase", () => {
  const state = makeState();
  const event = normalizeNotification(state, {
    method: "thread/started",
    params: { thread: { id: "thr_xyz", name: "rescue task" } }
  });

  assert.equal(event.method, "thread/started");
  assert.equal(event.threadId, "thr_xyz");
  assert.equal(event.phase, "starting");
  assert.equal(event.turnId, null);
  assert.equal(event.itemType, null);
  assert.equal(event.lifecycle, null);
  assert.match(event.message, /Thread started/);
  assert.match(event.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test("normalizeNotification: turn/started captures turnId and 'thinking' phase", () => {
  const state = makeState();
  const event = normalizeNotification(state, {
    method: "turn/started",
    params: { threadId: "thr_main", turn: { id: "trn_001" } }
  });

  assert.equal(event.method, "turn/started");
  assert.equal(event.threadId, "thr_main");
  assert.equal(event.turnId, "trn_001");
  assert.equal(event.phase, "thinking");
});

test("normalizeNotification: item/started commandExecution maps to running phase", () => {
  const state = makeState();
  state.threadTurnIds.set("thr_main", "trn_001");

  const event = normalizeNotification(state, {
    method: "item/started",
    params: {
      threadId: "thr_main",
      item: { type: "commandExecution", command: "git status" }
    }
  });

  assert.equal(event.method, "item/started");
  assert.equal(event.itemType, "commandExecution");
  assert.equal(event.lifecycle, "started");
  assert.equal(event.turnId, "trn_001");
  assert.equal(event.phase, "running");
  assert.match(event.message, /Running command: git status/);
});

test("normalizeNotification: item/started commandExecution detects verifying phase for test commands", () => {
  const state = makeState();
  const event = normalizeNotification(state, {
    method: "item/started",
    params: {
      threadId: "thr_main",
      item: { type: "commandExecution", command: "npm test" }
    }
  });

  // looksLikeVerificationCommand recognizes test/check/lint patterns
  assert.equal(event.phase, "verifying");
});

test("normalizeNotification: item/started fileChange maps to editing phase", () => {
  const event = normalizeNotification(makeState(), {
    method: "item/started",
    params: {
      threadId: "thr_main",
      item: { type: "fileChange", changes: [{}, {}, {}] }
    }
  });

  assert.equal(event.itemType, "fileChange");
  assert.equal(event.phase, "editing");
  assert.match(event.message, /3 file change/);
});

test("normalizeNotification: item/started mcpToolCall maps to investigating phase", () => {
  const event = normalizeNotification(makeState(), {
    method: "item/started",
    params: {
      threadId: "thr_main",
      item: { type: "mcpToolCall", server: "context7", tool: "resolve-library-id" }
    }
  });

  assert.equal(event.itemType, "mcpToolCall");
  assert.equal(event.phase, "investigating");
  assert.match(event.message, /context7\/resolve-library-id/);
});

test("normalizeNotification: item/started webSearch maps to investigating phase", () => {
  const event = normalizeNotification(makeState(), {
    method: "item/started",
    params: {
      threadId: "thr_main",
      item: { type: "webSearch", query: "claude code agent sdk" }
    }
  });

  assert.equal(event.itemType, "webSearch");
  assert.equal(event.phase, "investigating");
  assert.match(event.message, /Searching/);
});

test("normalizeNotification: item/completed carries completed lifecycle + exit code", () => {
  const event = normalizeNotification(makeState(), {
    method: "item/completed",
    params: {
      threadId: "thr_main",
      item: { type: "commandExecution", command: "echo hi", status: "completed", exitCode: 0 }
    }
  });

  assert.equal(event.method, "item/completed");
  assert.equal(event.lifecycle, "completed");
  assert.equal(event.itemType, "commandExecution");
  assert.match(event.message, /Command completed/);
  assert.match(event.message, /exit 0/);
});

test("normalizeNotification: turn/completed with status=completed yields 'completed' phase", () => {
  const event = normalizeNotification(makeState(), {
    method: "turn/completed",
    params: { threadId: "thr_main", turn: { id: "trn_001", status: "completed" } }
  });

  assert.equal(event.method, "turn/completed");
  assert.equal(event.phase, "completed");
  assert.equal(event.turnId, "trn_001");
});

test("normalizeNotification: turn/completed with non-completed status yields 'finalizing' phase", () => {
  const event = normalizeNotification(makeState(), {
    method: "turn/completed",
    params: { threadId: "thr_main", turn: { id: "trn_001", status: "cancelled" } }
  });

  assert.equal(event.phase, "finalizing");
  assert.match(event.message, /cancelled/);
});

test("normalizeNotification: error notification yields 'failed' phase", () => {
  const event = normalizeNotification(makeState(), {
    method: "error",
    params: { error: { message: "context length exceeded", code: "context_overflow" } }
  });

  assert.equal(event.method, "error");
  assert.equal(event.phase, "failed");
  assert.match(event.message, /context length exceeded/);
  assert.equal(event.raw.code, "context_overflow");
});

test("normalizeNotification: unknown method falls back to 'unknown' phase without throwing", () => {
  const event = normalizeNotification(makeState(), {
    method: "thread/compact/started",
    params: { threadId: "thr_main" }
  });

  assert.equal(event.method, "thread/compact/started");
  assert.equal(event.phase, "unknown");
  assert.equal(event.threadId, "thr_main");
});

test("normalizeNotification: handles malformed message without crashing", () => {
  // No method, no params, weird shape — should still return a valid record
  const event = normalizeNotification(makeState(), {});

  assert.equal(event.method, null);
  assert.equal(event.phase, "unknown");
  assert.match(event.ts, /^\d{4}-\d{2}-\d{2}T/);
});
