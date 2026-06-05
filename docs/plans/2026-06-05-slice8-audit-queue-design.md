# Slice 8 — Offline Audit Queue Design

**Status:** Spec — ready for implementation planning.

**Driver:** Today, clicking "Run audit" while offline silently fails — the Server Action call rejects without surfacing a useful error. Slice 8 queues failed/offline audit triggers in IndexedDB and replays them automatically when the network returns, with explicit "you're offline, this will run later" UX.

**Out of scope (deferred):**
- PWA install prompt (slice 9 candidate).
- Service Worker Background Sync API (Chromium-only; would let queues drain without a tab open). Page-based replay covers the common case and works in every browser.
- Per-run IDB cache (slice 9 candidate — unrelated to write-side queueing).
- Deleting `runAuditAction`. The Server Action stays in place as backwards-compat; UI callers switch to the new endpoint. A follow-up slice removes the action.

---

## Goal

When the user clicks "Run audit" or "Run audits on all sites" while offline, the request is enqueued in IndexedDB. When the tab regains connectivity (`window.online` event), the queue is drained against `POST /api/audit-run` and the user sees per-success toasts. Sign-out clears the user's queue alongside the dashboard cache.

## Non-goals

- New Realtime functionality. The existing `FanOut` already pushes events; once a queued audit fires server-side, the dashboard updates via the same path as today.
- Server-side queueing or retries. The replay loop is entirely client-side and per-tab.
- Multi-tab coordination. Each tab independently observes its own `online` event and drains the shared per-owner queue; duplicate replay attempts return success or fail idempotently because the run was already inserted.
- Cross-session sync. If the user closes the browser before reconnecting, the queue waits until a tab opens again.

---

## Architecture

```
User clicks "Run audit"
        │
        ▼
useQueueAudit(ownerId)({ siteId, requestedUrl })
        │
        ├─ try POST /api/audit-run
        │   └─ 200 ok       → return { ok:true, runId }              → toast + navigate
        │   └─ 4xx/5xx      → return { ok:false, error }             → toast.error
        │
        └─ network error / navigator.onLine === false
            ├─ enqueueAuditRun(db, { id: uuid, ownerId, siteId, requestedUrl, queuedAt })
            └─ return { ok:true, queued:true, queueId: uuid }        → "offline" toast (no nav)


On reconnect (window 'online' event)
        │
        ▼
useAuditQueueReplay(ownerId)
        │
        ├─ readQueueForOwner(db, ownerId) → [entry, …]
        └─ for each entry sequentially:
             POST /api/audit-run
              ├─ ok      → removeFromQueue(db, entry.id) + toast.success
              └─ failed  → leave entry in queue; aggregate-toast after loop
```

**Sign-out:** `clearDashboardCache(ownerId)` runs in parallel with new `clearAuditQueue(ownerId)`.

**Run-all goes client-side:** `RunAllButton` no longer calls `runAuditAllAction`. It receives `sites: SiteRow[]` and iterates, calling `useQueueAudit` for each. Online → all 6 fire individually. Offline → 6 queue entries. Consistent behavior with the per-site button.

---

## File layout

```
apps/app/src/app/api/audit-run/
└── route.ts                            NEW — POST handler, wraps the existing runAuditAction logic

apps/app/src/lib/offline/
├── db.ts                               MODIFY — bump DB_VERSION to 2, add STORE_AUDIT_QUEUE, add migration
├── audit-queue.ts                      NEW — enqueueAuditRun / readQueueForOwner / removeFromQueue / clearAuditQueue
├── use-queue-audit.ts                  NEW — useQueueAudit(ownerId) hook
├── use-audit-queue-replay.ts           NEW — useAuditQueueReplay(ownerId) hook
└── index.ts                            MODIFY — export the new symbols

apps/app/src/test/
├── api/audit-run-route.test.ts         NEW — 4 tests (modeled on existing run-audit-action.test.ts)
├── offline/db.test.ts                  MODIFY — append V1→V2 migration test
├── offline/audit-queue.test.ts         NEW — 4 CRUD tests
├── offline/use-queue-audit.test.ts     NEW — 4 hook tests (fetch mocked)
└── offline/use-audit-queue-replay.test.ts  NEW — 3 hook tests

DELETE:
apps/app/src/test/actions/run-audit-all-action.test.ts   (action being removed)
```

**Modifications:**
- `apps/app/src/app/(app)/dashboard/actions.ts` — delete `runAuditAllAction` and `RunAuditAllResult`. Keep `runAuditAction` for backwards-compat (callers switch but the export stays for now).
- `apps/app/src/components/run-audit-button.tsx` — replace direct `runAuditAction` call with `useQueueAudit`. Add `ownerId` prop.
- `apps/app/src/components/site-score-card.tsx` — same swap. Add `ownerId` prop.
- `apps/app/src/components/run-all-button.tsx` — rewrite to iterate `sites` client-side using `useQueueAudit`. Replace `siteCount` prop with `ownerId` + `sites`.
- `apps/app/src/views/dashboard-overview-tab.tsx` — pass `ownerId` + `sites` to `SiteScoreCard` and `RunAllButton`.
- `apps/app/src/views/dashboard-view.tsx` — pass `ownerId` to `DashboardOverviewTab`; mount `useAuditQueueReplay(ownerId)`.
- `apps/app/src/views/run-detail-view.tsx` — pass `initialRun.owner_id` to `RunAuditButton` (if it uses one inside; verify when implementing).
- `apps/app/src/components/sign-out-button.tsx` — call `clearAuditQueue` in parallel with `clearDashboardCache`.
- `apps/app/src/lib/offline/index.ts` — export new symbols.

---

## IDB schema migration

Bump `DB_VERSION` from `1` to `2`. `onupgradeneeded` becomes:

```ts
req.onupgradeneeded = (event) => {
  const db = req.result
  if (event.oldVersion < 1 && !db.objectStoreNames.contains(STORE_DASHBOARD)) {
    db.createObjectStore(STORE_DASHBOARD, { keyPath: "ownerId" })
  }
  if (event.oldVersion < 2 && !db.objectStoreNames.contains(STORE_AUDIT_QUEUE)) {
    db.createObjectStore(STORE_AUDIT_QUEUE, { keyPath: "id" })
  }
}
```

Existing `dashboard_snapshots` data survives untouched (additive migration). Existing `onversionchange = () => db.close()` (added in slice 7 T2) means stale connections in other tabs auto-close so the upgrade isn't blocked.

`STORE_AUDIT_QUEUE = "audit_run_queue"`, keyed by client-generated UUID (`crypto.randomUUID()`).

---

## Public API

```ts
// lib/offline/audit-queue.ts
export type QueuedAuditRun = {
  id: string
  ownerId: string
  siteId: string
  requestedUrl: string
  queuedAt: number
}

export async function enqueueAuditRun(db: IDBDatabase, entry: QueuedAuditRun): Promise<void>
export async function readQueueForOwner(db: IDBDatabase, ownerId: string): Promise<QueuedAuditRun[]>
export async function removeFromQueue(db: IDBDatabase, id: string): Promise<void>
export async function clearAuditQueue(ownerId: string): Promise<void>   // wraps openOfflineDB

// lib/offline/use-queue-audit.ts
export type QueueAuditResult =
  | { ok: true; runId: string }
  | { ok: true; queued: true; queueId: string }
  | { ok: false; error: string }

export function useQueueAudit(ownerId: string): (input: {
  siteId: string
  requestedUrl: string
}) => Promise<QueueAuditResult>

// lib/offline/use-audit-queue-replay.ts
export function useAuditQueueReplay(ownerId: string): void
```

**`useQueueAudit` behavior:**

```ts
async function run(input) {
  let res: Response | null = null
  try {
    res = await fetch("/api/audit-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  } catch {
    // Network error — definitely offline / unreachable.
    return enqueue(input)
  }

  if (!res.ok) {
    // HTTP error from the server (4xx/5xx with a body). If we're offline-ish,
    // queue; otherwise surface the error.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return enqueue(input)
    }
    return { ok: false, error: `HTTP ${res.status}` }
  }

  const body = (await res.json()) as { ok: true; runId: string } | { ok: false; error: string }
  return body
}

async function enqueue(input) {
  try {
    const id = crypto.randomUUID()
    const db = await openOfflineDB()
    await enqueueAuditRun(db, {
      id,
      ownerId,
      siteId: input.siteId,
      requestedUrl: input.requestedUrl,
      queuedAt: Date.now(),
    })
    return { ok: true, queued: true, queueId: id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "queue failed" }
  }
}
```

**`useAuditQueueReplay` behavior:**

```ts
export function useAuditQueueReplay(ownerId: string): void {
  useEffect(() => {
    const drain = async () => {
      let entries: QueuedAuditRun[] = []
      try {
        const db = await openOfflineDB()
        entries = await readQueueForOwner(db, ownerId)
      } catch {
        return
      }
      if (entries.length === 0) return

      let failures = 0
      for (const entry of entries) {
        try {
          const res = await fetch("/api/audit-run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              siteId: entry.siteId,
              requestedUrl: entry.requestedUrl,
            }),
          })
          if (!res.ok) {
            failures += 1
            continue
          }
          const body = (await res.json()) as
            | { ok: true; runId: string }
            | { ok: false; error: string }
          if (!body.ok) {
            failures += 1
            continue
          }
          try {
            const db = await openOfflineDB()
            await removeFromQueue(db, entry.id)
          } catch {
            /* leave in queue */
          }
          toast.success(`Queued audit started — ${body.runId.slice(0, 8)}`)
        } catch {
          failures += 1
        }
      }
      if (failures > 0) {
        toast.error(`${failures} queued audit${failures === 1 ? "" : "s"} failed to start.`)
      }
    }

    // Fire on mount in case we mount already-online with a non-empty queue.
    if (typeof navigator === "undefined" || navigator.onLine) {
      void drain()
    }

    const handler = () => void drain()
    window.addEventListener("online", handler)
    return () => window.removeEventListener("online", handler)
  }, [ownerId])
}
```

---

## API route

`apps/app/src/app/api/audit-run/route.ts`:

```ts
import { NextResponse } from "next/server"
import { RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

export async function POST(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = RunAuditSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
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
    })
    .select("id")
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, runId: data.id as string })
}
```

This mirrors the existing `runAuditAction` exactly, just shaped as a `NextResponse`.

---

## Caller updates

**`run-audit-button.tsx`:**
```tsx
"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@repo/ui/components/button"
import { useQueueAudit } from "@/lib/offline/use-queue-audit"

export function RunAuditButton({
  ownerId,
  siteId,
  url,
}: {
  ownerId: string
  siteId: string
  url: string
}) {
  const router = useRouter()
  const queue = useQueueAudit(ownerId)
  const [pending, start] = useTransition()
  return (
    <Button
      disabled={pending}
      onClick={() => {
        start(async () => {
          const result = await queue({ siteId, requestedUrl: url })
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
        })
      }}
    >
      {pending ? "Queueing…" : "Run new audit"}
    </Button>
  )
}
```

**`site-score-card.tsx`:** same pattern in the onClick of its existing Run button. Adds `ownerId` prop. `DashboardOverviewTab` passes it from its own `ownerId` (already a prop in dashboard-view).

**`run-all-button.tsx`:** complete rewrite:
```tsx
"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@repo/ui/components/button"
import type { SiteRow } from "@/lib/db-types"
import { useQueueAudit } from "@/lib/offline/use-queue-audit"

export function RunAllButton({
  ownerId,
  sites,
}: {
  ownerId: string
  sites: SiteRow[]
}) {
  const router = useRouter()
  const queue = useQueueAudit(ownerId)
  const [pending, start] = useTransition()
  return (
    <Button
      disabled={pending || sites.length === 0}
      onClick={() => {
        start(async () => {
          let runIds = 0
          let queued = 0
          let failed = 0
          for (const site of sites) {
            const r = await queue({ siteId: site.id, requestedUrl: site.url })
            if (!r.ok) failed += 1
            else if ("queued" in r) queued += 1
            else runIds += 1
          }
          if (runIds > 0) toast.success(`Queued ${runIds} audit${runIds === 1 ? "" : "s"}`)
          if (queued > 0) toast(`You are offline. ${queued} audit${queued === 1 ? "" : "s"} will run when you're back online.`)
          if (failed > 0) toast.error(`${failed} audit${failed === 1 ? "" : "s"} failed.`)
          router.refresh()
        })
      }}
    >
      {pending ? "Queueing…" : `Run audits on all sites (${sites.length})`}
    </Button>
  )
}
```

**`dashboard-overview-tab.tsx`:** add `ownerId` prop; pass through to `SiteScoreCard` and `RunAllButton` (passing `sites` instead of `siteCount`).

**`dashboard-view.tsx`:** mount the replay hook + pass ownerId to overview:
```tsx
useAuditQueueReplay(ownerId)
// …
<DashboardOverviewTab ownerId={ownerId} sites={cached.sites} latestScores={cached.latestScores} />
```

**`run-detail-view.tsx`:** `RunAuditButton` now needs `ownerId`. Use `initialRun.owner_id`.

**`sign-out-button.tsx`:**
```tsx
await Promise.all([
  clearDashboardCache(ownerId),
  clearAuditQueue(ownerId),
])
form.submit()
```

**Server cleanup:**
- Delete `runAuditAllAction` + `RunAuditAllResult` from `apps/app/src/app/(app)/dashboard/actions.ts`.
- Delete `apps/app/src/test/actions/run-audit-all-action.test.ts` (4 tests removed).
- Keep `runAuditAction` (still exported, no callers in this slice — drop in a future slice).

---

## Testing strategy

**API route (`audit-run-route.test.ts` — 4 tests, modeled on slice-5 `run-audit-action.test.ts`):**
- Rejects invalid input (returns 400).
- Returns 401 when no user.
- Returns 500-shaped error when Supabase insert fails.
- Returns `{ ok: true, runId }` with the inserted id on success.

The mock uses the same hoisted-vi pattern as the existing action tests (mocking `@/lib/supabase-server`).

**`audit-queue.test.ts` — 4 tests** (uses `fake-indexeddb`):
- `enqueueAuditRun` + `readQueueForOwner` round-trip.
- `readQueueForOwner` returns only matching owner entries.
- `removeFromQueue` deletes the one entry.
- `clearAuditQueue` removes all entries for an owner (and only that owner's).

**`db.test.ts` — 1 new test appended:**
- Open V1, write a snapshot, close, re-open as V2 → `dashboard_snapshots` still readable AND `audit_run_queue` store now exists.

**`use-queue-audit.test.ts` — 4 tests** (mock `fetch` via `vi.stubGlobal` + `fake-indexeddb`):
- Online success path: `fetch` returns `{ ok: true, runId }` → hook returns same shape, queue unchanged.
- Network error path: `fetch` rejects → hook enqueues, returns `{ ok: true, queued: true, queueId }`; queue has one entry.
- Server error path (`{ ok: false, error }`, `navigator.onLine === true`): returns error, queue unchanged.
- Server error path (`!ok`, `navigator.onLine === false`): enqueues despite a non-network error.

**`use-audit-queue-replay.test.ts` — 3 tests** (mock `fetch`, dispatch `online` event):
- Mount with one queued entry → fires immediately (online), drains, queue empty after.
- Online event with 3 entries → drains all 3, calls `fetch` 3 times.
- Failure case: server returns `!ok` for one entry → that entry remains in queue; success entries are removed.

**Manual smoke (steps 30-34 in `apps/app/README.md`):** see implementation plan.

**Total new tests:** 4 + 4 + 1 + 4 + 3 = **16 new**. Minus 4 deleted (`run-audit-all-action.test.ts`) = **+12 net**. Slice 7's 108 → slice 8's **~120**.

---

## Migration & backwards-compat

- **DB schema migration**: V1→V2 is additive; existing dashboard cache data survives.
- **Server Action `runAuditAction` stays exported.** No callers remain, but the symbol remains in place to avoid breakage if any external code references it. Drop in a future slice.
- **`runAuditAllAction` deleted.** No external callers; only `RunAllButton` referenced it, and that's rewritten.
- **No new runtime dependencies.** `crypto.randomUUID()` is standard in all modern browsers (Chrome 92+, Safari 15.4+, Firefox 95+).
- **`@testing-library/react`** and **`fake-indexeddb`** are already installed from slice 6/7.

---

## Risks

- **Replay can fire twice in close succession** if both `online` event and a fresh page-load trigger drain. Mitigated by the per-entry `removeFromQueue` happening only on success — a second drain would find an empty queue. Not data-loss-prone.
- **Server error vs network error ambiguity.** A 500 from the API with the user offline-ish is treated as a queue-eligible failure. A 400 (validation) is not. This means a malformed request will get repeatedly retried by the user — but the underlying input is sourced from clean DB rows, so true 400s should be rare.
- **Two tabs racing on replay.** Both will try to drain the shared queue. The duplicate POST will land on the API; the second one will succeed (creates a second `audit_runs` row). User sees a duplicate run. Acceptable for slice 8; future de-dup could rely on the client UUID as an idempotency key.
- **Queue grows unboundedly** if the network is intermittent for hours. Worst case is small (one row per click). No eviction needed in slice 8; if it ever matters, add a max-age sweep.
- **`navigator.onLine` lies.** Same caveat as slice 7's `OfflineBanner`. The queue path triggers on actual `fetch` failure (catch block), which is the reliable signal; the `navigator.onLine` check is only an additional gate for queue-vs-error classification of server failures.

---

## After slice 8

Slice 9 candidates:

- **PWA install prompt** — `beforeinstallprompt` capture + Install button.
- **Per-run IDB cache** — `run_snapshots` store + a `useRunDetailCache` hook mirroring slice 7's dashboard pattern. Makes never-loaded run pages also work offline.
- **Service Worker Background Sync (Chromium)** — drain the queue even without a tab open. Enhancement layer on slice 8's IDB + endpoint plumbing.
- **Idempotency keys end-to-end** — pass the client UUID as a request header; the API rejects duplicate inserts. Closes the two-tab race window.
- **Delete `runAuditAction`** — once dust settles, remove the unused Server Action.
- **Trend dedup + 30-day pruning** (slice 7 carry-forward).
- **Cross-user IDB GC on sign-in** (slice 7 carry-forward).
