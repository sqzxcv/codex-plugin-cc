---
description: Run a context-aware Codex challenge review (second opinion on code changes, auto-detects infra vs app code)
argument-hint: '[--wait] [--base <ref>] [--scope auto|working-tree|branch] [--specialist]'
allowed-tools: Agent, Bash(node:*)
---

Run a Codex challenge review through the shared plugin runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Companion script path: `${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs`

## Execution

**If `--wait` or `--specialist` is in the arguments**: run in the foreground.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" challenge "$ARGUMENTS"
```

Return stdout verbatim. No commentary.

**Otherwise (default)**: launch a background Agent immediately. This must be your FIRST and ONLY action. Do not run any git commands, read files, or do any preliminary work.

```typescript
Agent({
  name: "codex-challenge",
  description: "Codex challenge review",
  prompt: "Execute this bash command and return its complete stdout verbatim. Do not add any text before or after. Do not summarize or comment on the output. Do not run additional commands.\n\nCommand:\nnode \"${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs\" challenge \"$ARGUMENTS\"",
  run_in_background: true
})
```

After launching, respond with only: "Codex challenge review running in background."

## Rules

- Review-only. Do not fix issues or suggest changes.
- Preserve the user's arguments exactly.
- The companion script handles all scope detection, file reading, and diff analysis.
