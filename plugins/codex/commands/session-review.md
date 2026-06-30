---
description: Interactively review the current Claude Code session with Codex
argument-hint: '[--source <claude-jsonl>]'
allowed-tools: Read, Glob, Grep, Edit, MultiEdit, Write, Bash(node:*), Bash(git:*), Bash(npm:*), AskUserQuestion
---

Run an interactive Codex session review.

Raw slash-command arguments:
`$ARGUMENTS`

Track effective arguments for this invocation:
- Start with `$ARGUMENTS`.
- If the user provides a transcript path after a missing-transcript failure, append `--source <path>` to the effective arguments.
- Use the effective arguments for every follow-up review in this command.
- In shell examples below, replace `<effective-arguments>` with that argument string; do not pass the placeholder literally.

Core rules:
- First run Codex in read-only mode through the runtime.
- Parse the JSON stdout.
- Immediately print the `rendered` field to the user before Claude handles any finding.
- Do not hide the Codex review before Claude handles it.
- Do not let Claude edit until after the Codex review has been shown and the user chooses the Claude path.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json <effective-arguments>"
```

If the command fails because the transcript path is missing, ask the user for the Claude JSONL path, update the effective arguments, and rerun with `--source <path>`.

After printing the `rendered` field, use `AskUserQuestion` with these options:
- `交给 Claude 处理`
- `交给用户决定`
- `进入循环复审`

If the user chooses `交给用户决定`, stop after showing the review.

If the user chooses `交给 Claude 处理`:
- Claude must review each Codex finding deeply.
- For every finding, write either `修复` or `有异议`.
- `修复` requires the smallest safe change and relevant verification.
- `有异议` requires concrete transcript, code, or command-output evidence.
- After Claude finishes, run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json --follow-up <effective-arguments>"
```
- Print the follow-up `rendered` field to the user.

If the user chooses `进入循环复审`:
- Ask for the maximum number of review iterations. Default to 3 if the user does not give a number.
- Repeat the Claude handling and `--follow-up` review until Codex returns no findings or the iteration limit is reached.
- Print every follow-up `rendered` field before Claude handles the next iteration.
