# Changelog

## 1.0.5

- Add managed image generation: `/codex:imagegen` plus an `imagegen` companion
  subcommand, run over the same single serialized app-server connection the
  plugin already uses for code tasks. Flags: `--out`, `--image <ref[,ref...]>`
  (edit from reference images), `--background`, `--force`, `--model`. The path
  captures the `imageGeneration` item the moment it arrives, writes the bytes to
  `--out`, then interrupts the turn so the model's post-image shell tail never
  runs. Reusing the one serialized connection also avoids the 403/429 contention
  that bare parallel Codex CLI calls caused. Fixes #356.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
