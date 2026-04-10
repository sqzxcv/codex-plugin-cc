---
description: Run a Codex skill through the shared runtime
argument-hint: '[--skill <name>] [--list] [--background|--wait] [--write] [prompt]'
allowed-tools: Read, Glob, Grep, Bash(node:*), AskUserQuestion
---

Run a Codex skill through the shared runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is a thin forwarder to the Codex companion script.
- Do not fix issues, apply patches, or add independent analysis.
- Your only job is to run the skill and return Codex's output verbatim to the user.

Execution mode rules:
- If the raw arguments include `--list`, run the command immediately and return the output.
- If the raw arguments include `--wait`, do not ask. Run the skill in the foreground.
- If the raw arguments include `--background`, do not ask. Run the skill in a Claude background task.
- If the raw arguments do not include `--skill <name>` and do not include `--list`, use `AskUserQuestion` exactly once to ask:
  - Question: "Which Codex skill would you like to run, and what should it do?"
  - Provide a free-text answer option.
  - After receiving the answer, construct the full command with `--skill <name>` and the user's prompt. Do NOT use `$ARGUMENTS` for this execution path.
- Otherwise (raw arguments include `--skill`), use `AskUserQuestion` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Run in background (Recommended)`
  - `Wait for results`

Argument handling:
- When `--skill` is provided in `$ARGUMENTS`, preserve the user's arguments exactly.
- When `--skill` was obtained via AskUserQuestion, build the command from the user's answer instead of `$ARGUMENTS`.
- Do not strip `--wait`, `--background`, or `--write` yourself.
- `--write` allows the skill to modify files (default is read-only sandbox).
- The companion script parses these flags, but Claude Code's `Bash(..., run_in_background: true)` is what actually detaches the run.

List mode:
- When `--list` is present, run the command and return the output verbatim.
- Do not paraphrase or add commentary.

Foreground flow:
- If `--skill` was in the raw arguments, run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" run-skill "$ARGUMENTS"
```
- If `--skill` was obtained via AskUserQuestion, build and run the command from the user's answer instead of `$ARGUMENTS`:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" run-skill --skill "<name>" <prompt>
```
- Return the command stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.

Background flow:
- If `--skill` was in the raw arguments, launch with:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" run-skill "$ARGUMENTS"`,
  description: "Codex skill run",
  run_in_background: true
})
```
- If `--skill` was obtained via AskUserQuestion, build the command from the user's answer instead of `$ARGUMENTS`:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" run-skill --skill "<name>" <prompt>`,
  description: "Codex skill run",
  run_in_background: true
})
```
- Do not call `BashOutput` or wait for completion in this turn.
- After launching the command, tell the user: "Codex skill run started in the background. Check `/codex:status` for progress."
