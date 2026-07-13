import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveClaudeSessionPath } from "./claude-session-transfer.mjs";
import { getRepoRoot } from "./git.mjs";
import { runCommandChecked } from "./process.mjs";
import { SESSION_ID_ENV } from "./tracked-jobs.mjs";

const MAX_SESSION_CONTEXT_CHARS = 120000;
const MAX_TRANSCRIPT_CHARS = 36000;
const MAX_GIT_CONTEXT_CHARS = 36000;
const MAX_TOOL_ACTIVITY_CHARS = 12000;
const MAX_PLANS_CHARS = 8000;
const MAX_EDITS_CHARS = 10000;
const MAX_COMMANDS_CHARS = 10000;
const MAX_PARSE_ERRORS_CHARS = 4000;
const MAX_USER_NOTE_CHARS = 32768;
const MAX_UNTRACKED_BYTES = 8 * 1024;
const EDIT_TOOL_NAMES = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const PLAN_TOOL_NAMES = new Set(["TodoWrite"]);
const COMMAND_TOOL_NAMES = new Set(["Bash"]);

function truncate(text, limit) {
  const value = String(text ?? "");
  if (!Number.isInteger(limit) || limit <= 0) {
    return value;
  }
  if (value.length <= limit) {
    return value;
  }
  if (limit < 256) {
    return `${value.slice(0, limit)}\n\n[truncated ${value.length - limit} character(s)]`;
  }
  const marker = `\n\n[truncated ${value.length - limit} character(s)]\n\n`;
  const remaining = Math.max(0, limit - marker.length);
  const headLength = Math.ceil(remaining * 0.6);
  const tailLength = Math.floor(remaining * 0.4);
  return `${value.slice(0, headLength)}${marker}${value.slice(value.length - tailLength)}`;
}

function formatSection(title, body, limit) {
  const value = truncate(String(body ?? "").trim(), limit);
  return [`## ${title}`, "", value || "(none)", ""].join("\n");
}

function formatParseErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "";
  }
  return errors.map((error) => `- line ${error.line}: ${error.message}`).join("\n");
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text ?? "")).digest("hex");
}

function readTranscriptBuffer(cwd, options = {}) {
  const sourcePath = resolveClaudeSessionPath(cwd, {
    source: options.source
  });
  return {
    sourcePath,
    buffer: fs.readFileSync(sourcePath)
  };
}

function parseJsonLines(text) {
  const entries = [];
  const errors = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    try {
      entries.push(JSON.parse(line));
    } catch (error) {
      errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { entries, errors };
}

function relativeToRepo(repoRoot, value) {
  if (typeof value !== "string" || !value.trim()) {
    return value;
  }
  const normalized = value.trim();
  if (!path.isAbsolute(normalized)) {
    return normalized;
  }
  let canonicalRepoRoot = repoRoot;
  let canonicalValue = normalized;
  try {
    canonicalRepoRoot = fs.realpathSync.native(repoRoot);
  } catch {
    canonicalRepoRoot = repoRoot;
  }
  try {
    canonicalValue = fs.realpathSync.native(normalized);
  } catch {
    try {
      canonicalValue = path.join(fs.realpathSync.native(path.dirname(normalized)), path.basename(normalized));
    } catch {
      canonicalValue = normalized;
    }
  }
  const relative = path.relative(canonicalRepoRoot, canonicalValue);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return normalized;
}

function stringifyContent(content, repoRoot) {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((entry) => stringifyContent(entry, repoRoot)).filter(Boolean).join("\n");
  }
  if (typeof content !== "object") {
    return String(content);
  }
  if (typeof content.text === "string") {
    return content.text;
  }
  if (content.type === "tool_use") {
    const name = content.name ?? "tool";
    return `[tool:${name}] ${stringifyToolInput(content.input, repoRoot)}`;
  }
  if (content.type === "tool_result") {
    return `[tool_result] ${stringifyContent(content.content, repoRoot)}`;
  }
  if (typeof content.content === "string" || Array.isArray(content.content)) {
    return stringifyContent(content.content, repoRoot);
  }
  return JSON.stringify(normalizeToolInput(content, repoRoot));
}

function normalizeToolInput(value, repoRoot) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeToolInput(entry, repoRoot));
  }
  if (!value || typeof value !== "object") {
    return relativeToRepo(repoRoot, value);
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = key.toLowerCase().includes("path") ? relativeToRepo(repoRoot, entry) : normalizeToolInput(entry, repoRoot);
  }
  return output;
}

function stringifyToolInput(input, repoRoot) {
  try {
    return JSON.stringify(normalizeToolInput(input ?? {}, repoRoot));
  } catch {
    return String(input ?? "");
  }
}

function collectToolUses(value, repoRoot, output = []) {
  if (!value || typeof value !== "object") {
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectToolUses(entry, repoRoot, output);
    }
    return output;
  }
  if (value.type === "tool_use" && typeof value.name === "string") {
    output.push({
      name: value.name,
      input: normalizeToolInput(value.input ?? {}, repoRoot)
    });
  }
  for (const entry of Object.values(value)) {
    collectToolUses(entry, repoRoot, output);
  }
  return output;
}

function entryRole(entry) {
  if (typeof entry?.type === "string") {
    return entry.type;
  }
  if (typeof entry?.message?.role === "string") {
    return entry.message.role;
  }
  return "unknown";
}

function summarizeEntries(entries, repoRoot) {
  const lines = [];
  const plans = [];
  const edits = [];
  const commands = [];
  const toolActivity = [];

  entries.forEach((entry, index) => {
    const role = entryRole(entry);
    const message = entry?.message ?? entry;
    const content = stringifyContent(message?.content ?? entry?.content ?? "", repoRoot).trim();
    const cwd = relativeToRepo(repoRoot, entry?.cwd ?? "");
    lines.push(`### ${index + 1}. ${role}${cwd ? ` (${cwd})` : ""}`);
    lines.push(content || "(no text content)");

    const tools = collectToolUses(message?.content ?? entry?.content ?? entry, repoRoot);
    for (const tool of tools) {
      const line = `- ${tool.name}: ${stringifyToolInput(tool.input, repoRoot)}`;
      toolActivity.push(line);
      if (PLAN_TOOL_NAMES.has(tool.name)) {
        plans.push(line);
      }
      if (EDIT_TOOL_NAMES.has(tool.name)) {
        edits.push(line);
      }
      if (COMMAND_TOOL_NAMES.has(tool.name)) {
        commands.push(line);
      }
    }
  });

  return {
    transcript: truncate(lines.join("\n\n"), MAX_TRANSCRIPT_CHARS),
    plans: truncate(plans.join("\n"), MAX_PLANS_CHARS),
    edits: truncate(edits.join("\n"), MAX_EDITS_CHARS),
    commands: truncate(commands.join("\n"), MAX_COMMANDS_CHARS),
    toolActivity: truncate(toolActivity.join("\n"), MAX_TOOL_ACTIVITY_CHARS)
  };
}

function gitChecked(cwd, args) {
  return runCommandChecked("git", args, { cwd }).stdout;
}

function formatUntrackedFile(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: broken symlink or unreadable file)`;
  }
  if (stat.isDirectory()) {
    return `### ${relativePath}\n(skipped: directory)`;
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  }
  try {
    return [`### ${relativePath}`, "```", fs.readFileSync(absolutePath, "utf8").trimEnd(), "```"].join("\n");
  } catch {
    return `### ${relativePath}\n(skipped: binary or unreadable file)`;
  }
}

function collectGitContext(repoRoot) {
  const status = gitChecked(repoRoot, ["status", "--short", "--untracked-files=all"]).trim();
  const stagedDiff = gitChecked(repoRoot, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"]);
  const unstagedDiff = gitChecked(repoRoot, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]);
  const untracked = gitChecked(repoRoot, ["ls-files", "--others", "--exclude-standard"]).trim().split("\n").filter(Boolean);
  const untrackedBody = untracked.map((file) => formatUntrackedFile(repoRoot, file)).join("\n\n");
  const content = [
    formatSection("Git Status", status),
    formatSection("Staged Diff", stagedDiff),
    formatSection("Unstaged Diff", unstagedDiff),
    formatSection("Untracked Files", untrackedBody)
  ].join("\n");

  return {
    status,
    content: truncate(content, MAX_GIT_CONTEXT_CHARS),
    diffHash: sha256(content),
    untrackedCount: untracked.length
  };
}

function getSessionId(sourcePath) {
  return process.env[SESSION_ID_ENV] || path.basename(sourcePath, ".jsonl");
}

function getPreviousReviewText(previousReview) {
  if (!previousReview) {
    return "No previous Codex session review for this Claude session.";
  }
  return [
    "Previous Codex session review",
    "",
    `Previous review id: ${previousReview.reviewId ?? "(unknown)"}`,
    `Previous iteration: ${previousReview.iteration ?? "(unknown)"}`,
    `Previous verdict: ${previousReview.result?.verdict ?? "(unknown)"}`,
    `Previous summary: ${previousReview.result?.summary ?? "(none)"}`,
    "",
    "Previous findings:",
    ...(previousReview.result?.findings?.length
      ? previousReview.result.findings.map((finding, index) => {
          return `${index + 1}. [${finding.severity ?? "unknown"}] ${finding.title ?? "Finding"} - ${finding.recommendation ?? ""}`;
        })
      : ["(none)"])
  ].join("\n");
}

export function collectSessionReviewContext(cwd, options = {}) {
  const repoRoot = getRepoRoot(cwd);
  const { sourcePath, buffer } = readTranscriptBuffer(cwd, options);
  const previousReview = options.previousReview ?? null;
  const requestedFollowUp = Boolean(options.followUp);
  const rawUserNote = options.userNote == null ? "" : String(options.userNote);
  if (rawUserNote.length > MAX_USER_NOTE_CHARS) {
    throw new Error(`User supplemental review input is too large: ${rawUserNote.length} characters exceeds ${MAX_USER_NOTE_CHARS}.`);
  }
  const userNote = rawUserNote.trim() ? rawUserNote : "";
  if (requestedFollowUp && !previousReview) {
    throw new Error("No previous session-review checkpoint was found for this Claude session.");
  }

  const previousOffset = previousReview?.transcriptOffset ?? 0;
  const safeOffset = Number.isInteger(previousOffset) && previousOffset > 0 && previousOffset <= buffer.length ? previousOffset : 0;
  const fullText = buffer.toString("utf8");
  const newText = buffer.subarray(safeOffset).toString("utf8");
  const parsedFull = parseJsonLines(fullText);
  const parsedNew = parseJsonLines(newText);
  const phase = requestedFollowUp ? "follow-up" : "initial";
  const selectedEntries = requestedFollowUp ? parsedNew.entries : parsedFull.entries;
  const selectedParseErrors = requestedFollowUp ? parsedNew.errors : parsedFull.errors;
  const summaries = summarizeEntries(selectedEntries, repoRoot);
  const git = collectGitContext(repoRoot);
  const sessionId = getSessionId(sourcePath);
  const iteration = requestedFollowUp ? Number(previousReview?.iteration ?? 1) + 1 : 1;
  const reviewId = `session-review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const transcriptTitle = requestedFollowUp ? "New session transcript since previous review" : "Full session transcript";
  const userNoteSection = userNote ? formatSection("User Supplemental Review Input", userNote) : "";

  const sessionContext = truncate([
    formatSection("Review Phase", phase),
    userNoteSection,
    formatSection(transcriptTitle, summaries.transcript),
    formatSection("Plans and Todos", summaries.plans),
    formatSection("Claude Tool Activity", summaries.toolActivity),
    formatSection("Claude Edit Activity", summaries.edits),
    formatSection("Claude Command Activity", summaries.commands),
    formatSection("Transcript Parse Errors", formatParseErrors(selectedParseErrors)),
    formatSection(requestedFollowUp ? "Latest Git Status" : "Current Git Status", git.content)
  ].join("\n"), MAX_SESSION_CONTEXT_CHARS);

  return {
    cwd: repoRoot,
    repoRoot,
    sourcePath,
    sessionId,
    phase,
    iteration,
    reviewId,
    userNote,
    transcriptOffset: buffer.length,
    transcript: {
      totalEntries: parsedFull.entries.length,
      newEntries: selectedEntries.length,
      parseErrors: selectedParseErrors
    },
    previousReview,
    previousReviewText: getPreviousReviewText(previousReview),
    git,
    sessionContext
  };
}

export function buildSessionReviewPrompt(context) {
  return {
    reviewId: context.reviewId,
    values: {
      PHASE: context.phase,
      SESSION_ID: context.sessionId,
      REVIEW_ID: context.reviewId,
      PREVIOUS_REVIEW: context.previousReviewText,
      SESSION_CONTEXT: context.sessionContext
    }
  };
}
