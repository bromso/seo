# Slice 7 — Offline-capable Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/dashboard` render with stale-but-meaningful data when offline by writing every successful snapshot (initial fetch + each FanOut event) to IndexedDB and reading from IDB when the cached HTML hydrates. Add a sticky "You are offline" banner to dashboard + run-detail pages. Cache key is the user's `ownerId`; sign-out clears the entry.

**Architecture:** New `apps/app/src/lib/offline/` module with a one-store IDB schema (`dashboard_snapshots` keyed by ownerId). A `useDashboardCache(ownerId, propsSnapshot)` hook reads from IDB on mount (swapping in fresher data if any), writes on FanOut events (debounced 500ms), and returns the live data the dashboard view renders. `OfflineBanner` is a small client component driven by `online`/`offline` window events. `SignOutButton` is rewired to call `clearDashboardCache(ownerId)` before triggering the existing server-side sign-out.

**Tech Stack:** IndexedDB (browser native), `fake-indexeddb` (new devDependency for Vitest), `@testing-library/react` (already installed in slice 6), happy-dom (existing test env), TypeScript 5.x.

**Spec:** [`docs/plans/2026-06-05-slice7-offline-dashboard-design.md`](2026-06-05-slice7-offline-dashboard-design.md)

---

## Conventions used throughout

- Working branch: `feat/offline-dashboard-slice7` (already created off `main`; spec committed at `4974c21`).
- Conventional commits: `feat(app):` / `test(app):` / `docs(app):` / `chore(deps):`.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 6's 92 tests must keep passing after every task.
- Tests live at `apps/app/src/test/offline/`.
- Use `bun --filter @repo/app <script>` for per-package operations.
- All IDB operations go through the `openOfflineDB()` factory so tests can swap in `fake-indexeddb`.
- All FanOut imports come from slice 6's `@/lib/realtime` barrel.

---

## Task 1: Install `fake-indexeddb` dev dependency

**Files:**
- Modify: `apps/app/package.json` (devDependencies)
- Modify: `bun.lock`

- [ ] **Step 1: Install**

```bash
bun add -d -F @repo/app fake-indexeddb
```

- [ ] **Step 2: Verify install**

```bash
grep '"fake-indexeddb"' apps/app/package.json
```

Expected output includes a version like `"fake-indexeddb": "^6.x.x"`.

- [ ] **Step 3: Verify baseline tests still pass**

```bash
bun --filter @repo/app test
```

Expected: **92 passing** (unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/app/package.json bun.lock
git commit -m "chore(deps): add fake-indexeddb devDep for offline tests"
```

---

## Task 2: `lib/offline/db.ts` + open/cache test

**Files:**
- Create: `apps/app/src/lib/offline/db.ts`
- Create: `apps/app/src/test/offline/db.test.ts`

The IDB connection factory — opens lazily, caches the promise per process.

- [ ] **Step 1: Failing test**

`apps/app/src/test/offline/db.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import { _resetOfflineDBCache, openOfflineDB, STORE_DASHBOARD } from "@/lib/offline/db"

afterEach(() => {
  _resetOfflineDBCache()
  // fake-indexeddb does not auto-clean between tests
  indexedDB.deleteDatabase("seo-app-cache")
})

describe("openOfflineDB", () => {
  it("opens version 1 and creates the dashboard_snapshots store", async () => {
    const db = await openOfflineDB()
    expect(db.objectStoreNames.contains(STORE_DASHBOARD)).toBe(true)
    expect(db.version).toBe(1)
  })

  it("returns the same DB instance on subsequent calls (cached promise)", async () => {
    const a = await openOfflineDB()
    const b = await openOfflineDB()
    expect(b).toBe(a)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 2 failures (module not found).

- [ ] **Step 3: Implement `apps/app/src/lib/offline/db.ts`**

```ts
export const DB_NAME = "seo-app-cache"
export const DB_VERSION = 1
export const STORE_DASHBOARD = "dashboard_snapshots"

let cachedDb: Promise<IDBDatabase> | null = null

export function openOfflineDB(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb
  cachedDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_DASHBOARD)) {
        db.createObjectStore(STORE_DASHBOARD, { keyPath: "ownerId" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return cachedDb
}

/** Test-only: clear the cached promise so the next call re-opens fresh. */
export function _resetOfflineDBCache(): void {
  cachedDb = null
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 2 new tests pass → **94 total**.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/offline/db.ts apps/app/src/test/offline/db.test.ts
git commit -m "feat(app): add offline IDB connection factory with TDD"
```

---

## Task 3: `lib/offline/snapshot.ts` read/write/clear + tests

**Files:**
- Create: `apps/app/src/lib/offline/snapshot.ts`
- Create: `apps/app/src/test/offline/snapshot.test.ts`

CRUD on `dashboard_snapshots`. Pure transaction wrappers.

- [ ] **Step 1: Failing test**

`apps/app/src/test/offline/snapshot.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import {
  clearSnapshot,
  type DashboardSnapshot,
  readSnapshot,
  writeSnapshot,
} from "@/lib/offline/snapshot"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

const SAMPLE: DashboardSnapshot = {
  ownerId: OWNER,
  updatedAt: 1_700_000_000_000,
  sites: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      url: "https://example.com",
      normalized_url: "https://example.com/",
      label: "My site",
      is_competitor: false,
      created_at: "2026-06-05T12:00:00Z",
    } satisfies SiteRow,
  ],
  latestScores: [
    {
      site_id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      url: "https://example.com",
      label: "My site",
      is_competitor: false,
      run_id: "22222222-2222-4222-8222-222222222222",
      run_status: "completed",
      run_started_at: "2026-06-05T12:00:00Z",
      category: "performance",
      result_status: "success",
      score: 87,
    } satisfies LatestScoreRow,
  ],
  trends: [
    {
      site_id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      label: "My site",
      is_competitor: false,
      category: "performance",
      score: 87,
      measured_at: "2026-06-05T12:00:00Z",
    } satisfies ScoreTrendRow,
  ],
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

describe("snapshot CRUD", () => {
  it("round-trips a snapshot through writeSnapshot + readSnapshot", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, SAMPLE)
    const got = await readSnapshot(db, OWNER)
    expect(got).toEqual(SAMPLE)
  })

  it("readSnapshot returns null for an unknown ownerId", async () => {
    const db = await openOfflineDB()
    const got = await readSnapshot(db, OWNER)
    expect(got).toBeNull()
  })

  it("writeSnapshot for an existing ownerId overwrites (no duplicates)", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, SAMPLE)
    const next: DashboardSnapshot = { ...SAMPLE, updatedAt: 1_700_000_000_999 }
    await writeSnapshot(db, next)
    const got = await readSnapshot(db, OWNER)
    expect(got?.updatedAt).toBe(1_700_000_000_999)
  })

  it("clearSnapshot removes the entry; subsequent read returns null", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, SAMPLE)
    await clearSnapshot(db, OWNER)
    const got = await readSnapshot(db, OWNER)
    expect(got).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 4 new failures (module not found).

- [ ] **Step 3: Implement `apps/app/src/lib/offline/snapshot.ts`**

```ts
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { STORE_DASHBOARD } from "@/lib/offline/db"

export type DashboardSnapshot = {
  ownerId: string
  updatedAt: number
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_DASHBOARD, mode).objectStore(STORE_DASHBOARD)
}

function awaitRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function readSnapshot(
  db: IDBDatabase,
  ownerId: string
): Promise<DashboardSnapshot | null> {
  const got = await awaitRequest<DashboardSnapshot | undefined>(
    txStore(db, "readonly").get(ownerId)
  )
  return got ?? null
}

export async function writeSnapshot(db: IDBDatabase, snap: DashboardSnapshot): Promise<void> {
  await awaitRequest(txStore(db, "readwrite").put(snap))
}

export async function clearSnapshot(db: IDBDatabase, ownerId: string): Promise<void> {
  await awaitRequest(txStore(db, "readwrite").delete(ownerId))
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 4 new tests pass → **98 total**.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/offline/snapshot.ts apps/app/src/test/offline/snapshot.test.ts
git commit -m "feat(app): add DashboardSnapshot read/write/clear with TDD"
```

---

## Task 4: `applyEventToSnapshot` pure helper + tests

**Files:**
- Modify: `apps/app/src/lib/offline/snapshot.ts` (append function + type export)
- Modify: `apps/app/src/test/offline/snapshot.test.ts` (append describe block)

Applies a single FanOut signal to an in-memory snapshot. Used by the cache hook to keep IDB current as events arrive.

- [ ] **Step 1: Failing tests — append to `snapshot.test.ts`**

Add this `describe` block AFTER the existing one:

```ts
import { applyEventToSnapshot } from "@/lib/offline/snapshot"
import type { Envelope } from "@/lib/realtime/envelope"

describe("applyEventToSnapshot", () => {
  it("returns snapshot unchanged for a resync signal", () => {
    const next = applyEventToSnapshot(SAMPLE, { kind: "resync" })
    expect(next).toBe(SAMPLE)
  })

  it("returns snapshot unchanged for an audit_runs event (dashboard scores only react to results)", () => {
    const env: Envelope = {
      table: "audit_runs",
      event: "UPDATE",
      row: {
        id: "22222222-2222-4222-8222-222222222222",
        site_id: "11111111-1111-4111-8111-111111111111",
        owner_id: OWNER,
        status: "completed",
        requested_url: "https://example.com",
        final_url: "https://example.com/",
        started_at: "2026-06-05T12:00:00Z",
        finished_at: "2026-06-05T12:00:30Z",
        triggered_by: "manual",
      },
    }
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next).toBe(SAMPLE)
  })

  it("replaces the matching (site_id, category) latestScores row on an audit_results INSERT", () => {
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "33333333-3333-4333-8333-333333333333",
        run_id: "22222222-2222-4222-8222-222222222222",
        owner_id: OWNER,
        category: "performance",
        status: "success",
        score: 94,
        issues: [],
        raw: {},
        partial_reasons: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        package_name: "@repo/audit-perf",
        package_version: "0.0.0",
        duration_ms: 1100,
        started_at: "2026-06-05T13:00:00Z",
      },
    }
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next).not.toBe(SAMPLE)
    expect(next.latestScores).toHaveLength(1)
    expect(next.latestScores[0]?.score).toBe(94)
    expect(next.trends).toHaveLength(2)
    expect(next.trends[1]).toMatchObject({
      site_id: "11111111-1111-4111-8111-111111111111",
      category: "performance",
      score: 94,
      measured_at: "2026-06-05T13:00:00Z",
    })
  })

  it("ignores audit_results events for runs not tied to a known site", () => {
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "44444444-4444-4444-8444-444444444444",
        run_id: "99999999-9999-4999-8999-999999999999", // not in SAMPLE
        owner_id: OWNER,
        category: "performance",
        status: "success",
        score: 50,
        issues: [],
        raw: {},
        partial_reasons: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        package_name: "x",
        package_version: "0",
        duration_ms: 0,
        started_at: "2026-06-05T14:00:00Z",
      },
    }
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next).toBe(SAMPLE)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 4 new failures (`applyEventToSnapshot` not exported).

- [ ] **Step 3: Append `applyEventToSnapshot` to `apps/app/src/lib/offline/snapshot.ts`**

Add at the END of the file:

```ts
import type { FanOutSignal } from "@/lib/realtime/fan-out"

export function applyEventToSnapshot(
  prev: DashboardSnapshot,
  signal: FanOutSignal
): DashboardSnapshot {
  if (signal.kind === "resync") return prev
  const env = signal.envelope
  if (env.table === "audit_runs") return prev

  // env.table === "audit_results", env.event === "INSERT"
  const result = env.row
  // Find the site this result belongs to by matching the run_id against any
  // latestScores row's run_id. If the run isn't represented in the snapshot
  // (e.g., a brand-new audit before the dashboard refreshes), skip.
  const siteId = prev.latestScores.find((s) => s.run_id === result.run_id)?.site_id
  if (!siteId) return prev

  const existing = prev.latestScores.find(
    (s) => s.site_id === siteId && s.category === result.category
  )
  const updatedScore: (typeof prev.latestScores)[number] = existing
    ? { ...existing, score: result.score, result_status: result.status }
    : {
        site_id: siteId,
        owner_id: result.owner_id,
        url: "",
        label: null,
        is_competitor: false,
        run_id: result.run_id,
        run_status: "completed",
        run_started_at: result.started_at,
        category: result.category,
        result_status: result.status,
        score: result.score,
      }

  const latestScores = existing
    ? prev.latestScores.map((s) => (s === existing ? updatedScore : s))
    : [...prev.latestScores, updatedScore]

  const siteForTrend = prev.sites.find((s) => s.id === siteId)
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
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 4 new tests pass → **102 total**.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/offline/snapshot.ts apps/app/src/test/offline/snapshot.test.ts
git commit -m "feat(app): add applyEventToSnapshot helper (apply FanOut events to cache)"
```

---

## Task 5: `useDashboardCache` hook + tests

**Files:**
- Create: `apps/app/src/lib/offline/use-dashboard-cache.ts`
- Create: `apps/app/src/test/offline/use-dashboard-cache.test.ts`

The React hook that wires FanOut → in-memory state → IDB.

- [ ] **Step 1: Failing tests**

`apps/app/src/test/offline/use-dashboard-cache.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { type DashboardSnapshot, writeSnapshot } from "@/lib/offline/snapshot"
import { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
import {
  FakeBroadcastChannel,
  FakeLockManager,
  FakeSupabaseClient,
  makeNow,
  resetBroadcastChannels,
} from "@/test/realtime/fakes"
import type { FanOutDeps } from "@/lib/realtime/fan-out"
import { _resetFanOutRegistry } from "@/lib/realtime/use-fan-out"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE = "11111111-1111-4111-8111-111111111111"
const RUN = "22222222-2222-4222-8222-222222222222"

const SITES: SiteRow[] = [
  {
    id: SITE,
    owner_id: OWNER,
    url: "https://example.com",
    normalized_url: "https://example.com/",
    label: "My site",
    is_competitor: false,
    created_at: "2026-06-05T12:00:00Z",
  },
]

const LATEST_SCORES: LatestScoreRow[] = [
  {
    site_id: SITE,
    owner_id: OWNER,
    url: "https://example.com",
    label: "My site",
    is_competitor: false,
    run_id: RUN,
    run_status: "completed",
    run_started_at: "2026-06-05T12:00:00Z",
    category: "performance",
    result_status: "success",
    score: 87,
  },
]

const TRENDS: ScoreTrendRow[] = []

let leaderSupabase: FakeSupabaseClient

beforeEach(async () => {
  _resetOfflineDBCache()
  _resetFanOutRegistry()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })

  leaderSupabase = new FakeSupabaseClient()
  ;(globalThis as unknown as { __realtimeDeps?: FanOutDeps }).__realtimeDeps = {
    bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
    locks: new FakeLockManager() as unknown as LockManager,
    supabaseFactory: () => leaderSupabase as unknown,
    now: makeNow(),
  }
})

afterEach(() => {
  resetBroadcastChannels()
  _resetFanOutRegistry()
  _resetOfflineDBCache()
  delete (globalThis as unknown as { __realtimeDeps?: FanOutDeps }).__realtimeDeps
})

describe("useDashboardCache", () => {
  it("returns propsSnapshot synchronously on first render", () => {
    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )
    expect(result.current.sites).toBe(SITES)
    expect(result.current.latestScores).toBe(LATEST_SCORES)
    expect(result.current.trends).toBe(TRENDS)
  })

  it("writes propsSnapshot to IDB after mount when IDB is empty", async () => {
    renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )
    await waitFor(async () => {
      const db = await openOfflineDB()
      const tx = db.transaction("dashboard_snapshots", "readonly")
      const got = await new Promise<DashboardSnapshot | undefined>((r) => {
        const req = tx.objectStore("dashboard_snapshots").get(OWNER)
        req.onsuccess = () => r(req.result as DashboardSnapshot | undefined)
      })
      expect(got?.sites).toEqual(SITES)
      expect(got?.latestScores).toEqual(LATEST_SCORES)
    })
  })

  it("hydrates from IDB on mount when IDB has fresher data than props", async () => {
    const db = await openOfflineDB()
    const fresher: DashboardSnapshot = {
      ownerId: OWNER,
      updatedAt: Date.now() + 60_000,
      sites: SITES,
      latestScores: [
        { ...LATEST_SCORES[0]!, score: 99 },
      ],
      trends: TRENDS,
    }
    await writeSnapshot(db, fresher)

    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )

    await waitFor(() => {
      expect(result.current.latestScores[0]?.score).toBe(99)
    })
  })

  it("updates state when a FanOut audit_results INSERT arrives and writes to IDB", async () => {
    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )

    // Wait for the FanOut leader to come up, then emit a result.
    await waitFor(() => {
      expect(leaderSupabase.channels.length).toBe(2)
    })

    act(() => {
      leaderSupabase.emit(`audit_results:${OWNER}`, {
        table: "audit_results",
        eventType: "INSERT",
        new: {
          id: "rid1",
          run_id: RUN,
          owner_id: OWNER,
          category: "performance",
          status: "success",
          score: 50,
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
      })
    })

    await waitFor(() => {
      expect(result.current.latestScores[0]?.score).toBe(50)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 4 new failures (module not found).

- [ ] **Step 3: Implement `apps/app/src/lib/offline/use-dashboard-cache.ts`**

```ts
"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { openOfflineDB } from "@/lib/offline/db"
import {
  applyEventToSnapshot,
  type DashboardSnapshot,
  readSnapshot,
  writeSnapshot,
} from "@/lib/offline/snapshot"
import { useFanOut } from "@/lib/realtime/use-fan-out"

type State = {
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}

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

export function useDashboardCache(ownerId: string, propsSnapshot: State): State {
  const propsFetchedAt = useRef<number>(Date.now())
  const [state, setState] = useState<State>(propsSnapshot)
  const fanOut = useFanOut(ownerId)

  // Capture propsSnapshot into stable state-init so the mount effect can
  // run "once per ownerId" without re-firing on every render. New
  // event-driven updates flow through the fan-out subscription below.
  const [initialProps] = useState(propsSnapshot)

  // On mount: read IDB; if fresher than props, swap. Otherwise write props.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const db = await openOfflineDB()
        const existing = await readSnapshot(db, ownerId)
        if (cancelled) return
        if (existing && existing.updatedAt > propsFetchedAt.current) {
          setState({
            sites: existing.sites,
            latestScores: existing.latestScores,
            trends: existing.trends,
          })
        } else {
          await writeSnapshot(db, {
            ownerId,
            updatedAt: propsFetchedAt.current,
            ...initialProps,
          })
        }
      } catch {
        // IDB unavailable (e.g., private mode in some browsers) — silently
        // degrade to props-only behavior. Dashboard still works.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, initialProps])

  // Debounced IDB writer for event bursts.
  const writeDebounced = useMemo(
    () =>
      debounce(async (snap: State) => {
        try {
          const db = await openOfflineDB()
          await writeSnapshot(db, { ownerId, updatedAt: Date.now(), ...snap })
        } catch {
          // ignored — see comment above
        }
      }, 500),
    [ownerId]
  )

  // Subscribe to fan-out; apply events to state.
  useEffect(() => {
    return fanOut.subscribe((s) => {
      setState((prev) => {
        const next = applyEventToSnapshot(
          { ownerId, updatedAt: Date.now(), ...prev },
          s
        )
        return next === prev || next.latestScores === prev.latestScores
          ? prev
          : { sites: next.sites, latestScores: next.latestScores, trends: next.trends }
      })
    })
  }, [fanOut, ownerId])

  // Re-write whenever state changes (debounced).
  useEffect(() => {
    writeDebounced(state)
  }, [state, writeDebounced])

  return state
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 4 new tests pass → **106 total**.

If the FanOut event test is flaky (timing), increase the `waitFor` timeout or add an extra `flushMicrotasks` import. Real-world: the debounce + waitFor combination can race.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/offline/use-dashboard-cache.ts apps/app/src/test/offline/use-dashboard-cache.test.ts
git commit -m "feat(app): add useDashboardCache hook (IDB hydration + FanOut-driven writes)"
```

---

## Task 6: `clear-cache.ts` + test

**Files:**
- Create: `apps/app/src/lib/offline/clear-cache.ts`
- Create: `apps/app/src/test/offline/clear-cache.test.ts`

Wraps `clearSnapshot` with the open-DB step so callers don't import both.

- [ ] **Step 1: Failing test**

`apps/app/src/test/offline/clear-cache.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { clearDashboardCache } from "@/lib/offline/clear-cache"
import { readSnapshot, writeSnapshot } from "@/lib/offline/snapshot"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

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

describe("clearDashboardCache", () => {
  it("removes the snapshot for the given ownerId", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, {
      ownerId: OWNER,
      updatedAt: 1,
      sites: [],
      latestScores: [],
      trends: [],
    })
    await clearDashboardCache(OWNER)
    const got = await readSnapshot(db, OWNER)
    expect(got).toBeNull()
  })

  it("is a no-op when no snapshot exists", async () => {
    await expect(clearDashboardCache(OWNER)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 2 failures.

- [ ] **Step 3: Implement `apps/app/src/lib/offline/clear-cache.ts`**

```ts
import { openOfflineDB } from "@/lib/offline/db"
import { clearSnapshot } from "@/lib/offline/snapshot"

export async function clearDashboardCache(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    await clearSnapshot(db, ownerId)
  } catch {
    // IDB unavailable — best-effort cleanup, do not block sign-out
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 2 new tests pass → **108 total**.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/offline/clear-cache.ts apps/app/src/test/offline/clear-cache.test.ts
git commit -m "feat(app): add clearDashboardCache (sign-out cleanup)"
```

---

## Task 7: `lib/offline/index.ts` barrel

**Files:**
- Create: `apps/app/src/lib/offline/index.ts`

- [ ] **Step 1: Create**

```ts
export { clearDashboardCache } from "@/lib/offline/clear-cache"
export {
  _resetOfflineDBCache,
  DB_NAME,
  DB_VERSION,
  openOfflineDB,
  STORE_DASHBOARD,
} from "@/lib/offline/db"
export {
  applyEventToSnapshot,
  clearSnapshot,
  type DashboardSnapshot,
  readSnapshot,
  writeSnapshot,
} from "@/lib/offline/snapshot"
export { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
```

- [ ] **Step 2: Verify**

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/offline/index.ts
git commit -m "feat(app): export offline barrel"
```

---

## Task 8: `OfflineBanner` component

**Files:**
- Create: `apps/app/src/components/offline-banner.tsx`

No unit test — pure DOM event wiring. Build + typecheck is the gate.

- [ ] **Step 1: Create `apps/app/src/components/offline-banner.tsx`**

```tsx
"use client"
import { useEffect, useState } from "react"

export function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    return () => {
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
    }
  }, [])

  if (online) return null
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      You are offline. Showing the last data we cached on this device.
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/offline-banner.tsx
git commit -m "feat(app): add OfflineBanner (online/offline event-driven)"
```

---

## Task 9: Wire `useDashboardCache` + `OfflineBanner` into dashboard-view

**Files:**
- Modify: `apps/app/src/views/dashboard-view.tsx`

- [ ] **Step 1: Replace `apps/app/src/views/dashboard-view.tsx`**

```tsx
"use client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs"
import { CompetitorDrawer } from "@/components/competitor-drawer"
import { OfflineBanner } from "@/components/offline-banner"
import { useRealtimeScores } from "@/hooks/use-realtime-scores"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
import { DashboardOverviewTab } from "@/views/dashboard-overview-tab"
import { DashboardTrendsTab } from "@/views/dashboard-trends-tab"

export function DashboardView({
  ownerId,
  sites,
  latestScores,
  trends,
}: {
  ownerId: string
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}) {
  useRealtimeScores(ownerId)
  const cached = useDashboardCache(ownerId, { sites, latestScores, trends })
  const competitors = cached.sites.filter((s) => s.is_competitor)
  return (
    <div className="space-y-6">
      <OfflineBanner />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <CompetitorDrawer competitors={competitors} />
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <DashboardOverviewTab sites={cached.sites} latestScores={cached.latestScores} />
        </TabsContent>
        <TabsContent value="trends">
          <DashboardTrendsTab trends={cached.trends} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. Test count stays at 108 (no new tests; view changes are not unit-tested).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/views/dashboard-view.tsx
git commit -m "feat(app): wire DashboardView through useDashboardCache + OfflineBanner"
```

---

## Task 10: Add `OfflineBanner` to run-detail-view

**Files:**
- Modify: `apps/app/src/views/run-detail-view.tsx`

Just adds the banner at the top of the view. No data layer changes (run-detail relies on SW HTML cache).

- [ ] **Step 1: Read current file to confirm layout**

```bash
cat apps/app/src/views/run-detail-view.tsx
```

Find the JSX root (a `<div className="space-y-6">`).

- [ ] **Step 2: Add import + banner**

At the top, after the existing imports, add:

```tsx
import { OfflineBanner } from "@/components/offline-banner"
```

Inside the JSX root, as the first child of the outer `<div className="space-y-6">`, add:

```tsx
<OfflineBanner />
```

- [ ] **Step 3: Verify**

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/views/run-detail-view.tsx
git commit -m "feat(app): add OfflineBanner to RunDetailView"
```

---

## Task 11: Wire `clearDashboardCache` into sign-out

**Files:**
- Modify: `apps/app/src/components/sign-out-button.tsx`
- Modify: `apps/app/src/components/app-shell.tsx`
- Modify: `apps/app/src/app/(app)/layout.tsx`

Sign-out is server-side today. We add a client-side step before the redirect: call `clearDashboardCache(ownerId)` then trigger the existing server route. Requires plumbing `ownerId` from the layout through `AppShell` to `SignOutButton`.

- [ ] **Step 1: Update `apps/app/src/components/sign-out-button.tsx`**

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import { useTransition } from "react"
import { clearDashboardCache } from "@/lib/offline/clear-cache"

export function SignOutButton({ ownerId }: { ownerId: string }) {
  const [pending, start] = useTransition()
  return (
    <form
      action="/sign-out"
      method="POST"
      onSubmit={(e) => {
        e.preventDefault()
        // Capture form ref synchronously — the synthetic event is pooled and
        // `e.currentTarget` becomes null after the handler returns.
        const form = e.currentTarget
        start(async () => {
          await clearDashboardCache(ownerId)
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

- [ ] **Step 2: Update `apps/app/src/components/app-shell.tsx`**

Add `ownerId` to props and pass to `SignOutButton`:

```tsx
import Link from "next/link"
import type { ReactNode } from "react"
import { SignOutButton } from "@/components/sign-out-button"

export function AppShell({
  ownerId,
  email,
  siteLabel,
  children,
}: {
  ownerId: string
  email: string
  siteLabel: string | null
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm font-medium">
            SEO Audit
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {siteLabel ? <span className="text-muted-foreground">{siteLabel}</span> : null}
            <span className="text-muted-foreground">{email}</span>
            <SignOutButton ownerId={ownerId} />
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 py-8">{children}</div>
    </div>
  )
}
```

- [ ] **Step 3: Update `apps/app/src/app/(app)/layout.tsx`**

Pass `user.id` as the new `ownerId` prop:

```tsx
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { AppShell } from "@/components/app-shell"
import { createServerSupabase } from "@/lib/supabase-server"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: site } = await supabase
    .from("sites")
    .select("label")
    .eq("owner_id", user.id)
    .eq("is_competitor", false)
    .maybeSingle()

  return (
    <AppShell ownerId={user.id} email={user.email ?? ""} siteLabel={site?.label ?? null}>
      {children}
    </AppShell>
  )
}
```

- [ ] **Step 4: Verify**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. Test count still 108.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/sign-out-button.tsx apps/app/src/components/app-shell.tsx apps/app/src/app/\(app\)/layout.tsx
git commit -m "feat(app): clear offline dashboard cache on sign-out"
```

---

## Task 12: README smoke checklist + DoD sweep + final commit

**Files:**
- Modify: `apps/app/README.md` (append steps 25-29)

- [ ] **Step 1: Append to `apps/app/README.md`**

Find the existing "Manual smoke checklist" section (ending at slice 6's step 24). Add after step 24:

```
25. Sign in, open /dashboard online → data renders normally. DevTools →
    Application → IndexedDB → seo-app-cache → dashboard_snapshots shows one
    entry keyed by your owner_id (updatedAt = now).
26. Queue an audit. When it completes (Realtime fires), the IDB entry's
    updatedAt advances and the snapshot's latestScores / trends include the
    new result. Refresh DevTools view to see the update.
27. DevTools → Network → "Offline" mode. Refresh /dashboard. Page renders
    from the SW HTML cache; the useDashboardCache hook hydrates from IDB.
    Sticky amber banner appears: "You are offline. Showing the last data
    we cached on this device."
28. Visit /dashboard/runs/<a runId you previously loaded> while offline.
    Page renders from the SW HTML cache. Banner appears. No IDB write for
    runs (run-detail intentionally doesn't IDB-cache).
29. Sign out → sign in as a DIFFERENT user → the previous user's snapshot
    is NOT visible (own ownerId means own IDB key; previous entry was also
    cleared by SignOutButton).
```

- [ ] **Step 2: Full DoD sweep**

```bash
# 1. Tests
bun --filter @repo/app test
# Expected: ~108 passing

# 2. Typecheck
bun --filter @repo/app check-types
# Clean

# 3. Build
bun --filter @repo/app build
# Clean

# 4. Lint (Biome) — runs in pre-commit, verify standalone
bun --filter @repo/app lint
```

- [ ] **Step 3: Final commit**

```bash
git add apps/app/README.md
git commit -m "docs(app): add slice 7 smoke checklist (steps 25-29)"
```

---

## Report Format

(For the implementer to fill in after T12.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (~108 tests) | … |
  | 4 | IDB entry appears in DevTools after first dashboard load | Deferred to user verification |
  | 5 | FanOut event updates IDB entry's updatedAt + latestScores | Deferred to user verification |
  | 6 | Offline dashboard renders with last-cached data + banner | Deferred to user verification |
  | 7 | Offline run-detail renders + banner | Deferred to user verification |
  | 8 | Sign-out clears the user's snapshot | Deferred to user verification |
- Total test count
- Commit SHA list (12 commits expected, +1 docs commit for the design spec already shipped)
- Slice 7 release note (one line)
- Any carry-forwards for slice 8

---

## After slice 7

Slice 8 candidates:

- **PWA install prompt** — `beforeinstallprompt` capture + Install button in dashboard header; iOS "Add to Home Screen" instructions card.
- **Background sync for `runAuditAction`** — queue audit triggers in IDB while offline; replay via SW background sync when network returns.
- **Per-run IDB cache** — extend `seo-app-cache` to a `run_snapshots` store keyed by `runId`, populated when the user visits a run-detail page. Makes "never-loaded-this-run" pages also work offline.
