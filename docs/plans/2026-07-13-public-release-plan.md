# Public Release Implementation Plan

> **For agentic workers:** Execute inline in this session. Do not commit or push; leave the verified changes for the user to review and commit.

**Goal:** Turn the current fork into a correctly identified, versioned, cross-platform-tested public Claude Code marketplace release.

**Architecture:** Preserve the `codex` plugin namespace while changing only distribution identity at the marketplace/package level. Use a small Node script for cross-platform build preparation and a GitHub Actions OS matrix for platform coverage.

**Tech Stack:** Node.js ESM, Node test runner, JSON manifests, GitHub Actions, Claude Code plugin marketplace.

## Global Constraints

- Marketplace name: `sq-codex`.
- Publisher and author: `sqzxcv`.
- Release version: `1.1.0`.
- GitHub source: `sqzxcv/codex-plugin-cc`.
- Plugin name remains `codex`.
- Do not modify or remove upstream LICENSE or NOTICE files.
- Do not commit or push automatically.

---

### Task 1: Lock release metadata with tests

**Files:**
- Create: `tests/release-metadata.test.mjs`

- [ ] Assert marketplace identity, plugin author, package identity, release version, installation commands, fork disclosure, cross-platform prebuild, and CI OS matrix.
- [ ] Run the new test and confirm it fails against the current OpenAI/1.0.5 metadata.

### Task 2: Apply publishing identity and release documentation

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/codex/.claude-plugin/plugin.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `plugins/codex/CHANGELOG.md`

- [ ] Change marketplace/package publisher identity without changing plugin namespace.
- [ ] Bump all synchronized manifests to `1.1.0`.
- [ ] Replace official installation commands with the fork marketplace commands.
- [ ] Add fork/conflict and Windows-support disclosures.
- [ ] Move the session-review changelog entries into the `1.1.0` release section.

### Task 3: Make build and CI cross-platform

**Files:**
- Create: `scripts/prepare-app-server-types.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/pull-request-ci.yml`

- [ ] Create the generated directory using `fs.mkdirSync(..., { recursive: true })`.
- [ ] Call the Node script from `prebuild` before Codex type generation.
- [ ] Run CI on `ubuntu-latest`, `macos-latest`, and `windows-latest` with fail-fast disabled.
- [ ] Run the release-metadata test and confirm it passes.

### Task 4: Verify release readiness

**Files:**
- Review all changed and untracked files.

- [ ] Run `npm test` and require exit code 0.
- [ ] Run `npm run build` and require exit code 0.
- [ ] Run `claude plugin validate .` and require success.
- [ ] Run `node scripts/bump-version.mjs --check` and require version `1.1.0` consistency.
- [ ] Run `git diff --check` and inspect `git status --short` so no release file is omitted.

### Task 5: Eliminate state-file partial-read races found during verification

**Files:**
- Modify: `plugins/codex/scripts/lib/fs.mjs`
- Modify: `plugins/codex/scripts/lib/state.mjs`
- Modify: `tests/state.test.mjs`

- [ ] Add a failing test for an atomic JSON writer that replaces an existing file without leaving temporary artifacts.
- [ ] Implement same-directory temporary-file writing followed by atomic rename and cleanup on failure.
- [ ] Route `saveState` through the atomic writer so concurrent readers see either the old or new complete JSON document.
- [ ] Re-run the isolated state and cancellation tests, then the complete suite.
