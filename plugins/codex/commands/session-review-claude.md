---
description: Review the current Claude Code session with Codex, then let Claude handle findings once
argument-hint: '[--source <claude-jsonl>]'
allowed-tools: Read, Glob, Grep, Edit, MultiEdit, Write, Bash(node:*), Bash(git:*), Bash(npm:*), AskUserQuestion
---

Run a Codex session review and then let Claude handle findings once.

Raw slash-command arguments:
`$ARGUMENTS`

Track effective arguments for this invocation:
- Start with `$ARGUMENTS`.
- If the user provides a transcript path after a missing-transcript failure, append `--source <path>` to the effective arguments.
- Use the effective arguments for the follow-up review.
- In shell examples below, replace `<effective-arguments>` with that argument string; do not pass the placeholder literally.

Core rules:
- First run Codex in read-only mode through the runtime.
- Parse the JSON stdout.
- Immediately print the `rendered` field to the user before Claude handles any finding.
- Do not hide the Codex review before Claude handles it.
- If Codex reports no findings, do not let Claude edit. Stop after showing the review.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json <effective-arguments>"
```

If the command fails because the transcript path is missing, ask the user for the Claude JSONL path, update the effective arguments, and rerun with `--source <path>`.

After printing the `rendered` field, use `AskUserQuestion` with these options:
- `交给 Claude 处理`
- `交给用户决定`

If the user chooses `交给用户决定`, stop.

If the user chooses `交给 Claude 处理`:
- Claude must deeply review the Codex review before changing anything.
- For every finding, 逐条给出“修复”或“有异议”.
- `修复` means make the smallest safe code or docs change and run relevant verification.
- `有异议` means explain the disagreement with concrete evidence from transcript, code, or command output.
- Do not skip findings silently.

After Claude finishes handling findings, run exactly one follow-up review:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json --follow-up <effective-arguments>"
```

Print the follow-up `rendered` field to the user and stop.
