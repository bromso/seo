# Slice 18 — Per-Entry Queue TTL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop audit-queue entries older than 7 days during each replay so cross-owner stale entries (rejected by RLS during SW Background Sync) don't sit in IDB indefinitely, and so a 2-week-old "vacation" audit doesn't fire silently.

**Architecture:** A new pure helper `pruneExpiredEntries(db, now, ttlMs)` walks the queue store, deletes entries where `now - entry.queuedAt > ttlMs`, and returns the count of dropped entries. `replayAuditQueueOnce` calls it once at the top — both the React hook path (`useAuditQueueReplay`) and the SW sync handler benefit transparently. The TTL value lives in `constants.ts` as `QUEUE_TTL_DAYS = 7`.

**Tech Stack:** Native IndexedDB via `@/lib/offline/audit-queue` + `@/lib/offline/_idb`, Vitest with happy-dom + `fake-indexeddb/auto`. No new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice18-queue-ttl-design.md`](2026-06-06-slice18-queue-ttl-design.md)

---

## Conventions used throughout

- Working branch: `feat/queue-ttl-slice18` (already created off `main`; spec committed at `d93d51b`).
- Conventional commits: `feat(app):` / `refactor(app):` / `test(app):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- Slice 17 left **174 tests**. Slice 18 adds **4 net new** (no deletions, no assertion adaptations) → final count **178**.
- Use `cd apps/app && bun run test` for per-file vitest filtering.

---

## File map

| Action | File | Slice-18 responsibility |
|---|---|---|
| Modify | `apps/app/src/lib/constants.ts` | Export `QUEUE_TTL_DAYS = 7` |
| Create | `apps/app/src/lib/offline/queue-ttl.ts` | `isQueueEntryExpired`, `pruneExpiredEntries`, `QUEUE_TTL_MS` |
| Create | `apps/app/src/test/offline/queue-ttl.test.ts` | 3 unit tests |
| Modify | `apps/app/src/lib/offline/replay-audit-queue.ts` | Call `pruneExpiredEntries(db, Date.now())` at the top |
| Modify | `apps/app/src/test/offline/replay-audit-queue.test.ts` | Refresh `entry()` helper's `queuedAt` + add 1 new test |
| Modify | `apps/app/src/test/offline/use-audit-queue-replay.test.ts` | Refresh `entry()` helper's `queuedAt` |

---

## Task 1: Add `QUEUE_TTL_DAYS` constant

**Files:**
- Modify: `apps/app/src/lib/constants.ts`

No new tests. The existing `constants.test.ts` imports `MAX_COMPETITORS`, `TRENDS_WINDOW_DAYS`, `CATEGORIES`; adding a new export doesn't break those assertions.

### Step 1: Read the current constants file

```bash
cat apps/app/src/lib/constants.ts
```

Confirm the file currently has three exports: `MAX_COMPETITORS`, `TRENDS_WINDOW_DAYS`, `CATEGORIES` + the `Category` type.

### Step 2: Add the new export

Edit `apps/app/src/lib/constants.ts` to add `QUEUE_TTL_DAYS = 7` as a new line after the existing constants. Full updated file:

```ts
export const MAX_COMPETITORS = 5
export const TRENDS_WINDOW_DAYS = 30
export const QUEUE_TTL_DAYS = 7
export const CATEGORIES = ["performance", "seo", "best-practices", "pwa", "on-page"] as const
export type Category = (typeof CATEGORIES)[number]
```

### Step 3: Run typecheck

```bash
bun --filter @repo/app check-types
```

Expected: clean (exit 0). The new export is a `number` literal; nothing else references it yet.

### Step 4: Commit

```bash
git add apps/app/src/lib/constants.ts
git commit -m "feat(app): add QUEUE_TTL_DAYS constant (7 days)"
```

---

## Task 2: Create `queue-ttl.ts` with `isQueueEntryExpired` + `pruneExpiredEntries`

**Files:**
- Create: `apps/app/src/lib/offline/queue-ttl.ts`
- Create: `apps/app/src/test/offline/queue-ttl.test.ts`

### Step 1: Write the three failing tests

Create `apps/app/src/test/offline/queue-ttl.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { enqueueAuditRun, readQueueForOwner } from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { isQueueEntryExpired, pruneExpiredEntries } from "@/lib/offline/queue-ttl"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const URL_X = "https://example.com"

beforeEach(async () => {
  _resetOfflineDBCache()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })
})

afterEach(() => {
  _resetOfflineDBCache()
})

describe("isQueueEntryExpired", () => {
  it("returns false when age < ttl", () => {
    const entry = {
      id: "x",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: URL_X,
      queuedAt: 1000,
    }
    expect(isQueueEntryExpired(entry, 5000, 10_000)).toBe(false)
  })

  it("returns true when age > ttl", () => {
    const entry = {
      id: "x",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: URL_X,
      queuedAt: 1000,
    }
    expect(isQueueEntryExpired(entry, 20_000, 10_000)).toBe(true)
  })
})

describe("pruneExpiredEntries", () => {
  it("deletes expired rows and leaves fresh rows; returns the count", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, {
      id: "fresh",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: URL_X,
      queuedAt: 9_000,
    })
    await enqueueAuditRun(db, {
      id: "stale",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: URL_X,
      queuedAt: 1,
    })

    const dropped = await pruneExpiredEntries(db, 10_000, 5_000)
    expect(dropped).toBe(1)

    const left = await readQueueForOwner(db, OWNER)
    expect(left.map((e) => e.id)).toEqual(["fresh"])
  })
})
```

### Step 2: Run — expect 3 FAIL

```bash
cd apps/app && bun run test src/test/offline/queue-ttl.test.ts
```

Expected: 3 FAIL — module not found (`Failed to resolve "@/lib/offline/queue-ttl"`).

### Step 3: Create `apps/app/src/lib/offline/queue-ttl.ts`

```ts
import { QUEUE_TTL_DAYS } from "@/lib/constants"
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import type { QueuedAuditRun } from "@/lib/offline/audit-queue"
import { STORE_AUDIT_QUEUE } from "@/lib/offline/db"

export const QUEUE_TTL_MS = QUEUE_TTL_DAYS * 24 * 60 * 60 * 1000

export function isQueueEntryExpired(
  entry: QueuedAuditRun,
  now: number,
  ttlMs: number = QUEUE_TTL_MS
): boolean {
  return now - entry.queuedAt > ttlMs
}

export async function pruneExpiredEntries(
  db: IDBDatabase,
  now: number,
  ttlMs: number = QUEUE_TTL_MS
): Promise<number> {
  const all = await awaitRequest<QueuedAuditRun[]>(
    txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll()
  )
  const expired = all.filter((e) => isQueueEntryExpired(e, now, ttlMs))
  for (const e of expired) {
    await awaitRequest(txStore(db, STORE_AUDIT_QUEUE, "readwrite").delete(e.id))
  }
  return expired.length
}
```

Three things:
1. `QUEUE_TTL_MS` derived from `QUEUE_TTL_DAYS` so callers don't repeat the conversion.
2. `isQueueEntryExpired` uses strict `>` so an entry with age exactly `ttlMs` is NOT expired — deterministic boundary for tests.
3. `pruneExpiredEntries` returns the count for callers that want to log/surface it; the slice-18 callers ignore it.

### Step 4: Run — expect 3 PASS

```bash
cd apps/app && bun run test src/test/offline/queue-ttl.test.ts
```

Expected: 3 PASS.

### Step 5: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **177 passing** (174 + 3), typecheck clean. No existing tests touched yet, so they remain green.

### Step 6: Commit

```bash
git add apps/app/src/lib/offline/queue-ttl.ts apps/app/src/test/offline/queue-ttl.test.ts
git commit -m "feat(app): add queue-ttl helpers (isQueueEntryExpired, pruneExpiredEntries)"
```

---

## Task 3: Refresh `queuedAt` in existing test helpers

**Files:**
- Modify: `apps/app/src/test/offline/replay-audit-queue.test.ts`
- Modify: `apps/app/src/test/offline/use-audit-queue-replay.test.ts`

This is preventive maintenance. Both files have a local `entry()` helper that returns `queuedAt: 1` (epoch millisecond 1, ≈ 56 years old). After T4 adds `pruneExpiredEntries` to `replayAuditQueueOnce`, those entries would be deleted before the replay loop sees them, and every existing test would fail.

We do this **before** T4 so that T4's new test is the only thing that goes red. The existing tests get a one-line maintenance edit in T3 and then stay green through T4.

### Step 1: Inspect both `entry()` helpers

```bash
grep -n "queuedAt: 1" apps/app/src/test/offline/replay-audit-queue.test.ts apps/app/src/test/offline/use-audit-queue-replay.test.ts
```

Expected output: both files show `queuedAt: 1` on a single line inside a function named `entry`.

### Step 2: Update `apps/app/src/test/offline/replay-audit-queue.test.ts`

Find the local `entry()` helper near the top of the file. Replace `queuedAt: 1,` with `queuedAt: Date.now(),`. No other changes.

Full updated helper for reference:

```ts
function entry(id: string, ownerId: string = OWNER): QueuedAuditRun {
  return {
    id,
    ownerId,
    siteId: SITE,
    requestedUrl: "https://example.com",
    queuedAt: Date.now(),
  }
}
```

### Step 3: Update `apps/app/src/test/offline/use-audit-queue-replay.test.ts`

Find the local `entry()` helper near the top of the file. Replace `queuedAt: 1,` with `queuedAt: Date.now(),`. No other changes.

Full updated helper for reference:

```ts
function entry(id: string): QueuedAuditRun {
  return {
    id,
    ownerId: OWNER,
    siteId: "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5",
    requestedUrl: "https://example.com",
    queuedAt: Date.now(),
  }
}
```

### Step 4: Run both files

```bash
cd apps/app && bun run test src/test/offline/replay-audit-queue.test.ts src/test/offline/use-audit-queue-replay.test.ts
```

Expected: all tests in both files PASS unchanged. The slice-17 replay function doesn't yet call `pruneExpiredEntries`, so the refresh is a no-op behavior-wise.

### Step 5: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **177 passing** (unchanged from T2). The refresh doesn't add or remove tests.

### Step 6: Verify no other `queuedAt: 1` lurks

```bash
grep -rn "queuedAt: 1" apps/app/src/test
```

Expected output: no matches. If any usage remains outside the `entry()` helper, update it the same way (`Date.now()`).

### Step 7: Commit

```bash
git add apps/app/src/test/offline/replay-audit-queue.test.ts apps/app/src/test/offline/use-audit-queue-replay.test.ts
git commit -m "test(app): refresh queuedAt in entry() helpers ahead of TTL prune"
```

---

## Task 4: Wire `pruneExpiredEntries` into `replayAuditQueueOnce`

**Files:**
- Modify: `apps/app/src/lib/offline/replay-audit-queue.ts`
- Modify: `apps/app/src/test/offline/replay-audit-queue.test.ts`

### Step 1: Add the new failing test

Append this `it()` block at the end of the existing `describe("replayAuditQueueOnce", () => { ... })` in `apps/app/src/test/offline/replay-audit-queue.test.ts`:

```ts
  it("prunes expired entries before POSTing", async () => {
    const db = await openOfflineDB()
    // Fresh entry — should be POSTed and removed.
    await enqueueAuditRun(db, {
      id: "fresh",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: "https://example.com",
      queuedAt: Date.now(),
    })
    // Stale entry — should be pruned and NOT POSTed.
    await enqueueAuditRun(db, {
      id: "stale",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: "https://example.com",
      queuedAt: 1,
    })

    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
    ) as unknown as typeof fetch

    const result = await replayAuditQueueOnce(db, fetcher, OWNER)

    // Only the fresh entry was POSTed.
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ successes: 1, failures: 0 })

    // Both are gone from IDB: fresh via removeFromQueue, stale via prune.
    expect(await readQueueForOwner(db, OWNER)).toEqual([])
  })
```

### Step 2: Run — expect 1 FAIL

```bash
cd apps/app && bun run test src/test/offline/replay-audit-queue.test.ts
```

Expected: existing 3 PASS + 1 FAIL on the new test. The failure: `expect(fetcher).toHaveBeenCalledTimes(1)` — actually called 2 times because the stale entry was POSTed too (current replay function has no prune).

### Step 3: Edit `apps/app/src/lib/offline/replay-audit-queue.ts`

Replace the entire file with the updated version:

```ts
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import { type QueuedAuditRun, readQueueForOwner, removeFromQueue } from "@/lib/offline/audit-queue"
import { STORE_AUDIT_QUEUE } from "@/lib/offline/db"
import { pruneExpiredEntries } from "@/lib/offline/queue-ttl"

export type ReplayResult = { successes: number; failures: number }

export async function replayAuditQueueOnce(
  db: IDBDatabase,
  fetcher: typeof fetch,
  ownerIdFilter?: string
): Promise<ReplayResult> {
  await pruneExpiredEntries(db, Date.now())

  const entries = ownerIdFilter
    ? await readQueueForOwner(db, ownerIdFilter)
    : await readAllQueueEntries(db)

  let successes = 0
  let failures = 0

  for (const entry of entries) {
    try {
      const res = await fetcher("/api/audit-run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": entry.id,
        },
        body: JSON.stringify({
          siteId: entry.siteId,
          requestedUrl: entry.requestedUrl,
        }),
      })
      if (!res.ok) {
        failures += 1
        continue
      }
      const body = (await res.json()) as { ok: true; runId: string } | { ok: false; error: string }
      if (!body.ok) {
        failures += 1
        continue
      }
      try {
        await removeFromQueue(db, entry.id)
      } catch {
        // leave in queue
      }
      successes += 1
    } catch {
      failures += 1
    }
  }

  return { successes, failures }
}

async function readAllQueueEntries(db: IDBDatabase): Promise<QueuedAuditRun[]> {
  return await awaitRequest<QueuedAuditRun[]>(txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll())
}
```

Two changes vs. the slice-17 version:
1. New import: `import { pruneExpiredEntries } from "@/lib/offline/queue-ttl"`.
2. New first line in the function body: `await pruneExpiredEntries(db, Date.now())`.

Everything else is identical to slice 17.

### Step 4: Run — expect 4 PASS in the replay file

```bash
cd apps/app && bun run test src/test/offline/replay-audit-queue.test.ts
```

Expected: 4 PASS (3 existing + 1 new). The slice-17 tests still pass because their `entry()` helper was refreshed in T3 — `queuedAt: Date.now()` keeps them well within the 7-day TTL.

### Step 5: Run the full suite + typecheck + build + lint

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
bun --filter @repo/app lint
```

Expected: **178 passing** (177 + 1), typecheck clean, build clean (the SW path that imports `replayAuditQueueOnce` will see the prune transparently), lint clean.

### Step 6: Commit

```bash
git add apps/app/src/lib/offline/replay-audit-queue.ts apps/app/src/test/offline/replay-audit-queue.test.ts
git commit -m "feat(app): prune expired queue entries before replay"
```

---

## Task 5: Final DoD sweep

**Files:** none.

### Step 1: Verify call-site integrity

```bash
grep -rn "pruneExpiredEntries\|isQueueEntryExpired\|QUEUE_TTL_DAYS\|QUEUE_TTL_MS" apps/app/src
```

Expected hits:
- `apps/app/src/lib/constants.ts` — `QUEUE_TTL_DAYS` export.
- `apps/app/src/lib/offline/queue-ttl.ts` — defines all four symbols, imports `QUEUE_TTL_DAYS`.
- `apps/app/src/lib/offline/replay-audit-queue.ts` — imports + calls `pruneExpiredEntries`.
- `apps/app/src/test/offline/queue-ttl.test.ts` — tests `isQueueEntryExpired` + `pruneExpiredEntries`.
- (No usage of `QUEUE_TTL_MS` outside `queue-ttl.ts` itself; it's the internal derivation.)

### Step 2: Confirm no `queuedAt: 1` regression

```bash
grep -rn "queuedAt: 1" apps/app/src
```

Expected: no matches anywhere in the codebase. (Production code never uses literal `1`; tests were all migrated in T3 + T4.)

### Step 3: Confirm final state

```bash
bun --filter @repo/app test
# Expected: 178 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean (SW build picks up the new prune transparently)

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)
```

### Step 4: No commit

T5 is verify-only. The branch should now contain:
- `d93d51b docs(app): slice 18 design — per-entry queue TTL` (pre-existing)
- 4 implementation commits from T1 / T2 / T3 / T4.

```bash
git log --oneline main..HEAD
```

---

## Report Format

(For the implementer to fill in after T5.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (178 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `QUEUE_TTL_DAYS = 7` exported | ✓ T1 |
  | 6 | `queue-ttl.ts` exports `isQueueEntryExpired`, `pruneExpiredEntries`, `QUEUE_TTL_MS` | ✓ T2 |
  | 7 | Existing `entry()` helpers use `queuedAt: Date.now()` | ✓ T3 |
  | 8 | `replayAuditQueueOnce` calls `pruneExpiredEntries(db, Date.now())` at the top | ✓ T4 |
  | 9 | No `queuedAt: 1` anywhere in the codebase | ✓ T5 |
- Total test count
- Commit SHA list (4 implementation commits expected)
- Slice 18 release note (one line)
- Any carry-forwards for slice 19

---

## After slice 18

Slice 19 candidates:

- **Whoami endpoint** for cleaner cross-owner SW filtering.
- **Push notifications** on run completion.
- **SW offline fallback page**.
- **Drop unused barrel re-exports.**
- **60s relative-time ticker** for OfflineBanner.
- **Surface the prune count in the toast** (only if a user complains about silent drops).
