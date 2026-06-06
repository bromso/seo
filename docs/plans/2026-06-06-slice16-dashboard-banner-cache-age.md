# Slice 16 — Dashboard Banner Cache-Age Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user is offline on `/dashboard`, the existing yellow `OfflineBanner` shows "You are offline. Showing data cached *X* ago." by piping a new `cacheUpdatedAt` field from `useDashboardCache` into the banner's slice-15 `cachedAt` prop.

**Architecture:** Two coordinated changes. (1) `useDashboardCache` widens its return type from `State` to `State & { cacheUpdatedAt: number }`; the field is initialized to `propsFetchedAt`, set to `existing.updatedAt` on the IDB-swap branch, and to `Date.now()` whenever the fan-out subscription accepts a state update. (2) `DashboardView` destructures `cacheUpdatedAt` from the hook and passes it to `<OfflineBanner cachedAt={...}>`.

**Tech Stack:** React 19 hooks, native IndexedDB via `@/lib/offline/snapshot`, fan-out via `@/lib/realtime/use-fan-out`, Vitest + `@testing-library/react` (`renderHook`, `act`, `waitFor`) + happy-dom + `fake-indexeddb/auto`. No new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice16-dashboard-banner-cache-age-design.md`](2026-06-06-slice16-dashboard-banner-cache-age-design.md)

---

## Conventions used throughout

- Working branch: `feat/dashboard-banner-cache-age-slice16` (already created off `main`; spec committed at `03072c2`).
- Conventional commits: `refactor(app):` / `feat(app):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- Slice 15 left **165 tests**. Slice 16 adds **3 net new** (no deletions, no adaptations) → final count **168**.
- Use `cd apps/app && bun run test` (vitest filter paths work from the package cwd).

---

## File map

| Action | File | Slice-16 responsibility |
|---|---|---|
| Modify | `apps/app/src/lib/offline/use-dashboard-cache.ts` | Widen `State` → `CacheState`; update both swap and fan-out setState sites |
| Modify | `apps/app/src/test/offline/use-dashboard-cache.test.ts` | +3 tests (init, swap, fan-out) |
| Modify | `apps/app/src/views/dashboard-view.tsx` | One-line wire-up: `<OfflineBanner cachedAt={cached.cacheUpdatedAt} />` |

---

## Task 1: Widen `useDashboardCache` with `cacheUpdatedAt`

**Files:**
- Modify: `apps/app/src/lib/offline/use-dashboard-cache.ts`
- Modify: `apps/app/src/test/offline/use-dashboard-cache.test.ts`

This task adds three new tests and widens the hook in one TDD cycle. No existing tests need deletion or adaptation — the existing "passthrough on first render" test uses per-field identity assertions (`result.current.sites === SITES`) which survive the widening.

### Step 1: Read the current hook + test files

```bash
cat apps/app/src/lib/offline/use-dashboard-cache.ts
cat apps/app/src/test/offline/use-dashboard-cache.test.ts
```

Confirm:
- Hook returns `State` of type `{ sites, latestScores, trends }`. Internal state initializer is `useState<State>(propsSnapshot)`.
- Test file has 4 tests in `describe("useDashboardCache", () => { ... })`. The first one ("returns propsSnapshot synchronously on first render") asserts three per-field identity comparisons, NOT a whole-object identity comparison.

### Step 2: Add three new failing tests

Append all three `it()` blocks at the end of the existing `describe("useDashboardCache", () => { ... })` in `apps/app/src/test/offline/use-dashboard-cache.test.ts`:

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

The third test reuses the existing scaffolding (`leaderSupabase`, `FanOutDeps`, `RUN` constant) declared at the top of the test file — no new imports needed.

### Step 3: Run — expect 3 FAIL

```bash
cd apps/app && bun run test src/test/offline/use-dashboard-cache.test.ts
```

Expected: **4 PASS + 3 FAIL** (7 tests total: 4 existing + 3 new). The new tests RED because `result.current.cacheUpdatedAt` is `undefined` on the current hook:
- Test 1: `expected undefined to be greater than or equal to 1...`
- Test 2: `expected undefined to be 1...` (after `waitFor` times out)
- Test 3: `expected undefined to be greater than undefined` (NaN/undefined comparison fails)

### Step 4: Replace `apps/app/src/lib/offline/use-dashboard-cache.ts`

Full updated contents:

```ts
"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { debounce } from "@/lib/offline/_debounce"
import { sweepOtherOwners } from "@/lib/offline/clear-cache"
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

type CacheState = State & { cacheUpdatedAt: number }

export function useDashboardCache(ownerId: string, propsSnapshot: State): CacheState {
  const propsFetchedAt = useRef<number>(Date.now())
  const [state, setState] = useState<CacheState>(() => ({
    sites: propsSnapshot.sites,
    latestScores: propsSnapshot.latestScores,
    trends: propsSnapshot.trends,
    cacheUpdatedAt: propsFetchedAt.current,
  }))
  const fanOut = useFanOut(ownerId)

  // Stable capture so the mount effect runs once per ownerId.
  const [initialProps] = useState(propsSnapshot)

  // On mount: read IDB; if fresher than props, swap. Otherwise write props.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const db = await openOfflineDB()
        void sweepOtherOwners(db, ownerId)
        const existing = await readSnapshot(db, ownerId)
        if (cancelled) return
        if (existing && existing.updatedAt > propsFetchedAt.current) {
          setState({
            sites: existing.sites,
            latestScores: existing.latestScores,
            trends: existing.trends,
            cacheUpdatedAt: existing.updatedAt,
          })
        } else {
          await writeSnapshot(db, {
            ownerId,
            updatedAt: propsFetchedAt.current,
            ...initialProps,
          })
        }
      } catch {
        // IDB unavailable (e.g., private mode) — silently degrade to props.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, initialProps])

  // Debounced IDB writer for event bursts.
  const writeDebounced = useMemo(
    () =>
      debounce(async (snap: CacheState) => {
        try {
          const db = await openOfflineDB()
          await writeSnapshot(db, {
            ownerId,
            updatedAt: Date.now(),
            sites: snap.sites,
            latestScores: snap.latestScores,
            trends: snap.trends,
          })
        } catch {
          // ignored
        }
      }, 500),
    [ownerId]
  )

  // Subscribe to fan-out; apply events to state.
  useEffect(() => {
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
  }, [fanOut, ownerId])

  // Re-write whenever state changes (debounced).
  useEffect(() => {
    writeDebounced(state)
  }, [state, writeDebounced])

  return state
}
```

Five changes vs. the slice-15 version:
1. New `CacheState = State & { cacheUpdatedAt: number }`; hook return type is `CacheState`.
2. `useState<CacheState>` initializer adds `cacheUpdatedAt: propsFetchedAt.current`.
3. Swap branch's `setState` now includes `cacheUpdatedAt: existing.updatedAt`.
4. Fan-out subscribe's else-branch (state actually changed) now includes `cacheUpdatedAt: Date.now()`.
5. Debounced write function is typed `CacheState` and explicitly destructures `sites`/`latestScores`/`trends` — it no longer spreads `cacheUpdatedAt` into the IDB row (the row's `updatedAt` is separately set to `Date.now()`).

The `applyEventToSnapshot({ ownerId, updatedAt: Date.now(), ...prev }, s)` call still works because `applyEventToSnapshot` reads `sites`/`latestScores`/`trends` from the spread; the extra `cacheUpdatedAt` is harmless (it's not a `DashboardSnapshot` field but it's not destructively read either). If TypeScript complains about the extra property, omit `cacheUpdatedAt` explicitly:

```ts
const { cacheUpdatedAt: _unused, ...prevSnap } = prev
const next = applyEventToSnapshot({ ownerId, updatedAt: Date.now(), ...prevSnap }, s)
```

Try the simpler form first; only fall back to the explicit destructure if typecheck flags it.

### Step 5: Run — expect 7 PASS

```bash
cd apps/app && bun run test src/test/offline/use-dashboard-cache.test.ts
```

Expected: **7 PASS** (4 existing + 3 new). The 4 existing tests stay green because:
- "returns propsSnapshot synchronously on first render" asserts per-field identity — `state.sites === SITES`, etc. — which holds after widening.
- "writes propsSnapshot to IDB after mount" asserts IDB row contents, unchanged by the widening.
- "hydrates from IDB on mount when IDB has fresher data" asserts `latestScores[0]?.score`, unchanged.
- "updates state when a FanOut audit_results INSERT arrives" asserts `latestScores[0]?.score`, unchanged.

### Step 6: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **168 passing**, typecheck clean.

**TypeScript note on `applyEventToSnapshot`:** if the spread `{ ownerId, updatedAt: Date.now(), ...prev }` is flagged for excess `cacheUpdatedAt`, switch to the explicit destructure form shown in Step 4. The dashboard-view destructure `cached.sites`/`cached.latestScores`/`cached.trends` is unaffected (those keys are still present).

### Step 7: Commit

```bash
git add apps/app/src/lib/offline/use-dashboard-cache.ts apps/app/src/test/offline/use-dashboard-cache.test.ts
git commit -m "refactor(app): expose cacheUpdatedAt from useDashboardCache"
```

---

## Task 2: Wire `cacheUpdatedAt` through `DashboardView`

**Files:**
- Modify: `apps/app/src/views/dashboard-view.tsx`

No new tests. The integration is a one-line edit; the hook test (T1) covers value propagation and the slice-15 banner tests cover the rendering branch.

### Step 1: Read current view

```bash
cat apps/app/src/views/dashboard-view.tsx
```

Confirm line 25 is currently:

```tsx
const cached = useDashboardCache(ownerId, { sites, latestScores, trends })
```

And line 29 currently reads:

```tsx
<OfflineBanner />
```

### Step 2: Change the banner JSX

In `apps/app/src/views/dashboard-view.tsx`, replace the `<OfflineBanner />` line with:

```tsx
<OfflineBanner cachedAt={cached.cacheUpdatedAt} />
```

No other changes. The destructure-via-`cached.*` style stays the same; we just pull one more field off of it.

### Step 3: Run the full suite + typecheck + build + lint

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
bun --filter @repo/app lint
```

Expected: 168 passing, typecheck clean, build clean, lint clean (pre-existing warnings only).

### Step 4: Commit

```bash
git add apps/app/src/views/dashboard-view.tsx
git commit -m "feat(app): dashboard banner shows cache age when offline"
```

---

## Task 3: Final DoD sweep

**Files:** none.

### Step 1: Verify call-site symmetry

```bash
grep -rn "OfflineBanner" apps/app/src
```

Expected hits:
- `apps/app/src/components/offline-banner.tsx` — the component itself.
- `apps/app/src/test/components/offline-banner.test.tsx` — its 6 tests (slice 15).
- `apps/app/src/views/dashboard-view.tsx` — now passes `cachedAt={cached.cacheUpdatedAt}` (T2).
- `apps/app/src/views/run-detail-view.tsx` — still passes `cachedAt={cacheUpdatedAt}` (slice 15, unchanged).

If a call site is missing or still parameterless, stop and investigate.

### Step 2: Confirm final state

```bash
bun --filter @repo/app test
# Expected: 168 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)
```

### Step 3: No commit

T3 is verify-only. The branch should now contain:
- `03072c2 docs(app): slice 16 design — dashboard banner cache-age hint` (pre-existing)
- 2 implementation commits from T1 / T2.

```bash
git log --oneline main..HEAD
```

---

## Report Format

(For the implementer to fill in after T3.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (168 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `useDashboardCache` return shape includes `cacheUpdatedAt` | ✓ T1 |
  | 6 | `DashboardView` passes `cached.cacheUpdatedAt` to banner | ✓ T2 |
  | 7 | 3 new tests in `use-dashboard-cache.test.ts` | ✓ T1 |
  | 8 | 4 existing dashboard hook tests still pass unchanged | ✓ T1 |
- Total test count
- Commit SHA list (2 implementation commits expected)
- Slice 16 release note (one line)
- Whether the simple `{ ownerId, updatedAt, ...prev }` spread worked or you needed the explicit destructure fallback
- Any carry-forwards for slice 17

---

## After slice 16

Slice 17 candidates:

- **Retry-from-cache button** when fetch fails on run-detail.
- **60s relative-time ticker** if banner staleness ever bites.
- **SW Background Sync (Chromium)** — drain the audit queue without a tab open.
- **Push notifications** on run completion.
- **Drop unused barrel re-exports.**
- **Extract shared `CacheStateOf<T>` helper** if a third cache hook ever appears.
