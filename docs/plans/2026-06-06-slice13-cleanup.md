# Slice 13 — Cleanup Bundle + Double-Click Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay down four small carry-forwards (hoist `z.uuid()`, extract `debounce`, narrow `useRunDetailCache` effect deps) and lock the slice-11 double-click race shut with a regression test on `SiteScoreCard`.

**Architecture:** Pure refactor + one regression test. Five tasks: T1 hoists the route schema; T2 creates `_debounce.ts` + tests + refactors `use-dashboard-cache.ts`; T3 refactors `use-run-detail-cache.ts` and narrows its effect deps; T4 adds the SiteScoreCard double-click test (with a fallback `useRef` guard if it RED's); T5 runs the DoD sweep.

**Tech Stack:** Vitest with happy-dom, `@testing-library/react`, `@testing-library/user-event` (slice 10), Biome via Husky. No new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice13-cleanup-design.md`](2026-06-06-slice13-cleanup-design.md)

---

## Conventions used throughout

- Working branch: `feat/cleanup-slice13` (already created off `main`; spec committed at `d83c2c6`).
- Conventional commits: `refactor(app):` / `test(app):` / `docs(app):` / `chore(app):`.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 12's 156 tests must keep passing after every task; slice 13 adds 2 net new.
- Tests live at `apps/app/src/test/`.
- Use `bun --filter @repo/app <script>` for per-package scripts.

---

## Task 1: Hoist `z.uuid()` in `/api/audit-run`

**Files:**
- Modify: `apps/app/src/app/api/audit-run/route.ts`

No new tests. The 3 slice-11 route tests (with key success, invalid key 400, 23505 dedup) and the 4 slice-8 tests (success, 400, 401, 500) all still pass — the behavior is identical.

### Step 1: Read current `route.ts`

```bash
cat apps/app/src/app/api/audit-run/route.ts
```

Confirm the current code constructs `z.uuid()` inline inside the POST handler.

### Step 2: Modify `apps/app/src/app/api/audit-run/route.ts`

Add a module-level constant just below the existing imports and switch the inline construction. Full updated file:

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

const IDEMPOTENCY_KEY_SCHEMA = z.uuid()

export async function POST(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = RunAuditSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 }
    )
  }

  const rawKey = req.headers.get("idempotency-key")
  const idempotencyKey = rawKey === null || rawKey === "" ? null : rawKey
  if (
    idempotencyKey !== null &&
    !IDEMPOTENCY_KEY_SCHEMA.safeParse(idempotencyKey).success
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid idempotency key" },
      { status: 400 }
    )
  }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("audit_runs")
    .insert({
      site_id: parsed.data.siteId,
      owner_id: user.id,
      requested_url: parsed.data.requestedUrl,
      triggered_by: "manual",
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505" && idempotencyKey !== null) {
      const { data: existing } = await supabase
        .from("audit_runs")
        .select("id")
        .eq("owner_id", user.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ ok: true, runId: existing.id as string })
      }
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, runId: data.id as string })
}
```

### Step 3: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. Test count stays at **156**.

### Step 4: Commit

```bash
git add apps/app/src/app/api/audit-run/route.ts
git commit -m "refactor(app): hoist Idempotency-Key schema to module constant"
```

---

## Task 2: Extract `debounce` to `_debounce.ts` + test + refactor `use-dashboard-cache.ts`

**Files:**
- Create: `apps/app/src/lib/offline/_debounce.ts`
- Create: `apps/app/src/test/offline/_debounce.test.ts`
- Modify: `apps/app/src/lib/offline/use-dashboard-cache.ts`

### Step 1: Failing test

Create `apps/app/src/test/offline/_debounce.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { debounce } from "@/lib/offline/_debounce"

describe("debounce", () => {
  it("coalesces multiple calls within the window into one trailing invocation", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced("a")
    debounced("b")
    debounced("c")
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith("c")
    vi.useRealTimers()
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 1 new failure (module not found).

### Step 3: Implement `apps/app/src/lib/offline/_debounce.ts`

```ts
// Internal helper shared by use-dashboard-cache.ts and use-run-detail-cache.ts.
// Not exported from the offline barrel; consumers import directly.

export function debounce<T extends (...args: never[]) => unknown>(
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
```

### Step 4: Refactor `apps/app/src/lib/offline/use-dashboard-cache.ts`

Read the current file:

```bash
cat apps/app/src/lib/offline/use-dashboard-cache.ts
```

Find the local `function debounce(...)` definition (slice 7 T5). Delete it entirely. Add this import at the top of the file (near the other `@/lib/offline/...` imports):

```ts
import { debounce } from "@/lib/offline/_debounce"
```

The rest of the file is unchanged — `useMemo(() => debounce(...))` continues to work.

### Step 5: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Expected: 1 new test passes + all existing tests still pass → **157 total** (156 + 1).

### Step 6: Commit

```bash
git add apps/app/src/lib/offline/_debounce.ts apps/app/src/test/offline/_debounce.test.ts apps/app/src/lib/offline/use-dashboard-cache.ts
git commit -m "refactor(app): extract shared debounce helper to _debounce.ts"
```

---

## Task 3: Refactor `use-run-detail-cache.ts` + narrow effect deps

**Files:**
- Modify: `apps/app/src/lib/offline/use-run-detail-cache.ts`

Two changes in one task: drop the local `debounce` (already extracted in T2) and narrow the effect deps from `[live, writeDebounced]` to `[live.run, live.results, writeDebounced]` (via destructuring).

### Step 1: Replace `apps/app/src/lib/offline/use-run-detail-cache.ts`

Full updated content:

```ts
"use client"
import { useEffect, useMemo } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { debounce } from "@/lib/offline/_debounce"
import { openOfflineDB } from "@/lib/offline/db"
import { sweepRunSnapshotsLRU, writeRunSnapshot } from "@/lib/offline/run-snapshot"

type State = { run: AuditRunRow; results: AuditResultRow[] }

export function useRunDetailCache(
  ownerId: string,
  runId: string,
  live: State
): State {
  const { run, results } = live

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
    [ownerId, runId]
  )

  useEffect(() => {
    writeDebounced({ run, results })
  }, [run, results, writeDebounced])

  return live
}
```

Three changes vs. slice 12 T3's version:
1. Local `function debounce(...)` block deleted.
2. `import { debounce } from "@/lib/offline/_debounce"` added.
3. Effect deps narrowed: `const { run, results } = live` destructure at the top + `useEffect(() => writeDebounced({ run, results }), [run, results, writeDebounced])`.

The returned value is still `live` (passthrough — slice 12 design choice).

### Step 2: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Expected: 157 passing (slice 12's 2 hook tests still green; debounce extraction doesn't change behavior). If Biome's `useExhaustiveDependencies` rule complains about the new dep array, the destructured form should satisfy it. If it flags anyway, add a one-line `biome-ignore` comment with a reason and re-verify.

### Step 3: Commit

```bash
git add apps/app/src/lib/offline/use-run-detail-cache.ts
git commit -m "refactor(app): useRunDetailCache uses shared debounce + narrowed deps"
```

---

## Task 4: Double-click guard test for `SiteScoreCard`

**Files:**
- Create: `apps/app/src/test/components/site-score-card.test.tsx`
- (Conditional) Modify: `apps/app/src/components/site-score-card.tsx` — only if Step 2 RED's

### Step 1: Failing test (might already pass)

Create `apps/app/src/test/components/site-score-card.test.tsx`:

```tsx
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SiteScoreCard } from "@/components/site-score-card"

const SITE = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  url: "https://example.com",
  normalized_url: "https://example.com/",
  label: null,
  is_competitor: false,
  created_at: "2026-06-05T12:00:00Z",
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 50))
    return new Response(JSON.stringify({ ok: true, runId: "r1" }), { status: 200 })
  })
  vi.stubGlobal("fetch", fetchSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SiteScoreCard Run button", () => {
  it("fires only one /api/audit-run request on a rapid double-click", async () => {
    render(
      <SiteScoreCard
        ownerId={SITE.owner_id}
        site={SITE}
        scores={[]}
        selfScores={null}
      />
    )
    const button = screen.getByRole("button", { name: /run audit/i })
    const user = userEvent.setup()
    await user.click(button)
    await user.click(button)
    await new Promise((r) => setTimeout(r, 100))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
```

### Step 2: Run the new test — observe outcome

```bash
bun --filter @repo/app test
```

**Branch A: test PASSES (likely)** — `useTransition` re-renders the button with `disabled={true}` before the second click can land; the second click is a no-op on a disabled button. Skip to Step 4 with **158 total** (157 + 1).

**Branch B: test FAILS** — second click did fire a second fetch. Proceed to Step 3 to add a synchronous guard, then re-run.

### Step 3 (ONLY if Branch B): Add a `useRef`-based guard to `SiteScoreCard`

Open `apps/app/src/components/site-score-card.tsx`. At the top of the imports add `useRef` to the existing `import {…} from "react"`:

```tsx
import { useRef, useTransition } from "react"
```

Inside the `SiteScoreCard` component body, add the ref:

```tsx
const pendingRef = useRef(false)
```

Replace the existing Run button's `onClick` body:

```tsx
onClick={() => {
  if (pendingRef.current) return
  pendingRef.current = true
  start(async () => {
    try {
      const result = await queue({ siteId: site.id, requestedUrl: site.url })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if ("queued" in result) {
        toast("You are offline. Audit will run when you're back online.")
        return
      }
      toast.success(`Audit queued — ${result.runId.slice(0, 8)}`)
      router.push(`/dashboard/runs/${result.runId}`)
    } finally {
      pendingRef.current = false
    }
  })
}}
```

Re-run:

```bash
bun --filter @repo/app test
```

Expected now: test passes → **158 total**.

### Step 4: Commit

If Branch A (no production change):

```bash
git add apps/app/src/test/components/site-score-card.test.tsx
git commit -m "test(app): regression-guard SiteScoreCard against rapid double-click"
```

If Branch B (production change too):

```bash
git add apps/app/src/test/components/site-score-card.test.tsx apps/app/src/components/site-score-card.tsx
git commit -m "fix(app): guard SiteScoreCard against rapid double-click via useRef + regression test"
```

---

## Task 5: Final DoD sweep

**Files:** none (no README update — slice 13 has no user-visible changes).

### Step 1: Verify final state

```bash
# 1. Tests
bun --filter @repo/app test
# Expected: 158 passing (156 + 2 net new)

# 2. Typecheck
bun --filter @repo/app check-types

# 3. Build
bun --filter @repo/app build

# 4. Lint
bun --filter @repo/app lint
```

All clean. Any warnings are pre-existing.

### Step 2: No commit

Slice 13 has no docs update. T5 is a verify-only task; no new commit. The implementer just confirms green.

---

## Report Format

(For the implementer to fill in after T5.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (~158 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `IDEMPOTENCY_KEY_SCHEMA` module constant in route | ✓ T1 |
  | 6 | `_debounce.ts` exists; both consumers import from it | ✓ T2 + T3 |
  | 7 | `useRunDetailCache` effect deps narrowed | ✓ T3 |
  | 8 | Double-click regression test exists and passes | ✓ T4 |
- Total test count
- Commit SHA list (4 implementation commits expected, or 5 if Branch B)
- Slice 13 release note (one line)
- Any carry-forwards for slice 14

---

## After slice 13

Slice 14 candidates:

- **SW Background Sync (Chromium)** — drain the audit queue without a tab open.
- **Push notifications** for run completion.
- **IDB hydration on run-detail mount** — actually use IDB to override stale RSC props (slice 12 MVP skipped this).
- **Drop any unused barrel re-exports** that have accumulated.
