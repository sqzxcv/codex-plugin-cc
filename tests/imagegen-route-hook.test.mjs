import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../plugins/codex/scripts/imagegen-route-hook.mjs", import.meta.url));

function run(command) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  return r.status;
}

const BLOCKED = 2;
const ALLOWED = 0;

test("allows the managed companion imagegen path", () => {
  assert.equal(run('node "/x/scripts/codex-companion.mjs" imagegen --out a.png "a cat"'), ALLOWED);
});

test("blocks garden gpt-image-2 generate.js", () => {
  assert.equal(run('node ~/.claude/skills/gpt-image-2/scripts/generate.js --prompt "x"'), BLOCKED);
});

test("blocks image2_asset.py", () => {
  assert.equal(run("python scripts/image2_asset.py generate --prompt x"), BLOCKED);
});

test("blocks baoyu-image-gen main.ts", () => {
  assert.equal(run('bun ~/.claude/skills/baoyu-image-gen/scripts/main.ts --prompt "x" --image o.png'), BLOCKED);
});

test("blocks a direct POST to /v1/images", () => {
  assert.equal(run('curl https://api.openai.com/v1/images/generations -d @body.json'), BLOCKED);
});

test("blocks a bare codex exec imagegen", () => {
  assert.equal(run('codex exec --sandbox workspace-write "use imagegen to draw a logo, save to x.png"'), BLOCKED);
});

test("allows a coding codex exec (no image markers)", () => {
  assert.equal(run('codex exec --sandbox workspace-write "fix the failing test in foo.ts"'), ALLOWED);
});

test("allows a mere quoted mention of imagegen", () => {
  assert.equal(run('echo "the imagegen route hook blocks gpt-image calls"'), ALLOWED);
});

test("allows an unrelated command", () => {
  assert.equal(run("ls -la /tmp"), ALLOWED);
});
