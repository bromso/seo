# Slice 10 — Reliability Cleanup Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay down five accumulated carry-forwards from slices 7/8 without adding any new product surface: trend dedup + 30-day pruning, cross-user IDB GC, replay-toast aggregation, deletion of orphan `runAuditAction`, and unit coverage for `OfflineBanner` + `SignOutButton`.

**Architecture:** Each sub-item is a focused edit. Two infrastructure changes support the others — a small `_idb.ts` extraction (so `clear-cache.ts` can reuse the existing `txStore` + `awaitRequest` wrappers without copying them) and adding `@testing-library/user-event` as a devDep (so we can unit-test the form-submit flow in `SignOutButton`). Slice 9's 131 tests → slice 10's ~138 (net +7).

**Tech Stack:** Vitest with happy-dom, `fake-indexeddb` (already installed), `@testing-library/react` (already installed), `@testing-library/user-event` (newly added in T7), Biome via Husky.

**Spec:** [`docs/plans/2026-06-05-slice10-reliability-design.md`](2026-06-05-slice10-reliability-design.md)

---

## Conventions used throughout

- Working branch: `feat/reliability-slice10` (already created off `main`; spec committed at `3764695`).
- Conventional commits: `feat(app):` / `test(app):` / `chore(app):` / `chore(deps):` / `refactor(app):` / `docs(app):`.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 9's 131 tests must keep passing after every task (except T5 which intentionally deletes 4 tests, and T1/T3/T6/T7 which add new ones).
- Tests live at `apps/app/src/test/`.
- Use `bun --filter @repo/app <script>` for per-package scripts; `cd apps/app && bun add -D <pkg>` for installs.

---

## Task 1: Trend dedup + 30-day pruning in `applyEventToSnapshot`

**Files:**
- Modify: `apps/app/src/lib/offline/snapshot.ts`
- Modify: `apps/app/src/test/offline/snapshot.test.ts` (append 3 tests)

### Step 1: Failing tests — append to `snapshot.test.ts`

At the END of the existing `describe("applyEventToSnapshot", …)` block (or in a new sibling describe — either works), append three new `it` cases. The existing `SAMPLE` constant has one trend row at `2026-06-05T12:00:00Z` with `category: "performance"`. The new tests reuse `SAMPLE` and the `OWNER` constant already defined at the top of the file.

```ts
import type { ScoreTrendRow } from "@/lib/db-types"
// ^ if not already imported; place near the other type imports

describe("applyEventToSnapshot — trend dedup + pruning", () => {
  it("does not append a duplicate trend row (same site_id, category, measured_at)", () => {
    // SAMPLE.trends already contains performance @ 2026-06-05T12:00:00Z for SITE.
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "rid-dup",
        run_id: "22222222-2222-4222-8222-222222222222",
        owner_id: OWNER,
        category: "performance",
        status: "success",
        score: 87,
        issues: [],
        raw: {},
        partial_reasons: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        package_name: "x",
        package_version: "0",
        duration_ms: 0,
        started_at: "2026-06-05T12:00:00Z",
      },
    }
    const before = SAMPLE.trends.length
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next.trends).toHaveLength(before)
  })

  it("prunes trends older than 30 days when a new event arrives", () => {
    const stale: ScoreTrendRow = {
      site_id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      label: "My site",
      is_competitor: false,
      category: "performance",
      score: 50,
      measured_at: "2026-04-01T12:00:00Z", // ~65 days before the event below
    }
    const seeded: DashboardSnapshot = {
      ...SAMPLE,
      trends: [...SAMPLE.trends, stale],
    }
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "rid-prune",
        run_id: "22222222-2222-4222-8222-222222222222",
        owner_id: OWNER,
        category: "seo",
        status: "success",
        score: 90,
        issues: [],
        raw: {},
        partial_reasons: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        package_name: "x",
        package_version: "0",
        duration_ms: 0,
        started_at: "2026-06-05T13:00:00Z",
      },
    }
    const next = applyEventToSnapshot(seeded, { kind: "event", envelope: env })
    expect(next.trends.some((t) => t.measured_at === "2026-04-01T12:00:00Z")).toBe(false)
  })

  it("keeps trends inside the 30-day window", () => {
    const recent: ScoreTrendRow = {
      site_id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      label: "My site",
      is_competitor: false,
      category: "performance",
      score: 60,
      measured_at: "2026-05-20T12:00:00Z", // ~16 days before the event below
    }
    const seeded: DashboardSnapshot = {
      ...SAMPLE,
      trends: [...SAMPLE.trends, recent],
    }
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "rid-keep",
        run_id: "22222222-2222-4222-8222-222222222222",
        owner_id: OWNER,
        category: "seo",
        status: "success",
        score: 90,
        issues: [],
        raw: {},
        partial_reasons: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        package_name: "x",
        package_version: "0",
        duration_ms: 0,
        started_at: "2026-06-05T13:00:00Z",
      },
    }
    const next = applyEventToSnapshot(seeded, { kind: "event", envelope: env })
    expect(next.trends.some((t) => t.measured_at === "2026-05-20T12:00:00Z")).toBe(true)
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 1 of the 3 new tests passes (the "keeps" test may incidentally pass since today's logic doesn't drop anything). The dedup test FAILS (today appends unconditionally, so length grows). The prune test FAILS (today never drops anything).

If you see different failure count, that's still RED. Continue.

### Step 3: Modify `apps/app/src/lib/offline/snapshot.ts`

Locate the existing `applyEventToSnapshot` function (slice 7 T4). The current end of the function builds `trends` as:

```ts
const trends =
  result.score !== null
    ? [
        ...prev.trends,
        {
          site_id: siteId,
          owner_id: result.owner_id,
          label: siteForTrend?.label ?? null,
          is_competitor: siteForTrend?.is_competitor ?? false,
          category: result.category,
          score: result.score,
          measured_at: result.started_at,
        },
      ]
    : prev.trends

return { ...prev, latestScores, trends }
```

Replace that trailing block with the dedup + prune logic. First, add the constant import near the top of the file:

```ts
import { TRENDS_WINDOW_DAYS } from "@/lib/constants"
```

Then, just below the other private constants in the file (e.g. above `function applyEventToSnapshot`), add:

```ts
const TRENDS_WINDOW_MS = TRENDS_WINDOW_DAYS * 86_400_000
```

Then replace the trailing trend-building block with:

```ts
const newTrend = {
  site_id: siteId,
  owner_id: result.owner_id,
  label: siteForTrend?.label ?? null,
  is_competitor: siteForTrend?.is_competitor ?? false,
  category: result.category,
  score: result.score,
  measured_at: result.started_at,
}

const isDuplicate = prev.trends.some(
  (t) =>
    t.site_id === newTrend.site_id &&
    t.category === newTrend.category &&
    t.measured_at === newTrend.measured_at
)

const eventTimeMs = Date.parse(result.started_at)
const cutoff = Number.isFinite(eventTimeMs)
  ? eventTimeMs - TRENDS_WINDOW_MS
  : Number.NEGATIVE_INFINITY
const pruned = prev.trends.filter((t) => {
  const tMs = Date.parse(t.measured_at)
  return Number.isFinite(tMs) ? tMs >= cutoff : true
})

const trends =
  isDuplicate || result.score === null ? pruned : [...pruned, newTrend]

return { ...prev, latestScores, trends }
```

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
```

Expected: 3 new tests pass → **134 total** (131 + 3).

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/snapshot.ts apps/app/src/test/offline/snapshot.test.ts
git commit -m "feat(app): dedup + 30-day prune trends in applyEventToSnapshot"
```

---

## Task 2: Extract `_idb.ts` shared helpers

**Files:**
- Create: `apps/app/src/lib/offline/_idb.ts`
- Modify: `apps/app/src/lib/offline/snapshot.ts`
- Modify: `apps/app/src/lib/offline/audit-queue.ts`

Pure refactor. No test changes, no behavior changes.

### Step 1: Create `apps/app/src/lib/offline/_idb.ts`

```ts
// Internal helpers shared by snapshot.ts, audit-queue.ts, and clear-cache.ts.
// Not exported from the offline barrel; consumers import directly.

export function txStore(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode
): IDBObjectStore {
  return db.transaction(storeName, mode).objectStore(storeName)
}

export function awaitRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
```

### Step 2: Update `apps/app/src/lib/offline/snapshot.ts`

Find the existing private `txStore` and `awaitRequest` definitions (slice 7) and delete them. Add an import at the top of the file:

```ts
import { awaitRequest, txStore } from "@/lib/offline/_idb"
```

Then update every existing `txStore(db, mode)` call site to pass `STORE_DASHBOARD` explicitly. Search for `txStore(db, "readonly")` and `txStore(db, "readwrite")` and change them to `txStore(db, STORE_DASHBOARD, "readonly")` / `txStore(db, STORE_DASHBOARD, "readwrite")`. The slice-7 file has three call sites (`readSnapshot`, `writeSnapshot`, `clearSnapshot`).

### Step 3: Update `apps/app/src/lib/offline/audit-queue.ts`

Find the existing private `txStore` and `awaitRequest` definitions (slice 8) and delete them. Add the same import:

```ts
import { awaitRequest, txStore } from "@/lib/offline/_idb"
```

Update every existing `txStore(db, mode)` call site to pass `STORE_AUDIT_QUEUE` explicitly. The slice-8 file has three call sites (`enqueueAuditRun`, `readQueueForOwner`, `removeFromQueue`).

### Step 4: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. Test count stays at **134**.

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/_idb.ts apps/app/src/lib/offline/snapshot.ts apps/app/src/lib/offline/audit-queue.ts
git commit -m "refactor(app): extract shared IDB helpers (_idb.ts)"
```

---

## Task 3: `sweepOtherOwners` + wire into `useDashboardCache` + 2 tests

**Files:**
- Modify: `apps/app/src/lib/offline/clear-cache.ts`
- Modify: `apps/app/src/lib/offline/index.ts` (export sweepOtherOwners)
- Modify: `apps/app/src/lib/offline/use-dashboard-cache.ts` (call sweep on mount)
- Modify: `apps/app/src/test/offline/clear-cache.test.ts` (append 2 tests)

### Step 1: Failing tests — append to `clear-cache.test.ts`

At the END of `apps/app/src/test/offline/clear-cache.test.ts`, append:

```ts
import { enqueueAuditRun, readQueueForOwner } from "@/lib/offline/audit-queue"
import { sweepOtherOwners } from "@/lib/offline/clear-cache"
import { readSnapshot, writeSnapshot } from "@/lib/offline/snapshot"

const OWNER_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const OWNER_B = "8b7c1a2f-3d4e-4f5a-9b6c-1d2e3f4a5b6c"

describe("sweepOtherOwners", () => {
  it("deletes other-owner snapshots and queue entries; keeps current-owner data", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, {
      ownerId: OWNER_A,
      updatedAt: 1,
      sites: [],
      latestScores: [],
      trends: [],
    })
    await writeSnapshot(db, {
      ownerId: OWNER_B,
      updatedAt: 2,
      sites: [],
      latestScores: [],
      trends: [],
    })
    await enqueueAuditRun(db, {
      id: "q1",
      ownerId: OWNER_A,
      siteId: "s",
      requestedUrl: "https://example.com",
      queuedAt: 1,
    })
    await enqueueAuditRun(db, {
      id: "q2",
      ownerId: OWNER_B,
      siteId: "s",
      requestedUrl: "https://example.com",
      queuedAt: 1,
    })

    await sweepOtherOwners(db, OWNER_A)

    expect(await readSnapshot(db, OWNER_A)).not.toBeNull()
    expect(await readSnapshot(db, OWNER_B)).toBeNull()
    expect(await readQueueForOwner(db, OWNER_A)).toHaveLength(1)
    expect(await readQueueForOwner(db, OWNER_B)).toHaveLength(0)
  })

  it("is a no-op when only current-owner data exists", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, {
      ownerId: OWNER_A,
      updatedAt: 1,
      sites: [],
      latestScores: [],
      trends: [],
    })
    await sweepOtherOwners(db, OWNER_A)
    expect(await readSnapshot(db, OWNER_A)).not.toBeNull()
  })
})
```

The file's existing `beforeEach` already clears the DB before each test, so no extra setup needed.

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 2 new failures (`sweepOtherOwners` not exported).

### Step 3: Modify `apps/app/src/lib/offline/clear-cache.ts`

Replace the file content with:

```ts
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import type { QueuedAuditRun } from "@/lib/offline/audit-queue"
import { openOfflineDB, STORE_AUDIT_QUEUE, STORE_DASHBOARD } from "@/lib/offline/db"
import { type DashboardSnapshot, clearSnapshot } from "@/lib/offline/snapshot"

export async function clearDashboardCache(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    await clearSnapshot(db, ownerId)
  } catch {
    // IDB unavailable — best-effort cleanup, do not block sign-out
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
  } catch {
    // best-effort GC; never block startup
  }
}
```

### Step 4: Update `apps/app/src/lib/offline/index.ts`

Add `sweepOtherOwners` to the `clear-cache.ts` re-export:

```ts
export { clearDashboardCache, sweepOtherOwners } from "@/lib/offline/clear-cache"
```

### Step 5: Wire into `useDashboardCache`

Open `apps/app/src/lib/offline/use-dashboard-cache.ts`. Find the existing mount effect that calls `openOfflineDB()` and `readSnapshot(db, ownerId)`. Right after the `openOfflineDB()` resolves and BEFORE the `readSnapshot` call, fire-and-forget the sweep:

```ts
const db = await openOfflineDB()
void sweepOtherOwners(db, ownerId)   // NEW: fire-and-forget; never await
const existing = await readSnapshot(db, ownerId)
```

Add to the file's imports:

```ts
import { sweepOtherOwners } from "@/lib/offline/clear-cache"
```

### Step 6: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Expected: 2 new tests pass → **136 total** (134 + 2).

### Step 7: Commit

```bash
git add apps/app/src/lib/offline/clear-cache.ts apps/app/src/lib/offline/index.ts apps/app/src/lib/offline/use-dashboard-cache.ts apps/app/src/test/offline/clear-cache.test.ts
git commit -m "feat(app): cross-user IDB GC via sweepOtherOwners on mount"
```

---

## Task 4: Replay toast aggregation in `useAuditQueueReplay`

**Files:**
- Modify: `apps/app/src/lib/offline/use-audit-queue-replay.ts`
- Modify: `apps/app/src/test/offline/use-audit-queue-replay.test.ts` (mock sonner + add 1 test)

### Step 1: Failing test — mock sonner at top of test file + append test

Open `apps/app/src/test/offline/use-audit-queue-replay.test.ts`. At the TOP of the file (after the existing imports but before `beforeEach`), add the mock and import:

```ts
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { toast } from "sonner"
```

Then in the existing `afterEach`, also reset the toast mocks:

```ts
afterEach(() => {
  resetBroadcastChannels()
  // ... existing cleanup
  ;(toast.success as ReturnType<typeof vi.fn>).mockClear()
  ;(toast.error as ReturnType<typeof vi.fn>).mockClear()
})
```

At the END of the file, append:

```ts
describe("useAuditQueueReplay — toast aggregation", () => {
  it("emits a single aggregated success toast for a multi-entry drain", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))
    await enqueueAuditRun(db, entry("q2"))
    await enqueueAuditRun(db, entry("q3"))

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, runId: "rid" }), { status: 200 })
      )
    )

    const successMock = toast.success as ReturnType<typeof vi.fn>
    successMock.mockClear()

    renderHook(() => useAuditQueueReplay(OWNER))

    await waitFor(async () => {
      expect(await readQueueForOwner(db, OWNER)).toEqual([])
    })

    expect(successMock).toHaveBeenCalledTimes(1)
    expect(successMock).toHaveBeenCalledWith(
      expect.stringMatching(/Started 3 queued audit/)
    )
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 1 new failure (currently the hook calls `toast.success` per entry; with 3 entries that's 3 calls, not 1).

The existing tests in this file may also fail because `toast.success` is now a mock instead of a noop — verify they still pass after the mock is added. If they fail due to assertion changes, leave them; they'll go green again after the implementation change makes the calls match.

### Step 3: Modify `apps/app/src/lib/offline/use-audit-queue-replay.ts`

Open the file. Locate the per-entry loop. Inside the success path, remove the call:

```ts
toast.success(`Queued audit started — ${body.runId.slice(0, 8)}`)
```

Replace with:

```ts
successes += 1
```

Declare `successes` at the top of the `drain` function alongside the existing `failures`:

```ts
let failures = 0
let successes = 0
for (const entry of entries) {
  // ... unchanged body, except the toast.success call removed and replaced
  //     with `successes += 1` inside the success branch
}
if (successes > 0) {
  toast.success(`Started ${successes} queued audit${successes === 1 ? "" : "s"}`)
}
if (failures > 0) {
  toast.error(`${failures} queued audit${failures === 1 ? "" : "s"} failed to start.`)
}
```

The full updated `drain` body (for clarity — replace the entire function body inside `useEffect`):

```ts
const drain = async () => {
  let entries: QueuedAuditRun[] = []
  try {
    const db = await openOfflineDB()
    entries = await readQueueForOwner(db, ownerId)
  } catch {
    return
  }
  if (entries.length === 0) return

  let successes = 0
  let failures = 0
  for (const entry of entries) {
    try {
      const res = await fetch("/api/audit-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: entry.siteId,
          requestedUrl: entry.requestedUrl,
        }),
      })
      if (!res.ok) {
        failures += 1
        continue
      }
      const body = (await res.json()) as
        | { ok: true; runId: string }
        | { ok: false; error: string }
      if (!body.ok) {
        failures += 1
        continue
      }
      try {
        const db = await openOfflineDB()
        await removeFromQueue(db, entry.id)
      } catch {
        // leave in queue
      }
      successes += 1
    } catch {
      failures += 1
    }
  }
  if (successes > 0) {
    toast.success(`Started ${successes} queued audit${successes === 1 ? "" : "s"}`)
  }
  if (failures > 0) {
    toast.error(`${failures} queued audit${failures === 1 ? "" : "s"} failed to start.`)
  }
}
```

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: all existing replay tests still pass + 1 new test passes → **137 total** (136 + 1).

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/use-audit-queue-replay.ts apps/app/src/test/offline/use-audit-queue-replay.test.ts
git commit -m "feat(app): aggregate replay success toasts (one summary instead of N)"
```

---

## Task 5: Delete `runAuditAction`

**Files:**
- Modify: `apps/app/src/app/(app)/dashboard/actions.ts` (delete `runAuditAction` + `RunAuditResult`)
- Delete: `apps/app/src/test/actions/run-audit-action.test.ts`

### Step 1: Confirm no callers

```bash
grep -rn "runAuditAction\|RunAuditResult" apps/app/src --include="*.ts" --include="*.tsx"
```

Expected: only the action definition + the test file should appear. If a non-test caller appears, **STOP and report**; the plan assumes slice 8 removed all UI callers.

### Step 2: Modify `apps/app/src/app/(app)/dashboard/actions.ts`

Delete:
- `export type RunAuditResult = …` line
- `export async function runAuditAction(input: unknown): Promise<RunAuditResult> { … }` block (entire function body)

The file's import of `RunAuditSchema` from `@/lib/schemas` is also used by no other action — but verify by searching for `RunAuditSchema` inside the file. If unused after the deletion, remove the import too.

### Step 3: Delete the test file

```bash
rm apps/app/src/test/actions/run-audit-action.test.ts
```

This removes 4 tests.

### Step 4: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Expected: tests drop by 4 → **133 total** (137 − 4). Typecheck + build clean.

### Step 5: Commit

```bash
git add 'apps/app/src/app/(app)/dashboard/actions.ts' apps/app/src/test/actions/run-audit-action.test.ts
git commit -m "chore(app): delete orphan runAuditAction + its test file"
```

---

## Task 6: `OfflineBanner` unit tests

**Files:**
- Create: `apps/app/src/test/components/offline-banner.test.tsx`

No production code changes. 4 new tests.

### Step 1: Failing test

Create `apps/app/src/test/components/offline-banner.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OfflineBanner } from "@/components/offline-banner"

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  })
})

afterEach(() => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  })
})

describe("OfflineBanner", () => {
  it("renders nothing when navigator.onLine is true on mount", () => {
    render(<OfflineBanner />)
    expect(screen.queryByText(/You are offline/i)).toBeNull()
  })

  it("renders the banner when navigator starts offline", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    expect(screen.getByText(/You are offline/i)).toBeTruthy()
  })

  it("shows the banner after the window 'offline' event fires", () => {
    render(<OfflineBanner />)
    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: false,
      })
      window.dispatchEvent(new Event("offline"))
    })
    expect(screen.getByText(/You are offline/i)).toBeTruthy()
  })

  it("hides the banner after the window 'online' event fires", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    expect(screen.getByText(/You are offline/i)).toBeTruthy()
    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: true,
      })
      window.dispatchEvent(new Event("online"))
    })
    expect(screen.queryByText(/You are offline/i)).toBeNull()
  })
})
```

### Step 2: Run — expect PASS

```bash
bun --filter @repo/app test
```

The `OfflineBanner` component already exists from slice 7 and behaves correctly; these tests should pass immediately (this isn't strict RED-GREEN because we're adding tests to existing code, not driving a new behavior). Expected: 4 new tests pass → **137 total** (133 + 4).

If any test fails because of a vitest-config issue with `.test.tsx` files (the existing test glob is `src/test/**/*.test.ts` per slice 5 conventions — verify it includes `.test.tsx`), fix the vitest config to glob both. The vitest config lives at `apps/app/vitest.config.ts`; update its `include` pattern to:

```ts
include: ["src/test/**/*.test.ts", "src/test/**/*.test.tsx"]
```

If you have to modify vitest.config.ts, include it in the commit.

### Step 3: Commit

```bash
git add apps/app/src/test/components/offline-banner.test.tsx
# include apps/app/vitest.config.ts if you modified it
git commit -m "test(app): add OfflineBanner unit tests"
```

---

## Task 7: `SignOutButton` unit test (+ install `@testing-library/user-event`)

**Files:**
- Modify: `apps/app/package.json` + `bun.lock` (add `@testing-library/user-event`)
- Create: `apps/app/src/test/components/sign-out-button.test.tsx`

### Step 1: Install `@testing-library/user-event`

```bash
cd apps/app && bun add -D @testing-library/user-event
cd /Users/jonasbroms/Sites/seo
```

Verify:

```bash
grep '"@testing-library/user-event"' apps/app/package.json
```

Expected output includes the version.

### Step 2: Failing test

Create `apps/app/src/test/components/sign-out-button.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const clearDashboardCacheSpy = vi.fn(async () => {})
const clearAuditQueueSpy = vi.fn(async () => {})

vi.mock("@/lib/offline/clear-cache", () => ({
  clearDashboardCache: clearDashboardCacheSpy,
}))
vi.mock("@/lib/offline/audit-queue", () => ({
  clearAuditQueue: clearAuditQueueSpy,
}))

beforeEach(() => {
  clearDashboardCacheSpy.mockClear()
  clearAuditQueueSpy.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("SignOutButton", () => {
  it("calls clearDashboardCache + clearAuditQueue before submitting the form", async () => {
    const { SignOutButton } = await import("@/components/sign-out-button")

    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {})

    render(<SignOutButton ownerId="owner-x" />)
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }))

    expect(clearDashboardCacheSpy).toHaveBeenCalledWith("owner-x")
    expect(clearAuditQueueSpy).toHaveBeenCalledWith("owner-x")
    expect(submitSpy).toHaveBeenCalledTimes(1)
  })
})
```

### Step 3: Run — expect PASS

```bash
bun --filter @repo/app test
```

Expected: 1 new test passes → **138 total** (137 + 1). `SignOutButton`'s behavior is correct from slice 8; this test just locks it in.

### Step 4: Verify build + typecheck

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Both clean.

### Step 5: Commit

```bash
git add apps/app/package.json bun.lock apps/app/src/test/components/sign-out-button.test.tsx
git commit -m "test(app): add SignOutButton unit test + @testing-library/user-event devDep"
```

---

## Task 8: Final DoD sweep + commit

**Files:**
- Modify: `apps/app/README.md` (no smoke step additions — slice 10 has no user-visible changes — but bump the slice marker if applicable)

### Step 1: Verify final state

```bash
# 1. Tests
bun --filter @repo/app test
# Expected: 138 passing (slice 9's 131 + 3 + 2 + 1 − 4 + 4 + 1 = 138)

# 2. Typecheck
bun --filter @repo/app check-types

# 3. Build
bun --filter @repo/app build

# 4. Lint
bun --filter @repo/app lint
```

All clean (any warnings are pre-existing).

### Step 2: No README smoke updates

Slice 10 has no user-visible changes. The existing smoke checklist (steps 1-38) covers everything; replay step 32 still works (just produces 1 toast for the single audit, or 1 summary toast on multi-replay).

Optional: add a single line under "Manual smoke checklist" reminding the reader that step 32 is unchanged but multi-entry replays now produce one summary toast. The plan does NOT require this; skip unless you want the documentation note.

### Step 3: Commit (only if README was modified)

```bash
# If README was modified:
git add apps/app/README.md
git commit -m "docs(app): note slice 10 replay toast aggregation"
# Otherwise: skip Step 3
```

---

## Report Format

(For the implementer to fill in after T8.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (~138 tests) | … |
  | 4 | Trend dedup + pruning behavior verified by test | ✓ via T1 tests |
  | 5 | Cross-user GC behavior verified by test | ✓ via T3 tests |
  | 6 | Replay produces 1 summary toast (not N) | ✓ via T4 test |
  | 7 | `runAuditAction` no longer in src | ✓ verifiable via grep |
  | 8 | OfflineBanner test coverage exists | ✓ via T6 tests |
  | 9 | SignOutButton test coverage exists | ✓ via T7 test |
- Total test count
- Commit SHA list (8 commits expected)
- Slice 10 release note (one line)
- Any carry-forwards for slice 11

---

## After slice 10

Slice 11 candidates (slimmer list after this slice):

- **Idempotency keys end-to-end** — closes the slice-8 two-tab replay race.
- **Per-run IDB cache** — `run_snapshots` store + `useRunDetailCache` hook.
- **SW Background Sync (Chromium)** — drain audit queue without a tab open.
- **Push notifications** for run completion.
