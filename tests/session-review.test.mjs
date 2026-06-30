import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import { resolveStateDir } from "../plugins/codex/scripts/lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "codex-companion.mjs");
const SESSION_HOOK = path.join(PLUGIN_ROOT, "scripts", "session-lifecycle-hook.mjs");

function installSessionReviewFakeCodex(binDir, behavior = "session-review") {
  installFakeCodex(binDir);
  const scriptPath = path.join(binDir, "codex");
  const source = fs.readFileSync(scriptPath, "utf8");
  const sessionPayload = `
  if (prompt.includes("Claude session review")) {
    if (${JSON.stringify(behavior)} === "session-review-invalid-json") {
      return "not structured json";
    }
    const phase = prompt.includes("Previous Codex session review") ? "follow-up" : "initial";
    return JSON.stringify({
      verdict: "needs-attention",
      phase,
      summary:
        phase === "follow-up"
          ? "Follow-up reviewed Claude's response to the previous findings."
          : "Claude session review found one issue.",
      findings: [
        {
          category: "code",
          severity: "high",
          title: "Claude skipped validation",
          body: "Claude changed the indexed access without proving empty-state behavior is safe.",
          evidence: "The session transcript shows an Edit to src/app.js and the git diff changes items[0] usage.",
          recommendation: "Add an empty-state guard and run the relevant tests.",
          suggested_owner: "claude"
        }
      ],
      next_steps: ["Show this review before Claude handles it."]
    });
  }
`;
  fs.writeFileSync(scriptPath, source.replace("function structuredReviewPayload(prompt) {", `function structuredReviewPayload(prompt) {${sessionPayload}`), {
    encoding: "utf8",
    mode: 0o755
  });
}

test("session-review reviews the current Claude transcript and git state", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  const binDir = makeTempDir();
  const sessionId = "sess-session-review";
  const projectDir = path.join(home, ".claude", "projects", "-repo");
  const sourcePath = path.join(projectDir, `${sessionId}.jsonl`);
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  installSessionReviewFakeCodex(binDir);
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0];\n");
  run("git", ["add", "src/app.js"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0].id;\n");
  fs.writeFileSync(
    sourcePath,
    [
      { type: "user", cwd: repo, message: { role: "user", content: "Add item id rendering." } },
      {
        type: "assistant",
        cwd: repo,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Plan: inspect the renderer, edit src/app.js, run tests." },
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: path.join(repo, "src", "app.js"), old_string: "items[0]", new_string: "items[0].id" }
            }
          ]
        }
      }
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8"
  );
  fs.appendFileSync(sourcePath, "not-json\n", "utf8");

  const result = run("node", [SCRIPT, "session-review", "--json"], {
    cwd: repo,
    env: {
      ...buildEnv(binDir),
      HOME: home,
      CODEX_HOME: path.join(home, ".codex"),
      CODEX_COMPANION_SESSION_ID: sessionId,
      CODEX_COMPANION_TRANSCRIPT_PATH: sourcePath
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.rendered, /# Codex Session Review/);
  assert.match(payload.rendered, /Claude skipped validation/);
  assert.equal(payload.context.phase, "initial");
  assert.equal(payload.context.sessionId, sessionId);
  assert.equal(payload.context.transcript.newEntries, 2);
  assert.equal(payload.context.transcript.parseErrors.length, 1);

  const fakeState = JSON.parse(fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8"));
  assert.match(fakeState.lastTurnStart.prompt, /Claude session review/i);
  assert.match(fakeState.lastTurnStart.prompt, /Add item id rendering\./);
  assert.match(fakeState.lastTurnStart.prompt, /Plan: inspect the renderer/);
  assert.match(fakeState.lastTurnStart.prompt, /Edit/);
  assert.match(fakeState.lastTurnStart.prompt, /src\/app\.js/);
  assert.match(fakeState.lastTurnStart.prompt, /Git Status/);
  assert.match(fakeState.lastTurnStart.prompt, /Unstaged Diff/);
  assert.match(fakeState.lastTurnStart.prompt, /Transcript Parse Errors/);
  assert.match(fakeState.lastTurnStart.prompt, /not-json/);
});

test("session-review follow-up focuses on transcript entries added after the previous review", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  const binDir = makeTempDir();
  const sessionId = "sess-session-review-follow-up";
  const projectDir = path.join(home, ".claude", "projects", "-repo");
  const sourcePath = path.join(projectDir, `${sessionId}.jsonl`);
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  installSessionReviewFakeCodex(binDir);
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0];\n");
  run("git", ["add", "src/app.js"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0].id;\n");
  fs.writeFileSync(
    sourcePath,
    [
      { type: "user", cwd: repo, message: { role: "user", content: "Add item id rendering." } },
      { type: "assistant", cwd: repo, message: { role: "assistant", content: "Implemented by editing src/app.js." } }
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8"
  );
  const env = {
    ...buildEnv(binDir),
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    CODEX_COMPANION_SESSION_ID: sessionId,
    CODEX_COMPANION_TRANSCRIPT_PATH: sourcePath
  };

  const first = run("node", [SCRIPT, "session-review", "--json"], { cwd: repo, env });
  assert.equal(first.status, 0, first.stderr);
  const stateDir = resolveStateDir(repo);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, "state.json"), "utf8"));
  const sessionReviews = JSON.parse(fs.readFileSync(path.join(stateDir, "session-reviews.json"), "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(state, "sessionReviews"), false);
  assert.equal(sessionReviews[sessionId].iteration, 1);
  fs.appendFileSync(
    sourcePath,
    [
      {
        type: "assistant",
        cwd: repo,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "修复: added an empty-state guard and ran npm test." },
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: path.join(repo, "src", "app.js"), old_string: "items[0].id", new_string: "items[0]?.id ?? null" }
            }
          ]
        }
      }
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8"
  );
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0]?.id ?? null;\n");

  const followUp = run("node", [SCRIPT, "session-review", "--json", "--follow-up"], { cwd: repo, env });

  assert.equal(followUp.status, 0, followUp.stderr);
  const payload = JSON.parse(followUp.stdout);
  assert.equal(payload.context.phase, "follow-up");
  assert.equal(payload.context.iteration, 2);
  assert.equal(payload.context.transcript.newEntries, 1);

  const fakeState = JSON.parse(fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8"));
  assert.match(fakeState.lastTurnStart.prompt, /Previous Codex session review/i);
  assert.match(fakeState.lastTurnStart.prompt, /New session transcript since previous review/i);
  assert.match(fakeState.lastTurnStart.prompt, /修复: added an empty-state guard/);
  assert.doesNotMatch(fakeState.lastTurnStart.prompt, /Implemented by editing src\/app\.js\./);
  assert.match(fakeState.lastTurnStart.prompt, /Latest Git Status/);
});

test("session-review follow-up can use --source when session environment variables are missing", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  const binDir = makeTempDir();
  const sessionId = "sess-source-only-review";
  const projectDir = path.join(home, ".claude", "projects", "-repo");
  const sourcePath = path.join(projectDir, `${sessionId}.jsonl`);
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  installSessionReviewFakeCodex(binDir);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "hello again\n");
  fs.writeFileSync(
    sourcePath,
    `${JSON.stringify({ type: "user", cwd: repo, message: { role: "user", content: "Update README." } })}\n`,
    "utf8"
  );
  const env = {
    ...buildEnv(binDir),
    HOME: home,
    CODEX_HOME: path.join(home, ".codex")
  };

  const first = run("node", [SCRIPT, "session-review", "--json", "--source", sourcePath], { cwd: repo, env });
  assert.equal(first.status, 0, first.stderr);
  fs.appendFileSync(
    sourcePath,
    `${JSON.stringify({ type: "assistant", cwd: repo, message: { role: "assistant", content: "修复: updated README." } })}\n`,
    "utf8"
  );

  const followUp = run("node", [SCRIPT, "session-review", "--json", "--follow-up", "--source", sourcePath], {
    cwd: repo,
    env
  });

  assert.equal(followUp.status, 0, followUp.stderr);
  const payload = JSON.parse(followUp.stdout);
  assert.equal(payload.context.sessionId, sessionId);
  assert.equal(payload.context.phase, "follow-up");
});

test("session-review accepts quoted raw arguments with --source", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  const binDir = makeTempDir();
  const sessionId = "sess-raw-source-review";
  const projectDir = path.join(home, ".claude", "projects", "-repo");
  const sourcePath = path.join(projectDir, `${sessionId}.jsonl`);
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  installSessionReviewFakeCodex(binDir);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(
    sourcePath,
    `${JSON.stringify({ type: "user", cwd: repo, message: { role: "user", content: "Review this session." } })}\n`,
    "utf8"
  );

  const result = run("node", [SCRIPT, "session-review", `--json --source "${sourcePath}"`], {
    cwd: repo,
    env: {
      ...buildEnv(binDir),
      HOME: home,
      CODEX_HOME: path.join(home, ".codex")
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.context.sessionId, sessionId);
  assert.equal(payload.context.sourcePath, fs.realpathSync(sourcePath));
});

test("session-review does not checkpoint when Codex returns invalid structured JSON", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  const binDir = makeTempDir();
  const sessionId = "sess-invalid-session-review";
  const projectDir = path.join(home, ".claude", "projects", "-repo");
  const sourcePath = path.join(projectDir, `${sessionId}.jsonl`);
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  installSessionReviewFakeCodex(binDir, "session-review-invalid-json");
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(
    sourcePath,
    `${JSON.stringify({ type: "user", cwd: repo, message: { role: "user", content: "Review this session." } })}\n`,
    "utf8"
  );

  const result = run("node", [SCRIPT, "session-review", "--json"], {
    cwd: repo,
    env: {
      ...buildEnv(binDir),
      HOME: home,
      CODEX_HOME: path.join(home, ".codex"),
      CODEX_COMPANION_SESSION_ID: sessionId,
      CODEX_COMPANION_TRANSCRIPT_PATH: sourcePath
    }
  });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.rendered, /did not return valid structured JSON/i);
  assert.equal(payload.result, null);
  assert.equal(fs.existsSync(path.join(resolveStateDir(repo), "session-reviews.json")), false);
});

test("session end clears session-review checkpoints even when no session job remains", () => {
  const repo = makeTempDir();
  initGitRepo(repo);

  const stateDir = resolveStateDir(repo);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "session-reviews.json"),
    `${JSON.stringify(
      {
        "sess-current": {
          iteration: 1,
          transcriptOffset: 123
        },
        "sess-other": {
          iteration: 2,
          transcriptOffset: 456
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = run("node", [SESSION_HOOK, "SessionEnd"], {
    cwd: repo,
    env: {
      ...process.env,
      CODEX_COMPANION_SESSION_ID: "sess-current"
    },
    input: JSON.stringify({
      hook_event_name: "SessionEnd",
      session_id: "sess-current",
      cwd: repo
    })
  });

  assert.equal(result.status, 0, result.stderr);
  const reviews = JSON.parse(fs.readFileSync(path.join(stateDir, "session-reviews.json"), "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(reviews, "sess-current"), false);
  assert.equal(reviews["sess-other"].iteration, 2);
  assert.equal(fs.existsSync(path.join(stateDir, "state.json")), false);
});
