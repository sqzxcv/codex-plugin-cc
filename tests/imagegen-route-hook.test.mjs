import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../plugins/codex/scripts/imagegen-route-hook.mjs", import.meta.url));

function run(command, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "/PLUGIN", ...env },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { status: r.status, json, rewritten: json?.hookSpecificOutput?.updatedInput?.command ?? null };
}

const BLOCKED = 2;
const ALLOWED = 0;

test("allows the managed companion imagegen path untouched", () => {
  const r = run('node "/x/scripts/codex-companion.mjs" imagegen --out a.png "a cat"');
  assert.equal(r.status, ALLOWED);
  assert.equal(r.rewritten, null);
});

test("rewrites garden generate.js: --image is the output -> --out", () => {
  const r = run('node ~/.claude/skills/gpt-image-2/scripts/generate.js --prompt "a red fox" --image out.png');
  assert.equal(r.status, ALLOWED);
  assert.match(r.rewritten, /codex-companion\.mjs' imagegen/);
  assert.match(r.rewritten, /--out 'out\.png'/);
  assert.match(r.rewritten, /'a red fox'$/);
});

test("rewrites garden edit.js: --image is the reference -> --image", () => {
  const r = run('node ~/.claude/skills/gpt-image-2/scripts/edit.js --image src.png --prompt "make it night"');
  assert.equal(r.status, ALLOWED);
  assert.match(r.rewritten, /--image 'src\.png'/);
  assert.doesNotMatch(r.rewritten, /--out/);
});

test("rewrites baoyu: --image is output, --ref is reference", () => {
  const r = run('bun ~/.claude/skills/baoyu-image-gen/scripts/main.ts --prompt "a logo" --image final.png --ref brand.png');
  assert.equal(r.status, ALLOWED);
  assert.match(r.rewritten, /--out 'final\.png'/);
  assert.match(r.rewritten, /--image 'brand\.png'/);
  assert.match(r.rewritten, /'a logo'$/);
});

test("rewrites image2_asset.py: --output -> --out", () => {
  const r = run('python scripts/image2_asset.py generate --prompt "a hero banner" --output hero.png');
  assert.equal(r.status, ALLOWED);
  assert.match(r.rewritten, /--out 'hero\.png'/);
  assert.match(r.rewritten, /'a hero banner'$/);
});

test("uses CLAUDE_PLUGIN_ROOT for the companion path", () => {
  const r = run('python scripts/image2_asset.py --prompt "x"');
  assert.match(r.rewritten, /node '\/PLUGIN\/scripts\/codex-companion\.mjs' imagegen/);
});

test("passes --background through", () => {
  const r = run('bun .../baoyu-image-gen/scripts/main.ts --prompt "x" --image o.png --background');
  assert.match(r.rewritten, /--background/);
});

test("blocks (no rewrite) when the prompt is only in a file", () => {
  const r = run('node ~/.claude/skills/gpt-image-2/scripts/generate.js --promptfile p.md --image o.png');
  assert.equal(r.status, BLOCKED);
  assert.equal(r.rewritten, null);
});

test("blocks a bare codex exec imagegen (free text, cannot map)", () => {
  const r = run('codex exec --sandbox workspace-write "use imagegen to draw a logo, save to x.png"');
  assert.equal(r.status, BLOCKED);
});

test("blocks a direct POST to /v1/images", () => {
  const r = run("curl https://api.openai.com/v1/images/generations -d @body.json");
  assert.equal(r.status, BLOCKED);
});

test("allows a coding codex exec (no image markers)", () => {
  assert.equal(run('codex exec --sandbox workspace-write "fix the failing test in foo.ts"').status, ALLOWED);
});

test("allows a mere quoted mention of imagegen", () => {
  assert.equal(run('echo "the imagegen route hook reroutes gpt-image calls"').status, ALLOWED);
});

test("allows an unrelated command", () => {
  assert.equal(run("ls -la /tmp").status, ALLOWED);
});
