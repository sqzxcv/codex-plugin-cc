import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveStateFile,
  saveState,
  loadState,
  generateJobId,
  upsertJob,
  listJobs,
  setConfig,
  getConfig,
  writeJobFile,
  readJobFile
} from "../plugins/codex/scripts/lib/state.mjs";

test("resolveStateDir uses a temp-backed per-workspace directory", () => {
  const workspace = makeTempDir();
  const stateDir = resolveStateDir(workspace);

  assert.equal(stateDir.startsWith(os.tmpdir()), true);
  assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
  assert.match(stateDir, new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("resolveStateDir uses CLAUDE_PLUGIN_DATA when it is provided", () => {
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

test("saveState prunes dropped job artifacts when indexed jobs exceed the cap", () => {
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

// ---------------------------------------------------------------------------
// loadState
// ---------------------------------------------------------------------------

test("loadState returns default state when the state file does not exist", () => {
  const workspace = makeTempDir();
  const state = loadState(workspace);

  assert.equal(state.version, 1);
  assert.deepEqual(state.config, { stopReviewGate: false });
  assert.deepEqual(state.jobs, []);
});

test("loadState returns default state when the state file contains invalid JSON", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, "{ not valid json }", "utf8");

  const state = loadState(workspace);
  assert.deepEqual(state.jobs, []);
});

test("loadState merges config defaults when some config keys are missing", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ version: 1, config: {}, jobs: [] }),
    "utf8"
  );

  const state = loadState(workspace);
  assert.equal(state.config.stopReviewGate, false);
});

test("loadState round-trips a persisted state file", () => {
  const workspace = makeTempDir();
  const original = {
    version: 1,
    config: { stopReviewGate: true },
    jobs: [{ id: "job-1", status: "completed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]
  };
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(original, null, 2)}\n`, "utf8");

  const loaded = loadState(workspace);
  assert.equal(loaded.config.stopReviewGate, true);
  assert.equal(loaded.jobs.length, 1);
  assert.equal(loaded.jobs[0].id, "job-1");
});

// ---------------------------------------------------------------------------
// generateJobId
// ---------------------------------------------------------------------------

test("generateJobId produces unique identifiers for successive calls", () => {
  const id1 = generateJobId();
  const id2 = generateJobId();
  assert.notEqual(id1, id2);
});

test("generateJobId starts with the default prefix", () => {
  const id = generateJobId();
  assert.match(id, /^job-/);
});

test("generateJobId honours a custom prefix", () => {
  const id = generateJobId("review");
  assert.match(id, /^review-/);
});

// ---------------------------------------------------------------------------
// upsertJob / listJobs
// ---------------------------------------------------------------------------

test("upsertJob inserts a new job and listJobs returns it", () => {
  const workspace = makeTempDir();

  upsertJob(workspace, { id: "job-a", status: "queued", title: "My Job" });
  const jobs = listJobs(workspace);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "job-a");
  assert.equal(jobs[0].status, "queued");
});

test("upsertJob merges a patch into an existing job", () => {
  const workspace = makeTempDir();

  upsertJob(workspace, { id: "job-b", status: "queued", title: "Task" });
  upsertJob(workspace, { id: "job-b", status: "running", phase: "executing" });

  const jobs = listJobs(workspace);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "running");
  assert.equal(jobs[0].phase, "executing");
  assert.equal(jobs[0].title, "Task");
});

test("upsertJob prepends new jobs so the newest appears first", () => {
  const workspace = makeTempDir();

  upsertJob(workspace, { id: "job-first", status: "completed" });
  upsertJob(workspace, { id: "job-second", status: "completed" });

  const jobs = listJobs(workspace);
  assert.equal(jobs[0].id, "job-second");
  assert.equal(jobs[1].id, "job-first");
});

// ---------------------------------------------------------------------------
// setConfig / getConfig
// ---------------------------------------------------------------------------

test("setConfig persists a config value and getConfig retrieves it", () => {
  const workspace = makeTempDir();

  setConfig(workspace, "stopReviewGate", true);
  const config = getConfig(workspace);

  assert.equal(config.stopReviewGate, true);
});

test("setConfig can toggle a config value back", () => {
  const workspace = makeTempDir();

  setConfig(workspace, "stopReviewGate", true);
  setConfig(workspace, "stopReviewGate", false);

  assert.equal(getConfig(workspace).stopReviewGate, false);
});

// ---------------------------------------------------------------------------
// writeJobFile / readJobFile
// ---------------------------------------------------------------------------

test("writeJobFile writes a job payload and readJobFile round-trips it", () => {
  const workspace = makeTempDir();
  const jobId = "job-wf";
  const payload = { id: jobId, status: "completed", result: { value: 42 } };

  const jobFile = writeJobFile(workspace, jobId, payload);
  assert.equal(fs.existsSync(jobFile), true);

  const loaded = readJobFile(jobFile);
  assert.deepEqual(loaded, payload);
});
