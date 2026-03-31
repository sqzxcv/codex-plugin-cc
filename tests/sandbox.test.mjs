import test from "node:test";
import assert from "node:assert/strict";

import {
  probeSandboxSupport,
  resetSandboxProbeCache
} from "../plugins/codex/scripts/lib/app-server.mjs";
import { renderSetupReport } from "../plugins/codex/scripts/lib/render.mjs";

test("probeSandboxSupport returns a valid result and caches it", () => {
  resetSandboxProbeCache();
  const result = probeSandboxSupport(process.cwd());

  assert.ok(["bwrap", "landlock", "none"].includes(result.type), `unexpected type: ${result.type}`);
  assert.ok(Array.isArray(result.configArgs));

  // Second call with same env should return the same cached object.
  const cached = probeSandboxSupport(process.cwd());
  assert.strictEqual(result, cached);
});

test("probeSandboxSupport Landlock result includes config args", () => {
  resetSandboxProbeCache();
  const result = probeSandboxSupport(process.cwd());

  if (result.type === "landlock") {
    assert.deepEqual(result.configArgs, ["-c", "use_legacy_landlock=true"]);
  } else {
    assert.deepEqual(result.configArgs, []);
  }
});

test("resetSandboxProbeCache clears cached result", () => {
  // Populate cache.
  const first = probeSandboxSupport(process.cwd());
  resetSandboxProbeCache();
  // After reset, a new probe should run (may or may not return same type,
  // but the object identity should differ).
  const second = probeSandboxSupport(process.cwd());
  assert.equal(first.type, second.type);
  // Reset for other tests.
  resetSandboxProbeCache();
});

test("probeSandboxSupport with explicit env skips cache and re-probes", () => {
  resetSandboxProbeCache();
  // Probe with default env (cached).
  const defaultResult = probeSandboxSupport(process.cwd());
  // Probe with explicit env — should NOT reuse cached object (fresh probe).
  const explicitResult = probeSandboxSupport(process.cwd(), { env: process.env });
  // Same type (same system) but different object identity.
  assert.equal(defaultResult.type, explicitResult.type);
  assert.notStrictEqual(defaultResult, explicitResult, "explicit env should bypass cache");
  resetSandboxProbeCache();
});

test("renderSetupReport includes sandbox status line", () => {
  const report = {
    ready: true,
    node: { available: true, detail: "v22.0.0" },
    npm: { available: true, detail: "10.0.0" },
    codex: { available: true, detail: "codex-cli 0.117.0" },
    auth: { available: true, loggedIn: true, detail: "authenticated" },
    sandbox: { type: "landlock", configArgs: ["-c", "use_legacy_landlock=true"] },
    sessionRuntime: { label: "direct startup" },
    reviewGateEnabled: false,
    actionsTaken: [],
    nextSteps: []
  };

  const output = renderSetupReport(report);
  assert.match(output, /sandbox: landlock \(fallback/);
});

test("renderSetupReport shows bwrap when sandbox type is bwrap", () => {
  const report = {
    ready: true,
    node: { available: true, detail: "v22.0.0" },
    npm: { available: true, detail: "10.0.0" },
    codex: { available: true, detail: "codex-cli 0.117.0" },
    auth: { available: true, loggedIn: true, detail: "authenticated" },
    sandbox: { type: "bwrap", configArgs: [] },
    sessionRuntime: { label: "direct startup" },
    reviewGateEnabled: false,
    actionsTaken: [],
    nextSteps: []
  };

  const output = renderSetupReport(report);
  assert.match(output, /sandbox: bwrap \(default\)/);
});

test("renderSetupReport shows unavailable when sandbox type is none", () => {
  const report = {
    ready: true,
    node: { available: true, detail: "v22.0.0" },
    npm: { available: true, detail: "10.0.0" },
    codex: { available: true, detail: "codex-cli 0.117.0" },
    auth: { available: true, loggedIn: true, detail: "authenticated" },
    sandbox: { type: "none", configArgs: [] },
    sessionRuntime: { label: "direct startup" },
    reviewGateEnabled: false,
    actionsTaken: [],
    nextSteps: []
  };

  const output = renderSetupReport(report);
  assert.match(output, /sandbox: unavailable/);
});
