import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getCodexAvailability,
  parseStructuredOutput,
  readOutputSchema,
  runAppServerTurn
} from "./codex.mjs";
import { resolveClaudeSessionPath } from "./claude-session-transfer.mjs";
import { ensureGitRepository } from "./git.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./prompts.mjs";
import { renderSessionReviewResult } from "./session-review-render.mjs";
import { getSessionReview, upsertSessionReview } from "./session-review-state.mjs";
import { buildSessionReviewPrompt, collectSessionReviewContext } from "./session-review.mjs";
import { SESSION_ID_ENV } from "./tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SESSION_REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "session-review-output.schema.json");

function nowIso() {
  return new Date().toISOString();
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function ensureCodexAvailable(cwd) {
  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    throw new Error("Codex CLI is not installed or is missing required runtime support. Install it with `npm install -g @openai/codex`, then rerun `/codex:setup`.");
  }
}

function getCurrentClaudeSessionId() {
  return process.env[SESSION_ID_ENV] ?? null;
}

function resolveSessionReviewStateKey(cwd, source) {
  const sessionId = getCurrentClaudeSessionId();
  if (sessionId) {
    return sessionId;
  }
  if (!source) {
    return null;
  }
  return path.basename(resolveClaudeSessionPath(cwd, { source }), ".jsonl");
}

export async function executeSessionReviewRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  ensureCodexAvailable(request.cwd);
  ensureGitRepository(request.cwd);

  const sessionReviewStateKey = resolveSessionReviewStateKey(request.cwd, request.source);
  const previousReview = request.followUp ? getSessionReview(workspaceRoot, sessionReviewStateKey) : null;
  const context = collectSessionReviewContext(request.cwd, {
    source: request.source,
    followUp: request.followUp,
    userNote: request.userNote,
    previousReview
  });
  const promptTemplate = loadPromptTemplate(ROOT_DIR, "session-review");
  const promptData = buildSessionReviewPrompt(context);
  const prompt = interpolateTemplate(promptTemplate, promptData.values);

  const result = await runAppServerTurn(context.repoRoot, {
    prompt,
    model: request.model,
    sandbox: "read-only",
    outputSchema: readOutputSchema(SESSION_REVIEW_SCHEMA),
    onProgress: request.onProgress
  });
  const parsed = parseStructuredOutput(result.finalMessage, {
    status: result.status,
    failureMessage: result.error?.message ?? result.stderr
  });
  const rendered = renderSessionReviewResult(parsed, {
    phase: context.phase,
    reviewId: context.reviewId,
    reasoningSummary: result.reasoningSummary
  });
  const payload = {
    review: "Session Review",
    threadId: result.threadId,
    context: {
      phase: context.phase,
      iteration: context.iteration,
      reviewId: context.reviewId,
      sessionId: context.sessionId,
      sourcePath: context.sourcePath,
      userNote: context.userNote || null,
      transcript: {
        totalEntries: context.transcript.totalEntries,
        newEntries: context.transcript.newEntries,
        parseErrors: context.transcript.parseErrors,
        offset: context.transcriptOffset
      },
      git: {
        diffHash: context.git.diffHash,
        untrackedCount: context.git.untrackedCount
      }
    },
    codex: {
      status: result.status,
      stderr: result.stderr,
      stdout: result.finalMessage,
      reasoning: result.reasoningSummary
    },
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError,
    reasoningSummary: result.reasoningSummary,
    rendered
  };

  const hasValidReview = result.status === 0 && parsed.parsed;
  if (hasValidReview) {
    upsertSessionReview(workspaceRoot, context.sessionId, {
      reviewId: context.reviewId,
      iteration: context.iteration,
      phase: context.phase,
      sourcePath: context.sourcePath,
      transcriptOffset: context.transcriptOffset,
      gitDiffHash: context.git.diffHash,
      jobId: request.jobId ?? null,
      threadId: result.threadId,
      turnId: result.turnId,
      result: parsed.parsed,
      rawOutput: parsed.rawOutput,
      parseError: parsed.parseError,
      reviewedAt: nowIso()
    });
  }

  return {
    exitStatus: hasValidReview ? 0 : result.status || 1,
    threadId: result.threadId,
    turnId: result.turnId,
    payload,
    rendered,
    summary: parsed.parsed?.summary ?? parsed.parseError ?? firstMeaningfulLine(result.finalMessage, "Session review finished."),
    jobTitle: "Codex Session Review",
    jobClass: "review",
    targetLabel: context.phase
  };
}
