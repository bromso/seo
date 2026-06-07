# Runner Crash Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the audit runner daemon survive Lighthouse / Chrome crashes (which today exit the entire Node process via unhandled promise rejections) and convert the in-flight crashed run into a user-visible `failed` state.

**Architecture:** Install process-level `unhandledRejection` and `uncaughtException` handlers in `apps/runner/src/daemon.ts` that log without exiting. Change the daemon's `catch` block around `processRun` to call a new `markRunCrashed` helper that writes synthetic `failed` rows for missing categories, marks `audit_runs.status='failed'` (via a new `markAuditRunFailed` query in `@repo/db`), and acks the pgmq message. Three commits total.

**Tech Stack:** TypeScript 5.7, Node 20+ (running on 26 in dev), Drizzle ORM (Postgres), pgmq (queue), vitest 4. No new shared deps.

**Spec:** [`docs/superpowers/specs/2026-06-07-runner-crash-resilience-design.md`](../specs/2026-06-07-runner-crash-resilience-design.md)

---

## File Structure

**Modified:**
- `packages/db/src/queries.ts` — add `markAuditRunFailed`
- `packages/db/src/index.ts` — export `markAuditRunFailed`
- `apps/runner/src/daemon.ts` — add `installCrashHandlers` + `markRunCrashed` helpers; rewire the catch block

**Created:**
- `packages/db/integration/mark-audit-run-failed.integration.test.ts` — integration test for the new query
- `apps/runner/test/crash-handlers.test.ts` — unit test for `installCrashHandlers` + `markRunCrashed`
- `apps/runner/test/daemon-crash-recovery.test.ts` — integration-style test that drives the daemon with mocked dependencies through a crash scenario

**Untouched:** existing retry-limit path at `daemon.ts:104-138` (it keeps its own `archive` semantics; per spec we deliberately don't refactor it).

---

## Tasks

### Task 1: `markAuditRunFailed` in `@repo/db`

**Files:**
- Modify: `packages/db/src/queries.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/integration/mark-audit-run-failed.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `packages/db/integration/mark-audit-run-failed.integration.test.ts`:

```ts
import { sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { markAuditRunFailed } from "../src/queries"
import { auditRuns, profiles, sites } from "../src/schema/index"
import { createServiceDb, createTestUser, deleteTestUser, truncateUserData } from "./helpers"

const enabled = process.env["RUN_INTEGRATION"] === "1"

;(enabled ? describe : describe.skip)("markAuditRunFailed", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("mark-failed")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
    await service.close()
  })

  beforeEach(async () => {
    await truncateUserData()
    await service.db.insert(profiles).values({ id: user.id })
  })

  async function insertRun(status: "queued" | "running" | "completed" | "partial" | "failed") {
    const [site] = await service.db
      .insert(sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: sites.id })
    if (!site) throw new Error("site insert failed")
    const [run] = await service.db
      .insert(auditRuns)
      .values({
        siteId: site.id,
        ownerId: user.id,
        requestedUrl: "https://example.com",
        status: sql`${status}::run_status`,
      })
      .returning({ id: auditRuns.id })
    if (!run) throw new Error("run insert failed")
    return run.id
  }

  async function readStatus(runId: string): Promise<string> {
    const rows = await service.db
      .select({ status: auditRuns.status })
      .from(auditRuns)
      .where(sql`${auditRuns.id} = ${runId}`)
    return rows[0]?.status ?? "missing"
  }

  it("marks a running run as failed and returns 1", async () => {
    const runId = await insertRun("running")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(1)
    expect(await readStatus(runId)).toBe("failed")
  })

  it("does not overwrite a completed run", async () => {
    const runId = await insertRun("completed")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(0)
    expect(await readStatus(runId)).toBe("completed")
  })

  it("does not overwrite a partial run", async () => {
    const runId = await insertRun("partial")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(0)
    expect(await readStatus(runId)).toBe("partial")
  })

  it("does not overwrite an already-failed run", async () => {
    const runId = await insertRun("failed")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(0)
    expect(await readStatus(runId)).toBe("failed")
  })

  it("does nothing for a queued run (must be running before marking failed)", async () => {
    const runId = await insertRun("queued")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(0)
    expect(await readStatus(runId)).toBe("queued")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --filter @repo/db test:integration mark-audit-run-failed`

Expected: FAIL — `markAuditRunFailed` not exported. Requires Supabase running locally (`supabase status` should show running services).

- [ ] **Step 3: Implement `markAuditRunFailed` in `packages/db/src/queries.ts`**

Append to the end of `packages/db/src/queries.ts`:

```ts
/**
 * Update audit_runs.status to 'failed' if currently 'running'.
 * Returns the number of rows updated (0 if the row doesn't exist or has
 * already reached a terminal state — completed/partial/failed — or is
 * still queued).
 */
export async function markAuditRunFailed(db: Db, runId: string): Promise<number> {
  const result = await db
    .update(auditRuns)
    .set({ status: sql`'failed'::run_status` })
    .where(sql`${auditRuns.id} = ${runId} AND ${auditRuns.status} = 'running'`)
  return (result as unknown as { count: number }).count ?? 0
}
```

- [ ] **Step 4: Export `markAuditRunFailed` from `packages/db/src/index.ts`**

Update the queries re-export block:

```ts
export {
  getAuditRun,
  getCompletedCategoriesForRun,
  markAuditRunFailed,
  markAuditRunRunning,
} from "./queries"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun --filter @repo/db test:integration mark-audit-run-failed`

Expected: PASS, 5 tests.

- [ ] **Step 6: Run the existing test suites to confirm no regression**

Run: `bun --filter @repo/db test && bun --filter @repo/db build && bun turbo check-types`

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/queries.ts packages/db/src/index.ts packages/db/integration/mark-audit-run-failed.integration.test.ts
git commit -m "feat(db): add markAuditRunFailed query"
```

---

### Task 2: `markRunCrashed` + `installCrashHandlers` helpers in `apps/runner/src/daemon.ts`

This task ADDS the two helper functions and their tests. The daemon's catch block is NOT yet wired to call them — that's Task 3. After this task, the helpers exist with full test coverage but aren't used in production code paths.

**Files:**
- Modify: `apps/runner/src/daemon.ts` (add helpers + export them for testing)
- Create: `apps/runner/test/crash-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/runner/test/crash-handlers.test.ts`:

```ts
import type { AuditResult, Category, LogEvent } from "@repo/audit-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { installCrashHandlers, markRunCrashed } from "../src/daemon"

describe("installCrashHandlers", () => {
  let teardown: (() => void) | undefined

  afterEach(() => {
    teardown?.()
    teardown = undefined
  })

  it("adds unhandledRejection + uncaughtException listeners and removes them on teardown", () => {
    const before = {
      rej: process.listenerCount("unhandledRejection"),
      exc: process.listenerCount("uncaughtException"),
    }
    const logs: LogEvent[] = []
    teardown = installCrashHandlers((e) => logs.push(e))
    expect(process.listenerCount("unhandledRejection")).toBe(before.rej + 1)
    expect(process.listenerCount("uncaughtException")).toBe(before.exc + 1)
    teardown()
    teardown = undefined
    expect(process.listenerCount("unhandledRejection")).toBe(before.rej)
    expect(process.listenerCount("uncaughtException")).toBe(before.exc)
  })

  it("logs (and does not exit) when an unhandled rejection is fired", async () => {
    const logs: LogEvent[] = []
    teardown = installCrashHandlers((e) => logs.push(e))
    process.emit("unhandledRejection", new Error("simulated"), Promise.resolve())
    await new Promise((r) => setImmediate(r))
    expect(logs).toHaveLength(1)
    expect(logs[0]?.kind).toBe("warn")
    expect(logs[0]?.message).toContain("unhandledRejection")
    expect(logs[0]?.message).toContain("simulated")
  })

  it("logs (and does not exit) when an uncaught exception is fired", async () => {
    const logs: LogEvent[] = []
    teardown = installCrashHandlers((e) => logs.push(e))
    process.emit("uncaughtException", new Error("uncaught boom"))
    await new Promise((r) => setImmediate(r))
    expect(logs).toHaveLength(1)
    expect(logs[0]?.kind).toBe("warn")
    expect(logs[0]?.message).toContain("uncaughtException")
    expect(logs[0]?.message).toContain("uncaught boom")
  })

  it("stringifies non-Error rejection reasons", async () => {
    const logs: LogEvent[] = []
    teardown = installCrashHandlers((e) => logs.push(e))
    process.emit("unhandledRejection", "string reason", Promise.resolve())
    await new Promise((r) => setImmediate(r))
    expect(logs[0]?.message).toContain("string reason")
  })
})

describe("markRunCrashed", () => {
  const REQUESTED_URL = "https://example.com/"
  const RUN_ID = "11111111-2222-3333-4444-555555555555"
  const OWNER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  const MSG_ID = 42

  function makeDeps(
    overrides: {
      completedCategories?: Set<Category>
      insertReject?: Error
      markFailedReturns?: number
    } = {}
  ) {
    const inserted: AuditResult[] = []
    const insertSpy = vi.fn(async (r: AuditResult) => {
      if (overrides.insertReject) throw overrides.insertReject
      inserted.push(r)
      return "row-id"
    })
    const markFailedSpy = vi.fn(async () => overrides.markFailedReturns ?? 1)
    const getCompletedSpy = vi.fn(
      async () => overrides.completedCategories ?? (new Set() as Set<Category>)
    )
    const ackSpy = vi.fn(async () => {})
    const logs: LogEvent[] = []
    return {
      inserted,
      insertSpy,
      markFailedSpy,
      getCompletedSpy,
      ackSpy,
      logs,
      db: {} as never,
      args: {
        db: {} as never,
        queue: { ack: ackSpy } as never,
        msgId: MSG_ID,
        runId: RUN_ID,
        ownerId: OWNER_ID,
        requestedUrl: REQUESTED_URL,
        errorMessage: "lighthouse session closed",
        logger: (e: LogEvent) => logs.push(e),
        getCompletedCategoriesForRun: getCompletedSpy,
        insertAuditResult: insertSpy,
        markAuditRunFailed: markFailedSpy,
      },
    }
  }

  it("inserts synthetic failures for all 5 categories, marks run failed, acks", async () => {
    const t = makeDeps()
    await markRunCrashed(t.args)
    expect(t.inserted).toHaveLength(5)
    const categories = t.inserted.map((r) => r.category).sort()
    expect(categories).toEqual([
      "best-practices",
      "on-page",
      "performance",
      "pwa",
      "seo",
    ])
    for (const r of t.inserted) {
      expect(r.status).toBe("failed")
      expect(r.url).toBe(REQUESTED_URL)
      expect(r.requestedUrl).toBe(REQUESTED_URL)
      if (r.status === "failed") {
        expect(r.error.message).toBe("lighthouse session closed")
        expect(r.error.code).toBe("UNKNOWN")
      }
    }
    expect(t.markFailedSpy).toHaveBeenCalledWith(RUN_ID)
    expect(t.ackSpy).toHaveBeenCalledWith(MSG_ID)
  })

  it("skips categories that already have a row", async () => {
    const t = makeDeps({ completedCategories: new Set(["seo", "on-page"]) as Set<Category> })
    await markRunCrashed(t.args)
    const categories = t.inserted.map((r) => r.category).sort()
    expect(categories).toEqual(["best-practices", "performance", "pwa"])
    expect(t.ackSpy).toHaveBeenCalledWith(MSG_ID)
  })

  it("treats Postgres 23505 (unique violation) on insert as benign and continues", async () => {
    const t = makeDeps()
    // First call rejects with 23505; subsequent calls succeed.
    let first = true
    t.args.insertAuditResult = async (r) => {
      if (first) {
        first = false
        const err = new Error("duplicate key") as Error & { code?: string }
        err.code = "23505"
        throw err
      }
      t.inserted.push(r)
      return "row-id"
    }
    await markRunCrashed(t.args)
    expect(t.inserted).toHaveLength(4)
    expect(t.ackSpy).toHaveBeenCalledWith(MSG_ID)
  })

  it("does NOT ack if a non-23505 insert error happens", async () => {
    const t = makeDeps({ insertReject: new Error("db connection lost") })
    await expect(markRunCrashed(t.args)).rejects.toThrow("db connection lost")
    expect(t.ackSpy).not.toHaveBeenCalled()
    expect(t.markFailedSpy).not.toHaveBeenCalled()
  })

  it("does NOT ack if markAuditRunFailed throws", async () => {
    const t = makeDeps()
    t.args.markAuditRunFailed = async () => {
      throw new Error("update failed")
    }
    await expect(markRunCrashed(t.args)).rejects.toThrow("update failed")
    expect(t.ackSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --filter @repo/runner test test/crash-handlers.test.ts`

Expected: FAIL — `installCrashHandlers` and `markRunCrashed` not exported from `../src/daemon`.

- [ ] **Step 3: Add the two helpers to `apps/runner/src/daemon.ts`**

Open `apps/runner/src/daemon.ts`. Add these imports at the top (alphabetical with existing imports):

```ts
import type { AuditResult, Category, LogEvent } from "@repo/audit-core"
```

(`Category` may already be imported transitively; if so, only add the missing pieces.)

Then add these two exported helpers at the top of the file, AFTER the existing `import` block and BEFORE the existing `export type DaemonOptions`:

```ts
const ALL_CATEGORIES: Category[] = ["performance", "seo", "best-practices", "pwa", "on-page"]

export function installCrashHandlers(logger: (e: LogEvent) => void): () => void {
  const onUnhandled = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    logger({
      kind: "warn",
      message: `unhandledRejection (process continues): ${message}`,
    })
  }
  const onUncaught = (err: Error) => {
    logger({
      kind: "warn",
      message: `uncaughtException (process continues): ${err.message}`,
    })
  }
  process.on("unhandledRejection", onUnhandled)
  process.on("uncaughtException", onUncaught)
  return () => {
    process.off("unhandledRejection", onUnhandled)
    process.off("uncaughtException", onUncaught)
  }
}

export type MarkRunCrashedArgs = {
  db: unknown // opaque; helper only forwards it to the injected db functions
  queue: { ack: (msgId: number) => Promise<void> }
  msgId: number
  runId: string
  ownerId: string
  requestedUrl: string
  errorMessage: string
  logger: (e: LogEvent) => void
  // Injected DB ops — accept functions rather than the @repo/db module so tests
  // can pass spies without spinning up a real Postgres.
  getCompletedCategoriesForRun: (runId: string) => Promise<Set<Category>>
  insertAuditResult: (
    result: AuditResult,
    runId: string,
    ownerId: string
  ) => Promise<string>
  markAuditRunFailed: (runId: string) => Promise<number>
}

export async function markRunCrashed(args: MarkRunCrashedArgs): Promise<void> {
  const completed = await args.getCompletedCategoriesForRun(args.runId)
  const missing = ALL_CATEGORIES.filter((c) => !completed.has(c))
  const startedAt = new Date().toISOString()
  for (const c of missing) {
    const synth: AuditResult = {
      category: c,
      url: args.requestedUrl,
      requestedUrl: args.requestedUrl,
      startedAt,
      durationMs: 0,
      packageName: `@repo/audit-${c}`,
      packageVersion: "0.0.0",
      status: "failed",
      error: { code: "UNKNOWN", message: args.errorMessage, retryable: false },
    }
    try {
      await args.insertAuditResult(synth, args.runId, args.ownerId)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === "23505") {
        // Row was inserted by a concurrent path (processRun managed to write
        // this category before crashing). Benign — keep going.
        continue
      }
      throw err
    }
  }
  await args.markAuditRunFailed(args.runId)
  await args.queue.ack(args.msgId)
  args.logger({
    kind: "progress",
    message: `run ${args.runId} marked failed after crash: ${args.errorMessage}`,
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --filter @repo/runner test test/crash-handlers.test.ts`

Expected: PASS, 9 tests (4 for `installCrashHandlers` + 5 for `markRunCrashed`).

- [ ] **Step 5: Run the full runner test suite + typecheck**

Run: `bun --filter @repo/runner test && bun --filter @repo/runner build && bun turbo check-types`

Expected: all green. The existing `push.test.ts` should still pass; the daemon code compiles even though nothing calls the new helpers yet.

- [ ] **Step 6: Commit**

```bash
git add apps/runner/src/daemon.ts apps/runner/test/crash-handlers.test.ts
git commit -m "feat(runner): add installCrashHandlers + markRunCrashed helpers"
```

---

### Task 3: Wire the helpers into the daemon

Activates the helpers. After this commit, the daemon survives Lighthouse async crashes and marks runs failed instead of leaving them in `running`.

**Files:**
- Modify: `apps/runner/src/daemon.ts` (call `installCrashHandlers` + rewire the catch block)
- Create: `apps/runner/test/daemon-crash-recovery.test.ts`

**Design note for the test:** `processRun` (in `packages/runner-core/src/process-run.ts`) catches `aggregate` errors internally — it writes synthetic failures via `insertAuditResult` and returns `{ status: "failed", reason: "aggregate_failed" }` rather than re-throwing. That means mocking `aggregate` to throw does NOT trigger the daemon's catch block — the daemon sees a normal `result.status === "failed"` return.

The daemon's catch block fires when `processRun` itself re-throws. The reachable paths are:
- `dbApi.getAuditRun` throws (network blip mid-run)
- `dbApi.markAuditRunRunning` throws
- `dbApi.insertAuditResult` throws inside the result-loop or inside processRun's own aggregate-failure synthetic-write loop
- `dbApi.getCompletedCategoriesForRun` throws

So the test mocks `markAuditRunRunning` to throw — clean reproduction of "daemon catch fires."

The other half — surviving async unhandled rejections — is tested at the unit level in Task 2's `installCrashHandlers` tests (where we directly `process.emit("unhandledRejection", ...)` and assert the handler logged without exiting). Adding a full daemon-integration test for it would duplicate that coverage.

- [ ] **Step 1: Write the failing test**

Create `apps/runner/test/daemon-crash-recovery.test.ts`:

```ts
import type { AuditResult, Category, LogEvent } from "@repo/audit-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const aggregateMock = vi.fn(async () => [] as AuditResult[])
const insertAuditResultMock = vi.fn(async () => "row-id")
const markAuditRunFailedMock = vi.fn(async () => 1)
const markAuditRunRunningMock = vi.fn(async () => 1)
const getCompletedCategoriesForRunMock = vi.fn(async () => new Set<Category>())
const getAuditRunMock = vi.fn(async (id: string) => ({
  id,
  siteId: "site-1",
  ownerId: "owner-1",
  status: "queued" as const,
  requestedUrl: "https://example.com/",
}))

vi.mock("@repo/audit-cli/lib", () => ({
  aggregate: (url: string, opts: unknown, packages: unknown) =>
    aggregateMock(url, opts, packages),
  defaultPackages: {},
}))

vi.mock("@repo/db", () => ({
  createDbClient: () => ({}),
  getAuditRun: (_db: unknown, id: string) => getAuditRunMock(id),
  getCompletedCategoriesForRun: (_db: unknown, id: string) =>
    getCompletedCategoriesForRunMock(id),
  insertAuditResult: (_db: unknown, r: AuditResult, runId: string, ownerId: string) =>
    insertAuditResultMock(r, runId, ownerId),
  markAuditRunFailed: (_db: unknown, id: string) => markAuditRunFailedMock(id),
  markAuditRunRunning: (_db: unknown, id: string) => markAuditRunRunningMock(id),
  schema: {
    pushSubscriptions: {
      endpoint: {} as never,
      p256dh: {} as never,
      auth: {} as never,
      ownerId: {} as never,
    },
  },
}))

const queueReadMock = vi.fn()
const queueAckMock = vi.fn(async () => {})
const queueArchiveMock = vi.fn(async () => {})

vi.mock("@repo/runner-core", async () => {
  const actual = await vi.importActual<typeof import("@repo/runner-core")>(
    "@repo/runner-core"
  )
  return {
    ...actual,
    createQueueClient: () => ({
      read: (...args: unknown[]) => queueReadMock(...args),
      ack: (...args: unknown[]) => queueAckMock(...args),
      archive: (...args: unknown[]) => queueArchiveMock(...args),
    }),
    consoleLogger: (_e: LogEvent) => undefined,
    sleep: () => Promise.resolve(),
  }
})

const { runDaemon } = await import("../src/daemon")

const MSG = {
  msgId: 1,
  readCt: 1,
  body: {
    runId: "11111111-2222-3333-4444-555555555555",
    ownerId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    requestedUrl: "https://example.com/",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  getCompletedCategoriesForRunMock.mockResolvedValue(new Set())
  markAuditRunRunningMock.mockResolvedValue(1)
  getAuditRunMock.mockResolvedValue({
    id: MSG.body.runId,
    siteId: "site-1",
    ownerId: MSG.body.ownerId,
    status: "queued",
    requestedUrl: MSG.body.requestedUrl,
  })
})

afterEach(() => {
  vi.resetAllMocks()
})

async function runDaemonForOneMessage(): Promise<void> {
  // Feed exactly one message; subsequent reads trigger shutdown via SIGTERM.
  queueReadMock.mockResolvedValueOnce(MSG)
  queueReadMock.mockImplementation(async () => {
    process.emit("SIGTERM" as never)
    return undefined
  })
  await runDaemon({
    connectionString: "postgres://unused",
    pollIntervalMs: 0,
  })
}

describe("daemon crash recovery", () => {
  it("when processRun throws (markAuditRunRunning fails), daemon marks failed + acks + survives", async () => {
    markAuditRunRunningMock.mockRejectedValue(new Error("db unreachable"))
    await runDaemonForOneMessage()
    expect(markAuditRunFailedMock).toHaveBeenCalledWith(MSG.body.runId)
    expect(queueAckMock).toHaveBeenCalledWith(MSG.msgId)
    const failedRows = insertAuditResultMock.mock.calls.filter(
      ([r]) => (r as AuditResult).status === "failed"
    )
    // markAuditRunRunning fails BEFORE any categories run, so all 5 are missing.
    expect(failedRows.length).toBe(5)
  })

  it("when both markRunCrashed inserts AND ack succeed, message is removed", async () => {
    markAuditRunRunningMock.mockRejectedValue(new Error("db unreachable"))
    await runDaemonForOneMessage()
    expect(queueAckMock).toHaveBeenCalledWith(MSG.msgId)
    expect(queueArchiveMock).not.toHaveBeenCalled()
  })

  it("when markRunCrashed itself fails (insertAuditResult rejects with non-23505), message is NOT acked", async () => {
    markAuditRunRunningMock.mockRejectedValue(new Error("db unreachable"))
    insertAuditResultMock.mockRejectedValue(new Error("db still unreachable"))
    await runDaemonForOneMessage()
    expect(queueAckMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --filter @repo/runner test test/daemon-crash-recovery.test.ts`

Expected: FAIL — the test expects `markAuditRunFailed` to be called and the message to be acked, but the current daemon catch block just logs and leaves the message un-acked.

- [ ] **Step 3: Wire `installCrashHandlers` + change the daemon's catch block**

Edit `apps/runner/src/daemon.ts`. Add this import (alphabetical with existing imports — `markAuditRunFailed` slots in next to `markAuditRunRunning`):

```ts
import {
  createDbClient,
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  markAuditRunFailed,
  markAuditRunRunning,
  schema,
} from "@repo/db"
```

Inside `runDaemon`, install crash handlers immediately after the existing `logger`/`pollIntervalMs`/`visibilityTimeoutSec`/`shutdownGraceMs` setup block. So just after `const shutdownGraceMs = opts.shutdownGraceMs ?? 30_000` add:

```ts
  const uninstallCrashHandlers = installCrashHandlers(logger)
```

Then add this immediately AFTER the existing `logger({ kind: "progress", message: "daemon exited cleanly" })` line (very end of the function), so handlers are removed on graceful shutdown:

```ts
  uninstallCrashHandlers()
```

Now replace the daemon's catch block. The current code is at lines 180-188:

```ts
    } catch (err) {
      logger({
        kind: "warn",
        message: `processRun threw, leaving message for retry: ${(err as Error).message}`,
      })
      // No ack — pgmq returns the message after visibility timeout
    } finally {
      currentAbort = undefined
    }
```

Replace the catch body (keep the `finally`):

```ts
    } catch (err) {
      const errorMessage = (err as Error).message
      logger({
        kind: "warn",
        message: `processRun threw, marking run failed: ${errorMessage}`,
      })
      try {
        await markRunCrashed({
          db,
          queue,
          msgId: msg.msgId,
          runId: msg.body.runId,
          ownerId: msg.body.ownerId,
          requestedUrl: msg.body.requestedUrl,
          errorMessage,
          logger,
          getCompletedCategoriesForRun: (id) => getCompletedCategoriesForRun(db, id),
          insertAuditResult: (r, runId, ownerId) =>
            insertAuditResult(db, r, runId, ownerId),
          markAuditRunFailed: (id) => markAuditRunFailed(db, id),
        })
      } catch (crashErr) {
        logger({
          kind: "warn",
          message: `markRunCrashed failed, leaving msg for pgmq retry: ${(crashErr as Error).message}`,
        })
        // No ack — pgmq returns the message after visibility timeout
      }
    } finally {
      currentAbort = undefined
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --filter @repo/runner test test/daemon-crash-recovery.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full runner + workspace gate**

Run: `bun --filter @repo/runner test && bun --filter @repo/runner build && bun turbo check-types && bun --filter @repo/db test`

Expected: all green.

- [ ] **Step 6: Live smoke test** (non-gating)

Manual verification that the daemon survives a real crash:

```bash
# Kill any existing runner
pkill -f "apps/runner/dist/index.js" 2>/dev/null

# Start fresh runner
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  /opt/homebrew/bin/node /Users/jonasbroms/Sites/seo/apps/runner/dist/index.js start &
RUNNER_PID=$!

# Enqueue an audit that historically crashes Lighthouse on Node 26
# (use any site that previously hit the "Page.enable" error)
# Then watch:
ps -p $RUNNER_PID && echo "runner still alive ✓"
```

Expected: after a crash, `ps` still shows the runner running, and the dashboard shows the run as "failed" with the Lighthouse error message in each category card.

This is non-gating — Lighthouse crashes are flaky and may not reproduce on demand. If the smoke check succeeds, great; if not, the unit + integration tests are still authoritative.

- [ ] **Step 7: Commit**

```bash
git add apps/runner/src/daemon.ts apps/runner/test/daemon-crash-recovery.test.ts
git commit -m "feat(runner): survive Lighthouse async crashes via process handlers"
```
