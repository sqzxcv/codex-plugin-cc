#!/usr/bin/env node

/**
 * Cursor-specific sessionStart hook adapter.
 *
 * Cursor propagates env vars via the hook's JSON stdout `{ "env": { ... } }`
 * rather than Claude Code's CLAUDE_ENV_FILE mechanism.  This thin wrapper reads
 * the Cursor hook input and emits the env vars the companion runtime needs for
 * the rest of the session.
 *
 * sessionEnd and stop hooks reuse the original scripts directly (see
 * cursor-hooks.json).
 */

import fs from "node:fs";
import process from "node:process";

const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function main() {
  const input = readHookInput();

  // Emit env vars that subsequent hooks (sessionEnd, stop) will need.
  const env = {};

  if (input.session_id) {
    env[SESSION_ID_ENV] = String(input.session_id);
  }

  // Cursor does not provide CLAUDE_PLUGIN_DATA; the companion runtime falls
  // back to $TMPDIR/codex-companion automatically (see lib/state.mjs).

  process.stdout.write(JSON.stringify({ env }));
}

main();
