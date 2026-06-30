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
  const loop = read("commands/session-review-loop.md");

  for (const source of [main, user, claude, loop]) {
    assert.match(source, /AskUserQuestion/);
    assert.match(source, /session-review "--json/);
    assert.match(source, /print the `rendered` field/i);
    assert.match(source, /before Claude handles/i);
    assert.match(source, /Do not hide the Codex review/i);
    assert.match(source, /effective arguments/i);
    assert.match(source, /do not pass the placeholder literally/i);
  }

  assert.match(main, /交给 Claude 处理/);
  assert.match(main, /交给用户决定/);
  assert.match(main, /进入循环复审/);
  assert.match(user, /do not let Claude edit/i);
  assert.match(user, /stop\. Do not summarize, paraphrase, fix, or offer Claude-side handling/i);
  assert.doesNotMatch(user, /交给 Claude 处理/);
  assert.match(claude, /逐条给出“修复”或“有异议”/);
  assert.match(loop, /default maximum is 3 review iterations/i);
});
