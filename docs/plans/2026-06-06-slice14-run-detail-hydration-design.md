# Slice 14 — IDB Hydration on Run-Detail Mount (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/run-detail-hydration-slice14`
**Carry-forward from:** Slice 12 (per-run IDB cache wrote but never read on mount)

---

## Goal

Make `/dashboard/runs/[runId]` actually use the IndexedDB snapshot it has been writing since slice 12. On client-mount, if the cached snapshot is fresher than the server-rendered props, swap state to the cache. This closes the slice 12 carry-forward and brings the run-detail page to parity with the dashboard, which has had IDB hydration since slice 7.

---

## Non-Goals

- No new IDB schema (V3 from slice 12 is unchanged).
- No new DB migration.
- No new dependencies.
- No SW Background Sync, no push notifications (deferred to slice 15+).
- No UX-visible flicker mitigation beyond what React's commit cycle already provides.

---

## Architecture

`useRunDetailCache` becomes stateful (was passthrough in slice 12). On mount it reads IDB and, if `existing.updatedAt > propsFetchedAt`, swaps local state — **unless** a realtime update from `live` has already landed (race guard). After mount, every `live` change overrides state. The debounced write-back path is unchanged.

The signature stays the same: `useRunDetailCache(ownerId, runId, live: State): State`. The view layer (`run-detail-view.tsx`) needs no changes — it already destructures `{ run, results }` from the return value.

This is symmetric with `useDashboardCache` (slice 7), modulo one difference: the dashboard hook owns the realtime subscription internally via `useFanOut`, while run-detail composes `useRealtimeRun` + `useRunDetailCache` at the view layer. The cache hook therefore takes `live` as a prop instead of subscribing to fan-out directly.

---

## The hook (full proposed source)

```ts
"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { debounce } from "@/lib/offline/_debounce"
import { openOfflineDB } from "@/lib/offline/db"
import {
  readRunSnapshot,
  sweepRunSnapshotsLRU,
  writeRunSnapshot,
} from "@/lib/offline/run-snapshot"

type State = { run: AuditRunRow; results: AuditResultRow[] }

export function useRunDetailCache(
  ownerId: string,
  runId: string,
  live: State
): State {
  const propsFetchedAt = useRef<number>(Date.now())
  const [initialLive] = useState(live)
  const [state, setState] = useState<State>(live)

  // Mount: read IDB; swap if fresher AND live hasn't moved.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const db = await openOfflineDB()
        const existing = await readRunSnapshot(db, runId)
        if (cancelled) return
        if (
          existing &&
          existing.ownerId === ownerId &&
          existing.updatedAt > propsFetchedAt.current
        ) {
          setState((prev) =>
            prev === initialLive
              ? { run: existing.run, results: existing.results }
              : prev
          )
        } else {
          await writeRunSnapshot(db, {
            runId,
            ownerId,
            updatedAt: propsFetchedAt.current,
            run: initialLive.run,
            results: initialLive.results,
          })
          await sweepRunSnapshotsLRU(db, ownerId)
        }
      } catch {
        // IDB unavailable (private mode, quota) — silent degrade.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, runId, initialLive])

  // Live updates from above (realtime) override.
  useEffect(() => {
    if (live !== initialLive) setState(live)
  }, [live, initialLive])

  // Debounced write on every state change (unchanged from slice 12 T3).
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
          // IDB unavailable / quota — silent degrade.
        }
      }, 500),
    [ownerId, runId]
  )

  useEffect(() => {
    writeDebounced(state)
  }, [state, writeDebounced])

  return state
}
```

### Key invariants

- **Returns `state` now.** Slice 12 returned `live`. The cache hook is now the source of truth post-mount.
- **Race guard:** `setState((prev) => prev === initialLive ? ... : prev)` skips the IDB swap if `live`'s `setState(live)` already ran. Reference equality on the initial captured `live` is sufficient — by the time the realtime effect fires `setState(live)`, `prev` no longer equals `initialLive`.
- **Mount-once write baseline:** when IDB has no snapshot OR is older than props, we write the props back as the new baseline with `updatedAt = propsFetchedAt`. This means the next mount on this device starts from a known timestamp.
- **Owner-mismatch defense:** `existing.ownerId === ownerId` rejects cross-account leakage. Slice 10's `sweepOtherOwners` already wipes other-owner data on dashboard load; this is belt-and-suspenders.

---

## Testing strategy

`apps/app/src/test/offline/use-run-detail-cache.test.ts` currently has **1** slice-12 test (write-on-debounce). Slice 14 adds **4**, all using `@testing-library/react` + `fake-indexeddb/auto` + happy-dom.

### Test 1: IDB-fresher-than-props swap

```ts
it("returns IDB snapshot when fresher than props on mount", async () => {
  // Pre-seed IDB with updatedAt = Date.now() + 10_000
  const db = await openOfflineDB()
  await writeRunSnapshot(db, {
    runId: RUN_ID, ownerId: OWNER, updatedAt: Date.now() + 10_000,
    run: { ...PROPS_RUN, status: "succeeded" },     // distinguishable from props
    results: [SAMPLE_RESULT],
  })

  const { result } = renderHook(() => useRunDetailCache(OWNER, RUN_ID, PROPS_LIVE))

  await waitFor(() => {
    expect(result.current.run.status).toBe("succeeded")  // IDB's value
    expect(result.current.results).toHaveLength(1)
  })
})
```

### Test 2: IDB-older-than-props baseline write

```ts
it("writes props as baseline when IDB is older than mount-time", async () => {
  const db = await openOfflineDB()
  await writeRunSnapshot(db, {
    runId: RUN_ID, ownerId: OWNER, updatedAt: Date.now() - 10_000,
    run: { ...PROPS_RUN, status: "failed" },
    results: [],
  })

  renderHook(() => useRunDetailCache(OWNER, RUN_ID, PROPS_LIVE))

  await waitFor(async () => {
    const got = await readRunSnapshot(db, RUN_ID)
    expect(got?.run.status).toBe(PROPS_LIVE.run.status)  // baseline = props
  })
})
```

### Test 3: Empty-IDB baseline write

```ts
it("writes baseline snapshot when no IDB entry exists", async () => {
  const db = await openOfflineDB()

  renderHook(() => useRunDetailCache(OWNER, RUN_ID, PROPS_LIVE))

  await waitFor(async () => {
    const got = await readRunSnapshot(db, RUN_ID)
    expect(got).not.toBeNull()
    expect(got?.ownerId).toBe(OWNER)
    expect(got?.run.id).toBe(RUN_ID)
  })
})
```

### Test 4: Race guard — realtime beats IDB

```ts
it("race guard: does not overwrite a realtime update with stale IDB", async () => {
  const db = await openOfflineDB()
  await writeRunSnapshot(db, {
    runId: RUN_ID, ownerId: OWNER, updatedAt: Date.now() + 10_000,
    run: { ...PROPS_RUN, status: "succeeded" },     // would win if no race
    results: [],
  })

  const { result, rerender } = renderHook(
    ({ live }) => useRunDetailCache(OWNER, RUN_ID, live),
    { initialProps: { live: PROPS_LIVE } }
  )

  // Simulate realtime arriving BEFORE IDB read resolves: rerender with new live
  // synchronously after the hook mounts.
  const REALTIME_LIVE: State = {
    run: { ...PROPS_RUN, status: "running" },
    results: PROPS_LIVE.results,
  }
  rerender({ live: REALTIME_LIVE })

  // Let IDB read settle.
  await new Promise((r) => setTimeout(r, 50))

  expect(result.current.run.status).toBe("running")  // realtime, not IDB
})
```

The race guard works because `fake-indexeddb` resolves its async I/O via a microtask queue — the synchronous `rerender({ live: REALTIME_LIVE })` runs before any pending IDB-read microtask drains. The hook's `live`-effect commits `setState(REALTIME_LIVE)`, then the IDB-read effect resolves and finds `prev !== initialLive`, skipping the swap.

### Existing test (slice 12 T2) — still passes

```ts
it("writes the live snapshot to IDB after the debounce window", ...)
```

The debounce path is unchanged. We only added a read on mount and changed `return live` to `return state` — the write-on-state-change effect still fires.

### Test count

- Before: 158
- After slice 14: **162** (+4)

---

## Files

| Action | File | Notes |
|---|---|---|
| Modify | `apps/app/src/lib/offline/use-run-detail-cache.ts` | The full source above replaces the slice-13-T3 version. |
| Modify | `apps/app/src/test/offline/use-run-detail-cache.test.ts` | Add 4 new `it()` blocks alongside the existing slice-12 test. |
| Verify | `apps/app/src/views/run-detail-view.tsx` | No code change required. Signature unchanged. |

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | Race-guard reference-equality breaks if React re-uses the `initialLive` reference unexpectedly | low | `useState(live)` captures the mount value into stable React state; identity stays put across renders. |
| 2 | `fake-indexeddb` resolves so fast that Test 4 doesn't actually exercise the race | medium | Test 4 explicitly relies on microtask ordering. If the test passes for the wrong reason, replace `setTimeout(50)` with explicit `vi.runAllTimersAsync()`. Plan will flag this. |
| 3 | IDB write of the baseline (Test 3) does not survive owner sign-out | low | Slice 12's `clearAuditRunSnapshots` already wipes on sign-out; baseline is intentionally tied to the owner. |
| 4 | Run page `notFound()` short-circuit means the hook never mounts for invalid runId | n/a | By design: SSR 404 before we ever hit the client. |

---

## Smoke test (after implementation)

1. Bring up the app: `bun dev`, sign in.
2. Trigger an audit; navigate to `/dashboard/runs/<id>` while it's running.
3. Watch the page populate via realtime. After ≥ 500 ms, kill the tab.
4. DevTools → Application → IndexedDB → `seo-app-cache` → `audit_run_snapshots` — confirm a row with this `runId` and `updatedAt` close to now.
5. Reload the page. The page should paint with the same data the cache has, even with the network throttled to slow-3G.
6. Sign out → confirm `audit_run_snapshots` is empty (slice 12 carry-forward).
7. Sign in as a different user → navigate to `/dashboard/runs/<id>` for a run that exists for the other account → confirm cross-account hydration is blocked (owner-mismatch guard).

---

## Definition of Done

- [ ] `bun --filter @repo/app test` → 162 passing.
- [ ] `bun --filter @repo/app check-types` → clean.
- [ ] `bun --filter @repo/app build` → clean.
- [ ] `bun --filter @repo/app lint` → clean (warnings may be pre-existing).
- [ ] `useRunDetailCache` returns `state`, not `live`.
- [ ] The mount-effect reads IDB and conditionally swaps via the race-safe `setState((prev) => prev === initialLive ? ... : prev)` form.
- [ ] The baseline-write branch runs when IDB is empty or older.
- [ ] The 4 new tests live in `use-run-detail-cache.test.ts` and pass.
- [ ] No changes to `run-detail-view.tsx`, `run-snapshot.ts`, `db.ts`, or any DB migration.

---

## Slice 15 candidates (carry-forward)

- **SW Background Sync (Chromium)** — drain the audit queue without a tab open.
- **Push notifications** for run completion.
- **Drop unused barrel re-exports** (`@/lib/offline` and similar).
- **Run-detail hydration UX polish** — visible "Last cached: <time>" hint, retry-from-cache button when network fails.
