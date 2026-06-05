# Slice 7 — Offline-capable Dashboard Design

**Status:** Spec — ready for implementation planning.

**Driver:** The dashboard breaks completely without network. Slice 7 adds an IndexedDB-backed cache so `/dashboard` renders the last-known scores when offline, and ensures `/dashboard/runs/[runId]` re-visits work too via the existing Service Worker HTML cache.

**Out of scope (deferred):**
- PWA install prompt (slice 8 candidate).
- Background sync — queueing audit runs while offline and replaying when back online (slice 9 candidate).
- Server-side render of the offline state (we rely on the cached HTML + client hydration).

---

## Goal

When the user has previously loaded `/dashboard` while online, they can revisit `/dashboard` offline and see their most recent radar + trends + site cards (sourced from IndexedDB). When they re-visit a `/dashboard/runs/[runId]` page they've loaded before, the page renders from the Service Worker's HTML cache.

A persistent "You are offline" banner shows on both pages when `navigator.onLine === false`.

## Non-goals

- New Realtime functionality. The existing `FanOut` from slice 6 already pushes events; slice 7 just persists them.
- Mutations offline. "Run audit" still requires network and will fail today's standard error path while offline.
- Caching arbitrary runs (only the runs reachable via dashboard navigation are cached as HTML by the SW).
- Multi-version IDB migrations. Bump version + add migration when a future slice needs it.

---

## Architecture

```
Online flow
───────────
RSC /dashboard → Supabase queries → propsSnapshot ─┐
                                                   ▼
                                     useDashboardCache(ownerId, propsSnapshot)
                                                   │
                                                   ├─ writes snapshot to IDB
                                                   │
                                                   ├─ subscribes to FanOut (slice 6)
                                                   │   on event: update React state + write IDB
                                                   │
                                                   └─ returns { sites, latestScores, trends }
                                                               ▼
                                                  rendered dashboard UI


Offline flow
────────────
navigator → /dashboard (offline)
        │
        ▼
Serwist SW NetworkFirst → network fails → serves cached /dashboard HTML
        │
        ▼
React hydrates with the HTML's baked-in props (= last successful RSC render's data)
        │
        ▼
useDashboardCache reads IDB on mount → if IDB updatedAt > props' fetchedAt, swap state
        │
        ▼
Dashboard shows the freshest data still on device (typically IDB beats HTML cache)
OfflineBanner shows
```

**Dashboard:** IDB is the source of "freshest data". The HTML cache is just the shell. The IDB is updated by FanOut events while online, so it captures events that happened after the last navigation.

**Run-detail:** No IDB. The Serwist HTML cache already preserves per-runId pages on visit. Offline re-visit serves the cached HTML; React hydrates with the baked-in initial run + results. The page's existing `useRealtimeRun` keeps working in the no-op-when-no-network mode (FanOut falls back to per-tab when WebSocket fails; no events arrive while offline; that's fine).

**OfflineBanner:** a small component using `online`/`offline` window events plus `navigator.onLine` for initial state. Rendered in both dashboard-view and run-detail-view.

**Sign-out:** clears the cache entry for the signing-out user so the next user's dashboard isn't seeded with the prior user's data.

---

## File layout

```
apps/app/src/lib/offline/
├── db.ts                     openOfflineDB() + _resetOfflineDBCache() (test helper) + DB constants
├── snapshot.ts               readSnapshot / writeSnapshot / clearSnapshot
├── use-dashboard-cache.ts    React hook: hydrate from IDB, write on FanOut events (debounced)
├── clear-cache.ts            clearDashboardCache(ownerId) — called from sign-out
└── index.ts                  barrel

apps/app/src/components/
└── offline-banner.tsx        client component, online/offline-event-driven

apps/app/src/test/offline/
├── db.test.ts                ~2 tests
├── snapshot.test.ts          ~4 tests
└── use-dashboard-cache.test.ts ~4 tests (uses fake-indexeddb + renderHook)
```

Modifications:
- `apps/app/src/views/dashboard-view.tsx` — wraps data props through `useDashboardCache`; renders `OfflineBanner`.
- `apps/app/src/views/run-detail-view.tsx` — renders `OfflineBanner`.
- `apps/app/src/app/(app)/sign-out/route.ts` (or wherever the sign-out logic lives) — calls `clearDashboardCache(user.id)` before signing out.
- `apps/app/package.json` — add `fake-indexeddb` as a `devDependency`.

---

## IDB schema

```ts
const DB_NAME = "seo-app-cache"
const DB_VERSION = 1
const STORE_DASHBOARD = "dashboard_snapshots"
```

One object store: `dashboard_snapshots`, keyed by `ownerId`. Value shape:

```ts
export type DashboardSnapshot = {
  ownerId: string
  updatedAt: number          // Date.now() at write
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}
```

No indexes — primary key by `ownerId` is sufficient.

## Public API

```ts
// lib/offline/db.ts
export function openOfflineDB(): Promise<IDBDatabase>
export function _resetOfflineDBCache(): void   // test-only

// lib/offline/snapshot.ts
export type DashboardSnapshot = { … }
export function readSnapshot(db: IDBDatabase, ownerId: string): Promise<DashboardSnapshot | null>
export function writeSnapshot(db: IDBDatabase, snap: DashboardSnapshot): Promise<void>
export function clearSnapshot(db: IDBDatabase, ownerId: string): Promise<void>

// lib/offline/use-dashboard-cache.ts
export function useDashboardCache(
  ownerId: string,
  propsSnapshot: Omit<DashboardSnapshot, "ownerId" | "updatedAt">,
): {
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}

// lib/offline/clear-cache.ts
export function clearDashboardCache(ownerId: string): Promise<void>
```

## Hook behavior in detail

```ts
const propsFetchedAt = useRef<number>(Date.now())

const [snap, setSnap] = useState({
  sites: props.sites,
  latestScores: props.latestScores,
  trends: props.trends,
})

const fanOut = useFanOut(ownerId)

useEffect(() => {
  let cancelled = false
  void (async () => {
    const db = await openOfflineDB()
    const existing = await readSnapshot(db, ownerId)
    if (cancelled) return
    if (existing && existing.updatedAt > propsFetchedAt.current) {
      // IDB is fresher — typically because FanOut wrote during the previous
      // session after the cached HTML was generated.
      setSnap({
        sites: existing.sites,
        latestScores: existing.latestScores,
        trends: existing.trends,
      })
    } else {
      await writeSnapshot(db, {
        ownerId,
        updatedAt: propsFetchedAt.current,
        ...snap,
      })
    }
  })()
  return () => {
    cancelled = true
  }
}, [ownerId])

// Debounced writer for FanOut event bursts
const writeDebounced = useMemo(() => debounce(async (next: typeof snap) => {
  const db = await openOfflineDB()
  await writeSnapshot(db, { ownerId, updatedAt: Date.now(), ...next })
}, 500), [ownerId])

useEffect(() => {
  return fanOut.subscribe((s) => {
    // Apply event to snap (mirrors the logic that lives in useRealtimeScores'
    // RSC re-fetch path, but applied locally so the cache stays current).
    setSnap((prev) => applyEventToSnapshot(prev, s, ownerId))
  })
}, [fanOut, ownerId])

useEffect(() => {
  writeDebounced(snap)
}, [snap, writeDebounced])

return snap
```

**`applyEventToSnapshot`** is a pure helper (added to `snapshot.ts`) that takes `(prev, signal, ownerId)` and returns the updated snapshot. For an `audit_results INSERT` event it updates the matching row in `latestScores` and appends a `trends` row. For an `audit_runs UPDATE`, no change (dashboard scores don't react to runs). For `kind:"resync"`, the React state is left unchanged (the parallel `useRealtimeScores` will trigger `router.refresh()` which re-supplies fresh props).

A small `debounce(fn, ms)` utility ships in `lib/offline/use-dashboard-cache.ts` to avoid spammy IDB writes when many events arrive in a burst.

---

## Sign-out integration

The existing sign-out flow handles a server-side `supabase.auth.signOut()`. Slice 7 adds a client-side step that runs BEFORE the redirect:

- Capture `user.id` from the session before signing out.
- Call `clearDashboardCache(user.id)` from a client-side handler (e.g., the `SignOutButton` component).
- Then trigger the existing server sign-out flow.

If the sign-out is initiated server-side (no client component involved), the cache stays on disk — but the next user who signs in on the same browser will write THEIR ownerId's snapshot, never reading the previous user's keyed entry. Cross-user leakage is structurally prevented by `ownerId` keying. The clear is for tidiness, not security.

---

## OfflineBanner

```tsx
"use client"
export function OfflineBanner() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
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

Imported and rendered at the top of `dashboard-view.tsx` and `run-detail-view.tsx`.

---

## Testing strategy

`db.test.ts` (~2 tests):
- Opens at version 1; `dashboard_snapshots` store exists.
- Second `openOfflineDB()` call returns the cached promise (same instance).

`snapshot.test.ts` (~5 tests):
- `writeSnapshot` then `readSnapshot` returns the same payload.
- `readSnapshot` for a missing ownerId returns `null`.
- Overwriting the same ownerId doesn't create a duplicate.
- `clearSnapshot` removes the entry; subsequent read returns `null`.
- `applyEventToSnapshot` updates `latestScores` correctly on an `audit_results INSERT`.

`use-dashboard-cache.test.ts` (~4 tests, `renderHook` + `fake-indexeddb`):
- First sync render returns `propsSnapshot` unchanged.
- Empty IDB on mount → writes propsSnapshot; returned data still matches props.
- IDB with `updatedAt > propsFetchedAt` → hook swaps to IDB data after mount.
- A FanOut `audit_results INSERT` event updates returned state AND writes to IDB.

Total new tests: ~11. Slice 6's 92 → slice 7's ~103.

**Manual smoke (steps 25-29 in `apps/app/README.md`):** see Section "Smoke" in implementation plan.

---

## Migration & backwards-compat

- No schema changes. No new migrations.
- One new dependency: `fake-indexeddb` (devDependency). No new runtime dependencies.
- `useDashboardCache` is additive — `dashboard-view.tsx` gains 3 lines. `useRealtimeScores` still triggers `router.refresh()` when online; the cache hook runs in parallel.
- Sign-out gains one async call (clear cache); failure of that call should not block sign-out.

---

## Risks

- **`navigator.onLine` is unreliable.** Banner can lie (says online when DNS is broken). Acceptable — banner is informational, not load-bearing.
- **IDB quota.** A snapshot is ~10-100 KB; one entry per user. Won't approach quota.
- **Concurrent writes across tabs.** Each tab writes the same data (same FanOut events). Last write wins; idempotent.
- **HTML cache age.** If the user hasn't visited `/dashboard` in days, the SW serves a very old HTML. The IDB hydration on mount immediately swaps to fresher data if any was captured via FanOut after the cached HTML's render. If no online session has happened, the cached HTML's data is all they get.
- **Multi-account on one browser.** Snapshot keyed by `ownerId` — A's data never leaks into B's view. Sign-out cleanup is best-effort tidiness.
- **`fake-indexeddb` test polyfill** has known divergence from real IDB on transaction lifetime edge cases. Our usage stays inside the safe subset (single-store get/put/delete in same transaction).

---

## After slice 7

Slice 8 candidates:

- **PWA install prompt** — `beforeinstallprompt` capture + Install button in dashboard header; iOS "Add to Home Screen" instructions card.
- **Background sync for `runAuditAction`** — queue audit triggers in IDB while offline; replay via SW background sync when online again.
- **Per-run IDB cache** — extend `seo-app-cache` to a `run_snapshots` store keyed by `runId`, populated when the user visits a run-detail page.
