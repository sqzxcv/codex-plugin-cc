import "./helpers.mjs";

import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { runTrackedJob } from "../plugins/codex/scripts/lib/tracked-jobs.mjs";

test("runTrackedJob emits a terminal completed event when the runner throws", async () => {
  const workspace = makeTempDir();
  const eventFile = path.join(makeTempDir(), "job.events.jsonl");

  await assert.rejects(
    runTrackedJob(
      { id: "task-boom", workspaceRoot: workspace, status: "queued" },
      () => {
        throw new Error("auth/config failure before execution object");
      },
      { eventFile }
    ),
    /auth\/config failure/
  );

  const events = fs
    .readFileSync(eventFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const terminal = events.find((event) => event.type === "completed");
  assert.ok(terminal, "a completed event must be emitted on failure so observers stop tailing");
  assert.equal(terminal.status, "failure");
  assert.equal(terminal.phase, "failed");
});
