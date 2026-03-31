import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "plugins", "codex", "scripts", "codex-companion.mjs");

function writeUserConfig(homeDir, contents) {
  const configDir = path.join(homeDir, ".codex");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.toml"), `${contents.trim()}\n`, "utf8");
}

function writeProjectConfig(projectDir, contents) {
  const configDir = path.join(projectDir, ".codex");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.toml"), `${contents.trim()}\n`, "utf8");
}

function runSetupJson(cwd, env) {
  const result = run(process.execPath, [SCRIPT, "setup", "--json"], { cwd, env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("setup treats litellm provider config as authenticated without codex login", () => {
  const cwd = makeTempDir();
  const home = makeTempDir();
  const binDir = makeTempDir();

  installFakeCodex(binDir, "logged-out");
  writeUserConfig(
    home,
    `
model_provider = "litellm"
[model_providers.litellm]
name = "litellm"
base_url = "https://example.invalid/v1"
http_headers = { "Authorization" = "Bearer test-key" }
`
  );

  const env = {
    ...buildEnv(binDir),
    HOME: home
  };
  const payload = runSetupJson(cwd, env);

  assert.equal(payload.codex.available, true);
  assert.equal(payload.auth.loggedIn, true);
  assert.match(payload.auth.detail, /model_provider "litellm"/i);
  assert.doesNotMatch(payload.auth.detail, /not logged in/i);
});

test("setup still reports unauthenticated when no custom provider is configured", () => {
  const cwd = makeTempDir();
  const home = makeTempDir();
  const binDir = makeTempDir();

  installFakeCodex(binDir, "logged-out");
  writeUserConfig(
    home,
    `
model = "gpt-5.4"
`
  );

  const env = {
    ...buildEnv(binDir),
    HOME: home
  };
  const payload = runSetupJson(cwd, env);

  assert.equal(payload.auth.loggedIn, false);
  assert.match(payload.auth.detail, /not authenticated|not logged in/i);
});

test("project config model_provider overrides user config for auth gating", () => {
  const cwd = makeTempDir();
  const home = makeTempDir();
  const binDir = makeTempDir();

  installFakeCodex(binDir, "logged-out");
  writeUserConfig(
    home,
    `
model_provider = "openai"
`
  );
  writeProjectConfig(
    cwd,
    `
model_provider = "litellm"
[model_providers.litellm]
name = "litellm"
base_url = "https://example.invalid/v1"
`
  );

  const env = {
    ...buildEnv(binDir),
    HOME: home
  };
  const payload = runSetupJson(cwd, env);

  assert.equal(payload.auth.loggedIn, true);
  assert.match(payload.auth.detail, /model_provider "litellm"/i);
  assert.match(payload.auth.detail, /\.codex\/config\.toml/);
});
