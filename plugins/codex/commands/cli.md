---
description: Run a direct Codex CLI task through the shared Codex runtime
argument-hint: "[--background] [--write] [--resume|--fresh] [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh>] [what Codex should do]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" cli "$ARGUMENTS"`

Present the full command output to the user. Do not summarize or condense it.

This is a direct Codex CLI task entrypoint:
- use `--write` when Codex may edit files
- use `--resume` to continue the latest Codex task or goal thread
- use `--fresh` to start a new thread
- use `--background` for long-running work, then check `/codex:status`
