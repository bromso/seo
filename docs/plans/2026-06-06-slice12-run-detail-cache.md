# Slice 12 — Per-Run IDB Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each visited `/dashboard/runs/[runId]` snapshot in a new IndexedDB store keyed by `runId` so previously-loaded run pages survive offline reloads. A per-owner LRU cap of 20 prevents bloat. Sign-out clears the user's snapshots; cross-user GC sweeps lingering entries from other owners.

**Architecture:** IDB schema bumps `DB_VERSION` 2 → 3 with an additive migration that adds `audit_run_snapshots` (keyPath `runId`). A new pure module `run-snapshot.ts` exposes CRUD + `applyEventToRunSnapshot` (exported for tests; not consumed by the hook) + `sweepRunSnapshotsLRU`. The new client hook `useRunDetailCache(ownerId, runId, live)` is write-only: it returns `live` unchanged and persists each change to IDB debounced 500ms, then runs the LRU sweep. `RunDetailView` wraps `useRealtimeRun`'s output through it (one-line change). Slice 10's `sweepOtherOwners` and `SignOutButton` learn about the new store.

**Tech Stack:** IndexedDB (native), `fake-indexeddb` (already installed), `@testing-library/react` (already installed), happy-dom (existing Vitest env), TypeScript 5.x.

**Spec:** [`docs/plans/2026-06-06-slice12-run-detail-cache-design.md`](2026-06-06-slice12-run-detail-cache-design.md)

---

## Conventions used throughout

- Working branch: `feat/run-detail-cache-slice12` (already created off `main`; spec committed at `3ef8a2d`).
- Conventional commits: `feat(app):` / `test(app):` / `docs(app):`.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 11's 143 tests must keep passing after every task.
- Tests live at `apps/app/src/test/`.
- Use `bun --filter @repo/app <script>` for per-package scripts.
- `txStore` + `awaitRequest` from `apps/app/src/lib/offline/_idb.ts` (slice 10) are reused everywhere.
- No new dependencies.

---

## Task 1: DB V2→V3 migration (add `audit_run_snapshots` store)

**Files:**
- Modify: `apps/app/src/lib/offline/db.ts`
- Modify: `apps/app/src/test/offline/db.test.ts`

### Step 1: Append migration test to `db.test.ts`

At the END of the file, after the existing `describe("openOfflineDB — V1→V2 migration", …)` block, append:

```ts
import { enqueueAuditRun } from "@/lib/offline/audit-queue"

describe("openOfflineDB — V2→V3 migration", () => {
  it("opens version 3 and exposes audit_run_snapshots store", async () => {
    const db = await openOfflineDB()
    expect(db.version).toBe(3)
    expect(db.objectStoreNames.contains(STORE_DASHBOARD)).toBe(true)
    expect(db.objectStoreNames.contains("audit_run_queue")).toBe(true)
    expect(db.objectStoreNames.contains("audit_run_snapshots")).toBe(true)
  })

  it("preserves existing dashboard_snapshots + audit_run_queue data when migrating from V2", async () => {
    // Open at V2 manually, seed both stores, close.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("seo-app-cache", 2)
      req.onupgradeneeded = (event) => {
        const v = req.result
        if (event.oldVersion < 1 && !v.objectStoreNames.contains("dashboard_snapshots")) {
          v.createObjectStore("dashboard_snapshots", { keyPath: "ownerId" })
        }
        if (event.oldVersion < 2 && !v.objectStoreNames.contains("audit_run_queue")) {
          v.createObjectStore("audit_run_queue", { keyPath: "id" })
        }
      }
      req.onsuccess = () => {
        const v = req.result
        const tx = v.transaction(["dashboard_snapshots", "audit_run_queue"], "readwrite")
        const snap: DashboardSnapshot = {
          ownerId: "owner-x",
          updatedAt: 1,
          sites: [],
          latestScores: [],
          trends: [],
        }
        tx.objectStore("dashboard_snapshots").put(snap)
        tx.objectStore("audit_run_queue").put({
          id: "qid-1",
          ownerId: "owner-x",
          siteId: "s",
          requestedUrl: "https://example.com",
          queuedAt: 1,
        })
        tx.oncomplete = () => {
          v.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    _resetOfflineDBCache()
    const db = await openOfflineDB()
    expect(db.version).toBe(3)
    const got = await readSnapshot(db, "owner-x")
    expect(got?.ownerId).toBe("owner-x")
    // Audit queue entry still readable via the slice-8 helper:
    const db2 = await openOfflineDB()
    const queueEntries = await new Promise<unknown[]>((res, rej) => {
      const req = db2.transaction("audit_run_queue", "readonly").objectStore("audit_run_queue").getAll()
      req.onsuccess = () => res(req.result as unknown[])
      req.onerror = () => rej(req.error)
    })
    expect(queueEntries).toHaveLength(1)
    expect(db.objectStoreNames.contains("audit_run_snapshots")).toBe(true)

    // Sanity: writing to the new store works.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("audit_run_snapshots", "readwrite")
      tx.objectStore("audit_run_snapshots").put({
        runId: "run-x",
        ownerId: "owner-x",
        updatedAt: 1,
        run: { id: "run-x" },
        results: [],
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    // Touch enqueueAuditRun to avoid an unused-import lint flag.
    void enqueueAuditRun
  })
})
```

The new tests reuse the file's existing `_resetOfflineDBCache`, `openOfflineDB`, `STORE_DASHBOARD`, `readSnapshot`, and `DashboardSnapshot` imports.

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 2 new failures (`db.version === 3` assertion fails because current code is at V2; second test fails on the same).

### Step 3: Modify `apps/app/src/lib/offline/db.ts`

Bump `DB_VERSION` to `3` and add the new store constant + migration guard. Full updated file:

```ts
export const DB_NAME = "seo-app-cache"
export const DB_VERSION = 3
export const STORE_DASHBOARD = "dashboard_snapshots"
export const STORE_AUDIT_QUEUE = "audit_run_queue"
export const STORE_RUN_SNAPSHOTS = "audit_run_snapshots"

let cachedDb: Promise<IDBDatabase> | null = null

export function openOfflineDB(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb
  cachedDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      if (event.oldVersion < 1 && !db.objectStoreNames.contains(STORE_DASHBOARD)) {
        db.createObjectStore(STORE_DASHBOARD, { keyPath: "ownerId" })
      }
      if (event.oldVersion < 2 && !db.objectStoreNames.contains(STORE_AUDIT_QUEUE)) {
        db.createObjectStore(STORE_AUDIT_QUEUE, { keyPath: "id" })
      }
      if (event.oldVersion < 3 && !db.objectStoreNames.contains(STORE_RUN_SNAPSHOTS)) {
        db.createObjectStore(STORE_RUN_SNAPSHOTS, { keyPath: "runId" })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  return cachedDb
}

/** Test-only: clear the cached promise so the next call re-opens fresh. */
export function _resetOfflineDBCache(): void {
  const prev = cachedDb
  cachedDb = null
  if (prev) {
    void prev.then((db) => db.close()).catch(() => {})
  }
}
```

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
```

Expected: 2 new tests pass + the existing V2 test in `db.test.ts` may need its `expect(db.version).toBe(2)` relaxed to `>=2` (slice 8's implementer already loosened that, per the slice-8 commit log). Verify by reading the file; if it still asserts strict equality, change it to:

```ts
expect(db.version).toBeGreaterThanOrEqual(2)
```

Total: **145 passing** (143 + 2).

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/db.ts apps/app/src/test/offline/db.test.ts
git commit -m "feat(app): bump offline DB to V3 with audit_run_snapshots store"
```

---

## Task 2: `run-snapshot.ts` — type + CRUD + apply + LRU sweep

**Files:**
- Create: `apps/app/src/lib/offline/run-snapshot.ts`
- Create: `apps/app/src/test/offline/run-snapshot.test.ts`

### Step 1: Failing tests

Create `apps/app/src/test/offline/run-snapshot.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import type { Envelope } from "@/lib/realtime/envelope"
import {
  applyEventToRunSnapshot,
  MAX_RUN_SNAPSHOTS_PER_OWNER,
  readRunSnapshot,
  type RunDetailSnapshot,
  sweepRunSnapshotsLRU,
  writeRunSnapshot,
} from "@/lib/offline/run-snapshot"

const OWNER_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const OWNER_B = "8b7c1a2f-3d4e-4f5a-9b6c-1d2e3f4a5b6c"
const RUN = "22222222-2222-4222-8222-222222222222"

const SAMPLE_RUN: AuditRunRow = {
  id: RUN,
  site_id: "11111111-1111-4111-8111-111111111111",
  owner_id: OWNER_A,
  status: "running",
  requested_url: "https://example.com",
  final_url: null,
  started_at: "2026-06-05T12:00:00Z",
  finished_at: null,
  triggered_by: "manual",
}

const SAMPLE_RESULT: AuditResultRow = {
  id: "33333333-3333-4333-8333-333333333333",
  run_id: RUN,
  owner_id: OWNER_A,
  category: "performance",
  status: "success",
  score: 87,
  issues: [],
  raw: {},
  partial_reasons: null,
  error_code: null,
  error_message: null,
  error_retryable: null,
  package_name: "@repo/audit-perf",
  package_version: "0.0.0",
  duration_ms: 1100,
  started_at: "2026-06-05T12:00:01Z",
}

const SAMPLE_SNAPSHOT: RunDetailSnapshot = {
  runId: RUN,
  ownerId: OWNER_A,
  updatedAt: 1_700_000_000_000,
  run: SAMPLE_RUN,
  results: [SAMPLE_RESULT],
}

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

describe("run-snapshot CRUD", () => {
  it("round-trips a snapshot through writeRunSnapshot + readRunSnapshot", async () => {
    const db = await openOfflineDB()
    await writeRunSnapshot(db, SAMPLE_SNAPSHOT)
    const got = await readRunSnapshot(db, RUN)
    expect(got).toEqual(SAMPLE_SNAPSHOT)
  })

  it("readRunSnapshot returns null for an unknown runId", async () => {
    const db = await openOfflineDB()
    const got = await readRunSnapshot(db, RUN)
    expect(got).toBeNull()
  })
})

describe("applyEventToRunSnapshot", () => {
  it("updates run on a matching audit_runs UPDATE", () => {
    const env: Envelope = {
      table: "audit_runs",
      event: "UPDATE",
      row: { ...SAMPLE_RUN, status: "completed", finished_at: "2026-06-05T12:00:30Z" },
    }
    const next = applyEventToRunSnapshot(SAMPLE_SNAPSHOT, { kind: "event", envelope: env })
    expect(next.run.status).toBe("completed")
    expect(next.run.finished_at).toBe("2026-06-05T12:00:30Z")
  })

  it("appends a matching audit_results INSERT", () => {
    const newResult: AuditResultRow = {
      ...SAMPLE_RESULT,
      id: "44444444-4444-4444-8444-444444444444",
      category: "seo",
      score: 92,
    }
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: newResult,
    }
    const next = applyEventToRunSnapshot(SAMPLE_SNAPSHOT, { kind: "event", envelope: env })
    expect(next.results).toHaveLength(2)
    expect(next.results[1]?.category).toBe("seo")
  })

  it("dedups an audit_results event whose id is already present", () => {
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: SAMPLE_RESULT,
    }
    const next = applyEventToRunSnapshot(SAMPLE_SNAPSHOT, { kind: "event", envelope: env })
    expect(next).toBe(SAMPLE_SNAPSHOT)
  })
})

describe("sweepRunSnapshotsLRU", () => {
  it("keeps the 20 most-recent per owner; leaves other-owner data", async () => {
    const db = await openOfflineDB()
    // Seed 22 snapshots for OWNER_A (updatedAt = 1..22) + 3 for OWNER_B.
    for (let i = 1; i <= 22; i++) {
      await writeRunSnapshot(db, {
        runId: `run-a-${i}`,
        ownerId: OWNER_A,
        updatedAt: i,
        run: { ...SAMPLE_RUN, id: `run-a-${i}` },
        results: [],
      })
    }
    for (let i = 1; i <= 3; i++) {
      await writeRunSnapshot(db, {
        runId: `run-b-${i}`,
        ownerId: OWNER_B,
        updatedAt: 100 + i,
        run: { ...SAMPLE_RUN, id: `run-b-${i}`, owner_id: OWNER_B },
        results: [],
      })
    }
    await sweepRunSnapshotsLRU(db, OWNER_A)
    // OWNER_A should have exactly MAX (20) entries: ones with updatedAt = 3..22.
    expect(await readRunSnapshot(db, "run-a-1")).toBeNull()
    expect(await readRunSnapshot(db, "run-a-2")).toBeNull()
    expect(await readRunSnapshot(db, "run-a-3")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-a-22")).not.toBeNull()
    // OWNER_B's 3 entries untouched.
    expect(await readRunSnapshot(db, "run-b-1")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-b-2")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-b-3")).not.toBeNull()
    // Sanity on the cap value.
    expect(MAX_RUN_SNAPSHOTS_PER_OWNER).toBe(20)
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 6 new failures (module not found).

### Step 3: Implement `apps/app/src/lib/offline/run-snapshot.ts`

```ts
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import { STORE_RUN_SNAPSHOTS } from "@/lib/offline/db"
import type { FanOutSignal } from "@/lib/realtime/fan-out"

export type RunDetailSnapshot = {
  runId: string
  ownerId: string
  updatedAt: number
  run: AuditRunRow
  results: AuditResultRow[]
}

export const MAX_RUN_SNAPSHOTS_PER_OWNER = 20

export async function readRunSnapshot(
  db: IDBDatabase,
  runId: string
): Promise<RunDetailSnapshot | null> {
  const got = await awaitRequest<RunDetailSnapshot | undefined>(
    txStore(db, STORE_RUN_SNAPSHOTS, "readonly").get(runId)
  )
  return got ?? null
}

export async function writeRunSnapshot(
  db: IDBDatabase,
  snap: RunDetailSnapshot
): Promise<void> {
  await awaitRequest(txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").put(snap))
}

export async function clearRunSnapshotsForOwner(
  db: IDBDatabase,
  ownerId: string
): Promise<void> {
  const all = await awaitRequest<RunDetailSnapshot[]>(
    txStore(db, STORE_RUN_SNAPSHOTS, "readonly").getAll()
  )
  for (const snap of all) {
    if (snap.ownerId === ownerId) {
      await awaitRequest(
        txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").delete(snap.runId)
      )
    }
  }
}

export function applyEventToRunSnapshot(
  prev: RunDetailSnapshot,
  signal: FanOutSignal
): RunDetailSnapshot {
  if (signal.kind === "resync") return prev
  const env = signal.envelope

  if (env.table === "audit_runs") {
    if (env.event !== "UPDATE") return prev
    if (env.row.id !== prev.runId) return prev
    return { ...prev, run: env.row, updatedAt: Date.now() }
  }

  if (env.table === "audit_results") {
    if (env.row.run_id !== prev.runId) return prev
    const already = prev.results.some((r) => r.id === env.row.id)
    if (already) return prev
    return {
      ...prev,
      results: [...prev.results, env.row],
      updatedAt: Date.now(),
    }
  }

  return prev
}

export async function sweepRunSnapshotsLRU(
  db: IDBDatabase,
  ownerId: string
): Promise<void> {
  const all = await awaitRequest<RunDetailSnapshot[]>(
    txStore(db, STORE_RUN_SNAPSHOTS, "readonly").getAll()
  )
  const owned = all.filter((s) => s.ownerId === ownerId)
  if (owned.length <= MAX_RUN_SNAPSHOTS_PER_OWNER) return
  const sorted = [...owned].sort((a, b) => b.updatedAt - a.updatedAt)
  const toDelete = sorted.slice(MAX_RUN_SNAPSHOTS_PER_OWNER)
  for (const snap of toDelete) {
    await awaitRequest(
      txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").delete(snap.runId)
    )
  }
}
```

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: 6 new tests pass → **151 total** (145 + 6).

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/run-snapshot.ts apps/app/src/test/offline/run-snapshot.test.ts
git commit -m "feat(app): add RunDetailSnapshot CRUD + applyEvent + LRU sweep"
```

---

## Task 3: `useRunDetailCache` hook + 2 tests

**Files:**
- Create: `apps/app/src/lib/offline/use-run-detail-cache.ts`
- Create: `apps/app/src/test/offline/use-run-detail-cache.test.ts`

### Step 1: Failing tests

Create `apps/app/src/test/offline/use-run-detail-cache.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { readRunSnapshot } from "@/lib/offline/run-snapshot"
import { useRunDetailCache } from "@/lib/offline/use-run-detail-cache"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const RUN = "22222222-2222-4222-8222-222222222222"

const RUN_ROW: AuditRunRow = {
  id: RUN,
  site_id: "11111111-1111-4111-8111-111111111111",
  owner_id: OWNER,
  status: "running",
  requested_url: "https://example.com",
  final_url: null,
  started_at: "2026-06-05T12:00:00Z",
  finished_at: null,
  triggered_by: "manual",
}

const RESULTS: AuditResultRow[] = []

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

describe("useRunDetailCache", () => {
  it("returns the live prop synchronously on first render (passthrough)", () => {
    const live = { run: RUN_ROW, results: RESULTS }
    const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))
    expect(result.current).toBe(live)
  })

  it("writes the live snapshot to IDB after the debounce window", async () => {
    const live = { run: RUN_ROW, results: RESULTS }
    renderHook(() => useRunDetailCache(OWNER, RUN, live))
    await waitFor(
      async () => {
        const db = await openOfflineDB()
        const got = await readRunSnapshot(db, RUN)
        expect(got?.runId).toBe(RUN)
        expect(got?.ownerId).toBe(OWNER)
        expect(got?.run).toEqual(RUN_ROW)
      },
      { timeout: 2000 }
    )
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 2 new failures (module not found).

### Step 3: Implement `apps/app/src/lib/offline/use-run-detail-cache.ts`

```ts
"use client"
import { useEffect, useMemo } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { openOfflineDB } from "@/lib/offline/db"
import { sweepRunSnapshotsLRU, writeRunSnapshot } from "@/lib/offline/run-snapshot"

type State = { run: AuditRunRow; results: AuditResultRow[] }

function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }
}

export function useRunDetailCache(
  ownerId: string,
  runId: string,
  live: State
): State {
  const writeDebounced = useMemo(
    () =>
      debounce(async (snap: State) => {
        try {
          const db = await openOfflineDB()
          await writeRunSnapshot(db, {
            runId,
            ownerId,
            updatedAt: Date.now(),
            run: snap.run,
            results: snap.results,
          })
          await sweepRunSnapshotsLRU(db, ownerId)
        } catch {
          // IDB unavailable / quota — silent degrade
        }
      }, 500),
    [ownerId, runId]
  )

  useEffect(() => {
    writeDebounced(live)
  }, [live, writeDebounced])

  return live
}
```

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: 2 new tests pass → **153 total** (151 + 2).

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/use-run-detail-cache.ts apps/app/src/test/offline/use-run-detail-cache.test.ts
git commit -m "feat(app): add useRunDetailCache hook (write-only IDB persist)"
```

---

## Task 4: Wire `useRunDetailCache` into `RunDetailView`

**Files:**
- Modify: `apps/app/src/views/run-detail-view.tsx`

### Step 1: Read current `run-detail-view.tsx`

```bash
cat apps/app/src/views/run-detail-view.tsx
```

Confirm the existing line:

```tsx
const { run, results } = useRealtimeRun(
  initialRun.owner_id,
  initialRun.id,
  initialRun,
  initialResults
)
```

### Step 2: Add import + wrap

At the top of the file (after the existing imports), add:

```tsx
import { useRunDetailCache } from "@/lib/offline/use-run-detail-cache"
```

Replace the `useRealtimeRun` block with:

```tsx
const live = useRealtimeRun(
  initialRun.owner_id,
  initialRun.id,
  initialRun,
  initialResults
)
const { run, results } = useRunDetailCache(initialRun.owner_id, initialRun.id, live)
```

The view's downstream usage of `run` and `results` doesn't change.

### Step 3: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. Test count stays at **153** (no new tests; this task wires existing pieces).

### Step 4: Commit

```bash
git add apps/app/src/views/run-detail-view.tsx
git commit -m "feat(app): wire RunDetailView through useRunDetailCache"
```

---

## Task 5: Extend `sweepOtherOwners` + add `clearAuditRunSnapshots` + barrel

**Files:**
- Modify: `apps/app/src/lib/offline/clear-cache.ts`
- Modify: `apps/app/src/lib/offline/index.ts`
- Modify: `apps/app/src/test/offline/clear-cache.test.ts`

### Step 1: Failing tests — append to `clear-cache.test.ts`

At the END of the file, after the existing `describe("sweepOtherOwners", …)` block, append:

```ts
import { clearAuditRunSnapshots } from "@/lib/offline/clear-cache"
import { readRunSnapshot, writeRunSnapshot } from "@/lib/offline/run-snapshot"

describe("sweepOtherOwners — run snapshots", () => {
  it("also deletes other-owner run snapshots", async () => {
    const db = await openOfflineDB()
    await writeRunSnapshot(db, {
      runId: "run-a-1",
      ownerId: OWNER_A,
      updatedAt: 1,
      run: { id: "run-a-1", site_id: "s", owner_id: OWNER_A, status: "running", requested_url: "u", final_url: null, started_at: "t", finished_at: null, triggered_by: "manual" },
      results: [],
    })
    await writeRunSnapshot(db, {
      runId: "run-b-1",
      ownerId: OWNER_B,
      updatedAt: 1,
      run: { id: "run-b-1", site_id: "s", owner_id: OWNER_B, status: "running", requested_url: "u", final_url: null, started_at: "t", finished_at: null, triggered_by: "manual" },
      results: [],
    })
    await sweepOtherOwners(db, OWNER_A)
    expect(await readRunSnapshot(db, "run-a-1")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-b-1")).toBeNull()
  })
})

describe("clearAuditRunSnapshots", () => {
  it("removes only the current owner's run snapshots", async () => {
    const db = await openOfflineDB()
    await writeRunSnapshot(db, {
      runId: "run-a-1",
      ownerId: OWNER_A,
      updatedAt: 1,
      run: { id: "run-a-1", site_id: "s", owner_id: OWNER_A, status: "running", requested_url: "u", final_url: null, started_at: "t", finished_at: null, triggered_by: "manual" },
      results: [],
    })
    await writeRunSnapshot(db, {
      runId: "run-b-1",
      ownerId: OWNER_B,
      updatedAt: 1,
      run: { id: "run-b-1", site_id: "s", owner_id: OWNER_B, status: "running", requested_url: "u", final_url: null, started_at: "t", finished_at: null, triggered_by: "manual" },
      results: [],
    })
    await clearAuditRunSnapshots(OWNER_A)
    expect(await readRunSnapshot(db, "run-a-1")).toBeNull()
    expect(await readRunSnapshot(db, "run-b-1")).not.toBeNull()
  })

  it("is a no-op when no snapshots exist for the owner", async () => {
    await expect(clearAuditRunSnapshots(OWNER_A)).resolves.toBeUndefined()
  })
})
```

The file's existing `beforeEach` clears IDB; `OWNER_A` and `OWNER_B` constants are reused from the slice-10 tests already in the file.

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 3 new failures (`clearAuditRunSnapshots` not exported; `sweepOtherOwners` doesn't touch the new store yet).

### Step 3: Modify `apps/app/src/lib/offline/clear-cache.ts`

Add the third sweep pass to `sweepOtherOwners` and the new `clearAuditRunSnapshots` function. Full updated file:

```ts
import type { QueuedAuditRun } from "@/lib/offline/audit-queue"
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import {
  openOfflineDB,
  STORE_AUDIT_QUEUE,
  STORE_DASHBOARD,
  STORE_RUN_SNAPSHOTS,
} from "@/lib/offline/db"
import {
  clearRunSnapshotsForOwner,
  type RunDetailSnapshot,
} from "@/lib/offline/run-snapshot"
import { type DashboardSnapshot, clearSnapshot } from "@/lib/offline/snapshot"

export async function clearDashboardCache(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    await clearSnapshot(db, ownerId)
  } catch {
    // IDB unavailable — best-effort cleanup, do not block sign-out
  }
}

export async function clearAuditRunSnapshots(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    await clearRunSnapshotsForOwner(db, ownerId)
  } catch {
    // best-effort cleanup
  }
}

export async function sweepOtherOwners(
  db: IDBDatabase,
  currentOwnerId: string
): Promise<void> {
  try {
    const snaps = await awaitRequest<DashboardSnapshot[]>(
      txStore(db, STORE_DASHBOARD, "readonly").getAll()
    )
    for (const s of snaps) {
      if (s.ownerId !== currentOwnerId) {
        await awaitRequest(
          txStore(db, STORE_DASHBOARD, "readwrite").delete(s.ownerId)
        )
      }
    }
    const entries = await awaitRequest<QueuedAuditRun[]>(
      txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll()
    )
    for (const e of entries) {
      if (e.ownerId !== currentOwnerId) {
        await awaitRequest(
          txStore(db, STORE_AUDIT_QUEUE, "readwrite").delete(e.id)
        )
      }
    }
    const runSnaps = await awaitRequest<RunDetailSnapshot[]>(
      txStore(db, STORE_RUN_SNAPSHOTS, "readonly").getAll()
    )
    for (const r of runSnaps) {
      if (r.ownerId !== currentOwnerId) {
        await awaitRequest(
          txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").delete(r.runId)
        )
      }
    }
  } catch {
    // best-effort GC; never block startup
  }
}
```

### Step 4: Update `apps/app/src/lib/offline/index.ts`

Add the new symbols. Replace the file content with:

```ts
export {
  clearAuditQueue,
  enqueueAuditRun,
  type QueuedAuditRun,
  readQueueForOwner,
  removeFromQueue,
} from "@/lib/offline/audit-queue"
export {
  clearAuditRunSnapshots,
  clearDashboardCache,
  sweepOtherOwners,
} from "@/lib/offline/clear-cache"
export {
  _resetOfflineDBCache,
  DB_NAME,
  DB_VERSION,
  openOfflineDB,
  STORE_AUDIT_QUEUE,
  STORE_DASHBOARD,
  STORE_RUN_SNAPSHOTS,
} from "@/lib/offline/db"
export {
  applyEventToRunSnapshot,
  clearRunSnapshotsForOwner,
  MAX_RUN_SNAPSHOTS_PER_OWNER,
  readRunSnapshot,
  type RunDetailSnapshot,
  sweepRunSnapshotsLRU,
  writeRunSnapshot,
} from "@/lib/offline/run-snapshot"
export {
  applyEventToSnapshot,
  clearSnapshot,
  type DashboardSnapshot,
  readSnapshot,
  writeSnapshot,
} from "@/lib/offline/snapshot"
export { useAuditQueueReplay } from "@/lib/offline/use-audit-queue-replay"
export { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
export {
  type QueueAuditInput,
  type QueueAuditResult,
  useQueueAudit,
} from "@/lib/offline/use-queue-audit"
export { useRunDetailCache } from "@/lib/offline/use-run-detail-cache"
```

### Step 5: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Expected: 3 new tests pass + all existing tests still pass → **156 total** (153 + 3).

### Step 6: Commit

```bash
git add apps/app/src/lib/offline/clear-cache.ts apps/app/src/lib/offline/index.ts apps/app/src/test/offline/clear-cache.test.ts
git commit -m "feat(app): cross-user GC + per-owner clear for run snapshots"
```

---

## Task 6: Sign-out wiring + README smoke + final DoD

**Files:**
- Modify: `apps/app/src/components/sign-out-button.tsx`
- Modify: `apps/app/README.md` (append steps 42-44)

### Step 1: Update `apps/app/src/components/sign-out-button.tsx`

Find the existing `Promise.all` inside the form's `onSubmit`. Add `clearAuditRunSnapshots(ownerId)` to the array. Full updated file:

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import { useTransition } from "react"
import { clearAuditQueue } from "@/lib/offline/audit-queue"
import { clearAuditRunSnapshots, clearDashboardCache } from "@/lib/offline/clear-cache"

export function SignOutButton({ ownerId }: { ownerId: string }) {
  const [pending, start] = useTransition()
  return (
    <form
      action="/sign-out"
      method="POST"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        start(async () => {
          await Promise.all([
            clearDashboardCache(ownerId),
            clearAuditQueue(ownerId),
            clearAuditRunSnapshots(ownerId),
          ])
          form.submit()
        })
      }}
    >
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </form>
  )
}
```

### Step 2: Append smoke steps to `apps/app/README.md`

Find the "Manual smoke checklist" section (ending at slice 11's step 41). Add after step 41:

```
42. Online: open /dashboard/runs/<runId> for a recently-completed run. DevTools
    → Application → IndexedDB → seo-app-cache → audit_run_snapshots. Within
    ~1s of the page mounting (debounce window) a new entry appears keyed by
    the runId. Snapshot shape: { runId, ownerId, updatedAt, run, results }.
43. Visit 22 distinct run pages over a session. audit_run_snapshots stays at
    exactly 20 entries (LRU cap). The two oldest by updatedAt are evicted as
    later writes happen.
44. Sign in as user A, visit some runs, sign out. Sign in as user B → user
    A's snapshots are NOT visible (sweepOtherOwners runs on dashboard mount).
    Open one of user B's run pages; user B's audit_run_snapshots entry appears.
```

### Step 3: Full DoD sweep

```bash
# 1. Tests
bun --filter @repo/app test
# Expected: ~156 passing

# 2. Typecheck
bun --filter @repo/app check-types

# 3. Build
bun --filter @repo/app build

# 4. Lint
bun --filter @repo/app lint
```

All clean. Any warnings are pre-existing.

### Step 4: Final commit

```bash
git add apps/app/src/components/sign-out-button.tsx apps/app/README.md
git commit -m "feat(app): clear run snapshots on sign-out + slice 12 smoke checklist"
```

---

## Report Format

(For the implementer to fill in after T6.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (~156 tests) | … |
  | 4 | V2→V3 migration preserves prior data | ✓ via T1 test |
  | 5 | Run page persists snapshot to IDB | ✓ via T3 test |
  | 6 | LRU cap kicks in at 20 per owner | ✓ via T2 test |
  | 7 | Sign-out clears the user's run snapshots | Deferred to user verification |
  | 8 | Cross-user GC clears prior user's snapshots on sign-in | Deferred to user verification |
- Total test count
- Commit SHA list (6 commits expected)
- Slice 12 release note (one line)
- Any carry-forwards for slice 13

---

## After slice 12

Slice 13 candidates:

- **SW Background Sync (Chromium)** — drain the audit queue without a tab open.
- **Push notifications** for run completion.
- **Online double-click race** — debounce or disabled-while-pending UX on Run buttons.
- **Minor cleanups**: hoist `z.uuid()` to module-level in `/api/audit-run`; extract `debounce` to `lib/offline/_debounce.ts` if a third consumer arrives; trim unused barrel re-exports.
- **IDB hydration** — actually use IDB to override stale RSC props on mount (slice 12 MVP skipped this).
