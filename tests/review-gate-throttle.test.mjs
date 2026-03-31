import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  getConfig,
  loadState,
  resolveStateFile,
  setConfig,
  upsertJob
} from "../plugins/codex/scripts/lib/state.mjs";

function setupWorkspace() {
  const workspace = makeTempDir();
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  const pluginData = makeTempDir();
  process.env.CLAUDE_PLUGIN_DATA = pluginData;

  return {
    workspace,
    cleanup() {
      if (previousPluginData == null) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
      }
    }
  };
}

test("setConfig stores stopReviewGateMaxPerSession", () => {
  const { workspace, cleanup } = setupWorkspace();
  try {
    setConfig(workspace, "stopReviewGateMaxPerSession", 5);
    const config = getConfig(workspace);
    assert.equal(config.stopReviewGateMaxPerSession, 5);
  } finally {
    cleanup();
  }
});

test("setConfig stores stopReviewGateCooldownMinutes", () => {
  const { workspace, cleanup } = setupWorkspace();
  try {
    setConfig(workspace, "stopReviewGateCooldownMinutes", 10);
    const config = getConfig(workspace);
    assert.equal(config.stopReviewGateCooldownMinutes, 10);
  } finally {
    cleanup();
  }
});

test("setConfig clears throttle config with null", () => {
  const { workspace, cleanup } = setupWorkspace();
  try {
    setConfig(workspace, "stopReviewGateMaxPerSession", 5);
    setConfig(workspace, "stopReviewGateMaxPerSession", null);
    const config = getConfig(workspace);
    assert.equal(config.stopReviewGateMaxPerSession, null);
  } finally {
    cleanup();
  }
});

test("default config has null throttle values", () => {
  const { workspace, cleanup } = setupWorkspace();
  try {
    const config = getConfig(workspace);
    assert.equal(config.stopReviewGateMaxPerSession, null);
    assert.equal(config.stopReviewGateCooldownMinutes, null);
    assert.equal(config.stopReviewGate, false);
  } finally {
    cleanup();
  }
});

test("loadState merges throttle defaults into existing state without throttle keys", () => {
  const { workspace, cleanup } = setupWorkspace();
  try {
    // Write a state file that only has the old config shape
    const stateFile = resolveStateFile(workspace);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        version: 1,
        config: { stopReviewGate: true },
        jobs: []
      }),
      "utf8"
    );

    const state = loadState(workspace);
    assert.equal(state.config.stopReviewGate, true);
    assert.equal(state.config.stopReviewGateMaxPerSession, null);
    assert.equal(state.config.stopReviewGateCooldownMinutes, null);
  } finally {
    cleanup();
  }
});
