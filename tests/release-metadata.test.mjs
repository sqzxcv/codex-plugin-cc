import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("release metadata identifies the independent session-review fork", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const plugin = readJson("plugins/codex/.claude-plugin/plugin.json");
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const marketplacePlugin = marketplace.plugins.find((entry) => entry.name === "codex");

  assert.equal(marketplace.name, "sq-codex");
  assert.equal(marketplace.owner.name, "sqzxcv");
  assert.equal(marketplace.metadata.version, "1.1.0");
  assert.equal(marketplacePlugin.version, "1.1.0");
  assert.equal(marketplacePlugin.author.name, "sqzxcv");
  assert.equal(plugin.name, "codex");
  assert.equal(plugin.version, "1.1.0");
  assert.equal(plugin.author.name, "sqzxcv");
  assert.equal(packageJson.name, "@sqzxcv/codex-plugin-cc");
  assert.equal(packageJson.version, "1.1.0");
  assert.equal(packageLock.name, "@sqzxcv/codex-plugin-cc");
  assert.equal(packageLock.version, "1.1.0");
  assert.equal(packageLock.packages[""].name, "@sqzxcv/codex-plugin-cc");
  assert.equal(packageLock.packages[""].version, "1.1.0");
});

test("release documentation installs the fork and discloses compatibility limits", () => {
  const readme = read("README.md");
  const rootNotice = read("NOTICE");
  const pluginNotice = read("plugins/codex/NOTICE");

  assert.match(readme, /unofficial fork/i);
  assert.match(readme, /must not be enabled at the same time/i);
  assert.match(readme, /\/plugin marketplace add sqzxcv\/codex-plugin-cc/);
  assert.match(readme, /\/plugin install codex@sq-codex/);
  assert.match(readme, /Windows support is experimental/i);
  assert.match(readme, /Git for Windows or WSL2/i);
  assert.doesNotMatch(readme, /\/plugin marketplace add openai\/codex-plugin-cc/);
  for (const notice of [rootNotice, pluginNotice]) {
    assert.match(notice, /Copyright 2026 OpenAI/);
    assert.match(notice, /modified by sqzxcv/i);
    assert.match(notice, /session review/i);
  }
});

test("build preparation and CI are cross-platform", () => {
  const packageJson = readJson("package.json");
  const workflow = read(".github/workflows/pull-request-ci.yml");
  const prepareScript = read("scripts/prepare-app-server-types.mjs");

  assert.match(packageJson.scripts.prebuild, /^node scripts\/prepare-app-server-types\.mjs && codex app-server generate-ts/);
  assert.doesNotMatch(packageJson.scripts.prebuild, /mkdir -p/);
  assert.match(prepareScript, /mkdirSync/);
  assert.match(prepareScript, /recursive:\s*true/);
  assert.match(workflow, /fail-fast:\s*false/);
  assert.match(workflow, /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/);
  assert.match(workflow, /runs-on:\s*\$\{\{ matrix\.os \}\}/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
});
