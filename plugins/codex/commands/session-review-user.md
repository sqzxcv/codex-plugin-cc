---
description: Review the current Claude Code session with Codex and return the result to the user
argument-hint: '[--source <claude-jsonl>]'
allowed-tools: Bash(node:*), AskUserQuestion
---

Run a user-owned Codex session review.

Raw slash-command arguments:
`$ARGUMENTS`

Track effective arguments for this invocation:
- Start with `$ARGUMENTS`.
- If the user provides a transcript path after a missing-transcript failure, append `--source <path>` to the effective arguments.
- In shell examples below, replace `<effective-arguments>` with that argument string; do not pass the placeholder literally.

Core rules:
- This command is review-only.
- Run Codex in read-only mode through the runtime.
- Parse the JSON stdout.
- Immediately print the `rendered` field to the user before Claude handles anything.
- Do not hide the Codex review before Claude handles it.
- By default, do not let Claude edit or fix any finding.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json <effective-arguments>"
```

If the command fails because the transcript path is missing, ask the user for the Claude JSONL path, update the effective arguments, and rerun with `--source <path>`.

After printing the `rendered` field, stop. Do not summarize, paraphrase, fix, or offer Claude-side handling from this command.
