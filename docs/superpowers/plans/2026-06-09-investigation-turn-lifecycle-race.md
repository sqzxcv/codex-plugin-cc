# Investigation Turn-Lifecycle Race Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the multi-turn review investigation from discarding a valid verdict and hanging to the 180s watchdog, by fixing three lifecycle races in `captureTurn`.

**Architecture:** All production changes live in `plugins/codex/scripts/lib/codex.mjs` inside `captureTurn` and its helpers. Defect A demotes inferred turn-completion to a subagent-gated, re-arming quiet-window fallback (primary signal stays the real `turn/completed`). Defect B reorders the idle-watchdog re-arm so only belonging traffic re-arms it. Defect C records a `pendingTurnId` from a buffered `turn/started` so the watchdog can still `turn/interrupt` when the `turn/start` RPC reply is delayed. Tests extend the existing subprocess fixture (`tests/fake-codex-fixture.mjs`) — including teaching its `queue-driven` mode to serialize turns per thread — and assert end-to-end through `runAppServerInvestigation`.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, a fake-codex JSON-RPC app-server subprocess fixture.

---

## Background the engineer needs

- **Spec:** `docs/superpowers/specs/2026-06-09-investigation-turn-lifecycle-race-design.md`. Read it first.
- **The file under change:** `plugins/codex/scripts/lib/codex.mjs` (~1424 lines). Key regions:
  - `createTurnCaptureState` (~323): builds the per-turn capture state object. The JSDoc `@typedef TurnCaptureState` at the top of the file (~10-36) must stay in sync with the fields.
  - `scheduleInferredCompletion` (~393): the inference timer. Today it fires 250ms after the first `final_answer` message — **this is Defect A**.
  - `completeTurn` (~366) / `clearCompletionTimer` (~359): resolve the turn / clear the inference timer.
  - `recordItem` (~426) and `applyTurnNotification` (~510): translate notifications into state. `recordItem` handles `collabAgentToolCall` (~427) and `agentMessage` (~441). `applyTurnNotification` handles `turn/started` (~525) and `turn/completed` (~561).
  - `captureTurn` (~579): the idle watchdog (`armIdle` ~597, the timeout callback ~604, `clearIdle` ~622) and the notification handler (~630).
- **Two timers, never share a handle:**
  - **Idle watchdog** (`idleTimer`, default `DEFAULT_TURN_IDLE_TIMEOUT_MS = 180_000` at ~60): rejects the turn on a dead link. Review callers inject it via `turnIdleTimeoutMs`; task runs pass nothing (no watchdog).
  - **Quiet/inference timer** (today `completionTimer`, 250ms): resolves the turn as an inferred success. Only relevant when subagent/collab work happened.
- **Test fixture:** `tests/fake-codex-fixture.mjs`.
  - `installFakeCodex(binDir, behavior)` writes a fake `codex` executable whose source is a template string. Behaviors include `with-subagent`, `with-late-subagent-message`, `with-subagent-no-main-turn-completed`, `queue-driven`, `slow-task`, `interruptible-slow-task`, `gate-recovered`.
  - `setupFakeCodex({ cwd })` (~683) installs `queue-driven` mode and returns a handle: `queueTurnResponse(entry)`, `queueTurnRpcError({message})`, `queueTurnHang()`, `requests` getter, `cwd`, `env`, `close()`.
  - The `queue-driven` `turn/start` handler is at ~395-444. It records each request, shifts one `entry` off `state.queue`, and emits `turn/started` + items + `turn/completed` **synchronously**.
  - `turn/interrupt` handler (~629) records `state.lastInterrupt = { threadId, turnId }`.
- **Two test files:** `tests/investigation.test.mjs` (in-process, calls `runAppServerInvestigation` directly — the home for Defect A & B tests) and `tests/runtime.test.mjs` (spawns the real subprocess — home for the Defect C subprocess assertion and the env-var override regression).
- **Known baseline:** the suite has **7 pre-existing unrelated failures**. "No net-new failures" is measured against that baseline (captured in Task 0).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `plugins/codex/scripts/lib/codex.mjs` | turn capture + watchdog | All three production fixes |
| `tests/fake-codex-fixture.mjs` | fake app-server | Add per-thread serialization + delayed-completion to `queue-driven`; expose a `serialize` toggle and `delayCompletedMs` on queue entries |
| `tests/investigation.test.mjs` | in-process lifecycle tests | Defect A repro + plain-recon-no-infer + Defect B |
| `tests/runtime.test.mjs` | subprocess tests | Defect C interrupt assertion + env-var quiet-window override regression |
| `docs/superpowers/specs/2026-06-09-investigation-turn-lifecycle-race-design.md` | spec | (already committed) |

---

## Task 0: Capture the test baseline

**Files:** none (records a baseline only).

- [ ] **Step 1: Run the full suite and record the failing-test names**

Run: `node --test tests/*.test.mjs 2>&1 | tail -40`
Expected: the run completes (does not hang) and reports a number of failing tests. Record the exact `not ok` test names and the failing total (expected ~7). This is the baseline; every later task must not increase it.

- [ ] **Step 2: Save the baseline to a scratch note**

Write the list of currently-failing test names into the PR description / scratchpad so later comparisons are exact. No commit.

---

## Task 1: Defect C — record `pendingTurnId` and interrupt with it

This is first because it is the smallest, self-contained change and unblocks the watchdog edits the other tasks build on.

**Files:**
- Modify: `plugins/codex/scripts/lib/codex.mjs` — `@typedef` (~10-36), `createTurnCaptureState` (~331-356), `captureTurn` watchdog callback (~604-621) and notification handler (~630-650)
- Modify: `tests/runtime.test.mjs` (new test near the other subagent/idle tests)

- [ ] **Step 1: Write the failing test (subprocess, asserts `turn/interrupt` is sent with the buffered turn id)**

Add to `tests/runtime.test.mjs`. This uses a new fixture behavior `idle-after-started` (added in Step 3) that emits `turn/started` but then never completes the turn and never returns the `turn/start` RPC result — so the watchdog must fire while `state.turnId` is still null and fall back to `pendingTurnId`.

```js
test("idle watchdog interrupts using the buffered turn id when the turn/start RPC reply is delayed", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "idle-after-started");
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "hello again\n");

  // Review path arms the idle watchdog; force a short window so the test is fast.
  const result = run("node", [SCRIPT, "review", "--turn-idle-timeout", "1"], {
    cwd: repo,
    env: buildEnv(binDir)
  });

  // The review fails (idle timeout), but the fake server must have received a
  // turn/interrupt carrying the turn id it announced via turn/started — proving
  // the watchdog did not skip the interrupt just because state.turnId was null.
  const statePath = path.join(binDir, "fake-codex-state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.ok(state.lastInterrupt, "watchdog must send turn/interrupt even before the turn/start RPC reply");
  assert.equal(state.lastInterrupt.turnId, "turn_1", "interrupt must carry the buffered turn id");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/runtime.test.mjs 2>&1 | grep -A3 "buffered turn id"`
Expected: FAIL — either the behavior `idle-after-started` is unknown (no interrupt recorded) or `state.lastInterrupt` is null because the current code skips `turn/interrupt` when `state.turnId` is null.

- [ ] **Step 3: Add the `idle-after-started` behavior to the fixture**

In `tests/fake-codex-fixture.mjs`, inside the `turn/start` case, add a branch BEFORE the `queue-driven` branch (so it is checked first). Place it right after `const thread = ensureThread(...)`/`nextTurnId` is available — mirror how other behavior branches obtain `thread` and `turnId`. Concretely, add this just above the `if (BEHAVIOR === "queue-driven") {` line (~395), using the same `thread`/`turnId` acquisition the synchronous path uses:

```js
        if (BEHAVIOR === "idle-after-started") {
          const turnId = nextTurnId(state);
          // Announce the turn (so the client buffers a turn/started carrying the
          // id) but never send the turn/start RPC result and never complete the
          // turn. Models a delayed RPC reply on a half-dead link.
          send({ method: "turn/started", params: { threadId: thread.id, turn: buildTurn(turnId) } });
          break;
        }
```

Note: `thread` is resolved earlier in the `turn/start` case (`const thread = ensureThread(state, message.params.threadId)` / the queue-driven path uses `ensureThread`). Verify `thread` is in scope at the insertion point; if the synchronous path resolves `thread` lower, move this branch just below that resolution. The branch must `break` without sending `{ id: message.id, result: ... }`.

- [ ] **Step 4: Add `pendingTurnId` to the typedef and state**

In the `@typedef TurnCaptureState` (top of `codex.mjs`, after the `turnId` line ~16), add:

```js
 *   turnId: string | null,
 *   pendingTurnId: string | null,
```

In `createTurnCaptureState` (~336-337), after `turnId: null,` add:

```js
    turnId: null,
    pendingTurnId: null,
```

- [ ] **Step 5: Capture `pendingTurnId` from a buffered `turn/started` and use it in the watchdog**

In `captureTurn`, replace the ENTIRE notification handler body (currently ~630-650). Old:

```js
  client.setNotificationHandler((message) => {
    armIdle();
    if (!state.turnId) {
      state.bufferedNotifications.push(message);
      return;
    }

    if (message.method === "thread/started" || message.method === "thread/name/updated") {
      applyTurnNotification(state, message);
      return;
    }

    if (!belongsToTurn(state, message)) {
        if (previousHandler) {
          previousHandler(message);
        }
        return;
    }

    applyTurnNotification(state, message);
  });
```

New (this task only adds `pendingTurnId` capture in the buffering window; the
post-buffer re-arm-on-everything behavior is preserved exactly as before so this
task introduces no watchdog regression — Task 2 refines the re-arm):

```js
  client.setNotificationHandler((message) => {
    if (!state.turnId) {
      // Buffering window: the turn/start RPC reply has not set state.turnId yet.
      // Capture the turn id from a turn/started for our thread so the idle
      // watchdog can still interrupt (Defect C). Re-arm here — these early
      // notifications are almost always our own.
      armIdle();
      if (message.method === "turn/started" && extractThreadId(message) === state.threadId) {
        state.pendingTurnId = message.params?.turn?.id ?? state.pendingTurnId;
      }
      state.bufferedNotifications.push(message);
      return;
    }

    // Preserve existing behavior for this task: re-arm on all post-buffer
    // traffic. (Task 2 replaces this with a belonging-gated re-arm.)
    armIdle();

    if (message.method === "thread/started" || message.method === "thread/name/updated") {
      applyTurnNotification(state, message);
      return;
    }

    if (!belongsToTurn(state, message)) {
        if (previousHandler) {
          previousHandler(message);
        }
        return;
    }

    applyTurnNotification(state, message);
  });
```

Then update the watchdog callback (currently ~611-617) from:

```js
      if (state.turnId) {
        try {
          client.request("turn/interrupt", { threadId, turnId: state.turnId }).catch(() => {});
        } catch {
          // ignore — interrupt is best-effort
        }
      }
```

to:

```js
      const interruptTurnId = state.turnId ?? state.pendingTurnId;
      if (interruptTurnId) {
        try {
          client.request("turn/interrupt", { threadId, turnId: interruptTurnId }).catch(() => {});
        } catch {
          // ignore — interrupt is best-effort
        }
      }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/runtime.test.mjs 2>&1 | grep -A3 "buffered turn id"`
Expected: PASS.

- [ ] **Step 7: Run the full suite to confirm no net-new failures**

Run: `node --test tests/*.test.mjs 2>&1 | tail -20`
Expected: failing total equals the Task 0 baseline (≈7), no new names.

- [ ] **Step 8: Commit**

```bash
git add plugins/codex/scripts/lib/codex.mjs tests/fake-codex-fixture.mjs tests/runtime.test.mjs
git commit --no-verify -m "fix(codex): interrupt with buffered turn id when turn/start RPC reply is delayed (Defect C)"
```

---

## Task 2: Defect B — re-arm the idle watchdog only for belonging traffic

**Files:**
- Modify: `plugins/codex/scripts/lib/codex.mjs` — `captureTurn` notification handler (~636-650)
- Modify: `tests/investigation.test.mjs` (new test)

- [ ] **Step 1: Write the failing test (foreign-thread chatter must NOT keep a stuck turn alive)**

Add to `tests/investigation.test.mjs`. This needs a fixture entry that, on a recon turn, emits `turn/started`, then a stream of notifications attributed to a DIFFERENT thread id, and then goes silent (never completes our turn). With the bug, the foreign notifications re-arm our watchdog forever; with the fix, the watchdog fires after the idle window. Add a queue-entry flag `foreignChatterThenHang` (implemented in Step 3).

The assertion must distinguish bug from fix. Foreign chatter is emitted every
50ms for ~2.5s (well past the 300ms idle window). After the fix, foreign traffic
does NOT re-arm, so the watchdog fires ~300ms after `turn/started`. With the bug,
each foreign message re-arms the watchdog, so it cannot fire until chatter stops
(~2.5s) + 300ms ≈ 2.8s. A tight `elapsed < 1500` assertion therefore PASSES only
on the fixed code and FAILS (by ~2.8s) on the buggy code.

```js
test("foreign-thread chatter does not re-arm the current turn's idle watchdog (Defect B)", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: emits turn/started, then a long stream of foreign-thread
    // notifications spaced UNDER the idle window, then never completes OUR turn.
    // Spans ~2.5s so the buggy (re-arm-on-foreign) path cannot time out before
    // chatter stops; the fixed path times out promptly at the idle window.
    fake.queueTurnResponse({ foreignChatterThenHang: { count: 50, everyMs: 50 } });

    const start = Date.now();
    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize.",
      turnIdleTimeoutMs: 300
    });
    const elapsed = Date.now() - start;

    assert.ok(result.error, "stuck turn must time out despite foreign chatter");
    assert.match(result.error.message, /idle|timeout|timed out/i);
    assert.ok(elapsed < 1500, `watchdog must fire at the idle window, not be held open by foreign chatter (took ${elapsed}ms)`);
  } finally {
    fake.close();
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/investigation.test.mjs 2>&1 | grep -A3 "Defect B"`
Expected: FAIL — `foreignChatterThenHang` unknown (turn completes/empties immediately, no error) OR with the un-fixed handler the test hangs near the test timeout because foreign chatter keeps re-arming. (If it hangs, that itself demonstrates the bug; the fix makes it terminate with an error well under 15s.)

- [ ] **Step 3: Add the `foreignChatterThenHang` queue entry to the fixture**

In `tests/fake-codex-fixture.mjs`, inside the `queue-driven` branch, after `send({ method: "turn/started", ... })` (~419) and before the `commands` loop, add:

```js
          if (entry && entry.foreignChatterThenHang) {
            const { count = 5, everyMs = 50 } = entry.foreignChatterThenHang;
            const foreignThreadId = thread.id + "-foreign";
            const foreignTurnId = turnId + "-foreign";
            // Foreign-thread traffic: must NOT re-arm our turn's watchdog.
            for (let n = 0; n < count; n += 1) {
              setTimeout(() => {
                send({
                  method: "item/completed",
                  params: {
                    threadId: foreignThreadId,
                    turnId: foreignTurnId,
                    item: { type: "agentMessage", id: "foreign_" + n, text: "noise", phase: "analysis" }
                  }
                });
              }, everyMs * (n + 1));
            }
            // Never emit turn/completed for OUR turn -> the watchdog must fire.
            break;
          }
```

Note: the `break` exits the `turn/start` case for this request; the `turn/start` RPC result was already sent at ~418 so `state.turnId` is set on the client and the foreign notifications flow through the post-buffer handler path (exercising the belongsToTurn branch).

- [ ] **Step 4: Reorder the notification handler so only belonging traffic re-arms**

In `captureTurn`, the handler currently (after Task 1) re-arms unconditionally on all post-buffer traffic. Replace the post-buffer portion. Old (the block produced by Task 1 Step 5, from the unconditional `armIdle();` down to the closing `});`):

```js
    // Preserve existing behavior for this task: re-arm on all post-buffer
    // traffic. (Task 2 replaces this with a belonging-gated re-arm.)
    armIdle();

    if (message.method === "thread/started" || message.method === "thread/name/updated") {
      applyTurnNotification(state, message);
      return;
    }

    if (!belongsToTurn(state, message)) {
        if (previousHandler) {
          previousHandler(message);
        }
        return;
    }

    applyTurnNotification(state, message);
  });
```

New:

```js
    if (message.method === "thread/started" || message.method === "thread/name/updated") {
      // Turn-agnostic bookkeeping (thread registration / naming). Safe to re-arm.
      armIdle();
      applyTurnNotification(state, message);
      return;
    }

    if (!belongsToTurn(state, message)) {
        // Foreign turn/thread traffic must NOT re-arm our watchdog (Defect B):
        // otherwise cross-turn chatter masks a stuck turn and it never fails fast.
        if (previousHandler) {
          previousHandler(message);
        }
        return;
    }

    // Belongs to our turn: re-arm the idle watchdog, then apply.
    armIdle();
    applyTurnNotification(state, message);
  });
```

(The buffering-window `armIdle()` from Task 1 Step 5 stays as-is; only the
post-buffer unconditional re-arm is replaced by belonging-gated re-arms.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/investigation.test.mjs 2>&1 | grep -A3 "Defect B"`
Expected: PASS — the run ends with an idle-timeout error in well under 15s.

- [ ] **Step 6: Regression — a healthy turn that keeps emitting belonging progress is still not killed**

This is already covered by the existing test `a turn that keeps emitting progress is NOT killed by the idle timeout` (investigation.test.mjs:309). Run it explicitly:

Run: `node --test tests/investigation.test.mjs 2>&1 | grep -A3 "NOT killed by the idle timeout"`
Expected: PASS (belonging progress still re-arms).

- [ ] **Step 7: Run the full suite**

Run: `node --test tests/*.test.mjs 2>&1 | tail -20`
Expected: baseline failing total, no new names.

- [ ] **Step 8: Commit**

```bash
git add plugins/codex/scripts/lib/codex.mjs tests/fake-codex-fixture.mjs tests/investigation.test.mjs
git commit --no-verify -m "fix(codex): re-arm idle watchdog only for belonging turn traffic (Defect B)"
```

---

## Task 3: Defect A part 1 — gate inference on subagent work + a re-arming quiet window

This task changes the inference trigger. It does NOT yet reproduce the end-to-end finalize-queue hang (that needs the fixture serialization in Task 4); here we lock the unit-level contract: plain recon turns never infer, and the quiet window is injectable + env-overridable.

**Files:**
- Modify: `plugins/codex/scripts/lib/codex.mjs` — module constant (~60 area), `@typedef`, `createTurnCaptureState`, `scheduleInferredCompletion` (~393-414), `recordItem` (~427-453), `applyTurnNotification` `turn/started` (~525-530), and `captureTurn`/`runAppServerInvestigation` option threading
- Modify: `tests/investigation.test.mjs` (new test)

- [ ] **Step 1: Write the failing test — a plain recon turn must NOT infer completion from a readiness cue**

Add to `tests/investigation.test.mjs`. With a plain (no-subagent) recon turn that emits a `final_answer` readiness cue but the fixture is told to delay `turn/completed`, the loop must wait for the real `turn/completed` rather than inferring early. We assert the recon turn still converges correctly (verdict preserved) and that inference did not short-circuit it. Uses a new `delayCompletedMs` entry flag (Step 6 of Task 4 adds serialization; the delay flag is added here in Step 3).

```js
test("plain recon turn waits for turn/completed and does not infer on a readiness cue (Defect A)", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: a final-answer "ready" cue, but turn/completed is delayed.
    // No subagent work => inference must be INELIGIBLE; the loop waits for the
    // real turn/completed. Converges (0 commands + agent message) once complete.
    fake.queueTurnResponse({
      commands: [],
      finalAnswer: { text: "I'm ready for finalize." },
      delayCompletedMs: 120
    });
    // Finalize turn 2: structured JSON.
    fake.queueTurnResponse({ finalAnswer: { text: STRUCTURED_REVIEW } });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize.",
      outputSchema: { type: "object", required: ["verdict"] },
      // Tiny quiet window proves that EVEN IF inference were eligible it could
      // not have fired before turn/completed; the point is it must be ineligible
      // for a plain turn regardless.
      inferredCompletionQuietMs: 20
    });

    const starts = fake.requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 2, "1 recon + 1 finalize");
    assert.equal(result.finalMessage, STRUCTURED_REVIEW);
    assert.equal(result.error ?? null, null);
  } finally {
    fake.close();
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/investigation.test.mjs 2>&1 | grep -A3 "does not infer on a readiness cue"`
Expected: FAIL — `inferredCompletionQuietMs` is not yet threaded (ignored), and `delayCompletedMs` is unknown to the fixture. (Before the fix, the readiness cue + 250ms inference may also advance early, but the proximate failure is the unknown options/flag.)

- [ ] **Step 3: Add `delayCompletedMs` support to the queue-driven fixture**

In `tests/fake-codex-fixture.mjs`, inside the `queue-driven` branch, replace the final `turn/completed` send (~442):

```js
          send({ method: "turn/completed", params: { threadId: thread.id, turn: buildTurn(turnId, "completed") } });
          break;
```

with:

```js
          if (entry && entry.delayCompletedMs) {
            const completedTurnId = turnId;
            setTimeout(() => {
              send({ method: "turn/completed", params: { threadId: thread.id, turn: buildTurn(completedTurnId, "completed") } });
            }, entry.delayCompletedMs);
          } else {
            send({ method: "turn/completed", params: { threadId: thread.id, turn: buildTurn(turnId, "completed") } });
          }
          break;
```

- [ ] **Step 4: Add the quiet-window constant, env override, typedef and state fields**

In `codex.mjs`, after the `DEFAULT_TURN_IDLE_TIMEOUT_MS = 180_000;` block (~60), add:

```js
// Demoted-inference quiet window (Defect A). Inferred turn completion is a
// FALLBACK for the subagent/collab case where the main thread never emits a
// real turn/completed. It is eligible only after (a) the turn actually spawned
// subagent/collab work, (b) that work has drained, and (c) the turn has been
// silent for this long with no turn/completed. The window re-arms on every
// belonging item/message, so only genuine silence triggers it. Plain recon
// turns never infer — they wait for the real turn/completed.
const DEFAULT_INFERRED_COMPLETION_QUIET_MS = 15_000;

function resolveInferredCompletionQuietMs(explicitMs) {
  if (Number.isFinite(explicitMs) && explicitMs > 0) {
    return explicitMs;
  }
  const fromEnv = Number(process.env.CODEX_INFERRED_COMPLETION_QUIET_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return DEFAULT_INFERRED_COMPLETION_QUIET_MS;
}
```

In the `@typedef TurnCaptureState`, after `finalAnswerSeen: boolean,` (~23) add:

```js
 *   finalAnswerSeen: boolean,
 *   sawSubagentWork: boolean,
 *   inferredCompletionQuietMs: number,
```

In `createTurnCaptureState`, change the signature-less body: after `finalAnswerSeen: false,` (~344) add the two fields and read the resolver from options. Replace:

```js
    finalAnswerSeen: false,
    pendingCollaborations: new Set(),
    activeSubagentTurns: new Set(),
    completionTimer: null,
```

with:

```js
    finalAnswerSeen: false,
    sawSubagentWork: false,
    inferredCompletionQuietMs: resolveInferredCompletionQuietMs(options.inferredCompletionQuietMs),
    pendingCollaborations: new Set(),
    activeSubagentTurns: new Set(),
    completionTimer: null,
```

- [ ] **Step 5: Latch `sawSubagentWork` when subagent/collab work appears**

In `recordItem`, the `collabAgentToolCall` branch (~427-435) currently is:

```js
  if (item.type === "collabAgentToolCall") {
    if (!threadId || threadId === state.threadId) {
      if (lifecycle === "started" || item.status === "inProgress") {
        state.pendingCollaborations.add(item.id);
      } else if (lifecycle === "completed") {
        state.pendingCollaborations.delete(item.id);
        scheduleInferredCompletion(state);
      }
    }
    for (const receiverThreadId of item.receiverThreadIds ?? []) {
      registerThread(state, receiverThreadId);
    }
  }
```

Change the `started`/`inProgress` branch to also latch the flag:

```js
  if (item.type === "collabAgentToolCall") {
    if (!threadId || threadId === state.threadId) {
      if (lifecycle === "started" || item.status === "inProgress") {
        state.sawSubagentWork = true;
        state.pendingCollaborations.add(item.id);
      } else if (lifecycle === "completed") {
        state.pendingCollaborations.delete(item.id);
        scheduleInferredCompletion(state);
      }
    }
    for (const receiverThreadId of item.receiverThreadIds ?? []) {
      registerThread(state, receiverThreadId);
    }
  }
```

In `applyTurnNotification`, the `turn/started` case (~525-530) registers subagent turns:

```js
    case "turn/started":
      registerThread(state, message.params.threadId);
      state.threadTurnIds.set(message.params.threadId, message.params.turn.id);
      if ((message.params.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.add(message.params.threadId);
      }
```

Add the latch inside the subagent branch:

```js
    case "turn/started":
      registerThread(state, message.params.threadId);
      state.threadTurnIds.set(message.params.threadId, message.params.turn.id);
      if ((message.params.threadId ?? null) !== state.threadId) {
        state.sawSubagentWork = true;
        state.activeSubagentTurns.add(message.params.threadId);
      }
```

- [ ] **Step 6: Rewrite `scheduleInferredCompletion` as the subagent-gated, re-arming quiet-window fallback**

Replace the whole function (~393-414):

```js
function scheduleInferredCompletion(state) {
  if (state.completed || state.finalTurn || !state.finalAnswerSeen) {
    return;
  }

  if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) {
    return;
  }

  clearCompletionTimer(state);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (state.completed || state.finalTurn || !state.finalAnswerSeen) {
      return;
    }
    if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) {
      return;
    }
    completeTurn(state, null, { inferred: true });
  }, 250);
  state.completionTimer.unref?.();
}
```

with:

```js
// Inferred completion is a guarded FALLBACK (Defect A). The primary completion
// signal is always the real main-thread turn/completed. Inference is eligible
// ONLY when the turn actually spawned subagent/collab work that has fully
// drained — plain recon turns never infer; they wait for turn/completed. When
// eligible, arm a quiet timer that re-arms on every subsequent belonging
// item/message (see scheduleInferredCompletion call sites) and fires only after
// inferredCompletionQuietMs of genuine silence with no real turn/completed.
function inferenceEligible(state) {
  return (
    !state.completed &&
    !state.finalTurn &&
    state.sawSubagentWork &&
    state.pendingCollaborations.size === 0 &&
    state.activeSubagentTurns.size === 0
  );
}

function scheduleInferredCompletion(state) {
  if (!inferenceEligible(state)) {
    return;
  }

  clearCompletionTimer(state);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (!inferenceEligible(state)) {
      return;
    }
    completeTurn(state, null, { inferred: true });
  }, state.inferredCompletionQuietMs);
  state.completionTimer.unref?.();
}
```

Key behavior changes: (1) `finalAnswerSeen` is no longer required or sufficient — it is removed from the gate; (2) `sawSubagentWork` is now required; (3) the window is `state.inferredCompletionQuietMs`, not 250ms.

- [ ] **Step 7: Stop triggering inference on a bare `final_answer`; re-arm the quiet timer on belonging activity**

In `recordItem`, the `agentMessage` branch currently triggers inference on a final-answer message (~450-453):

```js
        if (lifecycle === "completed" && item.phase === "final_answer") {
          state.finalAnswerSeen = true;
          scheduleInferredCompletion(state);
        }
```

Change it so `finalAnswerSeen` is still recorded (other code/telemetry may read it) but it no longer drives completion on its own — instead, re-arm the quiet timer only when inference is already eligible (i.e. subagent work happened and drained), so genuine post-drain silence still resolves:

```js
        if (lifecycle === "completed" && item.phase === "final_answer") {
          state.finalAnswerSeen = true;
          // Do NOT infer from a readiness cue on a plain turn. Only re-arm the
          // quiet fallback when subagent work has already happened and drained.
          if (inferenceEligible(state)) {
            scheduleInferredCompletion(state);
          }
        }
```

To keep the quiet window re-arming on ALL belonging activity (not just final-answer messages) so a still-streaming subagent-origin turn isn't cut off mid-output, add a re-arm at the end of `applyTurnNotification` for `item/started` and `item/completed`. Locate the `item/started` (~543) and `item/completed` (~550) cases; after each one's existing body, before `break;`, add `maybeRearmInferredCompletion(state);`. Define that helper next to `scheduleInferredCompletion`:

```js
function maybeRearmInferredCompletion(state) {
  if (state.completionTimer && inferenceEligible(state)) {
    scheduleInferredCompletion(state);
  }
}
```

So the `item/started`/`item/completed` cases become:

```js
    case "item/started":
      recordItem(state, message.params.item, "started", message.params.threadId ?? null);
      {
        const update = describeStartedItem(state, message.params.item);
        emitProgress(state.onProgress, update?.message, update?.phase ?? null);
      }
      maybeRearmInferredCompletion(state);
      break;
    case "item/completed":
      recordItem(state, message.params.item, "completed", message.params.threadId ?? null);
      {
        const update = describeCompletedItem(state, message.params.item);
        emitProgress(state.onProgress, update?.message, update?.phase ?? null);
      }
      maybeRearmInferredCompletion(state);
      break;
```

- [ ] **Step 8: Thread `inferredCompletionQuietMs` through `captureTurn` callers**

`captureTurn` already forwards `options` into `createTurnCaptureState(threadId, options)` (~580), so the field is read there automatically. Now pass it from the runners.

In `runAppServerInvestigation` (~1152-1154), where `turnIdleTimeoutMs` is read, add:

```js
  const turnIdleTimeoutMs = options.turnIdleTimeoutMs;
  const inferredCompletionQuietMs = options.inferredCompletionQuietMs;
```

In BOTH `captureTurn` calls inside `runAppServerInvestigation` (the recon call ~1191 and the finalize call ~1298), extend the options object:

Recon (~1191):

```js
          { onProgress: options.onProgress, turnIdleTimeoutMs, inferredCompletionQuietMs }
```

Finalize (~1298):

```js
          { onProgress: options.onProgress, turnIdleTimeoutMs, inferredCompletionQuietMs }
```

In `runAppServerTurn` (~1069 reads `turnIdleTimeoutMs`; ~1113 passes options), do the same so the /codex:task subagent path can be tuned via the env var (no explicit option needed there, but keep the plumbing consistent):

After `const turnIdleTimeoutMs = options.turnIdleTimeoutMs;` (~1069) add:

```js
  const inferredCompletionQuietMs = options.inferredCompletionQuietMs;
```

And change the `captureTurn` options (~1113) to:

```js
      { onProgress: options.onProgress, turnIdleTimeoutMs, inferredCompletionQuietMs }
```

- [ ] **Step 9: Run the new test to verify it passes**

Run: `node --test tests/investigation.test.mjs 2>&1 | grep -A3 "does not infer on a readiness cue"`
Expected: PASS.

- [ ] **Step 10: Run the full suite — watch the subagent task test specifically**

Run: `node --test tests/*.test.mjs 2>&1 | tail -25`
Expected: baseline failing total. The test `task can finish after subagent work even if the parent turn/completed event is missing` (runtime.test.mjs:750) now relies on the quiet fallback at the **15s default** — it will still PASS but may take ~15s, slowing the suite. Task 5 fixes the slowness via the env var. If the suite's per-test timeout is under 15s and this test now FAILS by timeout, jump to Task 5 Step 1-2 before continuing, then return.

- [ ] **Step 11: Commit**

```bash
git add plugins/codex/scripts/lib/codex.mjs tests/fake-codex-fixture.mjs tests/investigation.test.mjs
git commit --no-verify -m "fix(codex): demote inferred completion to a subagent-gated quiet-window fallback (Defect A)"
```

---

## Task 4: Defect A part 2 — end-to-end repro via per-thread serialization

This proves the headline bug: with the app-server serializing turns per thread, a premature finalize dispatch queues behind a still-open recon turn and the run hangs to the watchdog. Old behavior: timeout error. Fixed behavior (Task 3): recon waits for real `turn/completed`, finalize lands on an idle thread, verdict survives.

**Files:**
- Modify: `tests/fake-codex-fixture.mjs` — teach `queue-driven` to serialize turns per thread (opt-in)
- Modify: `tests/investigation.test.mjs` (new test)

- [ ] **Step 1: Write the failing test — readiness cue, then a delayed real verdict + completion, under serialization**

Add to `tests/investigation.test.mjs`:

```js
test("a verdict streamed after a readiness cue is captured, not discarded (Defect A end-to-end)", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    fake.enableSerialization();
    // Recon turn 1: emits a "ready for finalize" cue immediately, but the REAL
    // verdict message and turn/completed arrive ~150ms later. Under
    // serialization the finalize turn/start cannot open until this completes.
    fake.queueTurnResponse({
      commands: [],
      finalAnswer: { text: "I'm ready for finalize." },
      lateFinalAnswer: { text: "Investigation complete. Verdict ready.", afterMs: 150 },
      delayCompletedMs: 150
    });
    // Finalize turn 2: schema-enforced structured JSON.
    fake.queueTurnResponse({ finalAnswer: { text: STRUCTURED_REVIEW } });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize.",
      outputSchema: { type: "object", required: ["verdict"] },
      turnIdleTimeoutMs: 2000,
      inferredCompletionQuietMs: 50
    });

    const starts = fake.requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 2, "recon must complete before finalize is dispatched");
    assert.equal(result.error ?? null, null, "must NOT hang to the watchdog");
    assert.equal(result.finalMessage, STRUCTURED_REVIEW, "verdict from finalize is preserved");
  } finally {
    fake.close();
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/investigation.test.mjs 2>&1 | grep -A4 "end-to-end"`
Expected: FAIL — `enableSerialization`/`lateFinalAnswer` are unknown. (After Step 3-4 wire them, with Task 3 already applied the test passes; to see it fail for the RIGHT reason, you can temporarily revert Task 3's gate — optional.)

- [ ] **Step 3: Add serialization + `lateFinalAnswer` to the fixture**

In `tests/fake-codex-fixture.mjs`:

(a) In the fixture template source, add a per-thread busy map and a pending-start queue near the top of the generated script (next to `const interruptibleTurns = new Map();` ~17):

```js
	const interruptibleTurns = new Map();
	const threadBusy = new Map();
	const pendingStarts = [];
```

(b) Add a helper (in the template, near `emitTurnCompleted` ~147) that runs a queued `turn/start` only when its thread is free, and drains the queue when a turn completes:

```js
function threadIsBusy(threadId) {
  return threadBusy.get(threadId) === true;
}

function markThreadBusy(threadId, busy) {
  threadBusy.set(threadId, busy);
  if (!busy) {
    const next = pendingStarts.findIndex((p) => !threadIsBusy(p.threadId));
    if (next >= 0) {
      const job = pendingStarts.splice(next, 1)[0];
      job.run();
    }
  }
}
```

(c) In the `queue-driven` `turn/start` handler, when serialization is enabled (a flag persisted in state, see Step 4), wrap the body so that if the thread is busy the job is deferred. The existing code records the request at ~397 (`state.requests.push(...)`) but only persists state later via `nextTurnId`. In the serialize branch we defer before that save, so **persist the recorded request first** or the `fake.requests` assertions lose it. At the top of the `if (BEHAVIOR === "queue-driven") {` block (~395), after the existing `state.requests.push({ method: "turn/start", params: message.params });`, add:

```js
          if (state.serialize) {
            saveState(state);   // persist the just-recorded request before deferring
            const job = {
              threadId: thread.id,
              run: () => runQueuedTurn(message, thread)
            };
            if (threadIsBusy(thread.id)) {
              pendingStarts.push(job);
            } else {
              job.run();
            }
            break;
          }
```

(Note: `runQueuedTurn` reloads state, so it does NOT re-push the request — the push happened here once. Ensure the extracted `runQueuedTurn` body does not also push to `state.requests`; that line stays in the enqueue path only.)

Then extract the existing synchronous body (from `const turnId = nextTurnId(state);` at ~399 through the final `turn/completed`/`break` at ~442-443) into a function `runQueuedTurn(message, thread)` defined in the template.

**Correctness — reload state inside the job.** A deferred job runs later (via the `markThreadBusy(..., false)` drain), so it must NOT close over the `state` snapshot from enqueue time. Make `runQueuedTurn` reload fresh state at entry and persist as it goes:

```js
function runQueuedTurn(message, thread) {
  const state = loadState();
  const turnId = nextTurnId(state);   // re-reads/saves state internally
  // ... (the rest of the previously-synchronous body, using this fresh `state`) ...
}
```

The `threadBusy` map and `pendingStarts` array are module-scoped in the subprocess (in-memory, not persisted) — correct, since a single app-server subprocess handles the whole investigation. Inside `runQueuedTurn`: call `markThreadBusy(thread.id, true)` right after `send({ method: "turn/started", ... })`, and call `markThreadBusy(thread.id, false)` immediately before each path that sends the real `turn/completed` (both the delayed and immediate branches from Task 3 Step 3). For the `delayCompletedMs` branch, call `markThreadBusy(thread.id, false)` inside the `setTimeout` right before sending `turn/completed`. The `entry` shifted off `state.queue` must be read from the freshly-loaded `state` inside `runQueuedTurn`, not captured earlier.

(d) Add `lateFinalAnswer` emission inside `runQueuedTurn`, right after the `finalAnswer` send (~431):

```js
          if (entry && entry.lateFinalAnswer) {
            const lateTurnId = turnId;
            setTimeout(() => {
              send({ method: "item/completed", params: { threadId: thread.id, turnId: lateTurnId, item: { type: "agentMessage", id: "late_" + lateTurnId, text: entry.lateFinalAnswer.text, phase: "final_answer" } } });
            }, entry.lateFinalAnswer.afterMs ?? 100);
          }
```

- [ ] **Step 4: Expose `enableSerialization()` on the handle and persist the flag**

In `setupFakeCodex` (~683), add `serialize: false` to `initialState`, and add a method to the returned handle (near `queueTurnHang` ~730):

```js
    enableSerialization() {
      const state = readState();
      state.serialize = true;
      writeState(state);
    },
```

In the fixture template's `loadState()` default (~21) and anywhere state is rehydrated, ensure `serialize` is read from disk (it already round-trips through `JSON.parse(readFileSync)` since the whole object is persisted). Confirm the template reads `state.serialize` (set in the handler in Step 3c) — it does, because `state` is `loadState()` per message.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/investigation.test.mjs 2>&1 | grep -A4 "end-to-end"`
Expected: PASS — 2 turn/start requests, no error, `finalMessage === STRUCTURED_REVIEW`.

- [ ] **Step 6: Sanity — existing queue-driven tests still pass (serialization is opt-in)**

Run: `node --test tests/investigation.test.mjs 2>&1 | tail -20`
Expected: the existing queue-driven tests (which never call `enableSerialization()`) are unaffected; baseline holds.

- [ ] **Step 7: Commit**

```bash
git add tests/fake-codex-fixture.mjs tests/investigation.test.mjs
git commit --no-verify -m "test(codex): reproduce the finalize-queue hang end-to-end via per-thread serialization (Defect A)"
```

---

## Task 5: Keep the subprocess subagent test fast + add an env-override regression

The subagent fallback fires on the real `/codex:task` subprocess path with the 15s default. Use the env var to keep tests fast and lock the override behavior.

**Files:**
- Modify: `tests/runtime.test.mjs` — set `CODEX_INFERRED_COMPLETION_QUIET_MS` in the existing subagent-no-completion test's env, and add a focused override regression test.

- [ ] **Step 1: Speed up the existing subagent-no-completion subprocess test**

In `tests/runtime.test.mjs`, the test `task can finish after subagent work even if the parent turn/completed event is missing` (~750) builds env via `buildEnv(binDir)`. Change its run to inject a tiny quiet window:

```js
  const result = run("node", [SCRIPT, "task", "challenge the current design"], {
    cwd: repo,
    env: { ...buildEnv(binDir), CODEX_INFERRED_COMPLETION_QUIET_MS: "50" }
  });
```

- [ ] **Step 2: Run it — must still pass, now fast**

Run: `node --test tests/runtime.test.mjs 2>&1 | grep -A3 "even if the parent turn/completed event is missing"`
Expected: PASS, completing in well under a second (no 15s wait).

- [ ] **Step 3: Add a focused regression that the env override is honored**

Add near the other subagent tests in `tests/runtime.test.mjs`. It asserts the fallback still produces the subagent task's output (proving inference fired) while the env var keeps it fast:

```js
test("CODEX_INFERRED_COMPLETION_QUIET_MS overrides the inferred-completion quiet window", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "with-subagent-no-main-turn-completed");
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const start = Date.now();
  const result = run("node", [SCRIPT, "task", "challenge the current design"], {
    cwd: repo,
    env: { ...buildEnv(binDir), CODEX_INFERRED_COMPLETION_QUIET_MS: "50" }
  });
  const elapsed = Date.now() - start;

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Handled the requested task.\nTask prompt accepted.\n");
  assert.ok(elapsed < 10000, `inference must fire on the short window (took ${elapsed}ms)`);
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/runtime.test.mjs 2>&1 | grep -A3 "overrides the inferred-completion quiet window"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/runtime.test.mjs
git commit --no-verify -m "test(codex): keep subagent fallback fast via CODEX_INFERRED_COMPLETION_QUIET_MS override"
```

---

## Task 6: Full-suite verification and JSDoc/typedef consistency sweep

**Files:**
- Modify: `plugins/codex/scripts/lib/codex.mjs` (only if the typedef/state drift check finds a gap)

- [ ] **Step 1: Confirm the typedef matches the state object**

Open `codex.mjs`. Verify `@typedef TurnCaptureState` lists every field set in `createTurnCaptureState`: it must now include `pendingTurnId`, `sawSubagentWork`, `inferredCompletionQuietMs`. Verify no field references a removed name (none were removed; `finalAnswerSeen` and `completionTimer` are retained).

Run: `grep -n "pendingTurnId\|sawSubagentWork\|inferredCompletionQuietMs\|finalAnswerSeen\|completionTimer" plugins/codex/scripts/lib/codex.mjs`
Expected: each new field appears in both the typedef block and `createTurnCaptureState`.

- [ ] **Step 2: Confirm no stray `250` literal or bare `final_answer` inference remains**

Run: `grep -n "250\|finalAnswerSeen" plugins/codex/scripts/lib/codex.mjs`
Expected: the only `finalAnswerSeen` writes are the record in `recordItem` and the typedef; no `setTimeout(..., 250)` remains in `scheduleInferredCompletion`.

- [ ] **Step 3: Run the full suite and compare to the Task 0 baseline**

Run: `node --test tests/*.test.mjs 2>&1 | tail -30`
Expected: the run terminates cleanly (no hang). Failing-test names are a subset of (equal to) the Task 0 baseline; the new tests from Tasks 1-5 all pass. No net-new failures.

- [ ] **Step 4: Confirm the suite does not hang and finishes in a reasonable time**

Run: `time node --test tests/*.test.mjs > /dev/null 2>&1`
Expected: completes without hanging; total time not dramatically higher than baseline (the 15s-default path is overridden in tests).

- [ ] **Step 5: Final commit if Step 1-2 required an edit; otherwise no-op**

```bash
git add plugins/codex/scripts/lib/codex.mjs
git commit --no-verify -m "docs(codex): sync TurnCaptureState typedef with new capture-state fields"
```

(Skip if no edit was needed.)

---

## Self-review notes (for the implementer)

- **Spec coverage:** Defect A → Tasks 3+4; Defect B → Task 2; Defect C → Task 1; injectable/env-overridable quiet window → Task 3 (constant+resolver) and Task 5 (override regression); "no net-new failures vs 7 baseline" → Tasks 0 and 6.
- **Order rationale:** C and B touch the watchdog/handler with minimal logic; doing them first means Task 3's larger inference rewrite lands on an already-corrected handler. A's end-to-end repro (Task 4) depends on the gate from Task 3.
- **Type consistency:** the new fields are `pendingTurnId`, `sawSubagentWork`, `inferredCompletionQuietMs`; the new functions are `resolveInferredCompletionQuietMs`, `inferenceEligible`, `maybeRearmInferredCompletion`. Use these exact names across tasks.
- **Watch-out:** in Task 3 Step 10, the default 15s window can slow the subprocess subagent test until Task 5 injects the env override. If the suite's per-test timeout is shorter than 15s, apply Task 5 Steps 1-2 early.
