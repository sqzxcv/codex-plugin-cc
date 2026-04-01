import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("marketplace registers the opencode plugin", () => {
  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
  const plugin = marketplace.plugins.find((entry) => entry.name === "opencode");

  assert.ok(plugin);
  assert.equal(plugin.source, "./plugins/opencode");
  assert.equal(plugin.author.name, "OpenAI");
});

test("opencode plugin manifest matches repository conventions", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "plugins", "opencode", ".claude-plugin", "plugin.json"), "utf8")
  );

  assert.equal(manifest.name, "opencode");
  assert.equal(manifest.version, "1.0.2");
  assert.equal(manifest.author.name, "OpenAI");
});

test("opencode hooks manifest wires the session lifecycle hook", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, "plugins", "opencode", "hooks", "hooks.json"), "utf8"));

  assert.match(hooks.hooks.SessionStart[0].hooks[0].command, /session-lifecycle-hook\.mjs/);
  assert.match(hooks.hooks.SessionEnd[0].hooks[0].command, /session-lifecycle-hook\.mjs/);
});

test("opencode rescue agent does not claim unsupported write-mode flags", () => {
  const agent = fs.readFileSync(path.join(ROOT, "plugins", "opencode", "agents", "opencode-rescue.md"), "utf8");

  assert.doesNotMatch(agent, /Default to `--write`/);
  assert.match(agent, /OpenCode manages write access through its own configuration/i);
});
