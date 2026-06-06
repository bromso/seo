# Slice 16 — Dashboard Banner Cache-Age (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/dashboard-banner-cache-age-slice16`
**Carry-forward from:** Slice 15 (run-detail banner enrichment shipped; dashboard is asymmetric)

---

## Goal

When the user is offline on `/dashboard`, the existing yellow `OfflineBanner` shows "You are offline. Showing data cached *X* ago." This is the symmetric extension of slice 15 — the banner's `cachedAt` prop already exists; we just need to wire `useDashboardCache` to feed it a timestamp.

---

## Non-Goals

- No 60-second relative-time ticker — the timestamp is point-in-time at render. (Carried forward to slice 17+.)
- No retry-from-cache button on run-detail (carried forward).
- No SW Background Sync, no push notifications, no barrel cleanup.
- No changes to `OfflineBanner` (prop is reused).
- No changes to `useRunDetailCache` (slice 15 already ships `cacheUpdatedAt`).
- No DB migration, no new dependencies.

---

## Architecture

`useDashboardCache` widens its return type from `State` to `State & { cacheUpdatedAt: number }`. The field is initialized to `propsFetchedAt.current`, set to `existing.updatedAt` on the IDB-swap branch, and to `Date.now()` whenever the fan-out subscription accepts a new state update. `DashboardView` destructures it and passes it to `<OfflineBanner cachedAt={cacheUpdatedAt} />`. The dashboard's existing call site `<OfflineBanner />` becomes `<OfflineBanner cachedAt={cached.cacheUpdatedAt} />` — single-line view change.

This pattern mirrors slice 15's run-detail hook with one structural difference: dashboard's realtime updates flow through an internal fan-out subscription rather than a prop, so the timestamp bump happens inside the `setState((prev) => ...)` callback on each accepted event.

---

## `cacheUpdatedAt` semantics

| Moment | Value | Why |
|---|---|---|
| Initial render (mount) | `propsFetchedAt.current` (= `Date.now()` at `useRef` init) | RSC props arrived just now |
| After IDB-swap branch fires (mount effect, IDB row was fresher) | `existing.updatedAt` | IDB row was the data source |
| Fan-out subscription accepts an `audit_results` INSERT/UPDATE | `Date.now()` | Realtime is "now" |
| Baseline-write branch (mount effect, no swap) | Unchanged: `propsFetchedAt.current` | Data is still the RSC props |
| Fan-out event delivered but rejected by the `next === prev` / `latestScores === prev.latestScores` guard | Unchanged from previous state | Nothing actually changed; no timestamp bump |

The last row is important: the existing fan-out effect already has a no-op guard that returns `prev` when an event doesn't materially change `latestScores`. Slice 16 only updates `cacheUpdatedAt` when the guard's else-branch fires (a real state change).

---

## Hook return shape

```ts
type State = {
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}
type CacheState = State & { cacheUpdatedAt: number }

export function useDashboardCache(ownerId: string, propsSnapshot: State): CacheState
```

Internal `state` is widened from `State` to `CacheState`. The debounced IDB write path is unchanged: it still writes only `{ sites, latestScores, trends }` to IDB with a fresh `updatedAt = Date.now()` — the hook's `cacheUpdatedAt` is computed at state-update time, not derived from the next IDB row.

Initial state on mount:

```ts
const [state, setState] = useState<CacheState>(() => ({
  sites: propsSnapshot.sites,
  latestScores: propsSnapshot.latestScores,
  trends: propsSnapshot.trends,
  cacheUpdatedAt: propsFetchedAt.current,
}))
```

Mount-read swap branch:

```ts
if (existing && existing.updatedAt > propsFetchedAt.current) {
  setState({
    sites: existing.sites,
    latestScores: existing.latestScores,
    trends: existing.trends,
    cacheUpdatedAt: existing.updatedAt,
  })
}
```

Fan-out subscribe handler — only the "accepted update" branch gains `cacheUpdatedAt`:

```ts
return fanOut.subscribe((s) => {
  setState((prev) => {
    const next = applyEventToSnapshot({ ownerId, updatedAt: Date.now(), ...prev }, s)
    return next === prev || next.latestScores === prev.latestScores
      ? prev
      : {
          sites: next.sites,
          latestScores: next.latestScores,
          trends: next.trends,
          cacheUpdatedAt: Date.now(),
        }
  })
})
```

The `applyEventToSnapshot` call passes a `DashboardSnapshot` shape (no `cacheUpdatedAt`); that's fine because `applyEventToSnapshot` only reads/writes the data fields. We pull `updatedAt` from the result purely as input to the snapshot apply; we set `cacheUpdatedAt` independently using `Date.now()` when the branch fires.

---

## View wiring

```tsx
// dashboard-view.tsx
const cached = useDashboardCache(ownerId, { sites, latestScores, trends })
// ...
return (
  <div className="space-y-6">
    <OfflineBanner cachedAt={cached.cacheUpdatedAt} />
    {/* …rest unchanged… */}
  </div>
)
```

One line changes. `cached` already has the right keys for the rest of the JSX (`cached.sites`, `cached.latestScores`, `cached.trends`).

---

## Testing strategy

Tests delta: **165 → 168 (+3 net new, 0 deletions, 0 adaptations).**

The existing 4 dashboard hook tests stay GREEN unchanged because they assert per-field identity (`result.current.sites === SITES`, etc.) — the widened state object's fields still reference the same arrays.

### Test 1: cacheUpdatedAt initialized to ~now

```ts
it("exposes cacheUpdatedAt initialized to ~now on first render", () => {
  const before = Date.now()
  const { result } = renderHook(() =>
    useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
  )
  const after = Date.now()
  expect(result.current.cacheUpdatedAt).toBeGreaterThanOrEqual(before)
  expect(result.current.cacheUpdatedAt).toBeLessThanOrEqual(after)
})
```

### Test 2: cacheUpdatedAt mirrors IDB row on swap

```ts
it("exposes cacheUpdatedAt = existing.updatedAt after IDB swap", async () => {
  const db = await openOfflineDB()
  const idbStamp = Date.now() + 60_000
  await writeSnapshot(db, {
    ownerId: OWNER,
    updatedAt: idbStamp,
    sites: SITES,
    latestScores: [{ ...LATEST_SCORES[0]!, score: 99 }],
    trends: TRENDS,
  })

  const { result } = renderHook(() =>
    useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
  )

  await waitFor(() => {
    expect(result.current.cacheUpdatedAt).toBe(idbStamp)
  })
})
```

### Test 3: cacheUpdatedAt advances on fan-out update

```ts
it("advances cacheUpdatedAt past propsFetchedAt when a fan-out event applies", async () => {
  const { result } = renderHook(() =>
    useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
  )

  const before = result.current.cacheUpdatedAt

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

  await waitFor(
    () => {
      expect(result.current.cacheUpdatedAt).toBeGreaterThan(before)
    },
    { timeout: 2000 }
  )
})
```

This test piggybacks on the same fan-out scaffolding the existing "fan-out INSERT" test uses (`leaderSupabase.emit`, the `FanOutDeps` injection, etc.). The score-change assertion is already covered by the existing test; this one only asserts the timestamp advance.

### View

No view tests. The single-line wiring is covered by smoke checks and TypeScript.

### Final test count

165 baseline → **168** (+3 new).

---

## Files

| Action | File | Notes |
|---|---|---|
| Modify | `apps/app/src/lib/offline/use-dashboard-cache.ts` | Widen `State` → `CacheState`; update both swap and fan-out setState sites; initialize `cacheUpdatedAt` from `propsFetchedAt.current` |
| Modify | `apps/app/src/test/offline/use-dashboard-cache.test.ts` | +3 tests (init, swap, fan-out) |
| Modify | `apps/app/src/views/dashboard-view.tsx` | One-line: `<OfflineBanner cachedAt={cached.cacheUpdatedAt} />` |

---

## Smoke test (after implementation)

1. `bun dev`, sign in.
2. Trigger an audit; let dashboard receive at least one realtime update (a score appears).
3. DevTools → Network → throttle to "Offline".
4. Force a reload (`Cmd+R`) — dashboard should load via cache (slice 7 hydration).
5. **Verify the yellow banner now reads "You are offline. Showing data cached *X* ago."**
6. Throttle back to "Online" — banner disappears.
7. Visit `/dashboard/runs/<id>` while offline — banner reads "cached *Y* ago" with `Y` being the run-detail cache age (independent timestamp from slice 15).

---

## Definition of Done

- [ ] `bun --filter @repo/app test` → 168 passing.
- [ ] `bun --filter @repo/app check-types` → clean.
- [ ] `bun --filter @repo/app build` → clean.
- [ ] `bun --filter @repo/app lint` → clean (warnings may be pre-existing).
- [ ] `useDashboardCache` return shape includes `cacheUpdatedAt: number`.
- [ ] `DashboardView` passes `cached.cacheUpdatedAt` to `<OfflineBanner>`.
- [ ] The 4 existing dashboard hook tests still pass without modification.
- [ ] No changes to `OfflineBanner`, `useRunDetailCache`, or any DB migration.

---

## Slice 17 candidates (carry-forward)

- Retry-from-cache button when fetch fails on run-detail.
- 60s relative-time ticker if staleness ever bites.
- SW Background Sync (Chromium).
- Push notifications on run completion.
- Drop unused barrel re-exports.
- Extract a shared `CacheStateOf<T>` helper if a third cache hook ever appears.
