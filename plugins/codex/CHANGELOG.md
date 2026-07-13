# Changelog

## Unreleased

## 1.1.0 - 2026-07-13

- Add interactive `session-review` commands that review the current Claude Code session with Codex before optionally handing findings back to Claude.
- Keep `session-review` runtime, rendering, and checkpoint state in isolated modules/files to reduce conflicts with future upstream updates.
- Harden `session-review` follow-up checkpoints so failed reviews cannot advance offsets and session-end cleanup removes stale review checkpoints.
- Add a dedicated follow-up command and support supplemental review instructions without losing whitespace or executing shell-like input.
- Publish the plugin as the independent `sq-codex` marketplace and add cross-platform build and CI coverage.
- Merge the official v1.0.6 Git command hardening and apply literal, shell-free Git argument handling to session-review context collection.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
