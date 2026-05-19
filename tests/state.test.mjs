import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  getStateDirOverride,
  resolveJobFile,
  resolveJobLogFile,
  resolveJobsDir,
  resolveStateDir,
  resolveStateFile,
  saveState,
  setStateDirOverride
} from "../plugins/codex/scripts/lib/state.mjs";

const STATE_DIR_ENV = "CODEX_COMPANION_STATE_DIR";

function withCleanStateDirEnv(fn) {
  const previous = process.env[STATE_DIR_ENV];
  delete process.env[STATE_DIR_ENV];
  try {
    fn();
  } finally {
    if (previous == null) {
      delete process.env[STATE_DIR_ENV];
    } else {
      process.env[STATE_DIR_ENV] = previous;
    }
  }
}

test("resolveStateDir uses a temp-backed per-workspace directory", () => {
  withCleanStateDirEnv(() => {
    const workspace = makeTempDir();
    const stateDir = resolveStateDir(workspace);

    assert.equal(stateDir.startsWith(os.tmpdir()), true);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.match(stateDir, new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
});

test("resolveStateDir uses CLAUDE_PLUGIN_DATA when it is provided", () => {
  withCleanStateDirEnv(() => {
    const workspace = makeTempDir();
    const pluginDataDir = makeTempDir();
    const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

    try {
      const stateDir = resolveStateDir(workspace);

      assert.equal(stateDir.startsWith(path.join(pluginDataDir, "state")), true);
      assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
      assert.match(
        stateDir,
        new RegExp(`^${path.join(pluginDataDir, "state").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
      );
    } finally {
      if (previousPluginDataDir == null) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
      }
    }
  });
});

test("saveState prunes dropped job artifacts when indexed jobs exceed the cap", () => {
  withCleanStateDirEnv(() => {
    const workspace = makeTempDir();
    const stateFile = resolveStateFile(workspace);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });

    const jobs = Array.from({ length: 51 }, (_, index) => {
      const jobId = `job-${index}`;
      const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
      const logFile = resolveJobLogFile(workspace, jobId);
      const jobFile = resolveJobFile(workspace, jobId);
      fs.writeFileSync(logFile, `log ${jobId}\n`, "utf8");
      fs.writeFileSync(jobFile, JSON.stringify({ id: jobId, status: "completed" }, null, 2), "utf8");
      return {
        id: jobId,
        status: "completed",
        logFile,
        updatedAt,
        createdAt: updatedAt
      };
    });

    fs.writeFileSync(
      stateFile,
      `${JSON.stringify(
        {
          version: 1,
          config: { stopReviewGate: false },
          jobs
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    saveState(workspace, {
      version: 1,
      config: { stopReviewGate: false },
      jobs
    });

    const prunedJobFile = resolveJobFile(workspace, "job-0");
    const prunedLogFile = resolveJobLogFile(workspace, "job-0");
    const retainedJobFile = resolveJobFile(workspace, "job-50");
    const retainedLogFile = resolveJobLogFile(workspace, "job-50");
    const jobsDir = path.dirname(prunedJobFile);

    assert.equal(fs.existsSync(retainedJobFile), true);
    assert.equal(fs.existsSync(retainedLogFile), true);

    const savedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(savedState.jobs.length, 50);
    assert.deepEqual(
      savedState.jobs.map((job) => job.id),
      Array.from({ length: 50 }, (_, index) => `job-${50 - index}`)
    );
    assert.deepEqual(
      fs.readdirSync(jobsDir).sort(),
      Array.from({ length: 50 }, (_, index) => `job-${index + 1}`)
        .flatMap((jobId) => [`${jobId}.json`, `${jobId}.log`])
        .sort()
    );
  });
});

// --- CODEX_COMPANION_STATE_DIR override tests -------------------------------
// These tests cover the optional `--state-dir <abs-path>` global flag on
// `codex-companion.mjs main()` and the equivalent `CODEX_COMPANION_STATE_DIR`
// env var that backs it. See lib/state.mjs documentation.

test("setStateDirOverride: subsequent resolveStateDir returns the override", () => {
  withCleanStateDirEnv(() => {
    const override = makeTempDir();
    setStateDirOverride(override);
    assert.equal(resolveStateDir(makeTempDir()), override);
    assert.equal(resolveStateDir("/any/other/cwd"), override);
    assert.equal(getStateDirOverride(), override);
  });
});

test("setStateDirOverride(null): clears override; workspace hashing resumes", () => {
  withCleanStateDirEnv(() => {
    const override = makeTempDir();
    const workspace = makeTempDir();
    setStateDirOverride(override);
    assert.equal(resolveStateDir(workspace), override);

    setStateDirOverride(null);
    const stateDir = resolveStateDir(workspace);
    assert.notEqual(stateDir, override);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.equal(getStateDirOverride(), null);
  });
});

test("setStateDirOverride: relative path is canonicalized to absolute against process.cwd()", () => {
  withCleanStateDirEnv(() => {
    setStateDirOverride("relative/state-dir");
    const expected = path.resolve(process.cwd(), "relative/state-dir");
    assert.equal(resolveStateDir(makeTempDir()), expected);
    assert.equal(process.env[STATE_DIR_ENV], expected);
  });
});

test("setStateDirOverride: resolveStateFile and resolveJobsDir route through override", () => {
  withCleanStateDirEnv(() => {
    const override = makeTempDir();
    setStateDirOverride(override);
    assert.equal(resolveStateFile(makeTempDir()), path.join(override, "state.json"));
    assert.equal(resolveJobsDir(makeTempDir()), path.join(override, "jobs"));
  });
});

test("setStateDirOverride: empty string clears override (treated as null)", () => {
  withCleanStateDirEnv(() => {
    const override = makeTempDir();
    setStateDirOverride(override);
    assert.equal(getStateDirOverride(), override);

    setStateDirOverride("");
    assert.equal(getStateDirOverride(), null);
  });
});

test("setStateDirOverride: undefined clears override (treated as null)", () => {
  withCleanStateDirEnv(() => {
    const override = makeTempDir();
    setStateDirOverride(override);
    assert.equal(getStateDirOverride(), override);

    setStateDirOverride(undefined);
    assert.equal(getStateDirOverride(), null);
  });
});

test("CODEX_COMPANION_STATE_DIR env var directly: resolveStateDir honors absolute values", () => {
  withCleanStateDirEnv(() => {
    const override = makeTempDir();
    process.env[STATE_DIR_ENV] = override;
    assert.equal(resolveStateDir(makeTempDir()), override);
    assert.equal(getStateDirOverride(), override);
  });
});

test("CODEX_COMPANION_STATE_DIR env var: relative value is canonicalized AND written back to env on first read", () => {
  withCleanStateDirEnv(() => {
    process.env[STATE_DIR_ENV] = "rel/dir";
    const expected = path.resolve(process.cwd(), "rel/dir");
    assert.equal(getStateDirOverride(), expected);
    // ...and persists the absolute form back to env so child processes inherit it:
    assert.equal(process.env[STATE_DIR_ENV], expected);
    assert.equal(resolveStateDir(makeTempDir()), expected);
  });
});
