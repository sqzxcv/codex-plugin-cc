# Public Release Design

## Goal

Prepare this repository as an independently distributed Claude Code marketplace containing the OpenAI Codex plugin plus the session-review additions.

## Publishing identity

- Keep the plugin name `codex` so existing `/codex:*` commands and internal agent names remain compatible.
- Rename the marketplace to `sq-codex` and publisher/author metadata to `sqzxcv`.
- Keep the upstream Apache-2.0 license and NOTICE files intact.
- Describe the project as an unofficial fork and state that it replaces, rather than coexists with, the official `codex` plugin because both expose the same command namespace.
- Publish version `1.1.0` from the GitHub repository `sqzxcv/codex-plugin-cc`.

## Cross-platform release support

- Replace the POSIX-only `mkdir -p` prebuild step with a Node.js directory-preparation script.
- Run CI on Ubuntu, macOS, and Windows.
- Document Windows support as experimental until the plugin has been exercised in a real Windows Claude Code session; recommend Git for Windows or WSL2.

## Verification

- Add release-metadata tests before changing manifests and scripts.
- Persist shared job state through same-directory atomic replacement so background workers cannot expose partially written JSON to status and cancellation readers.
- Run the complete Node test suite.
- Run the TypeScript/app-server build.
- Validate the Claude Code marketplace manifest.
- Verify synchronized version metadata and whitespace correctness.
