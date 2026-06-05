# Slice 10 — Reliability Cleanup Bundle Design

**Status:** Spec — ready for implementation planning.

**Driver:** Pay down accumulated carry-forwards from slices 7/8 that became apparent during their final reviews. No new product surfaces; each sub-item closes a specific gap or polishes existing UX. Touching these now keeps the codebase honest before adding more features.

**Sub-items in scope (5):**

1. Trend dedup + 30-day pruning in `applyEventToSnapshot` (slice 7 carry-forward).
2. Cross-user IDB GC on mount (slice 7 carry-forward).
3. Replay toast aggregation in `useAuditQueueReplay` (slice 8 carry-forward).
4. Delete `runAuditAction` (now caller-less) + its 4 tests (slice 8 carry-forward).
5. `OfflineBanner` + `SignOutButton` unit tests (slice 7 carry-forward).

**Out of scope (deferred):**
- Idempotency keys end-to-end (slice 11 candidate).
- Per-run IDB cache (slice 11 candidate).
- SW Background Sync (slice 12 candidate).
- Push notifications.

---

## Goal

After slice 10:
- Replayed and double-delivered audit events don't bloat the cached `trends` list; old measurements (>30 days) get dropped passively as events arrive.
- A shared browser doesn't leak the prior user's snapshot or queue entries past sign-in; the next user's `useDashboardCache` mount sweeps them.
- A multi-entry queue replay produces one summary toast instead of N.
- `runAuditAction` and its 4-test file are gone; no orphan Server Action lingers.
- `OfflineBanner` and `SignOutButton` get the unit tests that were deferred during their original landing slices.

## Non-goals

- Anything visible in the UI other than fewer duplicate toasts.
- New schema migrations or new dependencies in production code.
- New IDB stores or version bumps.
- Refactor of unrelated code.

---

## Architecture

```
applyEventToSnapshot (snapshot.ts)
    ├─ existing logic decides this is an audit_results INSERT
    └─ NEW: dedup by (site_id, category, measured_at)
        + prune trends older than (eventTime - 30d)

useDashboardCache (use-dashboard-cache.ts)
    └─ mount effect, after openOfflineDB() resolves
        └─ NEW: void sweepOtherOwners(db, ownerId)   // best-effort GC

sweepOtherOwners (clear-cache.ts)
    ├─ delete dashboard_snapshots where ownerId !== currentOwnerId
    └─ delete audit_run_queue where ownerId !== currentOwnerId

useAuditQueueReplay (use-audit-queue-replay.ts)
    └─ existing per-entry try/catch
        ├─ count successes (was: toast per success)
        └─ count failures (already aggregated)
    └─ NEW: emit ONE toast.success + ONE toast.error at end

runAuditAction        DELETE — no callers since slice 8 T8
RunAuditResult type   DELETE
run-audit-action.test.ts  DELETE (4 tests)

OfflineBanner   add unit tests (4 tests)
SignOutButton   add unit test (1 test) verifying clears-before-submit
```

**Internal helper extraction:** `snapshot.ts`, `audit-queue.ts`, and the new sweep in `clear-cache.ts` all use the same `txStore(db, name, mode)` and `awaitRequest(req)` wrappers. Extract them once to a new internal `apps/app/src/lib/offline/_idb.ts` (not exported from the barrel). DRY win; no behavior change.

---

## File layout

```
apps/app/src/lib/offline/
├── _idb.ts                          NEW — internal txStore + awaitRequest helpers
├── snapshot.ts                      MODIFY — dedup + prune in applyEventToSnapshot;
│                                            import txStore/awaitRequest from _idb
├── audit-queue.ts                   MODIFY — import txStore/awaitRequest from _idb
├── clear-cache.ts                   MODIFY — add sweepOtherOwners
├── use-dashboard-cache.ts           MODIFY — call sweepOtherOwners on mount
├── use-audit-queue-replay.ts        MODIFY — aggregate success toasts
└── index.ts                         MODIFY — export sweepOtherOwners

apps/app/src/app/(app)/dashboard/
└── actions.ts                       MODIFY — delete runAuditAction + RunAuditResult

apps/app/src/test/offline/
├── snapshot.test.ts                 EXTEND — +3 tests (dedup, prune-old, keep-in-window)
├── clear-cache.test.ts              EXTEND — +2 tests (sweepOtherOwners cases)
└── use-audit-queue-replay.test.ts   EXTEND — +1 test (toast called once per drain)

apps/app/src/test/actions/
└── run-audit-action.test.ts         DELETE (4 tests)

apps/app/src/test/components/
├── offline-banner.test.tsx          NEW — 4 tests
└── sign-out-button.test.tsx         NEW — 1 test

(possibly) apps/app/package.json     MODIFY — add @testing-library/user-event devDep
```

---

## Sub-item 1: Trend dedup + 30-day pruning

**Location:** `apps/app/src/lib/offline/snapshot.ts`, inside `applyEventToSnapshot`.

**Behavior:**
- When the function decides this is an `audit_results INSERT` event for a known site, construct `newTrend` as today.
- **Dedup:** skip appending `newTrend` if `prev.trends` already has a row with the same `(site_id, category, measured_at)`.
- **Prune:** filter `prev.trends` to rows whose `measured_at` is within `TRENDS_WINDOW_DAYS` of the event's `started_at`. Use `Date.parse()`; on `NaN` fall through to "no pruning" (defensive).

```ts
import { TRENDS_WINDOW_DAYS } from "@/lib/constants"

const TRENDS_WINDOW_MS = TRENDS_WINDOW_DAYS * 86_400_000

// ... inside applyEventToSnapshot, after siteForTrend is computed:
const newTrend = {
  site_id: siteId,
  owner_id: result.owner_id,
  label: siteForTrend?.label ?? null,
  is_competitor: siteForTrend?.is_competitor ?? false,
  category: result.category,
  score: result.score,
  measured_at: result.started_at,
}

const isDuplicate = prev.trends.some(
  (t) =>
    t.site_id === newTrend.site_id &&
    t.category === newTrend.category &&
    t.measured_at === newTrend.measured_at,
)

const eventTimeMs = Date.parse(result.started_at)
const cutoff = Number.isFinite(eventTimeMs)
  ? eventTimeMs - TRENDS_WINDOW_MS
  : Number.NEGATIVE_INFINITY  // unparseable → no pruning
const pruned = prev.trends.filter((t) => {
  const t_ms = Date.parse(t.measured_at)
  return Number.isFinite(t_ms) ? t_ms >= cutoff : true  // keep on parse failure
})

const trends = isDuplicate || result.score === null
  ? pruned
  : [...pruned, newTrend]
```

**Tests** (append to `snapshot.test.ts`):

```ts
describe("applyEventToSnapshot — trend dedup + pruning", () => {
  it("does not append a duplicate trend row (same site_id, category, measured_at)", () => {
    // SAMPLE.trends already has performance@2026-06-05T12:00:00Z
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: { ...RESULT_BASE, category: "performance", score: 87, started_at: "2026-06-05T12:00:00Z" },
    }
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next.trends).toHaveLength(SAMPLE.trends.length)
  })

  it("prunes trends older than 30 days when a new event arrives", () => {
    const stale: ScoreTrendRow = {
      ...SAMPLE.trends[0]!,
      measured_at: "2026-04-01T12:00:00Z",  // ~65 days before event
    }
    const seeded: DashboardSnapshot = { ...SAMPLE, trends: [...SAMPLE.trends, stale] }
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: { ...RESULT_BASE, category: "seo", score: 90, started_at: "2026-06-05T13:00:00Z" },
    }
    const next = applyEventToSnapshot(seeded, { kind: "event", envelope: env })
    expect(next.trends.some((t) => t.measured_at === "2026-04-01T12:00:00Z")).toBe(false)
  })

  it("keeps trends inside the 30-day window", () => {
    const recent: ScoreTrendRow = {
      ...SAMPLE.trends[0]!,
      measured_at: "2026-05-20T12:00:00Z",  // ~16 days before event
    }
    const seeded: DashboardSnapshot = { ...SAMPLE, trends: [...SAMPLE.trends, recent] }
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: { ...RESULT_BASE, category: "seo", score: 90, started_at: "2026-06-05T13:00:00Z" },
    }
    const next = applyEventToSnapshot(seeded, { kind: "event", envelope: env })
    expect(next.trends.some((t) => t.measured_at === "2026-05-20T12:00:00Z")).toBe(true)
  })
})
```

The implementer derives `RESULT_BASE` from the existing test file's helper (reusing whatever fixture is already there).

---

## Sub-item 2: Cross-user IDB GC

**Location:** `apps/app/src/lib/offline/clear-cache.ts`.

**New helper:**

```ts
export async function sweepOtherOwners(
  db: IDBDatabase,
  currentOwnerId: string,
): Promise<void> {
  try {
    const snaps = await awaitRequest<DashboardSnapshot[]>(
      txStore(db, STORE_DASHBOARD, "readonly").getAll(),
    )
    for (const s of snaps) {
      if (s.ownerId !== currentOwnerId) {
        await awaitRequest(
          txStore(db, STORE_DASHBOARD, "readwrite").delete(s.ownerId),
        )
      }
    }
    const entries = await awaitRequest<QueuedAuditRun[]>(
      txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll(),
    )
    for (const e of entries) {
      if (e.ownerId !== currentOwnerId) {
        await awaitRequest(
          txStore(db, STORE_AUDIT_QUEUE, "readwrite").delete(e.id),
        )
      }
    }
  } catch {
    // best-effort GC; never block startup
  }
}
```

`txStore(db, storeName, mode)` and `awaitRequest(req)` are extracted to the new `_idb.ts`. The signature changes slightly from snapshot.ts's existing two-arg form (which captures `STORE_DASHBOARD` implicitly) to three-arg to support multiple stores. Snapshot.ts and audit-queue.ts adjust their call sites accordingly.

**Wiring:** `apps/app/src/lib/offline/use-dashboard-cache.ts` calls `void sweepOtherOwners(db, ownerId)` inside its mount effect, right after `openOfflineDB()` resolves. Fire-and-forget; not awaited; errors swallowed.

**Tests** (append to `clear-cache.test.ts`):

```ts
describe("sweepOtherOwners", () => {
  it("deletes other-owner snapshots and queue entries; keeps current-owner data", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, { ownerId: "owner-a", updatedAt: 1, sites: [], latestScores: [], trends: [] })
    await writeSnapshot(db, { ownerId: "owner-b", updatedAt: 2, sites: [], latestScores: [], trends: [] })
    await enqueueAuditRun(db, { id: "q1", ownerId: "owner-a", siteId: "s", requestedUrl: "u", queuedAt: 1 })
    await enqueueAuditRun(db, { id: "q2", ownerId: "owner-b", siteId: "s", requestedUrl: "u", queuedAt: 1 })

    await sweepOtherOwners(db, "owner-a")

    expect(await readSnapshot(db, "owner-a")).not.toBeNull()
    expect(await readSnapshot(db, "owner-b")).toBeNull()
    expect(await readQueueForOwner(db, "owner-a")).toHaveLength(1)
    expect(await readQueueForOwner(db, "owner-b")).toHaveLength(0)
  })

  it("is a no-op when only current-owner data exists", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, { ownerId: "owner-a", updatedAt: 1, sites: [], latestScores: [], trends: [] })
    await sweepOtherOwners(db, "owner-a")
    expect(await readSnapshot(db, "owner-a")).not.toBeNull()
  })
})
```

---

## Sub-item 3: Replay toast aggregation

**Location:** `apps/app/src/lib/offline/use-audit-queue-replay.ts`.

**Behavior change:**
- Inside the per-entry loop, replace `toast.success(`Queued audit started — ${body.runId.slice(0, 8)}`)` with `successes += 1`.
- After the loop, emit `toast.success(\`Started ${successes} queued audit${successes === 1 ? "" : "s"}\`)` if `successes > 0`.
- Failure aggregation already exists; leave untouched.

**Test** (append to `use-audit-queue-replay.test.ts`):

```ts
it("emits a single aggregated success toast for a multi-entry drain", async () => {
  // Stub `sonner` with vi.mock at the top of the file:
  //   vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
  const { toast } = await import("sonner")
  const successMock = toast.success as ReturnType<typeof vi.fn>
  successMock.mockClear()

  const db = await openOfflineDB()
  await enqueueAuditRun(db, entry("q1"))
  await enqueueAuditRun(db, entry("q2"))
  await enqueueAuditRun(db, entry("q3"))
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, runId: "rid" }), { status: 200 })
  ))

  renderHook(() => useAuditQueueReplay(OWNER))
  await waitFor(async () => expect(await readQueueForOwner(db, OWNER)).toEqual([]))

  expect(successMock).toHaveBeenCalledTimes(1)
  expect(successMock).toHaveBeenCalledWith(expect.stringMatching(/Started 3 queued audit/))
})
```

If `vi.mock("sonner", ...)` at the top of the test file breaks the existing toast-noop tests, gate the new test by hoisting the mock and using `vi.mocked(...)` calls. The implementer adapts during T6.

---

## Sub-item 4: Delete `runAuditAction`

**Location:** `apps/app/src/app/(app)/dashboard/actions.ts`.

**Operations:**

1. `grep -rn "runAuditAction\|RunAuditResult" apps/app/src` — confirm zero hits in src. If any remain (a forgotten import), fix the caller first.
2. Delete:
   - `export type RunAuditResult = …` line and the import of `RunAuditSchema` if it's only used by this action.
   - `export async function runAuditAction(input: unknown): Promise<RunAuditResult> { … }` block.
3. Delete `apps/app/src/test/actions/run-audit-action.test.ts` (4 tests).
4. Run typecheck + build to confirm no broken references.

**Net tests:** −4.

---

## Sub-item 5: OfflineBanner + SignOutButton tests

**Install `@testing-library/user-event` if missing:**

```bash
grep '"@testing-library/user-event"' apps/app/package.json
# If missing:
cd apps/app && bun add -D @testing-library/user-event
```

**`apps/app/src/test/components/offline-banner.test.tsx`** (4 tests, see full code in Section "Caller updates" of the implementation plan).

**`apps/app/src/test/components/sign-out-button.test.tsx`** (1 test using mocked `clearDashboardCache` + `clearAuditQueue` + spy on `HTMLFormElement.prototype.submit`).

**Net tests:** +5.

---

## Test count summary

| Sub-item | Δ |
|---|---|
| 1. Trend dedup + pruning | +3 |
| 2. Cross-user GC | +2 |
| 3. Replay toast aggregation | +1 |
| 4. Delete runAuditAction | −4 |
| 5. OfflineBanner + SignOutButton tests | +5 |
| **Net** | **+7** |

Slice 9's 131 → slice 10's **~138**.

---

## Migration & backwards-compat

- **No DB migration.** No schema or version changes.
- **No new runtime dependencies** in production code. `@testing-library/user-event` is a devDep only (and only added if missing).
- **No public-API breaks.** `runAuditAction` was caller-less; removing it cannot break any consumer in the repo.
- **`_idb.ts` is internal** — not re-exported from the offline barrel. Snapshot.ts and audit-queue.ts switch to importing it; their public APIs are unchanged.

---

## Risks

- **`@testing-library/user-event` API differences.** v14 introduced async-by-default `userEvent.setup()`. The test in this slice uses `await userEvent.click(...)`, which works in v13 and v14 with `userEvent` imported as the default export. The implementer verifies whichever major version `bun add` resolves.
- **`sonner` mock leakage.** Mocking the `sonner` module at the top of `use-audit-queue-replay.test.ts` may affect other tests in the same file. The existing tests already don't assert on toast calls, so the mock should be transparent. If a stale mock causes flakes, use `vi.resetModules()` between tests.
- **Trend pruning on parse failure.** If `Date.parse(measured_at)` returns NaN (unlikely; everything comes from Postgres timestamptz), we keep the row rather than dropping it. Defensive default; downside is that one bad row never expires. Acceptable.
- **`sweepOtherOwners` fire-and-forget timing.** If the user is on `/dashboard`, signs out, and signs back in as a different user in the same tab before the prior sweep completes, the second sweep may race with the first. Both delete other-owner entries; idempotent under racing. Worst case: two sweeps run; nothing breaks.

---

## After slice 10

Slice 11 candidates (slimmer list after this slice):

- **Idempotency keys end-to-end** — closes the slice-8 two-tab replay race.
- **Per-run IDB cache** — `run_snapshots` store + `useRunDetailCache` hook.
- **SW Background Sync (Chromium)** — drain audit queue without a tab open.
- **Push notifications** for run completion.
