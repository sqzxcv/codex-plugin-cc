import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { inspectProcess } from "./process.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "codex-companion");
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 50;

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false
    },
    jobs: []
  };
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalWorkspaceRoot = workspaceRoot;
  try {
    canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }

  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...(parsed.config ?? {})
      },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function isActiveJob(job) {
  return job?.status === "queued" || job?.status === "running";
}

function staleReasonDetail(inspection) {
  if (inspection.reason === "missing_pid") {
    return "missing pid";
  }
  if (inspection.reason === "dead_pid") {
    return inspection.pid == null ? "dead pid" : `pid ${inspection.pid} is not running`;
  }
  return inspection.detail ?? "stale process";
}

function appendStaleJobLog(job, message) {
  if (!job?.logFile) {
    return;
  }
  try {
    fs.appendFileSync(job.logFile, `[${nowIso()}] ${message}\n`, "utf8");
  } catch {
    // Best-effort diagnostics; reconciliation should not fail on log writes.
  }
}

function persistJobFilePatch(cwd, jobId, patch) {
  const jobFile = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(jobFile)) {
    return;
  }
  try {
    writeJobFile(cwd, jobId, {
      ...readJobFile(jobFile),
      ...patch
    });
  } catch {
    // Ignore malformed or concurrently removed job files; state.json remains authoritative.
  }
}

function buildStaleActiveJobPatch(job, inspection, timestamp) {
  const reason = inspection.reason ?? "stale_process";
  const detail = staleReasonDetail(inspection);
  return {
    ...job,
    previousStatus: job.status,
    status: "failed",
    phase: "failed",
    pid: null,
    completedAt: timestamp,
    staleReconciledAt: timestamp,
    staleReconciliationReason: reason,
    errorMessage: `Codex job was ${job.status} but its tracked process is stale (${detail}); auto-reconciled as failed.`,
    updatedAt: timestamp
  };
}

export function reconcileActiveJobs(cwd, options = {}) {
  const state = loadState(cwd);
  const timestamp = nowIso();
  const reconciled = [];
  let changed = false;

  const jobs = (state.jobs ?? []).map((job) => {
    if (!isActiveJob(job)) {
      return job;
    }
    if (options.predicate && !options.predicate(job)) {
      return job;
    }

    const inspection = inspectProcess(job.pid, options);
    if (inspection.live !== false) {
      return job;
    }

    changed = true;
    const nextJob = buildStaleActiveJobPatch(job, inspection, timestamp);
    reconciled.push({
      id: job.id,
      previousStatus: job.status,
      pid: inspection.pid,
      reason: inspection.reason,
      completedAt: timestamp
    });
    appendStaleJobLog(
      job,
      `Detected stale ${job.status} job (${staleReasonDetail(inspection)}). Marked as failed automatically.`
    );
    persistJobFilePatch(cwd, job.id, nextJob);
    return nextJob;
  });

  if (changed) {
    saveState(cwd, {
      ...state,
      jobs
    });
  }

  return {
    changed,
    reconciled,
    jobs
  };
}

export function saveState(cwd, state) {
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);
  const nextJobs = pruneJobs(state.jobs ?? []);
  const nextState = {
    version: STATE_VERSION,
    config: {
      ...defaultState().config,
      ...(state.config ?? {})
    },
    jobs: nextJobs
  };

  const retainedIds = new Set(nextJobs.map((job) => job.id));
  for (const job of previousJobs) {
    if (retainedIds.has(job.id)) {
      continue;
    }
    removeJobFile(resolveJobFile(cwd, job.id));
    removeFileIfExists(job.logFile);
  }

  fs.writeFileSync(resolveStateFile(cwd), `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
}

export function updateState(cwd, mutate) {
  const state = loadState(cwd);
  mutate(state);
  return saveState(cwd, state);
}

export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex((job) => job.id === jobPatch.id);
    if (existingIndex === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch
      });
      return;
    }
    state.jobs[existingIndex] = {
      ...state.jobs[existingIndex],
      ...jobPatch,
      updatedAt: timestamp
    };
  });
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value
    };
  });
}

export function getConfig(cwd) {
  return loadState(cwd).config;
}

export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  fs.writeFileSync(jobFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return jobFile;
}

export function readJobFile(jobFile) {
  return JSON.parse(fs.readFileSync(jobFile, "utf8"));
}

function removeJobFile(jobFile) {
  if (fs.existsSync(jobFile)) {
    fs.unlinkSync(jobFile);
  }
}

export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}
