#!/usr/bin/env node
// PreToolUse(Bash) — route ALL image generation through the managed /codex:imagegen path.
//
// Image generation must go through codex-companion's serialized app-server path.
// Every other route — garden gpt-image-2 generate.js / edit.js, baoyu-image-gen,
// image2_asset.py, a bare `codex exec ... imagegen`, or a direct POST to /v1/images
// — bypasses the single serialized connection, which is the websocket contention
// (403/429) and quota burn the managed path exists to prevent.
//
// This hook prefers REWRITE: when it can map a foreign command's prompt / output /
// reference flags onto the companion's `imagegen` subcommand, it rewrites the command
// in place (hookSpecificOutput.updatedInput) so it transparently runs through the
// managed path — no extra agent round-trip. When the mapping is not safe (prompt only
// in a file, free-text `codex exec`, raw curl), it falls back to BLOCK + redirect and
// lets the agent re-issue. It never rewrites into a guess.
//
// Coding `codex exec` (rescue / executor) and the companion's own imagegen are left
// untouched.

import { readFileSync } from "node:fs";

let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let cmd = "";
try {
  cmd = (JSON.parse(raw).tool_input?.command ?? "").toString();
} catch {
  process.exit(0);
}
if (!cmd.trim()) process.exit(0);

// Already the managed path — let it run.
if (/codex-companion\.mjs[\s\S]*\bimagegen\b/.test(cmd)) process.exit(0);

const COMPANION = `${process.env.CLAUDE_PLUGIN_ROOT ?? ""}/scripts/codex-companion.mjs`;

// Foreign image-gen tools and how their flags map onto the companion.
// out:  flag whose value is the OUTPUT path  -> companion --out
// ref:  flag whose value is a REFERENCE image -> companion --image
// promptFileOnly: flags that supply the prompt via a file (can't inline) -> block
const TOOLS = [
  { re: /gpt-image-2[/\\][^\s]*\bgenerate\.js/i, prompt: ["--prompt"], out: ["--image"], ref: [], promptFileOnly: ["--promptfile"] },
  { re: /gpt-image-2[/\\][^\s]*\bedit\.js/i,     prompt: ["--prompt"], out: [],          ref: ["--image"], promptFileOnly: ["--promptfile"] },
  { re: /baoyu-image-gen[/\\][^\s]*main\.ts/i,   prompt: ["--prompt"], out: ["--image"], ref: ["--ref", "--reference"], promptFileOnly: ["--promptfiles"] },
  { re: /image2_asset\.py/i,                      prompt: ["--prompt"], out: ["--output"], ref: ["--image"], promptFileOnly: [] },
];

const tool = TOOLS.find((t) => t.re.test(cmd));
if (tool) {
  const prompt = flag(cmd, tool.prompt);
  if (!prompt) block(promptOnlyInFile(cmd, tool) ? "a file-only prompt that cannot be inlined" : "an image-gen command with no inlinable --prompt");
  const out = flag(cmd, tool.out);
  const ref = flag(cmd, tool.ref);
  const passBg = /(^|\s)--background(\s|$)/.test(cmd) ? " --background" : "";
  const parts = [`node ${shq(COMPANION)} imagegen`];
  if (out) parts.push(`--out ${shq(out)}`);
  if (ref) parts.push(`--image ${shq(ref)}`);
  const rewritten = parts.join(" ") + passBg + ` ${shq(prompt)}`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Rerouted through the managed /codex:imagegen path.",
      updatedInput: { command: rewritten },
    },
  }));
  process.exit(0);
}

// Routes we cannot safely rewrite -> block + redirect.
const stripped = cmd.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
if (/codex\s+exec/.test(stripped) &&
    /imagegen|gpt-image|image generation|generate the image|built-in image|generated_images/i.test(cmd)) {
  block("a bare `codex exec` image generation");
}
if (/\/v1\/images\/(generations|edits)/i.test(cmd)) {
  block("a direct POST to /v1/images (OpenAI-compatible image API)");
}

process.exit(0);

// ── helpers ──────────────────────────────────────────────────────────────────
function flag(command, names) {
  for (const n of names) {
    const re = new RegExp(`${n.replace(/[-]/g, "\\$&")}(?:\\s+|=)(?:"([^"]*)"|'([^']*)'|(\\S+))`);
    const m = command.match(re);
    if (m) return m[1] ?? m[2] ?? m[3];
  }
  return null;
}

function promptOnlyInFile(command, tool) {
  return tool.promptFileOnly.some((f) => flag(command, [f]) !== null);
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function block(why) {
  process.stderr.write(
`BLOCKED — image generation must go through the managed /codex:imagegen path.

Detected: ${why}.
This route can't be auto-rewritten safely, so it's blocked rather than guessed.

Do instead:
  - Generate via the managed path:
      /codex:imagegen --out <path> <what the image should be>
    (edit with --image ref.png; queue with --background)
  - To recover an image a prior run already produced:
      ls -t ~/.codex/generated_images/*/*.png | head
`);
  process.exit(2);
}
