---
description: Auto-detect what to review and run the appropriate Codex review command
argument-hint: '[--wait] [--base <ref>]'
allowed-tools: Agent, Glob, Bash(node:*), Bash(git:*)
---

Smart router that detects what to review and dispatches to the right Codex command.

Raw slash-command arguments:
`$ARGUMENTS`

Companion script path: `${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs`

## Execution

**If `--wait` is in the arguments**: run detection and companion in the foreground.

1. Run `git status --short --untracked-files=all` to check working tree
2. Run `BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main") && git rev-list --count "${BASE}..HEAD"` to check branch
3. Use Glob to check for `HANDOFF.md` or `working-docs/*/plan*.md`

Route to the first match:
- Working tree has changes → `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" challenge --scope working-tree $EXTRA_FLAGS`
- Branch ahead of base → `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" challenge --scope branch $EXTRA_FLAGS`
- Plan files exist → `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" adversarial-review $EXTRA_FLAGS "Review the feasibility and completeness of this plan"`
- Nothing to review → tell user, show available commands

Return stdout verbatim. No commentary.

**Otherwise (default)**: launch a background Agent immediately. This must be your FIRST and ONLY action. Do not run any git commands or preliminary detection yourself.

```typescript
Agent({
  name: "codex-run",
  description: "Codex auto-detect review",
  prompt: `Detect what to review and run the appropriate Codex review command. Return all output verbatim with no commentary.

Companion script: ${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs
User flags: $ARGUMENTS

Steps:
1. Run: git status --short --untracked-files=all
2. Run: BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main") && git rev-list --count "$\{BASE}..HEAD"
3. Run: ls HANDOFF.md working-docs/*/plan*.md 2>/dev/null

Route to the first match:
- Working tree has changes: node "<companion>" challenge --scope working-tree <user_flags>
- Branch ahead: node "<companion>" challenge --scope branch <user_flags>
- Plan files exist: node "<companion>" adversarial-review <user_flags> "Review the feasibility and completeness of this plan"
- Nothing: output "No changes detected."

Strip --wait and --background from user flags before passing to the companion.
Return the companion stdout verbatim. No commentary before or after.`,
  run_in_background: true
})
```

After launching, respond with only: "Codex review running in background."

## Rules

- Review-only. Do not fix issues or suggest changes.
- Extract `--wait` and `--base <ref>` from arguments. Do not pass `--wait` or `--background` to the companion.
