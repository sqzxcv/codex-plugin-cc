# Changelog

## 1.0.5

- fix(critique): `/codex:critique` now runs in the foreground and returns the critique directly. It previously detached the work into a background Codex job and returned an instant stub, so the subagent "finished" with nothing and never produced a real completion. Backgrounding is now purely a subagent-dispatch concern.
- The `codex-critique` agent always runs `critique` in the foreground, strips `--background`/`--wait` (Claude-side dispatch controls), and sets a max Bash timeout so long critiques aren't cut short.
- `handleCritique` parses but ignores `--background`/`--wait` (matching the review commands), removing the detach path and fixing `--wait` leaking into the design text.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
