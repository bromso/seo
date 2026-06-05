# Slice 13 — Cleanup Bundle + Double-Click Guard Test Design

**Status:** Spec — ready for implementation planning.

**Driver:** Four small carry-forwards from slices 7/11/12 reviews + verification of the slice-11-acknowledged "user double-click" race. None is user-visible; all reduce code drift and pay down minor debt.

**Sub-items in scope (4):**

1. **Hoist `z.uuid()`** to a module-level constant in `apps/app/src/app/api/audit-run/route.ts` (slice 11 final-review minor).
2. **Extract `debounce`** to a shared `apps/app/src/lib/offline/_debounce.ts`. Currently duplicated in `use-dashboard-cache.ts` (slice 7) and `use-run-detail-cache.ts` (slice 12) (slice 12 final-review minor).
3. **Narrow `useRunDetailCache` effect deps** from `[live, writeDebounced]` to `[live.run, live.results, writeDebounced]` (or destructured) — perf tightening (slice 12 final-review minor).
4. **Double-click guard test** for `SiteScoreCard`'s Run button. Verify `useTransition`'s `pending` flag actually blocks a rapid second click. If the test passes today, it locks in the guarantee; if it fails, add a small `useRef`-based synchronous guard to the onClick.

**Out of scope:**
- SW Background Sync, push notifications, IDB hydration for run-detail (slice 14 candidates).
- New product surface or visible UX change.

---

## Goal

After slice 13:
- The `/api/audit-run` route validates idempotency keys with a single hoisted `z.uuid()` schema instance instead of constructing one per request.
- The `debounce` utility lives in one place; `useDashboardCache` and `useRunDetailCache` both import from there.
- `useRunDetailCache`'s persistence effect re-runs only when the actual data changes (not on every render).
- A regression test guards against future drift in `SiteScoreCard`'s double-click behavior.

## Non-goals

- Visible UX change. Existing button behavior is preserved; the test is purely an additive guard.
- Any new dependencies, schema migration, or IDB store change.
- General refactor of the offline barrel or the hook surfaces.

---

## Architecture

```
Sub-item 1 — Hoist z.uuid()
    apps/app/src/app/api/audit-run/route.ts
    const IDEMPOTENCY_KEY_SCHEMA = z.uuid()  // module-level
    ... .safeParse(idempotencyKey) ...

Sub-item 2 — Extract debounce
    apps/app/src/lib/offline/_debounce.ts        NEW
        export function debounce<T>(fn: T, ms: number): T-shaped wrapper
    apps/app/src/lib/offline/use-dashboard-cache.ts
        remove local debounce, import from @/lib/offline/_debounce
    apps/app/src/lib/offline/use-run-detail-cache.ts
        same — and narrow the effect deps in the same edit
    apps/app/src/test/offline/_debounce.test.ts  NEW (1 test)

Sub-item 3 — Narrow useRunDetailCache effect deps
    Bundled with sub-item 2's edit to use-run-detail-cache.ts. Destructure
    `const { run, results } = live` and depend on those refs.

Sub-item 4 — Double-click guard test
    apps/app/src/test/components/site-score-card.test.tsx  NEW (1 test)
    Asserts a rapid double-click on the Run button fires exactly one fetch.
    Fallback: if the test reveals an actual race, add a useRef-based guard
    to SiteScoreCard's onClick before commit.
```

---

## File layout

```
apps/app/src/app/api/audit-run/
└── route.ts                            MODIFY — hoist z.uuid() to module const

apps/app/src/lib/offline/
├── _debounce.ts                        NEW — internal shared helper
├── use-dashboard-cache.ts              MODIFY — import debounce from _debounce
└── use-run-detail-cache.ts             MODIFY — import debounce, narrow deps

apps/app/src/test/offline/
└── _debounce.test.ts                   NEW — 1 test

apps/app/src/test/components/
└── site-score-card.test.tsx            NEW — 1 test (dbl-click guard)
```

Total new files: 4. Total modified files: 3.

---

## Public API

`_debounce.ts` — internal, NOT exported from `lib/offline/index.ts`:

```ts
export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void
```

Signature is identical to the local copies that currently exist in `use-dashboard-cache.ts` and `use-run-detail-cache.ts` so refactor is mechanical.

`/api/audit-run/route.ts` — module-level constant added near the imports:

```ts
const IDEMPOTENCY_KEY_SCHEMA = z.uuid()
```

Used in place of `z.uuid()` inside the POST handler. No behavior change.

---

## Sub-item 1 — Hoist `z.uuid()`

Current code (slice 11 T2):

```ts
import { z } from "zod"
// ...
if (idempotencyKey !== null && !z.uuid().safeParse(idempotencyKey).success) {
  return NextResponse.json(
    { ok: false, error: "invalid idempotency key" },
    { status: 400 }
  )
}
```

Updated code:

```ts
import { z } from "zod"

const IDEMPOTENCY_KEY_SCHEMA = z.uuid()

// ... inside POST:
if (
  idempotencyKey !== null &&
  !IDEMPOTENCY_KEY_SCHEMA.safeParse(idempotencyKey).success
) {
  return NextResponse.json(
    { ok: false, error: "invalid idempotency key" },
    { status: 400 }
  )
}
```

The 3 slice-11 route tests cover this code path; they continue to pass without modification.

---

## Sub-item 2 — Extract `debounce`

**`apps/app/src/lib/offline/_debounce.ts` (NEW):**

```ts
// Internal helper shared by use-dashboard-cache.ts and use-run-detail-cache.ts.
// Not exported from the offline barrel; consumers import directly.

export function debounce<T extends (...args: never[]) => unknown>(
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
```

**`use-dashboard-cache.ts`** — delete the local `debounce` definition (the 12-line block); add `import { debounce } from "@/lib/offline/_debounce"`. All call sites stay identical.

**`use-run-detail-cache.ts`** — same change, plus the dep-narrow in sub-item 3.

**Test (`apps/app/src/test/offline/_debounce.test.ts`, NEW):**

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

---

## Sub-item 3 — Narrow `useRunDetailCache` effect deps

**Current code (slice 12 T3):**

```ts
useEffect(() => {
  writeDebounced(live)
}, [live, writeDebounced])
```

**Problem:** `useRealtimeRun` returns a fresh `{run, results}` object literal on every render (`return { run, results }` in slice 6 T13). So `live` !== `live` on every render — the effect fires every render, schedules a debounced write, immediately cancels it on the next render, reschedules, etc. The debounce coalesces so the IDB write timing is unaffected, but it's noise.

**Updated code:**

```ts
const { run, results } = live

useEffect(() => {
  writeDebounced({ run, results })
}, [run, results, writeDebounced])
```

`run` and `results` are individual property references; they only change when `useRealtimeRun`'s state mutates. Effect fires once on mount + once per actual data change. Biome's `useExhaustiveDependencies` rule is satisfied because all referenced values appear in the deps array.

The existing 2 tests in `use-run-detail-cache.test.ts` pass unchanged.

---

## Sub-item 4 — Double-click guard test for `SiteScoreCard`

**Test (`apps/app/src/test/components/site-score-card.test.tsx`, NEW):**

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
    // Resolve slowly so the second click would land while first is in-flight.
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
    // Allow the in-flight fetch to settle:
    await new Promise((r) => setTimeout(r, 100))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
```

**Expected outcome:** test passes immediately. `useTransition` in `SiteScoreCard` (slice 5 T11) sets `pending = true` on `start(...)`; React re-renders with `disabled={true}` before the second click can land. The second `user.click(button)` is a no-op (clicks on a disabled `<button>` are ignored).

**Fallback if test fails:** add a synchronous `useRef<boolean>` guard:

```ts
// inside the component:
const pendingRef = useRef(false)
// ... in the Run button onClick:
onClick={() => {
  if (pendingRef.current) return
  pendingRef.current = true
  start(async () => {
    try { /* existing body */ } finally { pendingRef.current = false }
  })
}}
```

Then re-run the test. The plan's task for sub-item 4 has explicit "if RED then GREEN" steps to cover both outcomes.

---

## Testing summary

| Sub-item | New tests |
|---|---|
| 1. Hoist z.uuid() | 0 (slice 11 tests cover the path) |
| 2. Extract debounce | +1 (`_debounce.test.ts`) |
| 3. Narrow useRunDetailCache deps | 0 (existing slice-12 tests cover the effect) |
| 4. Double-click guard | +1 (`site-score-card.test.tsx`) |
| **Net** | **+2** |

Slice 12's 156 → slice 13's **158**.

---

## Manual smoke

No new smoke steps. Slice 13 has no user-visible behavior change. Re-running the slice-8 smoke (steps 30-34) and slice-11 smoke (step 39 — verify `Idempotency-Key` header still sent) is sufficient regression coverage.

---

## Risks

- **Site-score-card test flakiness:** the test uses real `setTimeout` with happy-dom's event loop. The 50ms fetch delay + 100ms drain wait should be robust on CI; if it flakes, increase the drain wait. No fake-timer workaround needed because we want real-time React event handling.
- **Effect-deps lint warning:** Biome's `useExhaustiveDependencies` will be satisfied by the destructured-property form. If it flags anyway (e.g., because of how the hook's `useMemo` closure captures things), the fix is `// biome-ignore lint/correctness/useExhaustiveDependencies: …` with a one-line reason.
- **Debounce extraction breaks if Biome reorders imports** unexpectedly: low risk, but verify the two consumer files still typecheck after the change.

---

## After slice 13

Slice 14 candidates:

- **SW Background Sync (Chromium)** — drain the audit queue without a tab open. Touches sw.ts; adds IDB access from SW.
- **Push notifications** for run completion (largest remaining product feature).
- **IDB hydration on run-detail mount** — actually use IDB to override stale RSC props (slice 12 MVP skipped this).
- **Drop unused barrel re-exports** if any have accumulated.
