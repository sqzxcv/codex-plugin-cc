import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  markDeadPidJobFailed
} from "../plugins/codex/scripts/lib/job-control.mjs";
import { ensureStateDir, upsertJob, writeJobFile } from "../plugins/codex/scripts/lib/state.mjs";

// Pick a PID that is virtually guaranteed to be dead. PID 999999 is well above
// the default macOS/Linux pid_max for short-lived workloads.
const DEAD_PID = 999_999;

// Stamp test jobs with the inherited session id (if any) so they survive
// filterJobsForCurrentSession when running under Claude Code's harness.
const TEST_SESSION_ID = process.env.CODEX_COMPANION_SESSION_ID ?? null;

function seedRunningJobWithDeadPid(workspace, jobId, pid = DEAD_PID) {
  ensureStateDir(workspace);
  const record = {
    id: jobId,
    kind: "task",
    kindLabel: "rescue",
    title: "Codex Task",
    workspaceRoot: workspace,
    jobClass: "task",
    summary: "test job",
    write: false,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    status: "running",
    phase: "running",
    pid,
    logFile: null,
    ...(TEST_SESSION_ID ? { sessionId: TEST_SESSION_ID } : {})
  };
  writeJobFile(workspace, jobId, record);
  upsertJob(workspace, record);
}

test("markDeadPidJobFailed transitions a running job to failed", () => {
  const workspace = makeTempDir();
  seedRunningJobWithDeadPid(workspace, "task-deadpid-1");

  const reconciled = markDeadPidJobFailed(workspace, "task-deadpid-1", DEAD_PID);
  assert.equal(reconciled, true);

  const snapshot = buildSingleJobSnapshot(workspace, "task-deadpid-1");
  assert.equal(snapshot.job.status, "failed");
  assert.equal(snapshot.job.phase, "failed");
  assert.equal(snapshot.job.pid, null);
  assert.match(snapshot.job.errorMessage ?? "", /exited unexpectedly/);
});

test("markDeadPidJobFailed is a no-op when the job already finished", () => {
  const workspace = makeTempDir();
  ensureStateDir(workspace);
  const finishedRecord = {
    id: "task-finished",
    kind: "task",
    kindLabel: "rescue",
    title: "Codex Task",
    workspaceRoot: workspace,
    jobClass: "task",
    summary: "test job",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: "completed",
    phase: "done",
    pid: null,
    ...(TEST_SESSION_ID ? { sessionId: TEST_SESSION_ID } : {})
  };
  writeJobFile(workspace, "task-finished", finishedRecord);
  upsertJob(workspace, finishedRecord);

  const reconciled = markDeadPidJobFailed(workspace, "task-finished", DEAD_PID);
  assert.equal(reconciled, false);

  const snapshot = buildSingleJobSnapshot(workspace, "task-finished");
  assert.equal(snapshot.job.status, "completed");
});

test("markDeadPidJobFailed refuses to overwrite a job whose PID has rotated", () => {
  const workspace = makeTempDir();
  // Use the current process PID so the job's stored PID is alive and the
  // snapshot reconciler does not interfere with what we are testing here.
  seedRunningJobWithDeadPid(workspace, "task-rotated", process.pid);

  // Caller saw 999999 as dead, but the job is now tracking a different PID.
  const reconciled = markDeadPidJobFailed(workspace, "task-rotated", DEAD_PID);
  assert.equal(reconciled, false);

  const snapshot = buildSingleJobSnapshot(workspace, "task-rotated");
  assert.equal(snapshot.job.status, "running");
});

test("buildSingleJobSnapshot reconciles a running job with a dead PID without --wait", () => {
  const workspace = makeTempDir();
  seedRunningJobWithDeadPid(workspace, "task-snapshot-dead");

  const snapshot = buildSingleJobSnapshot(workspace, "task-snapshot-dead");
  assert.equal(snapshot.job.status, "failed");
  assert.equal(snapshot.job.phase, "failed");
  assert.match(snapshot.job.errorMessage ?? "", /exited unexpectedly/);
});

test("buildStatusSnapshot moves dead-pid jobs out of the running list", () => {
  const workspace = makeTempDir();
  seedRunningJobWithDeadPid(workspace, "task-status-dead");

  // Pass an env without a session id so filterJobsForCurrentSession does not
  // exclude our seeded jobs (the test runner inherits CODEX_COMPANION_SESSION_ID
  // from Claude Code).
  const snapshot = buildStatusSnapshot(workspace, { env: {} });
  assert.equal(snapshot.running.length, 0);
  assert.equal(snapshot.latestFinished?.id, "task-status-dead");
  assert.equal(snapshot.latestFinished?.status, "failed");
});

test("buildStatusSnapshot leaves a running job alone when its PID is alive", () => {
  const workspace = makeTempDir();
  seedRunningJobWithDeadPid(workspace, "task-status-alive", process.pid);

  const snapshot = buildStatusSnapshot(workspace, { env: {} });
  assert.equal(snapshot.running.length, 1);
  assert.equal(snapshot.running[0].id, "task-status-alive");
  assert.equal(snapshot.running[0].status, "running");
});
