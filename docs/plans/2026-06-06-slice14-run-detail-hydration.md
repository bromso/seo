# Slice 14 — IDB Hydration on Run-Detail Mount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `useRunDetailCache` read its IDB snapshot on mount, swap state when the cached snapshot is fresher than the server-rendered props, write a baseline when IDB is empty or stale, and skip the swap if a realtime update has already overridden state.

**Architecture:** The slice 12 / slice 13 passthrough hook becomes stateful. Three React effects run in order: (1) a once-on-mount async IDB read that either swaps state (when `existing.updatedAt > propsFetchedAt` AND state hasn't changed since mount) or writes the props as a new baseline; (2) a live-propagation effect that updates state whenever the `live` prop changes after mount; (3) the existing debounced write-back effect. The race between effects (1) and (2) is resolved with a reference-equality guard against `initialLive` captured into stable `useState`.

**Tech Stack:** React 19 hooks (`useEffect`, `useMemo`, `useRef`, `useState`), native IndexedDB via `@/lib/offline/run-snapshot`, Vitest + `@testing-library/react` (`renderHook`, `waitFor`) + happy-dom + `fake-indexeddb/auto`. No new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice14-run-detail-hydration-design.md`](2026-06-06-slice14-run-detail-hydration-design.md)

---

## Conventions used throughout

- Working branch: `feat/run-detail-hydration-slice14` (already created off `main`; spec committed at `eaa0862`).
- Conventional commits: `test(app):` / `feat(app):` / `refactor(app):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- After slice 13 the app workspace has **158 tests**. Slice 14 adds **4 net new** → final count **162**.
- Tests live at `apps/app/src/test/`.
- Use `bun --filter @repo/app <script>` for per-package scripts.

---

## File map

| Action | File | Slice-14 responsibility |
|---|---|---|
| Modify | `apps/app/src/lib/offline/use-run-detail-cache.ts` | Stateful cache: mount-read + swap + baseline write + race guard. |
| Modify | `apps/app/src/test/offline/use-run-detail-cache.test.ts` | Add 4 new `it()` blocks alongside the existing slice-12 tests. |
| Verify | `apps/app/src/views/run-detail-view.tsx` | No code change required (signature unchanged). Just sanity-check in T5. |

---

## Task 1: Mount-read swap branch (Test 1)

**Files:**
- Modify: `apps/app/src/test/offline/use-run-detail-cache.test.ts`
- Modify: `apps/app/src/lib/offline/use-run-detail-cache.ts`

### Step 1: Read the current hook

```bash
cat apps/app/src/lib/offline/use-run-detail-cache.ts
```

Confirm slice 13 T3's version — passthrough that writes via debounce only, returns `live` directly.

### Step 2: Read the current test file

```bash
cat apps/app/src/test/offline/use-run-detail-cache.test.ts
```

Confirm two existing tests: "returns the live prop synchronously on first render (passthrough)" and "writes the live snapshot to IDB after the debounce window". Note the imports — we'll reuse `OWNER`, `RUN`, `RUN_ROW`, `RESULTS`.

### Step 3: Add Test 1 — IDB-fresher-than-props swap

Append this new `it()` block inside the existing `describe("useRunDetailCache", () => { ... })` block in `apps/app/src/test/offline/use-run-detail-cache.test.ts`. Also add `writeRunSnapshot` to the existing `from "@/lib/offline/run-snapshot"` import.

```ts
  it("returns IDB snapshot when fresher than props on mount", async () => {
    const db = await openOfflineDB()
    const fresherRun: AuditRunRow = { ...RUN_ROW, status: "succeeded" }
    const fresherResults: AuditResultRow[] = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        run_id: RUN,
        category: "performance",
        score: 95,
        status: "succeeded",
        issues: [],
        metrics: null,
        started_at: "2026-06-05T12:00:00Z",
        finished_at: "2026-06-05T12:00:30Z",
      },
    ]
    await writeRunSnapshot(db, {
      runId: RUN,
      ownerId: OWNER,
      updatedAt: Date.now() + 10_000,
      run: fresherRun,
      results: fresherResults,
    })

    const live = { run: RUN_ROW, results: RESULTS }
    const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))

    await waitFor(
      () => {
        expect(result.current.run.status).toBe("succeeded")
        expect(result.current.results).toHaveLength(1)
      },
      { timeout: 2000 }
    )
  })
```

Make sure the updated import at the top of the test file reads:

```ts
import { readRunSnapshot, writeRunSnapshot } from "@/lib/offline/run-snapshot"
```

### Step 4: Run — expect FAIL on the new test only

```bash
bun --filter @repo/app test apps/app/src/test/offline/use-run-detail-cache.test.ts
```

Expected: 2 PASS (existing) + 1 FAIL (the new one — current passthrough hook returns `live`, so `result.current.run.status` is `"running"`, not `"succeeded"`).

### Step 5: Implement the stateful hook with the swap branch

Replace the entire contents of `apps/app/src/lib/offline/use-run-detail-cache.ts` with:

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

export function useRunDetailCache(ownerId: string, runId: string, live: State): State {
  const propsFetchedAt = useRef<number>(Date.now())
  const [initialLive] = useState(live)
  const [state, setState] = useState<State>(live)

  // Mount: read IDB and swap if fresher.
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
          setState({ run: existing.run, results: existing.results })
        }
      } catch {
        // IDB unavailable — silent degrade.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, runId])

  // Live updates from above (realtime) override.
  useEffect(() => {
    if (live !== initialLive) setState(live)
  }, [live, initialLive])

  // Debounced write on every state change.
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

This adds the mount-read swap branch only. The baseline-write branch lands in T2; the race-guarded `prev === initialLive` form lands in T3.

### Step 6: Run — expect PASS on Test 1 + both existing tests

```bash
bun --filter @repo/app test apps/app/src/test/offline/use-run-detail-cache.test.ts
```

Expected: 3 PASS (2 existing + Test 1).

Why the existing passthrough test still passes: `useState(live)` captures `live` as the initial state by reference. On first render `result.current` (which is `state`) **is** `live`. `expect(result.current).toBe(live)` succeeds.

Why the existing debounce-write test still passes: the debounce effect still fires on state change and writes after 500 ms.

### Step 7: Run the full test suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: 159 passing (158 + 1), typecheck clean.

### Step 8: Commit

```bash
git add apps/app/src/test/offline/use-run-detail-cache.test.ts apps/app/src/lib/offline/use-run-detail-cache.ts
git commit -m "feat(app): hydrate useRunDetailCache from IDB on mount (swap branch)"
```

---

## Task 2: Baseline-write branch (Test 3 + Test 2)

**Files:**
- Modify: `apps/app/src/test/offline/use-run-detail-cache.test.ts`
- Modify: `apps/app/src/lib/offline/use-run-detail-cache.ts`

This task adds the "else" branch of the mount-read effect: when IDB is empty OR older than `propsFetchedAt`, write the props as a baseline. Two new tests cover both sub-cases. We do the empty-IDB test first (Test 3), then add the older-IDB test (Test 2) for regression coverage.

### Step 1: Add Test 3 — empty IDB baseline write

Append this `it()` block inside the existing `describe("useRunDetailCache", () => { ... })`:

```ts
  it("writes baseline snapshot when no IDB entry exists", async () => {
    const live = { run: RUN_ROW, results: RESULTS }
    renderHook(() => useRunDetailCache(OWNER, RUN, live))

    await waitFor(
      async () => {
        const db = await openOfflineDB()
        const got = await readRunSnapshot(db, RUN)
        expect(got).not.toBeNull()
        expect(got?.ownerId).toBe(OWNER)
        expect(got?.runId).toBe(RUN)
        expect(got?.run.id).toBe(RUN_ROW.id)
      },
      { timeout: 2000 }
    )
  })
```

### Step 2: Run — Test 3 may already PASS (debounce path), but we want the baseline branch to handle it explicitly

```bash
bun --filter @repo/app test apps/app/src/test/offline/use-run-detail-cache.test.ts
```

If Test 3 passes, that's because the existing debounced state-change effect writes the snapshot after 500 ms. We still want an immediate baseline write for slow-IDB cases — proceed to Step 3 regardless.

### Step 3: Add the baseline-write branch to the mount-read effect

Edit `apps/app/src/lib/offline/use-run-detail-cache.ts`. Replace the mount-read effect block:

```ts
  // Mount: read IDB and swap if fresher.
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
          setState({ run: existing.run, results: existing.results })
        }
      } catch {
        // IDB unavailable — silent degrade.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, runId])
```

With:

```ts
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
          setState({ run: existing.run, results: existing.results })
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
```

Two changes:
1. `else` branch writes the props as a baseline with `updatedAt = propsFetchedAt`.
2. Effect deps gain `initialLive` (Biome's `useExhaustiveDependencies` will require it).

### Step 4: Run — Tests 1 + 3 PASS

```bash
bun --filter @repo/app test apps/app/src/test/offline/use-run-detail-cache.test.ts
```

Expected: 4 PASS (2 existing + Test 1 + Test 3).

### Step 5: Add Test 2 — older IDB baseline overwrite

Now that the baseline branch exists, add the regression test for the "older IDB" sub-case. Append inside the same `describe`:

```ts
  it("writes props as baseline when IDB is older than mount-time", async () => {
    const db = await openOfflineDB()
    const olderRun: AuditRunRow = { ...RUN_ROW, status: "failed" }
    await writeRunSnapshot(db, {
      runId: RUN,
      ownerId: OWNER,
      updatedAt: Date.now() - 10_000,
      run: olderRun,
      results: [],
    })

    const live = { run: RUN_ROW, results: RESULTS }
    renderHook(() => useRunDetailCache(OWNER, RUN, live))

    await waitFor(
      async () => {
        const got = await readRunSnapshot(db, RUN)
        expect(got?.run.status).toBe(RUN_ROW.status)
      },
      { timeout: 2000 }
    )
  })
```

This asserts that after the hook mounts, the IDB row's `run.status` matches the props (`"running"`), not the stale IDB value (`"failed"`).

### Step 6: Run — Tests 1 + 2 + 3 PASS

```bash
bun --filter @repo/app test apps/app/src/test/offline/use-run-detail-cache.test.ts
```

Expected: 5 PASS (2 existing + Test 1 + Test 3 + Test 2).

### Step 7: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: 161 passing (158 + 3), typecheck clean.

### Step 8: Commit

```bash
git add apps/app/src/test/offline/use-run-detail-cache.test.ts apps/app/src/lib/offline/use-run-detail-cache.ts
git commit -m "feat(app): write baseline snapshot when IDB is empty or stale"
```

---

## Task 3: Race-guard the swap (Test 4)

**Files:**
- Modify: `apps/app/src/test/offline/use-run-detail-cache.test.ts`
- Modify: `apps/app/src/lib/offline/use-run-detail-cache.ts`

This task locks the race between the mount-read swap and a `live`-prop change that arrives before the async IDB read resolves. The guard form is `setState((prev) => prev === initialLive ? ... : prev)`.

### Step 1: Add Test 4 — race guard

Append inside the same `describe`:

```ts
  it("race guard: does not overwrite a realtime update with stale IDB", async () => {
    const db = await openOfflineDB()
    const idbRun: AuditRunRow = { ...RUN_ROW, status: "succeeded" }
    await writeRunSnapshot(db, {
      runId: RUN,
      ownerId: OWNER,
      updatedAt: Date.now() + 10_000,
      run: idbRun,
      results: [],
    })

    const propsLive = { run: RUN_ROW, results: RESULTS }
    const { result, rerender } = renderHook(
      ({ live }: { live: { run: AuditRunRow; results: AuditResultRow[] } }) =>
        useRunDetailCache(OWNER, RUN, live),
      { initialProps: { live: propsLive } }
    )

    // Simulate realtime: rerender with a new `live` reference synchronously
    // after mount, before the IDB read microtask drains.
    const realtimeLive = {
      run: { ...RUN_ROW, status: "running" as const, started_at: "2026-06-05T12:01:00Z" },
      results: RESULTS,
    }
    rerender({ live: realtimeLive })

    // Let the IDB read settle.
    await new Promise((r) => setTimeout(r, 100))

    expect(result.current).toBe(realtimeLive)
    expect(result.current.run.status).toBe("running")
  })
```

### Step 2: Run — expect FAIL on Test 4

```bash
bun --filter @repo/app test apps/app/src/test/offline/use-run-detail-cache.test.ts
```

Expected: 5 PASS + 1 FAIL. Without the guard, the mount-read effect sees `existing.updatedAt > propsFetchedAt` and unconditionally swaps to the IDB value (`status: "succeeded"`), overwriting the realtime `setState(realtimeLive)` that ran during the rerender. The assertion `expect(result.current).toBe(realtimeLive)` fails.

If by chance Test 4 already passes (microtask ordering happens to favor the rerender's effect over the IDB read), skip to Step 4 — the implementation is already race-safe and the test simply locks it down.

### Step 3: Add the race guard

Edit `apps/app/src/lib/offline/use-run-detail-cache.ts`. Replace the swap line inside the mount-read effect:

```ts
        if (
          existing &&
          existing.ownerId === ownerId &&
          existing.updatedAt > propsFetchedAt.current
        ) {
          setState({ run: existing.run, results: existing.results })
        } else {
```

With:

```ts
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
```

The functional `setState` form lets us inspect the current `state` at the moment of the update. If the live-effect already ran `setState(live)`, `prev` is the new live value — not `initialLive` — so we skip the swap and keep the realtime data.

### Step 4: Run — Test 4 PASS

```bash
bun --filter @repo/app test apps/app/src/test/offline/use-run-detail-cache.test.ts
```

Expected: 6 PASS (2 existing + Test 1 + Test 2 + Test 3 + Test 4).

### Step 5: Run the full suite + typecheck + build + lint

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
bun --filter @repo/app lint
```

Expected: 162 passing (158 + 4), typecheck clean, build clean, lint clean (pre-existing warnings only).

### Step 6: Commit

```bash
git add apps/app/src/test/offline/use-run-detail-cache.test.ts apps/app/src/lib/offline/use-run-detail-cache.ts
git commit -m "feat(app): race-guard the IDB swap against in-flight live updates"
```

---

## Task 4: Final DoD sweep

**Files:** none (no production change, no docs change).

### Step 1: Verify the call site is untouched

```bash
grep -n useRunDetailCache apps/app/src/views/run-detail-view.tsx
```

Expected: a single line at the top of `RunDetailView`:

```tsx
const { run, results } = useRunDetailCache(initialRun.owner_id, initialRun.id, live)
```

No change needed — the destructure still works because the hook still returns `{ run, results }`.

### Step 2: Confirm final state

```bash
bun --filter @repo/app test
# Expected: 162 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)
```

### Step 3: No commit

T4 is verify-only. The branch should now contain 3 implementation commits + 1 spec commit (the spec was committed before this plan ran).

```bash
git log --oneline main..HEAD
```

Expected 4 commits:
1. `docs(app): slice 14 design — IDB hydration on run-detail mount + race guard`  *(pre-existing)*
2. `feat(app): hydrate useRunDetailCache from IDB on mount (swap branch)`
3. `feat(app): write baseline snapshot when IDB is empty or stale`
4. `feat(app): race-guard the IDB swap against in-flight live updates`

---

## Report Format

(For the implementer to fill in after T4.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (162 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `useRunDetailCache` returns `state`, not `live` | ✓ T1 |
  | 6 | Mount-read effect: swap branch + baseline branch + race guard | ✓ T1 + T2 + T3 |
  | 7 | `run-detail-view.tsx` unchanged | ✓ T4 |
  | 8 | 4 new tests in `use-run-detail-cache.test.ts` | ✓ T1 + T2 + T3 |
- Total test count
- Commit SHA list (3 implementation commits expected)
- Slice 14 release note (one line)
- Any carry-forwards for slice 15

---

## After slice 14

Slice 15 candidates (carried forward from slice 13 and slice 14):

- **SW Background Sync (Chromium)** — drain the audit queue without a tab open.
- **Push notifications** for run completion.
- **Drop unused barrel re-exports** — audit `@/lib/offline` and similar.
- **Run-detail hydration UX polish** — visible "Last cached: <time>" hint, retry-from-cache button when network fails.
