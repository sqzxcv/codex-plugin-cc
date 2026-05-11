---
description: Manage a persistent Codex goal for this repository
argument-hint: "[--show|--clear] [--fresh|--resume|--thread-id <id>] [--budget <tokens>] [--status <active|paused|budgetLimited|complete>] [goal objective]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" goal "$ARGUMENTS"`

Present the full command output to the user. Do not summarize or condense it.

This command manages the persistent goal Codex can continue over time:
- pass an objective to create or update the goal
- use `--budget <tokens>` to set a token budget
- use `--status <active|paused|budgetLimited|complete>` to update progress state
- use `--show` to inspect the current goal
- use `--clear` to remove the current goal
- continue the goal work with `/codex:cli --resume`
