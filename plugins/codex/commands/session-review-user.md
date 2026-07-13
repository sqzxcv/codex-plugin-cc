---
description: Review the current Claude Code session with Codex and ask how to handle the result
argument-hint: '[--source <claude-jsonl>] [review note...]'
allowed-tools: Read, Glob, Grep, Edit, MultiEdit, Write, Bash(node:*), Bash(git:*), Bash(npm:*), AskUserQuestion
---

Run a user-owned Codex session review.

Raw slash-command arguments:
`$ARGUMENTS`

Track effective arguments for this invocation:
- Start with `$ARGUMENTS`.
- If the user provides a transcript path after a missing-transcript failure, append `--source <path>` to the effective arguments.
- Treat any raw trailing text after options as supplemental review input. Keep that trailing text inside `<effective-arguments>` and pass `<effective-arguments>` as one raw runtime argument string; do not rewrite trailing text to `--user-note`, because unquoted `--user-note` can truncate multi-word notes.
- In shell examples below, replace `<effective-arguments>` with that argument string; do not pass the placeholder literally.

Core rules:
- Codex stays review-only and read-only.
- Run Codex in read-only mode through the runtime.
- Parse the JSON stdout.
- Immediately print the `rendered` field to the user before Claude handles anything.
- Do not hide the Codex review before Claude handles it.
- Do not let Claude edit until after the Codex review has been shown and the user chooses the Claude path.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json <effective-arguments>"
```

If the command fails because the transcript path is missing, ask the user for the Claude JSONL path, update the effective arguments, and rerun with `--source <path>`.

After printing the `rendered` field, use the session-review decision point: use `AskUserQuestion` with these options:
- `交给 Claude 处理`
- `交给用户决定`
- `进入循环复审`
- `用户补充信息后重新让 Codex review`

If the user selects `Other` or provides free-form text at this decision point:
- Treat that text as supplemental review input.
- Preserve the text exactly as review context; do not summarize it.
- Write the exact text to a temporary note file.
- Do not pass supplemental review text directly on the command line; use `--user-note-file` so spaces, newlines, quotes, and shell-like text are transferred completely.
- Rerun Codex in read-only mode over the full current session with that supplemental input:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json <effective-arguments> --user-note-file <note-file>"
```
- Replace `<note-file>` with the actual note file path; do not pass the placeholder literally.
- Print the new `rendered` field, then return to the session-review decision point.

If the user chooses `交给用户决定`, stop after showing the review.

If the user chooses `用户补充信息后重新让 Codex review`:
- Use `AskUserQuestion` to ask for the user's supplemental review input.
- Preserve the user's text exactly as review context; do not summarize it.
- Write the exact text to a temporary note file.
- Do not pass supplemental review text directly on the command line; use `--user-note-file` so spaces, newlines, quotes, and shell-like text are transferred completely.
- Rerun Codex in read-only mode over the full current session with that supplemental input:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json <effective-arguments> --user-note-file <note-file>"
```
- Replace `<note-file>` with the actual note file path; do not pass the placeholder literally.
- Parse the JSON stdout and immediately print the new `rendered` field.
- After printing the new review, return to the session-review decision point.

If the user chooses `交给 Claude 处理`:
- Claude must review each Codex finding deeply.
- For every finding, write either `修复` or `有异议`.
- `修复` requires the smallest safe change and relevant verification.
- `有异议` requires concrete transcript, code, or command-output evidence.
- After Claude finishes, run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review-follow-up "--json <effective-arguments>"
```
- Print the follow-up `rendered` field to the user, then return to the session-review decision point.

If the user chooses `进入循环复审`:
- Ask for the maximum number of review iterations. Default to 3 if the user does not give a number.
- Run at most that many Claude handling and `session-review-follow-up` cycles.
- Print every follow-up `rendered` field before returning to the session-review decision point.
- If Codex returns no findings or the iteration limit is reached, do not start another automatic cycle; still return to the session-review decision point after showing the review.
