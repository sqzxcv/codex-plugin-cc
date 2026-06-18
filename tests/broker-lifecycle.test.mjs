import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { resolveStateRoot } from "../plugins/codex/scripts/lib/state.mjs";
import { resolveSessionId } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";

test("resolveStateRoot uses CLAUDE_PLUGIN_DATA/state when set", () => {
  const pluginData = makeTempDir();
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  try {
    assert.equal(resolveStateRoot(), path.join(pluginData, "state"));
  } finally {
    if (prev == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
  }
});

test("resolveStateRoot falls back to a tmp dir when CLAUDE_PLUGIN_DATA is unset", () => {
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    assert.equal(resolveStateRoot(), path.join(os.tmpdir(), "codex-companion"));
  } finally {
    if (prev != null) process.env.CLAUDE_PLUGIN_DATA = prev;
  }
});

test("resolveSessionId prefers explicit option, then env, then null", () => {
  assert.equal(resolveSessionId({ sessionId: "explicit" }), "explicit");
  assert.equal(resolveSessionId({ env: { CODEX_COMPANION_SESSION_ID: "from-env" } }), "from-env");
});

test("resolveSessionId reads process.env when no option/env given", () => {
  const prev = process.env.CODEX_COMPANION_SESSION_ID;
  process.env.CODEX_COMPANION_SESSION_ID = "proc-env";
  try {
    assert.equal(resolveSessionId({}), "proc-env");
  } finally {
    if (prev == null) delete process.env.CODEX_COMPANION_SESSION_ID;
    else process.env.CODEX_COMPANION_SESSION_ID = prev;
  }
});

test("resolveSessionId returns null when nothing is set", () => {
  const prev = process.env.CODEX_COMPANION_SESSION_ID;
  delete process.env.CODEX_COMPANION_SESSION_ID;
  try {
    assert.equal(resolveSessionId({ env: {} }), null);
  } finally {
    if (prev != null) process.env.CODEX_COMPANION_SESSION_ID = prev;
  }
});
