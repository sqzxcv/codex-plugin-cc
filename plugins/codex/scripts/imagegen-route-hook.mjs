#!/usr/bin/env node
// PreToolUse(Bash) — route ALL image generation through the managed /codex:imagegen path.
//
// Image generation must go through codex-companion's serialized app-server path
// (/codex:imagegen). Every other route — garden gpt-image-2 Mode A (generate.js /
// edit.js), baoyu-image-gen, image2_asset.py, a bare `codex exec ... imagegen`, or a
// direct POST to /v1/images — bypasses the single serialized connection. That is the
// websocket contention (403/429) and quota burn the managed path exists to prevent.
// This hook blocks those routes and tells the agent to use /codex:imagegen instead.
//
// It deliberately does NOT touch coding `codex exec` (rescue / executor) or the
// companion's own imagegen subcommand.

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

// Allow the canonical managed path: the companion's own imagegen subcommand.
if (/codex-companion\.mjs[\s\S]*\bimagegen\b/.test(cmd)) process.exit(0);

// Strip quoted spans so a mere mention inside a prompt never trips the codex-exec
// marker check (mirrors guard-codex.sh). Path-based blockers match the raw command.
const stripped = cmd.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");

const blockers = [
  { re: /gpt-image-2[/\\][^\s]*\b(generate|edit)\.js/i, why: "garden gpt-image-2 generate.js / edit.js (Mode A direct API)" },
  { re: /image2_asset\.py/i, why: "image2_asset.py (image2 / OpenRouter direct)" },
  { re: /baoyu-image-gen[/\\][^\s]*main\.ts/i, why: "baoyu-image-gen main.ts" },
  { re: /\/v1\/images\/(generations|edits)/i, why: "direct POST to /v1/images (OpenAI-compatible image API)" },
];
for (const b of blockers) {
  if (b.re.test(cmd)) blockAndExit(b.why);
}

// Bare `codex exec ... imagegen` — require a real codex exec, not a quoted mention.
if (/codex\s+exec/.test(stripped) &&
    /imagegen|gpt-image|image generation|generate the image|built-in image|generated_images/i.test(cmd)) {
  blockAndExit("a bare `codex exec` image generation");
}

process.exit(0);

function blockAndExit(why) {
  process.stderr.write(
`BLOCKED — image generation must go through the managed /codex:imagegen path.

Detected: ${why}.
This bypasses codex-companion's single serialized app-server connection, which is what
avoids 403/429 websocket contention and wasted quota.

Do instead:
  - Generate via the managed path:
      /codex:imagegen --out <path> <what the image should be>
    (edit with --image ref.png; queue with --background)
  - Need a good prompt first? Use the garden gpt-image-2 skill in Mode B to render the
    prompt, then pass it to /codex:imagegen.
  - To recover an image a prior run already produced:
      ls -t ~/.codex/generated_images/*/*.png | head
`);
  process.exit(2);
}
