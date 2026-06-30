---
description: Review the current Claude Code session with Codex and loop until findings are resolved or the limit is reached
argument-hint: '[--source <claude-jsonl>]'
allowed-tools: Read, Glob, Grep, Edit, MultiEdit, Write, Bash(node:*), Bash(git:*), Bash(npm:*), AskUserQuestion
---

Run a looping Codex session review.

Raw slash-command arguments:
`$ARGUMENTS`

Track effective arguments for this invocation:
- Start with `$ARGUMENTS`.
- If the user provides a transcript path after a missing-transcript failure, append `--source <path>` to the effective arguments.
- Use the effective arguments for every follow-up review in the loop.
- In shell examples below, replace `<effective-arguments>` with that argument string; do not pass the placeholder literally.

Core rules:
- First run Codex in read-only mode through the runtime.
- Parse the JSON stdout.
- Immediately print the `rendered` field to the user before Claude handles any finding.
- Do not hide the Codex review before Claude handles it.
- Print every follow-up `rendered` field before Claude handles the next iteration.
- The default maximum is 3 review iterations.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json <effective-arguments>"
```

If the command fails because the transcript path is missing, ask the user for the Claude JSONL path, update the effective arguments, and rerun with `--source <path>`.

After printing the initial `rendered` field, use `AskUserQuestion` with these options:
- `进入循环复审`
- `交给用户决定`

If the user chooses `交给用户决定`, stop.

If the user chooses `进入循环复审`:
- Ask for a maximum iteration count. Use 3 when the user does not provide a number.
- In each iteration, Claude must deeply review every Codex finding and 逐条给出“修复”或“有异议”.
- `修复` means make the smallest safe change and run relevant verification.
- `有异议` means explain the disagreement with concrete evidence from transcript, code, or command output.
- Then run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json --follow-up <effective-arguments>"
```
- Print the follow-up `rendered` field.
- Stop when Codex returns no findings or the iteration limit is reached.
