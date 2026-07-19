---
description: Interactively review the current Claude Code session with Codex
argument-hint: '[--source <claude-jsonl>] [review note...]'
allowed-tools: Read, Glob, Grep, Edit, MultiEdit, Write, Bash(node:*), Bash(git:*), Bash(npm:*), AskUserQuestion
---

Run an interactive Codex session review.

Raw slash-command arguments:
`$ARGUMENTS`

Track effective arguments for this invocation:
- Start with `$ARGUMENTS`.
- If the user provides a transcript path after a missing-transcript failure, append `--source <path>` to the effective arguments.
- Treat any raw trailing text after options as supplemental review input. Keep that trailing text inside `<effective-arguments>` and pass `<effective-arguments>` as one raw runtime argument string; do not rewrite trailing text to `--user-note`, because unquoted `--user-note` can truncate multi-word notes.
- Use the effective arguments for every follow-up review in this command.
- If the user provides supplemental review input during this command, write the exact text to a note file and pass `--user-note-file <note-file>` for the immediate re-review and for later follow-up reviews in this command.
- In shell examples below, replace `<effective-arguments>` with that argument string; do not pass the placeholder literally.

Review scope:
- A normal `/codex:session-review` invocation is an initial review and collects the full available Claude session transcript plus current git state.
- Only `/codex:session-review-follow-up` and the `session-review-follow-up` runtime command focus on transcript entries after the last saved session-review checkpoint.
- When the user chooses `用户补充信息后重新让 Codex review`, rerun an initial review over the full current session context plus the user's supplemental input; do not use the follow-up command for that re-review.

Core rules:
- First run Codex in read-only mode through the runtime.
- Parse the JSON stdout.
- Immediately print the `rendered` field to the user before Claude handles any finding.
- Do not hide the Codex review before Claude handles it.
- Every session-review decision must include the full `rendered` review text in the `AskUserQuestion` prompt, not only in the chat output.
- This is required because on some clients, including Windows, the modal can appear before the chat output is visible.
- Do not ask with only a short prompt such as `How should this review be handled?`, `See review above`, or `Review shown above`.
- The user must be able to read the review result in the same UI where they choose how to handle it.
- Do not let Claude edit until after the Codex review has been shown and the user chooses the Claude path.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" session-review "--json <effective-arguments>"
```

If the command fails because the transcript path is missing, ask the user for the Claude JSONL path, update the effective arguments, and rerun with `--source <path>`.

After printing the `rendered` field, use the session-review decision point: use `AskUserQuestion` with a prompt body that includes the complete `rendered` review text followed by these options:
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
- After printing the new review, return to the session-review decision point and offer the four options again.

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
