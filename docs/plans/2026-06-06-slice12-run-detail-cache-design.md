# Slice 12 — Per-Run IDB Cache Design

**Status:** Spec — ready for implementation planning.

**Driver:** Slice 7 added an offline cache for `/dashboard`. Slice 12 extends that pattern to `/dashboard/runs/[runId]` so previously-loaded run pages persist their data in IndexedDB. When the user reopens the same run offline (SW serves cached HTML) the page renders with the most-recent run + results snapshot the user saw while online.

**Out of scope (intentional):**
- Hydrating fresher IDB data over RSC props on mount. The MVP just persists `live` into IDB; the read-back path is the SW HTML cache. (Mirrors the simplification noted during brainstorming.)
- Eviction policy beyond per-owner LRU (no time pruning).
- Server-side changes. No DB migration, no API change, no new routes.
- Caching arbitrary runs the user never opened. Only visited runs land in IDB.

---

## Goal

When a user navigates to `/dashboard/runs/<runId>` while online:
- The page's RSC fetch returns the run + results from Supabase as today.
- The new `useRunDetailCache(ownerId, runId, live)` hook persists `live` to IndexedDB on every change, debounced 500ms.
- A tiny LRU sweep keeps the per-owner snapshot count at or below `MAX_RUN_SNAPSHOTS_PER_OWNER = 20` (delete oldest by `updatedAt`).

When the same user revisits the same `runId` offline:
- The Serwist SW returns the cached `/dashboard/runs/<runId>` HTML (slice 7 wiring).
- React hydrates with whatever data was baked into that HTML at last successful visit.
- `useRealtimeRun` fails to open a WebSocket (offline); no new events.
- `useRunDetailCache` keeps trying to write but `openOfflineDB()` succeeds and the persist becomes a no-op.

Sign-out clears the user's run snapshots in parallel with the existing dashboard cache + audit queue clears. Cross-user GC (`sweepOtherOwners`, slice 10) gains a third pass over the new store.

## Non-goals

- New product surface. The Run-detail page renders the same content whether the cache is empty or full.
- IDB `read-on-mount` hydration. The hook returns `live` always; cached HTML is sufficient for the offline display path.
- Reactive cache freshness signaling between tabs. Each tab persists its own view of `live`; last write wins.

---

## Architecture

```
RSC /dashboard/runs/[runId]
        │
        ▼
RunDetailView
  ├── live = useRealtimeRun(ownerId, runId, initialRun, initialResults)
  │       (FanOut subscriber from slices 5/6 — applies events to local state)
  │
  └── cached = useRunDetailCache(ownerId, runId, live)
        │
        └── useEffect on `live` change:
              debounce(500ms):
                writeRunSnapshot(db, { runId, ownerId, updatedAt, run, results })
                sweepRunSnapshotsLRU(db, ownerId)

  // The view consumes `cached` (which is just `live` after the no-hydration
  // simplification — the hook IS the writer-only side effect)
```

Note: `cached === live` always after the no-hydration simplification. The view could use either; we route through `useRunDetailCache` so the persistence side-effect runs.

**Sign-out path** (extends slice 10's parallel clear):

```ts
await Promise.all([
  clearDashboardCache(ownerId),
  clearAuditQueue(ownerId),
  clearAuditRunSnapshots(ownerId),  // NEW
])
form.submit()
```

**Cross-user GC** (extends slice 10's `sweepOtherOwners`):

The function gains a third sweep pass over `STORE_RUN_SNAPSHOTS`, deleting any entry whose `ownerId` doesn't match `currentOwnerId`.

---

## File layout

```
apps/app/src/lib/offline/
├── db.ts                            MODIFY — DB_VERSION = 3, STORE_RUN_SNAPSHOTS, V2→V3 migration branch
├── run-snapshot.ts                  NEW — type + CRUD + apply helper + LRU sweep
├── use-run-detail-cache.ts          NEW — React hook (write-only)
├── clear-cache.ts                   MODIFY — sweepOtherOwners gains a pass; add clearAuditRunSnapshots
└── index.ts                         MODIFY — export the new symbols

apps/app/src/components/
└── sign-out-button.tsx              MODIFY — Promise.all gains clearAuditRunSnapshots(ownerId)

apps/app/src/views/
└── run-detail-view.tsx              MODIFY — wrap props through useRunDetailCache (1 line)

apps/app/src/test/offline/
├── db.test.ts                       EXTEND — +1 test for V2→V3 migration
├── run-snapshot.test.ts             NEW — 6 tests
├── use-run-detail-cache.test.ts     NEW — 2 tests
└── clear-cache.test.ts              EXTEND — +3 tests (sweep+run-snapshots, clear-runs, clear-runs no-op)
```

**Internal helper:** `_idb.ts` (slice 10) is reused — no new helper module.

---

## IDB schema

```ts
export const DB_VERSION = 3
export const STORE_RUN_SNAPSHOTS = "audit_run_snapshots"
```

The `onupgradeneeded` handler gains a fourth additive guard:

```ts
if (event.oldVersion < 1 && !db.objectStoreNames.contains(STORE_DASHBOARD)) { … }
if (event.oldVersion < 2 && !db.objectStoreNames.contains(STORE_AUDIT_QUEUE)) { … }
if (event.oldVersion < 3 && !db.objectStoreNames.contains(STORE_RUN_SNAPSHOTS)) {
  db.createObjectStore(STORE_RUN_SNAPSHOTS, { keyPath: "runId" })
}
```

**Snapshot shape:**

```ts
export type RunDetailSnapshot = {
  runId: string
  ownerId: string
  updatedAt: number
  run: AuditRunRow
  results: AuditResultRow[]
}
```

Keyed by `runId`. No indexes (LRU sweep does `getAll` + in-memory filter; the cap of 20 entries per owner makes this cheap).

---

## Public API

```ts
// lib/offline/run-snapshot.ts
export type RunDetailSnapshot = { … }
export const MAX_RUN_SNAPSHOTS_PER_OWNER = 20

export async function readRunSnapshot(db: IDBDatabase, runId: string): Promise<RunDetailSnapshot | null>
export async function writeRunSnapshot(db: IDBDatabase, snap: RunDetailSnapshot): Promise<void>
export async function clearRunSnapshotsForOwner(db: IDBDatabase, ownerId: string): Promise<void>
export function applyEventToRunSnapshot(
  prev: RunDetailSnapshot,
  signal: FanOutSignal,
): RunDetailSnapshot
export async function sweepRunSnapshotsLRU(db: IDBDatabase, ownerId: string): Promise<void>

// lib/offline/clear-cache.ts
export async function clearAuditRunSnapshots(ownerId: string): Promise<void>

// lib/offline/use-run-detail-cache.ts
export function useRunDetailCache(
  ownerId: string,
  runId: string,
  live: { run: AuditRunRow; results: AuditResultRow[] },
): { run: AuditRunRow; results: AuditResultRow[] }
```

`applyEventToRunSnapshot` is exported for direct unit testing of the apply semantics. The hook itself does NOT call it — it just persists `live` whole.

---

## `applyEventToRunSnapshot` logic

```ts
export function applyEventToRunSnapshot(
  prev: RunDetailSnapshot,
  signal: FanOutSignal,
): RunDetailSnapshot {
  if (signal.kind === "resync") return prev
  const env = signal.envelope

  if (env.table === "audit_runs") {
    if (env.event !== "UPDATE") return prev
    if (env.row.id !== prev.runId) return prev
    return { ...prev, run: env.row, updatedAt: Date.now() }
  }

  if (env.table === "audit_results") {
    // env.event === "INSERT" by Envelope's type
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
```

---

## LRU sweep

```ts
export async function sweepRunSnapshotsLRU(
  db: IDBDatabase,
  ownerId: string,
): Promise<void> {
  const all = await awaitRequest<RunDetailSnapshot[]>(
    txStore(db, STORE_RUN_SNAPSHOTS, "readonly").getAll(),
  )
  const owned = all.filter((s) => s.ownerId === ownerId)
  if (owned.length <= MAX_RUN_SNAPSHOTS_PER_OWNER) return
  const sorted = [...owned].sort((a, b) => b.updatedAt - a.updatedAt)  // newest first
  const toDelete = sorted.slice(MAX_RUN_SNAPSHOTS_PER_OWNER)
  for (const snap of toDelete) {
    await awaitRequest(
      txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").delete(snap.runId),
    )
  }
}
```

Called from the hook after each debounced `writeRunSnapshot`. Cheap because the per-owner subset is bounded by ~20.

---

## Hook behavior

```ts
"use client"
import { useEffect, useMemo } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { openOfflineDB } from "@/lib/offline/db"
import {
  sweepRunSnapshotsLRU,
  writeRunSnapshot,
} from "@/lib/offline/run-snapshot"

type State = { run: AuditRunRow; results: AuditResultRow[] }

function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  ms: number,
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

export function useRunDetailCache(ownerId: string, runId: string, live: State): State {
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
    [ownerId, runId],
  )

  useEffect(() => {
    writeDebounced(live)
  }, [live, writeDebounced])

  return live
}
```

Notes:
- `debounce` is copy-pasted from `use-dashboard-cache.ts` (slice 7). 12 lines. If a third consumer arrives later, extract to `lib/offline/_debounce.ts`.
- The hook returns `live` unchanged — pure side-effect wrapper.
- No FanOut subscription. `useRealtimeRun` already owns the apply logic upstream; the hook just persists the result.

---

## Run-detail view wiring

`apps/app/src/views/run-detail-view.tsx` gains ONE line that wraps the existing `useRealtimeRun` output:

```tsx
const live = useRealtimeRun(
  initialRun.owner_id,
  initialRun.id,
  initialRun,
  initialResults,
)
const cached = useRunDetailCache(initialRun.owner_id, initialRun.id, live)
// Use `cached` instead of `live` below (functionally identical; routes the persist side-effect)
const { run, results } = cached
```

The rest of the view (`byCategory`, the JSX) is unchanged.

---

## Sign-out + cross-user GC

**`clearAuditRunSnapshots(ownerId)`** lives in `clear-cache.ts`:

```ts
export async function clearAuditRunSnapshots(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    await clearRunSnapshotsForOwner(db, ownerId)
  } catch {
    // best-effort
  }
}
```

**`sweepOtherOwners` gains a third pass** appended to the existing dashboard + queue passes:

```ts
const snaps = await awaitRequest<RunDetailSnapshot[]>(
  txStore(db, STORE_RUN_SNAPSHOTS, "readonly").getAll(),
)
for (const s of snaps) {
  if (s.ownerId !== currentOwnerId) {
    await awaitRequest(
      txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").delete(s.runId),
    )
  }
}
```

**`SignOutButton` extends the existing Promise.all:**

```tsx
await Promise.all([
  clearDashboardCache(ownerId),
  clearAuditQueue(ownerId),
  clearAuditRunSnapshots(ownerId),
])
```

---

## Testing strategy

**`db.test.ts` — extend with V2→V3 migration test (+1):**

```ts
it("preserves existing data when migrating from V2 to V3", async () => {
  // Manually open at version 2; seed a dashboard snapshot AND a queue entry.
  // Close. Reopen at version 3 via openOfflineDB.
  // Assert: prior data survives AND audit_run_snapshots store now exists.
})
```

**`run-snapshot.test.ts` — new file (+6):**

- `writeRunSnapshot` + `readRunSnapshot` round-trip
- `readRunSnapshot` returns null for unknown runId
- `applyEventToRunSnapshot` updates `run` on matching `audit_runs UPDATE`
- `applyEventToRunSnapshot` appends matching `audit_results INSERT`
- `applyEventToRunSnapshot` dedups a result already present by id
- `sweepRunSnapshotsLRU` keeps the 20 most recent (by `updatedAt`); deletes older; leaves other-owner entries untouched

**`use-run-detail-cache.test.ts` — new file (+2):**

- Returns the `live` prop synchronously on first render (passthrough)
- Writes to IDB after the 500ms debounce window (use `waitFor` with timeout 1500ms; verify `readRunSnapshot` returns the expected row)

**`clear-cache.test.ts` — extend (+3):**

- `sweepOtherOwners` ALSO deletes other-owner run snapshots (extend fixture with two owners' run snapshots; assert both stores trimmed appropriately)
- `clearAuditRunSnapshots` removes only current-owner entries
- `clearAuditRunSnapshots` is a no-op when no snapshots exist

**Total tests delta:** 1 + 6 + 2 + 3 = **+12**. Slice 11's 143 → slice 12's **~155**.

---

## Manual smoke (steps 42-44 in `apps/app/README.md`)

```
42. Online: open /dashboard/runs/<runId> for a recently-completed run. DevTools
    → Application → IndexedDB → seo-app-cache → audit_run_snapshots. Within
    ~1s of the page mounting (debounce window) a new entry appears keyed by
    the runId. Snapshot shape: { runId, ownerId, updatedAt, run, results }.
43. Visit 22 distinct run pages over a session. audit_run_snapshots stays at
    exactly 20 entries (LRU cap). The two oldest by updatedAt are evicted as
    later writes happen.
44. Sign in as user A, visit some runs, sign out. Sign in as user B → user
    A's snapshots are NOT visible (sweepOtherOwners ran on dashboard mount).
    Open one of user B's run pages; user B's audit_run_snapshots entry appears.
```

---

## Migration & backwards-compat

- **V2→V3 is additive**: only adds the new store. Existing dashboard_snapshots and audit_run_queue data is untouched.
- **No new dependencies** — production code uses only native IDB + existing FanOut machinery.
- **No DB migration on the server.** Idempotent on existing audit_runs.
- **Hook is write-only** — even on the offline fallback path, returning `live` matches today's behavior; the IDB persist becomes the only side effect, and silently fails when IDB is unavailable.

---

## Risks

- **Cached HTML staleness**: same as slice 7. Background-tab IDB writes don't update other tabs' SSR HTML until they refresh. Accepted gap.
- **Per-owner LRU is approximate under concurrent writes**: two tabs writing the same run snapshot at the same time both run `sweepRunSnapshotsLRU`; the second tab's sweep may see a different ordering. Idempotent under racing; result is always ≤20 entries.
- **`writeRunSnapshot` failure modes**: IDB quota errors are swallowed silently in the hook's try/catch. No user-facing error. Acceptable for an offline-cache feature.
- **Empty `live` props at first paint**: never happens for `/dashboard/runs/[runId]` — the RSC redirects via `notFound()` if the run doesn't exist (slice 6). So `live` always has a valid `run`.
- **runId collision across owners**: practically impossible (uuid v4); even if so, the `keyPath: "runId"` would overwrite. Acceptable.

---

## After slice 12

Slice 13 candidates (slimmer list after this slice):

- **SW Background Sync (Chromium)** — drain the audit queue without a tab open. Touches sw.ts.
- **Push notifications** for run completion. New DB table for subscriptions + VAPID setup.
- **Online double-click race** — debounce / pending-state UX on Run buttons.
- **Minor cleanups**: hoist `z.uuid()` to module-level constant in `/api/audit-run` route; extract `debounce` to `lib/offline/_debounce.ts` if it gets a third consumer; drop the unused barrel re-export from slice 10 (`sweepOtherOwners`).
- **IDB hydration** — actually use IDB to override stale RSC props on mount. The MVP skipped this; revisit if user demand surfaces.
