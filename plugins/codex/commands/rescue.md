---
description: Delegate investigation, coding tasks, bug fixes, or follow-up work to Codex
argument-hint: "[--wait] [--resume|--fresh] [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh>] [what Codex should investigate, solve, or continue]"
allowed-tools: Agent, Bash(node:*), AskUserQuestion
---

Run a Codex rescue task. Defaults to background.

Raw user request:
$ARGUMENTS

Companion script path: `${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs`

## Step 1: Resume check (foreground, fast)

If `--resume` or `--fresh` is in the request, skip this step.

Otherwise, check for a resumable thread:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task-resume-candidate --json
```

- If `available: true`: use `AskUserQuestion` once with choices `Continue current Codex thread` / `Start a new Codex thread`. Add `--resume` or `--fresh` based on the choice.
- If `available: false`: continue without asking.

If the user did not supply a task description, use `AskUserQuestion` to ask what Codex should investigate or fix.

## Step 2: Build the command

Construct the companion command:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task [flags] "the task description"`

Flag rules:
- Strip `--wait` (execution flag, not forwarded)
- Preserve `--resume` → becomes `--resume-last`
- Preserve `--fresh` (no `--resume-last`)
- Preserve `--model` and `--effort` as-is
- Map `--model spark` to `--model gpt-5.3-codex-spark`
- Add `--write` by default unless user asks for read-only/review-only behavior
- Leave `--effort` and `--model` unset unless user explicitly asks

## Step 3: Execute

**If `--wait` is in the request**: run the constructed command in the foreground via Bash. Return stdout verbatim.

**Otherwise (default)**: launch a background Agent with the constructed command.

```typescript
Agent({
  name: "codex-rescue",
  description: "Codex rescue task",
  prompt: "Execute this bash command and return its complete stdout verbatim. Do not add any text before or after. Do not summarize or comment on the output. Do not run additional commands.\n\nCommand:\n<the constructed command from Step 2>",
  run_in_background: true
})
```

After launching, respond with only: "Codex rescue task running in background."

## Rules

- Return Codex companion stdout verbatim. No commentary.
- Do not inspect files, monitor progress, or do follow-up work after launching.
- If the helper reports Codex is missing or unauthenticated, tell user to run `/codex:setup`.
