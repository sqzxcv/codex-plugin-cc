import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("session-review commands expose interactive review flows and show Codex output before Claude handles it", () => {
  const main = read("commands/session-review.md");
  const user = read("commands/session-review-user.md");
  const claude = read("commands/session-review-claude.md");
  const followUp = read("commands/session-review-follow-up.md");
  const loop = read("commands/session-review-loop.md");

  for (const source of [main, user, claude, followUp, loop]) {
    assert.match(source, /AskUserQuestion/);
    assert.match(source, /print the `rendered` field/i);
    assert.match(source, /before Claude handles/i);
    assert.match(source, /Do not hide the Codex review/i);
    assert.match(source, /effective arguments/i);
    assert.match(source, /do not pass the placeholder literally/i);
    assert.match(source, /do not rewrite trailing text to `--user-note`/i);
    assert.doesNotMatch(source, /--follow-up/);
    assert.match(source, /After printing .*`rendered` field.*AskUserQuestion/is);
    assert.match(source, /include the full `rendered` review text in the `AskUserQuestion` prompt/i);
    assert.match(source, /modal can appear before the chat output is visible/i);
    assert.match(source, /Do not ask with only a short prompt/i);
    assert.match(source, /same UI where they choose/i);
    assert.match(source, /交给 Claude 处理/);
    assert.match(source, /交给用户决定/);
    assert.match(source, /用户补充信息后重新让 Codex review/);
    assert.doesNotMatch(source, /After printing the `rendered` field, stop\. Do not summarize, paraphrase, fix, or offer Claude-side handling/i);
    assert.doesNotMatch(source, /If Codex reports no findings[\s\S]*Stop after showing the review/i);
    assert.doesNotMatch(source, /Stop when Codex returns no findings/i);
  }
  for (const source of [main, user, claude, loop]) {
    assert.match(source, /session-review "--json/);
  }

  assert.match(main, /交给 Claude 处理/);
  assert.match(main, /交给用户决定/);
  assert.match(main, /进入循环复审/);
  assert.match(main, /用户补充信息后重新让 Codex review/);
  assert.match(main, /--user-note/);
  assert.match(main, /session-review-follow-up/);
  assert.match(user, /session-review decision point/i);
  assert.match(followUp, /session-review-follow-up "--json/);
  assert.match(followUp, /session-review decision point/i);
  assert.match(claude, /逐条给出“修复”或“有异议”/);
  assert.match(claude, /session-review-follow-up/);
  assert.match(loop, /default maximum is 3 review iterations/i);
  assert.match(loop, /session-review-follow-up/);

  for (const source of [main, user, claude, followUp, loop]) {
    assert.match(source, /Other/);
    assert.match(source, /--user-note-file/);
    assert.match(source, /Do not pass supplemental review text directly on the command line/i);
    assert.doesNotMatch(source, /--user-note <user-supplemental-input>/);
  }
});
