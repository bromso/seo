# Slice 15 — Offline Banner Cache-Age Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user is offline on `/dashboard/runs/[runId]`, the existing yellow `OfflineBanner` shows "You are offline. Showing data cached *X* ago." with `X` driven by a new `cacheUpdatedAt` field on `useRunDetailCache`'s return shape.

**Architecture:** Three coordinated changes. (1) `useRunDetailCache` widens its return type from `{ run, results }` to `{ run, results, cacheUpdatedAt }`; the field is initialized to `propsFetchedAt`, updated to `existing.updatedAt` on the swap branch, and to `Date.now()` on each realtime live-prop change. (2) `OfflineBanner` gains an optional `cachedAt?: number | null` prop and renders the cache age via the existing `formatRelativeTime` when offline AND the prop is provided. (3) `RunDetailView` destructures `cacheUpdatedAt` from the hook and passes it to `<OfflineBanner>`.

**Tech Stack:** React 19 hooks, native IndexedDB via `@/lib/offline/run-snapshot`, Vitest + `@testing-library/react` (`renderHook`, `render`, `screen`, `waitFor`) + happy-dom + `fake-indexeddb/auto`. No new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice15-offline-banner-cache-age-design.md`](2026-06-06-slice15-offline-banner-cache-age-design.md)

---

## Conventions used throughout

- Working branch: `feat/offline-banner-cache-age-slice15` (already created off `main`; spec committed at `7615bf9`).
- Conventional commits: `refactor(app):` / `feat(app):` / `test(app):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- Slice 14 left **162 tests**. Slice 15 deletes 1 test (slice-12 passthrough) and adds 4 new (2 in `use-run-detail-cache.test.ts`, 2 in `offline-banner.test.tsx`) → final count **165**.
- Tests live at `apps/app/src/test/`.
- Use `cd apps/app && bun run test` (vitest filter paths work from the package cwd). `bun --filter @repo/app run test` is the cross-package alternative; both work.

---

## File map

| Action | File | Slice-15 responsibility |
|---|---|---|
| Modify | `apps/app/src/lib/offline/use-run-detail-cache.ts` | Widen state + return shape; add `cacheUpdatedAt`; update race-guard condition to compare data refs |
| Modify | `apps/app/src/test/offline/use-run-detail-cache.test.ts` | Delete slice-12 passthrough test, adapt slice-14 race-guard assertion, add 2 new `cacheUpdatedAt` tests |
| Modify | `apps/app/src/components/offline-banner.tsx` | Optional `cachedAt?: number \| null` prop with conditional message |
| Modify | `apps/app/src/test/components/offline-banner.test.tsx` | Add 2 new prop-branch tests |
| Modify | `apps/app/src/views/run-detail-view.tsx` | Destructure `cacheUpdatedAt`; pass to `<OfflineBanner>` |

---

## Task 1: Widen hook return shape with `cacheUpdatedAt`

**Files:**
- Modify: `apps/app/src/lib/offline/use-run-detail-cache.ts`
- Modify: `apps/app/src/test/offline/use-run-detail-cache.test.ts`

This task does five coordinated things:
1. Adds two new tests asserting `cacheUpdatedAt` on the return shape.
2. Widens the hook's state and return type to include `cacheUpdatedAt: number`.
3. Updates the race-guard condition to compare data refs (`prev.run === initialLive.run && prev.results === initialLive.results`) because the wrapping state object identity now changes immediately at mount.
4. Deletes the slice-12 passthrough test (`result.current === live`) — invariant no longer holds.
5. Adapts the slice-14 race-guard test assertion from `expect(result.current).toBe(realtimeLive)` to `expect(result.current.run).toBe(realtimeLive.run)` — semantic check preserved.

### Step 1: Read the current hook + test files

```bash
cat apps/app/src/lib/offline/use-run-detail-cache.ts
cat apps/app/src/test/offline/use-run-detail-cache.test.ts
```

Confirm the slice-14 versions:
- The hook returns `state` of type `{ run, results }`, with race guard `prev === initialLive`.
- The test file has 6 tests including "returns the live prop synchronously on first render (passthrough)" at line 41 and "race guard: does not overwrite a realtime update with stale IDB" at line 145.

### Step 2: Delete the slice-12 passthrough test

In `apps/app/src/test/offline/use-run-detail-cache.test.ts`, find and remove this entire `it()` block (lines 41-45 in the slice-14 state):

```ts
  it("returns the live prop synchronously on first render (passthrough)", () => {
    const live = { run: RUN_ROW, results: RESULTS }
    const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))
    expect(result.current).toBe(live)
  })
```

### Step 3: Adapt the slice-14 race-guard test assertion

In the same file, find the test "race guard: does not overwrite a realtime update with stale IDB" (around line 145). Find these final two assertion lines:

```ts
    expect(result.current).toBe(realtimeLive)
    expect(result.current.run.status).toBe("running")
```

Replace with:

```ts
    expect(result.current.run).toBe(realtimeLive.run)
    expect(result.current.results).toBe(realtimeLive.results)
    expect(result.current.run.status).toBe("running")
```

Semantic check preserved: realtime's `run` and `results` references win over IDB's by identity.

### Step 4: Add the two new `cacheUpdatedAt` tests

Append both `it()` blocks inside the existing `describe("useRunDetailCache", () => { ... })`:

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

    await waitFor(
      () => {
        expect(result.current.cacheUpdatedAt).toBe(idbStamp)
      },
      { timeout: 2000 }
    )
  })
```

### Step 5: Run — expect 2 FAIL on the new tests

```bash
cd apps/app && bun run test src/test/offline/use-run-detail-cache.test.ts
```

Expected: **5 PASS + 2 FAIL** (7 tests total: 6 original − 1 deleted + 2 new).

- The adapted race-guard test PASSES against the OLD hook: slice-14's propagation effect ran `setState(live)`, so `state === realtimeLive`, which means `state.run === realtimeLive.run` and `state.results === realtimeLive.results` both hold. The adapted assertion is forward-compatible.
- The 2 new `cacheUpdatedAt` tests RED because `result.current.cacheUpdatedAt` is `undefined` on the old hook. Failure messages: `expected undefined to be greater than or equal to 1...` on the first; `expected undefined to be 1...` on the second.

### Step 6: Replace `apps/app/src/lib/offline/use-run-detail-cache.ts`

Full updated contents:

```ts
"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { debounce } from "@/lib/offline/_debounce"
import { openOfflineDB } from "@/lib/offline/db"
import { readRunSnapshot, sweepRunSnapshotsLRU, writeRunSnapshot } from "@/lib/offline/run-snapshot"

type LiveState = { run: AuditRunRow; results: AuditResultRow[] }
type CacheState = LiveState & { cacheUpdatedAt: number }

export function useRunDetailCache(
  ownerId: string,
  runId: string,
  live: LiveState
): CacheState {
  const propsFetchedAt = useRef<number>(Date.now())
  const [initialLive] = useState(live)
  const [state, setState] = useState<CacheState>(() => ({
    run: live.run,
    results: live.results,
    cacheUpdatedAt: propsFetchedAt.current,
  }))

  // Mount: read IDB; swap if fresher, otherwise write a baseline.
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
            prev.run === initialLive.run && prev.results === initialLive.results
              ? {
                  run: existing.run,
                  results: existing.results,
                  cacheUpdatedAt: existing.updatedAt,
                }
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
        // IDB unavailable — silent degrade.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, runId, initialLive])

  // Live updates from above (realtime) override.
  useEffect(() => {
    if (live !== initialLive) {
      setState({
        run: live.run,
        results: live.results,
        cacheUpdatedAt: Date.now(),
      })
    }
  }, [live, initialLive])

  // Debounced write on every state change.
  const writeDebounced = useMemo(
    () =>
      debounce(async (snap: CacheState) => {
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

Five changes vs. the slice-14 version:
1. `CacheState = LiveState & { cacheUpdatedAt: number }` and the hook's return type is `CacheState`.
2. `useState<CacheState>` initializer uses `propsFetchedAt.current` for the initial `cacheUpdatedAt`.
3. Swap branch's race guard widened to `prev.run === initialLive.run && prev.results === initialLive.results`.
4. Swap branch's new state includes `cacheUpdatedAt: existing.updatedAt`.
5. Live-propagation effect builds a fresh state object including `cacheUpdatedAt: Date.now()`.

The debounced write function takes `CacheState` (which structurally satisfies the previous shape — only `run` and `results` are referenced inside). The IDB row's `updatedAt` is still the fresh `Date.now()` when the debounced write fires.

### Step 7: Run the file's tests — expect PASS

```bash
cd apps/app && bun run test src/test/offline/use-run-detail-cache.test.ts
```

Expected: **7 PASS** (5 remaining original tests after the slice-12 passthrough deletion + 2 new). The remaining tests:
- "writes the live snapshot to IDB after the debounce window" — still passes (debounce path unchanged).
- "returns IDB snapshot when fresher than props on mount" — still passes (asserts `run.status` and `results.length`).
- "writes baseline snapshot when no IDB entry exists" — still passes (asserts the IDB row's contents).
- "writes props as baseline when IDB is older than mount-time" — still passes.
- "race guard: does not overwrite a realtime update with stale IDB" — passes with the adapted assertion (data-ref comparison).
- "exposes cacheUpdatedAt initialized to ~now on first render" — new, passes.
- "exposes cacheUpdatedAt = existing.updatedAt after IDB swap" — new, passes.

### Step 8: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **163 passing** (162 baseline + 2 new − 1 deleted), typecheck clean.

**Note:** typecheck may also flag `run-detail-view.tsx` because its destructure `const { run, results } = useRunDetailCache(...)` is still valid (the returned object has those keys), but the hook now returns a wider type. The destructure compiles cleanly. No error expected here. If TS does complain, do not modify `run-detail-view.tsx` in this task — that's T3's scope.

### Step 9: Commit

```bash
git add apps/app/src/lib/offline/use-run-detail-cache.ts apps/app/src/test/offline/use-run-detail-cache.test.ts
git commit -m "refactor(app): expose cacheUpdatedAt from useRunDetailCache"
```

---

## Task 2: `OfflineBanner` accepts `cachedAt` prop

**Files:**
- Modify: `apps/app/src/components/offline-banner.tsx`
- Modify: `apps/app/src/test/components/offline-banner.test.tsx`

### Step 1: Read current files

```bash
cat apps/app/src/components/offline-banner.tsx
cat apps/app/src/test/components/offline-banner.test.tsx
```

Confirm the current banner has no props, and the current test file has 4 tests (online/offline mount + event toggle behavior).

### Step 2: Add the first failing test — cachedAt populates the message

Append this `it()` block inside the existing `describe("OfflineBanner", () => { ... })` in `apps/app/src/test/components/offline-banner.test.tsx`:

```tsx
  it("shows cache age in the message when offline and cachedAt is provided", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    render(<OfflineBanner cachedAt={fiveMinAgo} />)
    expect(screen.getByText(/cached 5m ago/i)).toBeTruthy()
  })
```

### Step 3: Run — expect 1 FAIL + a TypeScript error

```bash
cd apps/app && bun run test src/test/components/offline-banner.test.tsx
```

Expected: TypeScript error (`Property 'cachedAt' does not exist on type 'IntrinsicAttributes'`) AND/OR runtime assertion failure (`Unable to find an element with the text: /cached 5m ago/i`). The TS error may surface only via `bun --filter @repo/app check-types` — Vitest's tsc-noop run may swallow it. Either way the test isn't green.

### Step 4: Replace `apps/app/src/components/offline-banner.tsx`

Full updated contents:

```tsx
"use client"
import { useEffect, useState } from "react"
import { formatRelativeTime } from "@/lib/format"

type Props = { cachedAt?: number | null }

export function OfflineBanner({ cachedAt }: Props = {}) {
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

Three changes:
1. New `Props` type with optional `cachedAt`.
2. Import `formatRelativeTime` from `@/lib/format`.
3. Conditional message based on whether `cachedAt` is truthy.

The default-parameter form `({ cachedAt }: Props = {})` ensures `<OfflineBanner />` (no props) still works at all existing call sites.

### Step 5: Add the second new test — fallback when cachedAt is undefined

Append inside the same `describe`:

```tsx
  it("falls back to default message when offline and cachedAt is undefined", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    expect(
      screen.getByText(/last data we cached on this device/i)
    ).toBeTruthy()
  })
```

### Step 6: Run — expect PASS on all 6 banner tests

```bash
cd apps/app && bun run test src/test/components/offline-banner.test.tsx
```

Expected: 6 PASS (4 existing + 2 new).

### Step 7: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **165 passing** (163 after T1 + 2 new), typecheck clean.

### Step 8: Commit

```bash
git add apps/app/src/components/offline-banner.tsx apps/app/src/test/components/offline-banner.test.tsx
git commit -m "feat(app): OfflineBanner shows cache age when offline and cachedAt provided"
```

---

## Task 3: Wire `cacheUpdatedAt` through `RunDetailView`

**Files:**
- Modify: `apps/app/src/views/run-detail-view.tsx`

No new tests. The integration is trivial and covered by the smoke check in T4. The hook test (T1) covers the value propagation; the banner test (T2) covers the rendering branch.

### Step 1: Read current view

```bash
cat apps/app/src/views/run-detail-view.tsx
```

Confirm the destructure on line 22 is currently:

```tsx
const { run, results } = useRunDetailCache(initialRun.owner_id, initialRun.id, live)
```

And the JSX line 27 currently reads:

```tsx
<OfflineBanner />
```

### Step 2: Replace the destructure and the banner

In `apps/app/src/views/run-detail-view.tsx`:

Change the destructure to also pick up `cacheUpdatedAt`:

```tsx
const { run, results, cacheUpdatedAt } = useRunDetailCache(initialRun.owner_id, initialRun.id, live)
```

Change the banner JSX to pass the prop:

```tsx
<OfflineBanner cachedAt={cacheUpdatedAt} />
```

Both edits are single-line. No other changes in this file.

### Step 3: Run the full suite + typecheck + build + lint

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
bun --filter @repo/app lint
```

Expected: 165 passing, typecheck clean, build clean, lint clean (pre-existing warnings only).

### Step 4: Commit

```bash
git add apps/app/src/views/run-detail-view.tsx
git commit -m "feat(app): run-detail banner shows cache age when offline"
```

---

## Task 4: Final DoD sweep

**Files:** none.

### Step 1: Confirm final state

```bash
bun --filter @repo/app test
# Expected: 165 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)
```

### Step 2: Verify call-site consistency

```bash
grep -n "OfflineBanner" apps/app/src
```

Expected hits:
- `apps/app/src/components/offline-banner.tsx` — the component
- `apps/app/src/test/components/offline-banner.test.tsx` — its tests
- `apps/app/src/views/run-detail-view.tsx` — passes `cachedAt`
- One or more dashboard call sites — no `cachedAt`, still render fallback text

If a dashboard call site is missing or the test count is wrong, stop and investigate.

### Step 3: No commit

T4 is verify-only. The branch should now have:
- `7615bf9 docs(app): slice 15 design — OfflineBanner cache-age hint` (pre-existing)
- 3 implementation commits from T1 / T2 / T3.

```bash
git log --oneline main..HEAD
```

---

## Report Format

(For the implementer to fill in after T4.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (165 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `useRunDetailCache` return shape includes `cacheUpdatedAt` | ✓ T1 |
  | 6 | `OfflineBanner` accepts `cachedAt?: number \| null` | ✓ T2 |
  | 7 | `RunDetailView` passes `cacheUpdatedAt` to banner | ✓ T3 |
  | 8 | 4 new tests in slice-15 (2 hook + 2 banner) | ✓ T1 + T2 |
  | 9 | Slice-12 passthrough test deleted | ✓ T1 |
  | 10 | Slice-14 race-guard test assertion adapted | ✓ T1 |
- Total test count
- Commit SHA list (3 implementation commits expected)
- Slice 15 release note (one line)
- Any carry-forwards for slice 16

---

## After slice 15

Slice 16 candidates:

- **Retry-from-cache button** when fetch fails on run-detail.
- **Dashboard banner enrichment** (`useDashboardCache` already stores `updatedAt`).
- **60s relative-time ticker** if banner staleness ever bites.
- **SW Background Sync (Chromium)** — drain the audit queue without a tab open.
- **Push notifications** on run completion.
- **Drop unused barrel re-exports.**
