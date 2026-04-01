import test from "node:test";
import assert from "node:assert/strict";

import {
  renderReviewResult,
  renderStoredJobResult,
  renderSetupReport,
  renderNativeReviewResult,
  renderTaskResult,
  renderStatusReport,
  renderJobStatusReport,
  renderCancelReport
} from "../plugins/codex/scripts/lib/render.mjs";

test("renderReviewResult degrades gracefully when JSON is missing required review fields", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "Looks fine."
      },
      rawOutput: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine."
      }),
      parseError: null
    },
    {
      reviewLabel: "Adversarial Review",
      targetLabel: "working tree diff"
    }
  );

  assert.match(output, /Codex returned JSON with an unexpected review shape\./);
  assert.match(output, /Missing array `findings`\./);
  assert.match(output, /Raw final message:/);
});

test("renderStoredJobResult prefers rendered output for structured review jobs", () => {
  const output = renderStoredJobResult(
    {
      id: "review-123",
      status: "completed",
      title: "Codex Adversarial Review",
      jobClass: "review",
      threadId: "thr_123"
    },
    {
      threadId: "thr_123",
      rendered: "# Codex Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
      result: {
        result: {
          verdict: "needs-attention",
          summary: "One issue.",
          findings: [],
          next_steps: []
        },
        rawOutput:
          '{"verdict":"needs-attention","summary":"One issue.","findings":[],"next_steps":[]}'
      }
    }
  );

  assert.match(output, /^# Codex Adversarial Review/);
  assert.doesNotMatch(output, /^\{/);
  assert.match(output, /Codex session ID: thr_123/);
  assert.match(output, /Resume in Codex: codex resume thr_123/);
});

// ---------------------------------------------------------------------------
// renderReviewResult — additional cases
// ---------------------------------------------------------------------------

test("renderReviewResult emits no-findings message for a clean approve result", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "All good.",
        findings: [],
        next_steps: []
      },
      rawOutput: '{"verdict":"approve","summary":"All good.","findings":[],"next_steps":[]}',
      parseError: null
    },
    { reviewLabel: "Review", targetLabel: "working tree diff" }
  );

  assert.match(output, /Verdict: approve/);
  assert.match(output, /All good\./);
  assert.match(output, /No material findings\./);
  assert.doesNotMatch(output, /Findings:/);
});

test("renderReviewResult renders findings sorted by severity", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "needs-attention",
        summary: "Issues found.",
        findings: [
          { severity: "low", title: "Minor lint", body: "Lint warning.", file: "a.js", line_start: 1, line_end: 1, recommendation: "" },
          { severity: "critical", title: "SQL injection", body: "Unsafe query.", file: "b.js", line_start: 5, line_end: 5, recommendation: "Use prepared statements." },
          { severity: "medium", title: "Null deref", body: "Possible null.", file: "c.js", line_start: 10, line_end: 12, recommendation: "" }
        ],
        next_steps: ["Fix SQL issue.", "Suppress lint warning."]
      },
      rawOutput: null,
      parseError: null
    },
    { reviewLabel: "Review", targetLabel: "branch diff" }
  );

  assert.match(output, /Findings:/);
  // critical should appear before medium and low
  const critIdx = output.indexOf("[critical]");
  const medIdx = output.indexOf("[medium]");
  const lowIdx = output.indexOf("[low]");
  assert.ok(critIdx < medIdx, "critical should precede medium");
  assert.ok(medIdx < lowIdx, "medium should precede low");
  // line range
  assert.match(output, /c\.js:10-12/);
  assert.match(output, /b\.js:5/);
  // recommendation
  assert.match(output, /Use prepared statements\./);
  // next steps
  assert.match(output, /Next steps:/);
  assert.match(output, /Fix SQL issue\./);
});

test("renderReviewResult degrades gracefully when parsed is null", () => {
  const output = renderReviewResult(
    {
      parsed: null,
      rawOutput: "some raw text",
      parseError: "Unexpected token"
    },
    { reviewLabel: "Review", targetLabel: "working tree diff" }
  );

  assert.match(output, /Codex did not return valid structured JSON\./);
  assert.match(output, /Unexpected token/);
  assert.match(output, /some raw text/);
});

test("renderReviewResult includes reasoning summary when provided", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "Looks good.",
        findings: [],
        next_steps: []
      },
      rawOutput: null,
      parseError: null
    },
    {
      reviewLabel: "Review",
      targetLabel: "working tree diff",
      reasoningSummary: ["Checked all the critical paths.", "No regressions found."]
    }
  );

  assert.match(output, /Reasoning:/);
  assert.match(output, /Checked all the critical paths\./);
});

// ---------------------------------------------------------------------------
// renderSetupReport
// ---------------------------------------------------------------------------

test("renderSetupReport shows ready status and no next steps when everything is fine", () => {
  const output = renderSetupReport({
    ready: true,
    node: { detail: "v20.0.0" },
    npm: { detail: "10.0.0" },
    codex: { detail: "1.2.3" },
    auth: { detail: "authenticated" },
    sessionRuntime: { label: "app-server" },
    reviewGateEnabled: false,
    actionsTaken: [],
    nextSteps: []
  });

  assert.match(output, /# Codex Setup/);
  assert.match(output, /Status: ready/);
  assert.match(output, /node: v20\.0\.0/);
  assert.match(output, /review gate: disabled/);
  assert.doesNotMatch(output, /Next steps:/);
  assert.doesNotMatch(output, /Actions taken:/);
});

test("renderSetupReport shows needs-attention status, actions taken and next steps", () => {
  const output = renderSetupReport({
    ready: false,
    node: { detail: "v18.0.0" },
    npm: { detail: "9.0.0" },
    codex: { detail: "not found" },
    auth: { detail: "not authenticated" },
    sessionRuntime: { label: "none" },
    reviewGateEnabled: true,
    actionsTaken: ["Installed Codex CLI."],
    nextSteps: ["Run `codex login`."]
  });

  assert.match(output, /Status: needs attention/);
  assert.match(output, /review gate: enabled/);
  assert.match(output, /Actions taken:/);
  assert.match(output, /Installed Codex CLI\./);
  assert.match(output, /Next steps:/);
  assert.match(output, /Run `codex login`\./);
});

// ---------------------------------------------------------------------------
// renderNativeReviewResult
// ---------------------------------------------------------------------------

test("renderNativeReviewResult renders stdout when present", () => {
  const output = renderNativeReviewResult(
    { stdout: "No issues found.", stderr: "", status: 0 },
    { reviewLabel: "Review", targetLabel: "branch diff" }
  );

  assert.match(output, /# Codex Review/);
  assert.match(output, /Target: branch diff/);
  assert.match(output, /No issues found\./);
  assert.doesNotMatch(output, /stderr:/);
});

test("renderNativeReviewResult shows fallback message when stdout is empty and exit is 0", () => {
  const output = renderNativeReviewResult(
    { stdout: "", stderr: "", status: 0 },
    { reviewLabel: "Review", targetLabel: "working tree diff" }
  );

  assert.match(output, /Codex review completed without any stdout output\./);
});

test("renderNativeReviewResult shows failure message when stdout is empty and exit is non-zero", () => {
  const output = renderNativeReviewResult(
    { stdout: "", stderr: "fatal error", status: 1 },
    { reviewLabel: "Review", targetLabel: "working tree diff" }
  );

  assert.match(output, /Codex review failed\./);
  assert.match(output, /stderr:/);
  assert.match(output, /fatal error/);
});

// ---------------------------------------------------------------------------
// renderTaskResult
// ---------------------------------------------------------------------------

test("renderTaskResult returns rawOutput when present", () => {
  const output = renderTaskResult(
    { rawOutput: "Task done.\n", failureMessage: null },
    {}
  );
  assert.equal(output, "Task done.\n");
});

test("renderTaskResult appends a newline to rawOutput when missing", () => {
  const output = renderTaskResult({ rawOutput: "Task done.", failureMessage: null }, {});
  assert.equal(output, "Task done.\n");
});

test("renderTaskResult falls back to failureMessage when rawOutput is absent", () => {
  const output = renderTaskResult(
    { rawOutput: "", failureMessage: "Something went wrong." },
    {}
  );
  assert.equal(output, "Something went wrong.\n");
});

test("renderTaskResult uses generic fallback when both rawOutput and failureMessage are absent", () => {
  const output = renderTaskResult({}, {});
  assert.equal(output, "Codex did not return a final message.\n");
});

// ---------------------------------------------------------------------------
// renderStatusReport
// ---------------------------------------------------------------------------

test("renderStatusReport shows no-jobs message when there are no jobs", () => {
  const output = renderStatusReport({
    sessionRuntime: { label: "none" },
    config: { stopReviewGate: false },
    running: [],
    latestFinished: null,
    recent: [],
    needsReview: false
  });

  assert.match(output, /# Codex Status/);
  assert.match(output, /No jobs recorded yet\./);
  assert.doesNotMatch(output, /Active jobs:/);
});

test("renderStatusReport shows running jobs table and live details", () => {
  const output = renderStatusReport({
    sessionRuntime: { label: "app-server" },
    config: { stopReviewGate: false },
    running: [
      {
        id: "job-abc",
        status: "running",
        kindLabel: "review",
        title: "Codex Review",
        phase: "reviewing",
        elapsed: "5s",
        threadId: "thr_1",
        summary: null,
        logFile: "/tmp/job-abc.log"
      }
    ],
    latestFinished: null,
    recent: [],
    needsReview: false
  });

  assert.match(output, /Active jobs:/);
  assert.match(output, /job-abc/);
  assert.match(output, /Elapsed: 5s/);
  assert.match(output, /Live details:/);
});

test("renderStatusReport shows the review-gate warning when needsReview is true", () => {
  const output = renderStatusReport({
    sessionRuntime: { label: "none" },
    config: { stopReviewGate: true },
    running: [],
    latestFinished: null,
    recent: [],
    needsReview: true
  });

  assert.match(output, /stop-time review gate is enabled/);
});

test("renderStatusReport shows latest finished job", () => {
  const output = renderStatusReport({
    sessionRuntime: { label: "none" },
    config: { stopReviewGate: false },
    running: [],
    latestFinished: {
      id: "job-xyz",
      status: "completed",
      kindLabel: "task",
      title: "Codex Task",
      phase: "done",
      duration: "12s",
      threadId: "thr_2",
      summary: "Did things.",
      logFile: "/tmp/job-xyz.log"
    },
    recent: [],
    needsReview: false
  });

  assert.match(output, /Latest finished:/);
  assert.match(output, /job-xyz/);
  assert.match(output, /Duration: 12s/);
});

// ---------------------------------------------------------------------------
// renderJobStatusReport
// ---------------------------------------------------------------------------

test("renderJobStatusReport renders a running job with cancel hint", () => {
  const output = renderJobStatusReport({
    id: "job-run",
    status: "running",
    kindLabel: "review",
    title: "Codex Review",
    phase: "reviewing",
    elapsed: "3s",
    threadId: null,
    logFile: "/tmp/job-run.log"
  });

  assert.match(output, /# Codex Job Status/);
  assert.match(output, /job-run/);
  assert.match(output, /Cancel: \/codex:cancel job-run/);
});

test("renderJobStatusReport renders a completed job with result hint", () => {
  const output = renderJobStatusReport({
    id: "job-done",
    status: "completed",
    kindLabel: "task",
    title: "Codex Task",
    phase: "done",
    duration: "8s",
    threadId: "thr_5",
    logFile: "/tmp/job-done.log",
    jobClass: "task",
    write: true
  });

  assert.match(output, /Result: \/codex:result job-done/);
  assert.match(output, /Resume in Codex: codex resume thr_5/);
  assert.match(output, /Review changes: \/codex:review --wait/);
});

// ---------------------------------------------------------------------------
// renderCancelReport
// ---------------------------------------------------------------------------

test("renderCancelReport shows the cancelled job id", () => {
  const output = renderCancelReport({ id: "job-cancel", title: null, summary: null });
  assert.match(output, /# Codex Cancel/);
  assert.match(output, /Cancelled job-cancel\./);
  assert.match(output, /\/codex:status/);
});

test("renderCancelReport includes title and summary when present", () => {
  const output = renderCancelReport({
    id: "job-cancel",
    title: "My Task",
    summary: "Was running a sweep."
  });
  assert.match(output, /Title: My Task/);
  assert.match(output, /Summary: Was running a sweep\./);
});

// ---------------------------------------------------------------------------
// renderStoredJobResult — additional cases
// ---------------------------------------------------------------------------

test("renderStoredJobResult falls back to rawOutput from codex.stdout when result has no rawOutput", () => {
  const output = renderStoredJobResult(
    { id: "job-1", status: "completed", title: "My Task", threadId: null },
    {
      result: {
        codex: { stdout: "Task output here." }
      }
    }
  );

  assert.match(output, /Task output here\./);
});

test("renderStoredJobResult renders fallback block when no result and no rendered output", () => {
  const output = renderStoredJobResult(
    { id: "job-2", status: "completed", title: "Codex Task", threadId: null, summary: null, errorMessage: null },
    null
  );

  assert.match(output, /# Codex Task/);
  assert.match(output, /Job: job-2/);
  assert.match(output, /No captured result payload/);
});

test("renderStoredJobResult appends session ID and resume command to rendered output", () => {
  const output = renderStoredJobResult(
    { id: "job-3", status: "completed", title: "Codex Task", threadId: "thr_99" },
    {
      threadId: "thr_99",
      rendered: "Some task output."
    }
  );

  assert.match(output, /Codex session ID: thr_99/);
  assert.match(output, /Resume in Codex: codex resume thr_99/);
});

