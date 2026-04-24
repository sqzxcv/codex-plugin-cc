import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  reconcileActiveJobs,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveStateFile,
  saveState,
  writeJobFile
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

test("reconcileActiveJobs marks missing-pid running jobs failed and persists diagnostics", () => {
  const workspace = makeTempDir();
  const jobId = "task-stale-missing-pid";
  const logFile = resolveJobLogFile(workspace, jobId);
  const job = {
    id: jobId,
    status: "running",
    phase: "running",
    title: "Codex Task",
    logFile,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z"
  };
  fs.writeFileSync(logFile, "[2026-01-01T00:00:00.000Z] Starting Codex Task.\n", "utf8");
  saveState(workspace, {
    version: 1,
    config: { stopReviewGate: false },
    jobs: [job]
  });
  writeJobFile(workspace, jobId, job);

  const result = reconcileActiveJobs(workspace);

  assert.equal(result.changed, true);
  assert.deepEqual(result.reconciled.map((entry) => entry.reason), ["missing_pid"]);
  assert.equal(result.jobs[0].status, "failed");
  assert.equal(result.jobs[0].previousStatus, "running");
  assert.equal(result.jobs[0].pid, null);
  assert.equal(result.jobs[0].staleReconciliationReason, "missing_pid");
  assert.match(result.jobs[0].errorMessage, /auto-reconciled as failed/);

  const persistedState = JSON.parse(fs.readFileSync(resolveStateFile(workspace), "utf8"));
  assert.equal(persistedState.jobs[0].status, "failed");
  assert.equal(persistedState.jobs[0].staleReconciliationReason, "missing_pid");

  const persistedJob = JSON.parse(fs.readFileSync(resolveJobFile(workspace, jobId), "utf8"));
  assert.equal(persistedJob.status, "failed");
  assert.equal(persistedJob.previousStatus, "running");
  assert.match(fs.readFileSync(logFile, "utf8"), /Detected stale running job/);
});

test("reconcileActiveJobs marks dead-pid queued jobs failed", () => {
  const workspace = makeTempDir();
  const jobId = "task-stale-dead-pid";
  const job = {
    id: jobId,
    status: "queued",
    phase: "queued",
    title: "Codex Task",
    pid: 424242,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z"
  };
  saveState(workspace, {
    version: 1,
    config: { stopReviewGate: false },
    jobs: [job]
  });

  const result = reconcileActiveJobs(workspace, {
    killImpl() {
      const error = new Error("no such process");
      error.code = "ESRCH";
      throw error;
    }
  });

  assert.equal(result.changed, true);
  assert.equal(result.jobs[0].status, "failed");
  assert.equal(result.jobs[0].previousStatus, "queued");
  assert.equal(result.jobs[0].staleReconciliationReason, "dead_pid");
});
