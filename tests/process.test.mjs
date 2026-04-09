import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";

import {
  runCommand,
  sanitizeChildEnv,
  terminateProcessTree
} from "../plugins/codex/scripts/lib/process.mjs";

test("sanitizeChildEnv strips routing env and cargo target overrides", () => {
  const env = sanitizeChildEnv({
    KEEP: "ok",
    CARGO_HOME: "/tmp/cargo-home",
    CARGO_TARGET_DIR: "/tmp/target",
    RUST_VERIFICATION_ROOT_BASE: "/tmp/root",
    RUST_VERIFICATION_REAL_CARGO: "/tmp/cargo",
    RUST_VERIFICATION_PRESERVE_ROUTING_ENV: "1",
    BOLT_RUST_VERIFICATION_ROOT: "/tmp/bolt",
    CARGO_BUILD_TARGET_DIR: "/tmp/poison"
  });

  assert.deepEqual(env, {
    KEEP: "ok",
    CARGO_HOME: "/tmp/cargo-home"
  });
});

test("sanitizeChildEnv strips scrubbed keys case-insensitively", () => {
  const env = sanitizeChildEnv({
    keep: "ok",
    Cargo_Home: "/tmp/cargo-home",
    cargo_target_dir: "/tmp/target",
    Rust_Verification_Preserve_Routing_Env: "1",
    cargo_build_target_dir: "/tmp/poison"
  });

  assert.deepEqual(env, {
    keep: "ok",
    Cargo_Home: "/tmp/cargo-home"
  });
});

test("sanitizeChildEnv does not mutate its input", () => {
  const input = {
    KEEP: "ok",
    CARGO_TARGET_DIR: "/tmp/target",
    RUST_VERIFICATION_PRESERVE_ROUTING_ENV: "1"
  };

  const output = sanitizeChildEnv(input);

  assert.deepEqual(input, {
    KEEP: "ok",
    CARGO_TARGET_DIR: "/tmp/target",
    RUST_VERIFICATION_PRESERVE_ROUTING_ENV: "1"
  });
  assert.deepEqual(output, {
    KEEP: "ok"
  });
});

test("sanitizeChildEnv treats null like inherited process env", () => {
  const originalKeep = process.env.TEST_NULL_FALLBACK_KEEP;
  const originalTarget = process.env.CARGO_TARGET_DIR;
  process.env.TEST_NULL_FALLBACK_KEEP = "ok";
  process.env.CARGO_TARGET_DIR = "/tmp/target";

  try {
    const env = sanitizeChildEnv(null);
    assert.equal(env.TEST_NULL_FALLBACK_KEEP, "ok");
    assert.equal(env.CARGO_TARGET_DIR, undefined);
  } finally {
    if (originalKeep === undefined) {
      delete process.env.TEST_NULL_FALLBACK_KEEP;
    } else {
      process.env.TEST_NULL_FALLBACK_KEEP = originalKeep;
    }

    if (originalTarget === undefined) {
      delete process.env.CARGO_TARGET_DIR;
    } else {
      process.env.CARGO_TARGET_DIR = originalTarget;
    }
  }
});

test("runCommand sanitizes child env before spawning", () => {
  const result = runCommand(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify({" +
        "keep: process.env.KEEP ?? null," +
        "cargoHome: process.env.CARGO_HOME ?? null," +
        "routing: process.env.RUST_VERIFICATION_PRESERVE_ROUTING_ENV ?? null," +
        "targetRoot: process.env.CARGO_TARGET_DIR ?? null," +
        "target: process.env.CARGO_BUILD_TARGET_DIR ?? null" +
      "}));"
    ],
    {
      env: {
        ...process.env,
        KEEP: "ok",
        CARGO_HOME: "/tmp/cargo-home",
        CARGO_TARGET_DIR: "/tmp/target",
        RUST_VERIFICATION_PRESERVE_ROUTING_ENV: "1",
        CARGO_BUILD_TARGET_DIR: "/tmp/poison"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    keep: "ok",
    cargoHome: "/tmp/cargo-home",
    routing: null,
    targetRoot: null,
    target: null
  });
});

test("runCommand sanitizes inherited process env when env is omitted", () => {
  const originalKeep = process.env.TEST_INHERITED_KEEP;
  const originalTarget = process.env.CARGO_TARGET_DIR;
  process.env.TEST_INHERITED_KEEP = "ok";
  process.env.CARGO_TARGET_DIR = "/tmp/target";

  try {
    const result = runCommand(process.execPath, [
      "-e",
      "process.stdout.write(JSON.stringify({" +
        "keep: process.env.TEST_INHERITED_KEEP ?? null," +
        "targetRoot: process.env.CARGO_TARGET_DIR ?? null" +
      "}));"
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      keep: "ok",
      targetRoot: null
    });
  } finally {
    if (originalKeep === undefined) {
      delete process.env.TEST_INHERITED_KEEP;
    } else {
      process.env.TEST_INHERITED_KEEP = originalKeep;
    }

    if (originalTarget === undefined) {
      delete process.env.CARGO_TARGET_DIR;
    } else {
      process.env.CARGO_TARGET_DIR = originalTarget;
    }
  }
});

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
