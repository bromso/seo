# Slice 15 — Offline Banner Cache-Age Hint (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/offline-banner-cache-age-slice15`
**Carry-forward from:** Slice 14 (IDB hydration shipped but invisible to users)

---

## Goal

When the user is offline on `/dashboard/runs/[runId]`, the existing yellow `OfflineBanner` gains a contextual suffix telling them when the data was last cached: "You are offline. Showing data cached *5m ago*." Online users see no change. The dashboard banner stays unchanged for now.

---

## Non-Goals

- No 60-second relative-time ticker — the timestamp is point-in-time at render. If a user sits offline for 10 minutes the displayed age becomes stale; that's a slice 16+ polish item.
- No "Reload from cache" button when fetch fails — deferred to slice 16.
- No dashboard banner enrichment — symmetric work, but separate slice.
- No new dependencies, no DB migration, no SW changes, no new UI primitives (Card, Badge, etc.).

---

## Architecture

`useRunDetailCache` adds a third field to its return shape — `cacheUpdatedAt: number` — tracking the timestamp of the data currently displayed. `OfflineBanner` gains an optional `cachedAt?: number | null` prop and, when offline AND the prop is provided, renders "Showing data cached *X* ago" via the existing `formatRelativeTime`. `RunDetailView` threads the value from the hook into the banner; the dashboard `<OfflineBanner />` call site stays unchanged (the new prop is optional, falls back to the existing message).

This is the smallest possible surface that makes slice 14's hydration visible to users.

---

## `cacheUpdatedAt` semantics

The field reflects "the timestamp the data we're currently showing was last updated":

| Moment | Value | Why |
|---|---|---|
| Initial render (mount) | `propsFetchedAt.current` (= `Date.now()` at `useRef` init) | RSC props arrived client-side just now |
| After IDB-swap branch fires | `existing.updatedAt` | The IDB row was the data source; its timestamp wins |
| After a `live` prop change (realtime delivered) | `Date.now()` at the moment the live-propagation effect ran | Realtime is "now" by definition |
| Baseline-write branch (no swap) | Unchanged: `propsFetchedAt.current` | Data is still the RSC props |

The slice-14 race guard still applies: if `live` already moved before the IDB read resolves, the swap is skipped and `cacheUpdatedAt` stays whatever the live-effect set it to.

---

## Hook return shape

```ts
type CacheState = {
  run: AuditRunRow
  results: AuditResultRow[]
  cacheUpdatedAt: number
}

export function useRunDetailCache(
  ownerId: string,
  runId: string,
  live: { run: AuditRunRow; results: AuditResultRow[] }
): CacheState
```

Internal `state` is widened from `{ run, results }` to `{ run, results, cacheUpdatedAt }`. The debounced write-back path is unchanged: it still writes only `{ run, results }` to IDB with a fresh `updatedAt = Date.now()` — the hook's `cacheUpdatedAt` is computed at state-update time, not derived from the next IDB row.

Initial state on mount:

```ts
const [state, setState] = useState<CacheState>({
  run: live.run,
  results: live.results,
  cacheUpdatedAt: propsFetchedAt.current,
})
```

Live-propagation effect now also bumps `cacheUpdatedAt`:

```ts
useEffect(() => {
  if (live !== initialLive) {
    setState({ run: live.run, results: live.results, cacheUpdatedAt: Date.now() })
  }
}, [live, initialLive])
```

Mount-read swap branch carries the IDB timestamp through:

```ts
setState((prev) =>
  prev.run === initialLive.run && prev.results === initialLive.results
    ? { run: existing.run, results: existing.results, cacheUpdatedAt: existing.updatedAt }
    : prev
)
```

Note: the race-guard condition now compares the data fields (`prev.run === initialLive.run && prev.results === initialLive.results`) instead of the wrapping object identity, because the state object identity now changes immediately at mount (it's a fresh object containing `cacheUpdatedAt`). Comparing the data references preserves the slice-14 semantics: if `live` already arrived, `prev.run` and `prev.results` will be the live values, not `initialLive`'s.

---

## `OfflineBanner` prop

```tsx
type Props = { cachedAt?: number | null }

export function OfflineBanner({ cachedAt }: Props = {}): JSX.Element | null {
  // ...existing online/offline subscription unchanged...

  if (online) return null
  const message = cachedAt
    ? `You are offline. Showing data cached ${formatRelativeTime(new Date(cachedAt))}.`
    : "You are offline. Showing the last data we cached on this device."
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {message}
    </div>
  )
}
```

The dashboard's existing call `<OfflineBanner />` continues to render the fallback message. Run-detail switches to `<OfflineBanner cachedAt={cacheUpdatedAt} />`.

---

## View wiring

```tsx
// run-detail-view.tsx
const live = useRealtimeRun(initialRun.owner_id, initialRun.id, initialRun, initialResults)
const { run, results, cacheUpdatedAt } = useRunDetailCache(initialRun.owner_id, initialRun.id, live)

return (
  <div className="space-y-6">
    <OfflineBanner cachedAt={cacheUpdatedAt} />
    {/* …rest unchanged… */}
  </div>
)
```

Only one line changes in the JSX (the `<OfflineBanner>` call) plus the destructure picks up `cacheUpdatedAt`.

---

## Testing strategy

Tests delta: **162 → 165** (+4 new − 1 deleted; see Decisions below).

### `OfflineBanner` (existing 4 tests + 2 new)

Existing tests in `apps/app/src/test/components/offline-banner.test.tsx` rely on toggling `navigator.onLine`. The two new tests reuse that setup.

```tsx
it("shows cache age in the message when offline and cachedAt is provided", () => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  render(<OfflineBanner cachedAt={fiveMinAgo} />)
  expect(screen.getByText(/cached 5m ago/i)).toBeTruthy()
})

it("falls back to default message when offline and cachedAt is undefined", () => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
  render(<OfflineBanner />)
  expect(
    screen.getByText(/last data we cached on this device/i)
  ).toBeTruthy()
})
```

The existing 4 tests stay green because the new prop is optional.

### `useRunDetailCache` (existing 6 tests + 2 new)

```ts
it("exposes cacheUpdatedAt initialized to ~now on first render", () => {
  const before = Date.now()
  const live = { run: RUN_ROW, results: RESULTS }
  const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))
  const after = Date.now()
  expect(result.current.cacheUpdatedAt).toBeGreaterThanOrEqual(before)
  expect(result.current.cacheUpdatedAt).toBeLessThanOrEqual(after)
})

it("exposes cacheUpdatedAt = existing.updatedAt after IDB swap", async () => {
  const db = await openOfflineDB()
  const idbStamp = Date.now() + 10_000
  await writeRunSnapshot(db, {
    runId: RUN,
    ownerId: OWNER,
    updatedAt: idbStamp,
    run: { ...RUN_ROW, status: "completed" },
    results: [],
  })

  const live = { run: RUN_ROW, results: RESULTS }
  const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))

  await waitFor(() => {
    expect(result.current.cacheUpdatedAt).toBe(idbStamp)
  }, { timeout: 2000 })
})
```

### Existing `useRunDetailCache` tests — pre-flight check

The slice-12 passthrough test asserts `result.current === live`. Slice-14 made `state === live` on first render (via `useState(live)`). Slice-15 widens the state shape, so on first render `state` is **no longer** `live` (it's a new object `{ run: live.run, results: live.results, cacheUpdatedAt: ... }`). **This test will RED.** The fix is to delete the passthrough test entirely — it served slice 12's purpose (proving the hook didn't break the synchronous render contract) and is superseded by the more direct assertions in slices 14 and 15 (which check `result.current.run.status`, etc.).

**Decision recorded:** delete the slice-12 passthrough test in slice 15. Net test count remains: 158 baseline + 4 slice-14 + 4 slice-15 − 1 deleted = **165**. (Adjusting from the earlier "166" estimate.)

Slice-12 debounce-write test still passes because state still changes on mount; the debounce effect still fires.

Slice-14 swap test (`returns IDB snapshot when fresher than props on mount`) asserts `result.current.run.status === "completed"` — still holds because the state shape gain is additive on the same `run` reference.

Slice-14 race-guard test asserts `expect(result.current).toBe(realtimeLive)`. **This test will also RED** — the state is no longer `realtimeLive` by reference, it's a new object. The fix is to change the assertion to `expect(result.current.run).toBe(realtimeLive.run)` and `expect(result.current.run.status).toBe("running")`. The semantic check (realtime wins over IDB) is preserved.

**Decision recorded:** edit the slice-14 race test assertion as described. Not a test deletion; an assertion adaptation to the widened return shape.

### Final test count

158 baseline → 162 (slice 14) → **165** in slice 15: −1 (delete passthrough) + 4 (slice 15 adds 4 new) = 165.

The plan's task ordering will explicitly RED-then-GREEN both adaptations so a reader sees the failure modes.

---

## Files

| Action | File | Notes |
|---|---|---|
| Modify | `apps/app/src/lib/offline/use-run-detail-cache.ts` | Add `cacheUpdatedAt` to state + return; widen race-guard comparison to use data refs |
| Modify | `apps/app/src/components/offline-banner.tsx` | Optional `cachedAt?: number \| null` prop + conditional message |
| Modify | `apps/app/src/views/run-detail-view.tsx` | Destructure `cacheUpdatedAt`; pass to `<OfflineBanner>` |
| Modify | `apps/app/src/test/components/offline-banner.test.tsx` | +2 tests (prop branches) |
| Modify | `apps/app/src/test/offline/use-run-detail-cache.test.ts` | +2 tests (cacheUpdatedAt branches), delete passthrough test, adapt race-guard assertion |

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | Widening the return shape silently breaks a consumer outside `RunDetailView` | low | Only one consumer exists (the view). TypeScript will flag any missed call site. |
| 2 | The dashboard's `<OfflineBanner />` call site picks up the optional prop wrong and renders the cached-age message with `undefined` | low | The conditional `cachedAt ?` checks for truthy; `undefined` falls through to the existing message. Explicitly covered by Test 2. |
| 3 | `formatRelativeTime` formats "just now" for sub-10s ages — looks redundant ("cached just now" while offline is mildly misleading) | low | Acceptable for slice 15. The "just now" path only fires if the user transitioned online → offline within 10s, in which case the data is genuinely fresh. |
| 4 | Realtime updates while offline (improbable but possible via leftover SSE/WebSocket buffer) push `cacheUpdatedAt` to `Date.now()`, making the banner say "cached just now" indefinitely | very low | Realtime can't actually deliver while `navigator.onLine === false`. Not a practical concern. |
| 5 | Internationalization / pluralization of "5m ago" | n/a | App is English-only. `formatRelativeTime` already handles plural-ish via abbreviations. |

---

## Smoke test (after implementation)

1. `bun dev`, sign in.
2. Trigger an audit; navigate to `/dashboard/runs/<id>` while it's running.
3. Watch realtime updates land. Open DevTools → Network → throttle to "Offline".
4. Force a reload (`Cmd+R`) — page should load via cache (slice 14 hydration).
5. **Verify the yellow banner now reads "You are offline. Showing data cached *X* ago."** with X being a reasonable relative time.
6. Throttle back to "Online" — banner disappears.
7. Visit `/dashboard` while offline — banner still says the existing "Showing the last data we cached on this device." (no cache-age suffix; dashboard intentionally not enriched in this slice).

---

## Definition of Done

- [ ] `bun --filter @repo/app test` → 165 passing.
- [ ] `bun --filter @repo/app check-types` → clean.
- [ ] `bun --filter @repo/app build` → clean.
- [ ] `bun --filter @repo/app lint` → clean (warnings may be pre-existing).
- [ ] `useRunDetailCache` return shape includes `cacheUpdatedAt: number`.
- [ ] `OfflineBanner` accepts optional `cachedAt?: number | null` and renders the contextual suffix when offline + prop provided.
- [ ] `RunDetailView` wires `cacheUpdatedAt` through to `<OfflineBanner>`.
- [ ] No changes to `useDashboardCache`, no DB migration, no new dependencies.

---

## Slice 16 candidates (carry-forward)

- Retry-from-cache button when fetch fails on run-detail.
- Dashboard banner enrichment (`useDashboardCache` already stores `updatedAt`).
- 60s relative-time ticker if staleness ever bites.
- SW Background Sync (Chromium).
- Push notifications on run completion.
- Drop unused barrel re-exports.
