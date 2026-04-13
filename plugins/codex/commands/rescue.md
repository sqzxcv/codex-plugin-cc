---
description: Delegate investigation, coding tasks, bug fixes, or follow-up work to Codex
argument-hint: "[--wait] [--resume] [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh>] [task description]"
allowed-tools: Agent, Bash(node:*), AskUserQuestion
---

Run a Codex rescue task. Defaults to background.

Raw user request:
`$ARGUMENTS`

Companion script path: `${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs`

## Execution

If the raw user request contains no task description (only flags or empty), use `AskUserQuestion` to ask what Codex should investigate or fix. Then proceed.

**If `--wait` is in the request**: run in the foreground.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task --write "$ARGUMENTS"
```

Return stdout verbatim. No commentary.

**Otherwise (default)**: launch a background Agent immediately. This must be your FIRST and ONLY action after confirming a task description exists. Do not parse flags, check resume state, or do any other foreground work.

```typescript
Agent({
  name: "codex-rescue",
  description: "Codex rescue task",
  prompt: `Execute a Codex rescue task via the companion script. Return its complete stdout verbatim with no commentary.

Companion: ${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs
Raw user request: $ARGUMENTS

Build and run the command:
  node "<companion>" task [flags] "<task description>"

Flag rules:
- Add --write unless the task is clearly read-only (explain, describe, review, diagnose)
- --resume in the request → add --resume-last to the command
- --fresh in the request → do NOT add --resume-last
- If neither --resume nor --fresh: default to fresh (no --resume-last)
- --model spark → --model gpt-5.3-codex-spark. Other --model values pass through
- --effort passes through as-is
- Strip --wait (not a companion flag)
- Everything that is not a flag is the task description

Run the constructed command and return stdout verbatim. No commentary.`,
  run_in_background: true
})
```

After launching, respond with only: "Codex rescue task running in background."

## Rules

- Do not inspect files, monitor progress, or do follow-up work after launching.
- If the companion reports Codex is missing or unauthenticated, tell user to run `/codex:setup`.
