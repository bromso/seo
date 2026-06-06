# Slice 18 — Per-Entry Queue TTL (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/queue-ttl-slice18`
**Carry-forward from:** Slice 17 (cross-owner queue entries sit indefinitely)

---

## Goal

Drop audit-queue entries older than 7 days. Closes the slice 17 wart where cross-owner entries (rejected by server-side RLS during SW Background Sync) sit indefinitely in IDB and retry on every sync. Also handles the legitimate case of a user who queued an audit, took a 2-week vacation, and would otherwise come back to a stale audit firing.

---

## Non-Goals

- No UI surface for the prune count — pruning is silent (no toast).
- No per-owner TTL config — uniform 7 days across all owners.
- No "soft delete" / archive — entries are hard-deleted.
- No backfill migration — existing IDB queues are pruned naturally on first sync after deploy.
- No whoami endpoint (deferred to slice 19).
- No new DB migration (this is purely client-side IDB).

---

## Architecture

A new pure helper `pruneExpiredEntries(db, now, ttlMs)` walks the queue store, deletes entries where `now - entry.queuedAt > ttlMs`, and returns the count of dropped entries. `replayAuditQueueOnce` calls it once at the top — both the React hook path (`useAuditQueueReplay`) and the SW sync handler benefit transparently without any of their own changes.

The TTL is a single shared constant `QUEUE_TTL_DAYS = 7` in `apps/app/src/lib/constants.ts`; the helper derives `QUEUE_TTL_MS` from it and uses it as the default `ttlMs` for both `isQueueEntryExpired` and `pruneExpiredEntries`. Tests pass an override `ttlMs` to exercise the boundary without sleeping.

---

## TTL value

`QUEUE_TTL_DAYS = 7` (decided, not parameterized).

Rationale:
- Long enough that "I queued an audit, went on vacation, came back Monday" still works.
- Short enough that cross-owner stale entries clear within a week.
- Long enough that the SW retry budget (24h per Chromium spec) has run its course before we prune.
- Standard "user is on vacation but not abandoned" threshold.

If a different value is ever wanted, it's a single-line change in `constants.ts`.

---

## `queue-ttl.ts` module

```ts
// apps/app/src/lib/offline/queue-ttl.ts
import { QUEUE_TTL_DAYS } from "@/lib/constants"
import type { QueuedAuditRun } from "@/lib/offline/audit-queue"
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import { STORE_AUDIT_QUEUE } from "@/lib/offline/db"

export const QUEUE_TTL_MS = QUEUE_TTL_DAYS * 24 * 60 * 60 * 1000

export function isQueueEntryExpired(
  entry: QueuedAuditRun,
  now: number,
  ttlMs: number = QUEUE_TTL_MS
): boolean {
  return now - entry.queuedAt > ttlMs
}

export async function pruneExpiredEntries(
  db: IDBDatabase,
  now: number,
  ttlMs: number = QUEUE_TTL_MS
): Promise<number> {
  const all = await awaitRequest<QueuedAuditRun[]>(
    txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll()
  )
  const expired = all.filter((e) => isQueueEntryExpired(e, now, ttlMs))
  for (const e of expired) {
    await awaitRequest(txStore(db, STORE_AUDIT_QUEUE, "readwrite").delete(e.id))
  }
  return expired.length
}
```

Defaults to `QUEUE_TTL_MS` so callers (the replay function, the SW handler) don't need to wire the value; tests pass an override.

The `isQueueEntryExpired` strict inequality (`>`, not `>=`) means an entry with age `=== ttlMs` is NOT expired — keeps the boundary deterministic for tests.

---

## Integration with `replayAuditQueueOnce`

One line added at the top of `apps/app/src/lib/offline/replay-audit-queue.ts`:

```ts
export async function replayAuditQueueOnce(
  db: IDBDatabase,
  fetcher: typeof fetch,
  ownerIdFilter?: string
): Promise<ReplayResult> {
  await pruneExpiredEntries(db, Date.now())

  const entries = ownerIdFilter
    ? await readQueueForOwner(db, ownerIdFilter)
    : await readAllQueueEntries(db)

  // …rest unchanged…
}
```

Everything downstream is unchanged. Sweep runs on every replay — hook drain or SW sync, doesn't matter.

The pure function's signature stays `(db, fetcher, ownerIdFilter?) → Promise<ReplayResult>` — the prune count isn't surfaced through `ReplayResult` because no caller needs it.

---

## Existing-test surgery

Both `replay-audit-queue.test.ts` (slice 17) and `use-audit-queue-replay.test.ts` (slice 8/11) currently build entries with `queuedAt: 1` (epoch ms 1 = ≈ 56 years old). After slice 18, those entries would be pruned before replay, and every existing test would fail because the queue would be empty by the time the loop runs.

**Fix:** update the local `entry()` helper in each file to use `queuedAt: Date.now()`. Single-line change per file; no assertion changes; no semantic test rewrite.

This is the same scope as slice 15's slice-12 passthrough adaptation — small surgical change to keep existing tests green under the widened invariant.

`use-queue-audit.test.ts` is unaffected: the hook itself sets `queuedAt: Date.now()` when enqueueing, so its tests' assertions don't depend on a fake stamp.

---

## Testing strategy

Tests delta: **174 → 178 (+4 net new, 0 deletions)**.

### `queue-ttl.test.ts` (new file, +3)

```ts
import { describe, expect, it } from "vitest"
import { isQueueEntryExpired, pruneExpiredEntries } from "@/lib/offline/queue-ttl"

// Test 1: fresh entry is not expired.
it("isQueueEntryExpired returns false when age < ttl", () => {
  const entry = { id: "x", ownerId: "o", siteId: "s", requestedUrl: "u", queuedAt: 1000 }
  expect(isQueueEntryExpired(entry, 5000, 10_000)).toBe(false)
})

// Test 2: old entry is expired.
it("isQueueEntryExpired returns true when age > ttl", () => {
  const entry = { id: "x", ownerId: "o", siteId: "s", requestedUrl: "u", queuedAt: 1000 }
  expect(isQueueEntryExpired(entry, 20_000, 10_000)).toBe(true)
})

// Test 3: prune deletes only expired rows.
it("pruneExpiredEntries deletes expired rows and leaves fresh rows", async () => {
  // happy-dom + fake-indexeddb/auto setup
  const db = await openOfflineDB()
  await enqueueAuditRun(db, { id: "fresh", ownerId: O, siteId: S, requestedUrl: U, queuedAt: 9000 })
  await enqueueAuditRun(db, { id: "stale", ownerId: O, siteId: S, requestedUrl: U, queuedAt: 1 })

  const dropped = await pruneExpiredEntries(db, 10_000, 5_000)
  expect(dropped).toBe(1)
  const left = await readQueueForOwner(db, O)
  expect(left.map((e) => e.id)).toEqual(["fresh"])
})
```

### `replay-audit-queue.test.ts` (existing, +1)

```ts
it("prunes expired entries before POSTing", async () => {
  const db = await openOfflineDB()
  await enqueueAuditRun(db, { id: "fresh", ownerId: O, siteId: S, requestedUrl: U, queuedAt: Date.now() })
  await enqueueAuditRun(db, { id: "stale", ownerId: O, siteId: S, requestedUrl: U, queuedAt: 1 })

  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
  ) as unknown as typeof fetch

  const result = await replayAuditQueueOnce(db, fetcher, O)
  // Only "fresh" was POSTed.
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(result).toEqual({ successes: 1, failures: 0 })
  // Both are gone from IDB: fresh via removeFromQueue, stale via prune.
  expect(await readQueueForOwner(db, O)).toEqual([])
})
```

### Final test count

174 baseline → **178** (+4 net new).

---

## Files

| Action | File | Notes |
|---|---|---|
| Modify | `apps/app/src/lib/constants.ts` | Add `QUEUE_TTL_DAYS = 7` export |
| Create | `apps/app/src/lib/offline/queue-ttl.ts` | `isQueueEntryExpired`, `pruneExpiredEntries`, `QUEUE_TTL_MS` |
| Create | `apps/app/src/test/offline/queue-ttl.test.ts` | 3 unit tests |
| Modify | `apps/app/src/lib/offline/replay-audit-queue.ts` | One-line: `await pruneExpiredEntries(db, Date.now())` |
| Modify | `apps/app/src/test/offline/replay-audit-queue.test.ts` | Refresh `entry()` helper's `queuedAt` + add 1 new test |
| Modify | `apps/app/src/test/offline/use-audit-queue-replay.test.ts` | Refresh `entry()` helper's `queuedAt` |

No DB migration. No new dependencies. No SW changes. No view-layer changes.

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | Existing `constants.test.ts` test (if any) breaks on the new export | low | `constants.test.ts` asserts the existing constants; a new export doesn't break the existing assertions. Verify by reading the test in T1. |
| 2 | Pruning while concurrent enqueue is in progress | very low | IDB transactions are serialized per store; the prune's readonly→readwrite sequence is atomic within itself. A concurrent enqueue uses its own tx. |
| 3 | User legitimately queued audit 8 days ago and we silently drop it | low | 7 days is well past "I queued and forgot"; this is the intended behavior. No UX change. |
| 4 | Sweep on every replay adds I/O cost | low | `replayAuditQueueOnce` already does `readQueueForOwner` / `readAllQueueEntries` (a full getAll + filter). The prune adds one more `getAll`. For typical queue sizes (≤20), this is microseconds. |
| 5 | The `entry()` helper change misses a place that hard-codes `queuedAt: 1` outside of the helper | low | Grep before submitting T2: `grep -n "queuedAt: 1" apps/app/src/test`. If any usage exists outside the helper, update it too. |

---

## Smoke test (after implementation)

1. `bun dev`, sign in, open `/dashboard`.
2. DevTools → Application → IndexedDB → `seo-app-cache` → `audit_run_queue`.
3. Manually insert a row with `queuedAt: 1` (right-click → "Edit value" — or programmatically via the console).
4. Click "Run audit" on a site card while online — this triggers `useAuditQueueReplay`'s drain via the existing online-fetch success path; but to exercise *queue* replay, throttle to offline first, queue an audit, then throttle back online.
5. After the drain runs, refresh DevTools → confirm the manually-inserted stale row is gone.
6. Confirm the normally-queued entry was POSTed and removed.

Easier programmatic smoke: open the dev console with the app loaded and run:
```js
const { openOfflineDB } = await import("/_next/static/chunks/...") // path varies
const db = await openOfflineDB()
const tx = db.transaction("audit_run_queue", "readwrite")
tx.objectStore("audit_run_queue").put({
  id: "stale-test", ownerId: "current-uuid", siteId: "any-uuid",
  requestedUrl: "https://example.com", queuedAt: 1
})
// reload page → useAuditQueueReplay fires → prune deletes the stale entry
```

(The import path varies with the build; a more practical smoke is to wait for the SW sync replay path to run with a known-stale entry.)

---

## Definition of Done

- [ ] `bun --filter @repo/app test` → 178 passing.
- [ ] `bun --filter @repo/app check-types` → clean.
- [ ] `bun --filter @repo/app build` → clean.
- [ ] `bun --filter @repo/app lint` → clean (warnings may be pre-existing).
- [ ] `QUEUE_TTL_DAYS = 7` exported from `apps/app/src/lib/constants.ts`.
- [ ] `apps/app/src/lib/offline/queue-ttl.ts` exports `isQueueEntryExpired`, `pruneExpiredEntries`, `QUEUE_TTL_MS`.
- [ ] `replayAuditQueueOnce` calls `pruneExpiredEntries(db, Date.now())` once at the top.
- [ ] Both modified test files use a fresh `queuedAt` in their `entry()` helpers.
- [ ] No DB migration, no SW changes.

---

## Slice 19 candidates (carry-forward)

- **Whoami endpoint** for cleaner cross-owner SW filtering.
- **Push notifications** on run completion.
- **SW offline fallback page**.
- **Drop unused barrel re-exports.**
- **60s relative-time ticker** for OfflineBanner.
- **Surface the prune count in the toast** (only if a user complains about silent drops).
