---
description: Run a standard Codex code review against local git state
argument-hint: '[--wait] [--base <ref>] [--scope auto|working-tree|branch]'
allowed-tools: Agent, Bash(node:*)
---

Run a Codex review through the shared built-in reviewer.

Raw slash-command arguments:
`$ARGUMENTS`

Companion script path: `${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs`

## Execution

**If `--wait` is in the arguments**: run in the foreground.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review "$ARGUMENTS"
```

Return stdout verbatim. No commentary.

**Otherwise (default)**: launch a background Agent immediately. This must be your FIRST and ONLY action. Do not run any git commands, read files, or do any preliminary work.

```typescript
Agent({
  name: "codex-review",
  description: "Codex code review",
  prompt: "Execute this bash command and return its complete stdout verbatim. Do not add any text before or after. Do not summarize or comment on the output. Do not run additional commands.\n\nCommand:\nnode \"${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs\" review \"$ARGUMENTS\"",
  run_in_background: true
})
```

After launching, respond with only: "Codex review running in background."

## Rules

- Review-only. Do not fix issues or suggest changes.
- Preserve the user's arguments exactly.
- The companion script handles all scope detection, file reading, and diff analysis.
