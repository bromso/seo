# Runner Crash Resilience — Design

**Status:** approved (2026-06-07)
**Author:** Jonas + Claude (brainstorming session)

## Goal

Make the audit runner daemon survive Lighthouse / Chrome crashes that today exit the entire Node process via unhandled promise rejections, and convert the in-flight crashed run into a user-visible `failed` state so the dashboard reflects reality.

## Problem

The runner crashed mid-session today with:

```
Error: Protocol error (Page.enable): Session closed. Most likely the page has been closed.
    at LighthouseError.fromProtocolMessage ...
Node.js v26.0.0
```

`processRun` already has a `try/catch` around `aggregate()` (`packages/runner-core/src/process-run.ts`) and the daemon already has a `try/catch` around `processRun` (`apps/runner/src/daemon.ts:141-188`). The Lighthouse error escaped **both** because it was an **unhandled promise rejection** fired from a CDP/WebSocket event handler that isn't on the awaited path. Node 22+'s default `--unhandled-rejections=throw` then crashed the process.

Symptom for the user: the daemon stops processing runs entirely, the crashed run sits in DB with `status: running` forever, and any later "Run audit" clicks land in pgmq with no consumer.

## Decisions locked during brainstorming

1. **In-flight run handling:** on crash, mark the run `failed`, write synthetic `failed` rows for any missing categories, ack the pgmq message. No retry. The user re-runs manually if they want.
2. **Hardening scope:** minimal. `process.on("unhandledRejection")` + `process.on("uncaughtException")` with identical "log and continue" behavior. No circuit breaker, no fatal-on-uncaughtException, no per-URL blocklist.

## Architecture

```
Process boot (apps/runner/src/daemon.ts)
   ├─ installCrashHandlers(logger)
   │     ├─ process.on("unhandledRejection", logAndContinue)
   │     └─ process.on("uncaughtException", logAndContinue)
   └─ poll loop (existing structure)
        ├─ queue.read
        ├─ processRun(...)
        ├─ catch (err) → markRunCrashed(...) → queue.ack
        └─ continue
```

### New helpers (in `apps/runner/src/daemon.ts`)

**`installCrashHandlers(logger): () => void`**
- Wires `process.on("unhandledRejection", ...)` and `process.on("uncaughtException", ...)`.
- Both handlers log at `kind: "warn"` with the rejection reason / exception message.
- Neither calls `process.exit`.
- Returns a teardown function that removes both listeners (for test cleanup).

**`markRunCrashed({ db, queue, msgId, runId, ownerId, requestedUrl, errorMessage, logger })`**
Replaces the existing "leave-unacked" behavior in the daemon's catch block:
1. Query `getCompletedCategoriesForRun(db, runId)` to find missing categories.
2. For each missing category, build a synthetic `failed` `AuditResult` (same shape as the existing retry-limit path at lines 109-135 of daemon.ts) and `insertAuditResult`. On unique-constraint violation (PG `23505`), log debug and skip — that category was inserted by a concurrent path.
3. Call `markAuditRunFailed(db, runId)` (new helper in `@repo/db`) to set the run status to `failed`. This update is conditional on current status being `running` (won't overwrite `completed`/`partial`/`failed` if processRun managed to update them before the crash).
4. `await queue.ack(msgId)`.
5. If any DB write fails, log warn and **do NOT ack** — pgmq retries after visibility timeout, eventually hitting the existing retry-limit archive path. Self-healing.

### Daemon catch block — changed

Before:
```ts
} catch (err) {
  logger({ kind: "warn", message: `processRun threw, leaving message for retry: ${err.message}` })
  // No ack — pgmq returns the message after visibility timeout
}
```

After:
```ts
} catch (err) {
  await markRunCrashed({
    db, queue, msgId: msg.msgId,
    runId: msg.body.runId,
    ownerId: msg.body.ownerId,
    requestedUrl: msg.body.requestedUrl,
    errorMessage: (err as Error).message,
    logger,
  })
}
```

### New DB helper

**`markAuditRunFailed(db, runId): Promise<number>`** in `@repo/db`, mirroring the existing `markAuditRunRunning`. Updates `audit_runs.status` to `failed` only when current status is `running`. Returns row count.

## Error handling details

**`unhandledRejection` handler body:**
```ts
const onUnhandledRejection = (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  logger({
    kind: "warn",
    message: `unhandledRejection (process continues): ${message}`,
  })
}
```

**`uncaughtException` handler body:** identical shape, identical behavior. User explicitly chose to treat both the same way.

**Idempotency:** the `audit_results` table has a unique index on `(run_id, category)`. If `processRun` managed to insert results for some categories before crashing, the synthetic-failure inserts for those categories will hit `23505`. We catch that specific error code and skip — leaving the dashboard with real scores for partial-completion categories and synthetic-failed rows for the rest.

**Run-level status race:** `processRun` updates `audit_runs.status` after the result loop. If we crash mid-run, that update never fires. `markAuditRunFailed` is conditional-on-`running`, so if `processRun` did manage to write `partial`, we don't overwrite it.

**Path narrowing for the existing retry-limit code:** with this change, crash-style failures fail fast on the first attempt (ack on first crash), so the `read_ct > 3` retry-limit path becomes unreachable for that class. It remains reachable for genuinely transient failures (e.g., `queue.read` blip, leaving message un-acked) per the existing handler at lines 86-93. The retry-limit code stays in place; the trigger set just narrows.

## Testing strategy

| Test | What | How |
|---|---|---|
| `markAuditRunFailed` writes the row | Unit test in `@repo/db` | Drizzle integration test |
| `installCrashHandlers` registers + tears down | Listener present after install, absent after teardown | unit test in `apps/runner/test/crash-handlers.test.ts` |
| `markRunCrashed` happy path | Writes synthetic failures for all missing categories, marks run failed, acks the message | unit test with injected db / queue fakes |
| `markRunCrashed` idempotency | Skips categories that already have a row (simulated 23505) | unit test |
| `markRunCrashed` doesn't ack on db failure | If `insertAuditResult` throws, `queue.ack` is not called and the function rejects | unit test |
| Daemon survives synchronous error from `aggregate` | Mock `aggregate` to throw; assert poll loop continues, msg acked, synthetic rows inserted | integration test in `apps/runner/test/daemon-crash-recovery.test.ts` |
| Daemon survives async unhandled rejection from `aggregate` | Mock `aggregate` to spawn an unawaited rejecting promise (the real Lighthouse pattern); assert process stays alive, run marked failed, next message gets picked up | same file as above |
| Live smoke | Restart runner, enqueue an audit known to crash Lighthouse (the one that hit us today), verify the daemon survives | manual; non-gating |

The async-unhandled-rejection test is the meaningful one. Sketch:

```ts
const aggregateThatLeaksRejection = async () => {
  void Promise.reject(new Error("lighthouse session closed")) // unawaited
  await sleep(50) // let the rejection propagate
  throw new Error("aggregate also rejects (propagated from the leaked promise)")
}
```

Teardown of the global process listeners in `afterEach` is mandatory or tests across files will interfere.

## Rollout — commit order

Three commits, each leaving the workspace green:

1. `feat(db): add markAuditRunFailed` — new exported function + unit test mirroring `markAuditRunRunning`.
2. `feat(runner): markRunCrashed helper` — adds the helper. Not yet called by anything; new code only. Test added in isolation. No user-visible behavior change. (The existing retry-limit code at daemon.ts:109-135 keeps its own synthetic-failure + archive behavior — we deliberately don't swap `archive` for `ack` there since archive vs delete is a meaningful semantic difference and the existing path works.)
3. `feat(runner): survive Lighthouse async crashes via process handlers` — installs `installCrashHandlers`, changes the daemon's catch block to call `markRunCrashed` and ack on success. Adds the daemon-crash-recovery test file.

## Out of scope

- **Circuit breaker / N-failures-in-a-row exit.** User chose Minimal.
- **Treating `uncaughtException` as fatal.** User chose identical handling.
- **Chrome process leak cleanup** (a `pkill -f chrome` on daemon startup or per-run). Separate concern; not blocking.
- **Lighthouse version pin** to dodge the `lh:runner:gather` flake on Node 26. Separate task; could break other audits.
- **Per-URL crash blocklist.** Overkill; user can not-re-run a known-bad site.
- **Metrics / alerting on crash rate.** No metrics infra in the project; log grep is fine for now.
- **Refactoring the `nvm` wrapper that bit us today** when running `node dist/index.js` from this shell. Local-machine env issue, not a runner code issue.

## Risk register

| Risk | Mitigation |
|---|---|
| Process handlers swallow a real bug we'd want to crash on | Both handlers log at `warn` — visible in logs; on-call can still grep |
| `markAuditRunFailed` overwrites a `partial` status if both fire | Conditional on current status being `running` |
| Synthetic-failure insert spams unique-index violations | Catch + skip PG `23505`, log at debug |
| Test listeners leak across files | `installCrashHandlers` returns a teardown function; `afterEach` mandatory |
| The async-rejection test is flaky due to timing | Use `sleep(50)` to let the rejection propagate; if flake observed, switch to a promise-resolved barrier |

## Test gate before each commit

```bash
bun --filter @repo/db test
bun --filter @repo/runner test
bun --filter @repo/runner build
bun turbo check-types
```
