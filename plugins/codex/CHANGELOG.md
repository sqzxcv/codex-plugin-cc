# Changelog

## 1.0.4

- Route `/codex:rescue` through the Agent tool to stop Skill recursion (#234, #235)
- Quote `$ARGUMENTS` in `cancel`, `result`, and `status` commands (#168)
- Declare model in `codex-rescue` agent frontmatter (#169)
- Honor `--cwd` when reporting session runtime (#35)

## 1.0.3

- Avoid embedding large adversarial review diffs (#179)
- Scope default cancel selection to the current Claude session (#84)
- Scope implicit resume-last selection to the current Claude session (#83)
- Gracefully handle unsupported thread/name/set on older Codex CLI (#126)
- Inherit `process.env` in app-server spawn when no explicit env is provided (#159)
- Use app-server auth status for Codex readiness (#177)
- Respect `SHELL` on Windows for Git Bash (#178)
- Fix working-tree review crash on untracked directories / broken symlinks (#166)

## 1.0.2

- Fix `/codex:rescue` AskUserQuestion contract (#43)
- Resolve Windows ENOENT when spawning Codex app-server (#55)

## 1.0.1

- Add `shell: true` on Windows so `spawnSync` can resolve `.cmd` shims (#13)

## 1.0.0

- Initial version of the Codex plugin for Claude Code
