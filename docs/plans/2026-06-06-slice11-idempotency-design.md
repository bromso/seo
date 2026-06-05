# Slice 11 — Idempotency Keys End-to-End Design

**Status:** Spec — ready for implementation planning.

**Driver:** Slice 8 introduced an offline audit queue + replay loop and acknowledged a known race: two tabs replaying the same queue entry both POST to `/api/audit-run`, producing duplicate `audit_runs` rows and duplicate pgmq jobs. Slice 11 closes that race with idempotency keys: the client UUID flows from queue entry → HTTP header → DB column → Postgres unique constraint. A duplicate POST returns the original `runId` instead of creating a second row.

**Out of scope (intentional):**
- General Stripe-style idempotency middleware (request body cache + TTL). The `audit_runs` row IS the response; a column suffices.
- Online double-click race. Each click generates a NEW key, so it's a different problem (would need debounce / click-tracking).
- Backfilling existing `audit_runs` rows with synthetic keys. The partial unique index ignores NULL, so legacy rows are fine.
- Idempotency for other actions (`addCompetitorAction`, etc.). They're not exposed to a queue-replay path.

---

## Goal

- DB: new nullable `audit_runs.idempotency_key TEXT` column + partial unique index on `(owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
- API: `POST /api/audit-run` reads optional `Idempotency-Key` header, validates as UUID, stores on insert, returns the existing `runId` on Postgres 23505 unique-violation.
- Client (`useQueueAudit`, `useAuditQueueReplay`): generate one UUID per click, send as header, reuse the same UUID as the queue entry's `id`. On replay, send the queue entry's `id` as the header.
- Two-tab queue replay can no longer produce duplicate `audit_runs` rows.

## Non-goals

- New product surface — no user-visible behavior change in the happy path.
- New IDB store or schema bump. `QueuedAuditRun.id` is already a UUID; its semantic role widens to "also serves as idempotency key" without changing the field.
- Server-side queueing or background work. Replay remains client-driven.

---

## Architecture

```
Tab A — user clicks "Run audit"
        │
        ▼
useQueueAudit
        │
        ├── const key = crypto.randomUUID()
        │
        └── fetch POST /api/audit-run
              Headers: { Idempotency-Key: key, content-type: application/json }
              Body:    { siteId, requestedUrl }
              │
              ├── network ok → server { ok:true, runId } → toast + navigate
              └── network fail → enqueue { id: key, ownerId, siteId, requestedUrl, queuedAt }


Online replay (later, on `online` event)
        │
        ▼
useAuditQueueReplay drain
        for each entry:
          fetch POST /api/audit-run
            Headers: { Idempotency-Key: entry.id, content-type: application/json }
            Body:    { siteId: entry.siteId, requestedUrl: entry.requestedUrl }
            │
            ├── server inserts new row (R1)    → { ok:true, runId: R1 }
            └── server gets 23505 dup-violation
                  → SELECT audit_runs WHERE owner_id=U AND idempotency_key=entry.id
                  → returns { ok:true, runId: existing.id }  ← deduplicated
        if successes > 0: toast.success(`Started ${successes} queued audit(s)`)
```

**No idempotency-key replay window cache.** The audit_runs row is the response; if the row exists, the user already saw success (or will).

---

## File layout

```
packages/db/migrations/
└── 0005_idempotency_key.sql                NEW migration

packages/db/migrations/meta/
└── _journal.json                           APPEND idx:5 entry

packages/db/src/schema/
└── (audit_runs definition)                 MODIFY — add idempotency_key column

apps/app/src/app/api/audit-run/
└── route.ts                                MODIFY — read header, validate, insert with key, dedup on 23505

apps/app/src/lib/offline/
├── use-queue-audit.ts                      MODIFY — generate key per click, send header, reuse id in enqueue
└── use-audit-queue-replay.ts               MODIFY — send entry.id as Idempotency-Key

apps/app/src/test/api/
└── audit-run-route.test.ts                 EXTEND — +3 tests (with-key, invalid-key 400, dedup 23505)

apps/app/src/test/offline/
├── use-queue-audit.test.ts                 EXTEND — +1 test (header sent) + update existing offline-enqueue test
└── use-audit-queue-replay.test.ts          EXTEND — +1 test (header sent on replay)

apps/app/README.md                           APPEND smoke steps 39-41
```

---

## DB migration

`packages/db/migrations/0005_idempotency_key.sql`:

```sql
-- 1. Add nullable idempotency_key column to audit_runs
ALTER TABLE public.audit_runs
  ADD COLUMN idempotency_key TEXT;
--> statement-breakpoint

-- 2. Partial unique index — enforce uniqueness only when key is present.
-- NULL keys (legacy clients, in-flight rows from before this slice) are not
-- subject to the constraint.
CREATE UNIQUE INDEX audit_runs_owner_idempotency_uq
  ON public.audit_runs (owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
```

**Journal entry** appended to `packages/db/migrations/meta/_journal.json`:

```json
{
  "idx": 5,
  "version": "7",
  "when": <Date.now() at write time>,
  "tag": "0005_idempotency_key",
  "breakpoints": true
}
```

Match the `version` field used by the existing journal entries.

**Drizzle schema:** the audit_runs definition in `packages/db/src/schema/` (verify location during T1; slice 3 added the table) gains an `idempotencyKey: text("idempotency_key")` column. The column is nullable. No Drizzle constraint declaration is needed; the partial unique index is created by raw SQL above.

**Apply locally:**

```bash
bun --filter @repo/db migrate
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "\d public.audit_runs"
# Confirm idempotency_key column + audit_runs_owner_idempotency_uq index appear.
```

---

## API route

`apps/app/src/app/api/audit-run/route.ts` — updated POST handler:

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

export async function POST(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = RunAuditSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 })
  }

  const rawKey = req.headers.get("idempotency-key")
  const idempotencyKey = rawKey === null || rawKey === "" ? null : rawKey
  if (idempotencyKey !== null && !z.uuid().safeParse(idempotencyKey).success) {
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

**Backwards-compat:** the old `Idempotency-Key`-less path is unchanged (`rawKey === null` → `idempotencyKey = null` → insert with null → no unique constraint applies).

---

## Client changes

### `useQueueAudit` (`apps/app/src/lib/offline/use-queue-audit.ts`)

Today, the UUID is created inside `enqueue()` only. Pull it up so the SAME UUID flows through the online path's `Idempotency-Key` header AND the queue entry's `id`:

```ts
export function useQueueAudit(ownerId: string) {
  return useCallback(
    async (input: QueueAuditInput): Promise<QueueAuditResult> => {
      const idempotencyKey = crypto.randomUUID()

      async function enqueue(): Promise<QueueAuditResult> {
        try {
          const db = await openOfflineDB()
          const entry: QueuedAuditRun = {
            id: idempotencyKey,
            ownerId,
            siteId: input.siteId,
            requestedUrl: input.requestedUrl,
            queuedAt: Date.now(),
          }
          await enqueueAuditRun(db, entry)
          return { ok: true, queued: true, queueId: idempotencyKey }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "queue failed",
          }
        }
      }

      let res: Response
      try {
        res = await fetch("/api/audit-run", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(input),
        })
      } catch {
        return enqueue()
      }

      if (!res.ok) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          return enqueue()
        }
        return { ok: false, error: `HTTP ${res.status}` }
      }

      const body = (await res.json()) as
        | { ok: true; runId: string }
        | { ok: false; error: string }
      return body
    },
    [ownerId]
  )
}
```

### `useAuditQueueReplay` (`apps/app/src/lib/offline/use-audit-queue-replay.ts`)

The drain loop sends `entry.id` as the header:

```ts
const res = await fetch("/api/audit-run", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": entry.id,
  },
  body: JSON.stringify({
    siteId: entry.siteId,
    requestedUrl: entry.requestedUrl,
  }),
})
```

No other changes.

---

## Testing strategy

### Route tests (extend `apps/app/src/test/api/audit-run-route.test.ts`)

Three new cases (appended to the existing `describe("POST /api/audit-run", …)` block):

```ts
const VALID_KEY = "11111111-1111-4111-8111-111111111111"

it("inserts with idempotency_key from header on success", async () => {
  mockSupabaseClient.auth.getUser.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
  })
  const insertSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: NEW_RUN_ID }, error: null }),
    }),
  })
  mockSupabaseClient.from.mockReturnValue({ insert: insertSpy })

  const { POST } = await import("@/app/api/audit-run/route")
  const req = new Request("http://app.localhost:3001/api/audit-run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": VALID_KEY,
    },
    body: JSON.stringify({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" }),
  })
  const res = await POST(req)
  expect(res.status).toBe(200)
  expect(insertSpy).toHaveBeenCalledWith(
    expect.objectContaining({ idempotency_key: VALID_KEY })
  )
})

it("returns 400 for an invalid idempotency-key header", async () => {
  const { POST } = await import("@/app/api/audit-run/route")
  const req = new Request("http://app.localhost:3001/api/audit-run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "not-a-uuid",
    },
    body: JSON.stringify({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" }),
  })
  const res = await POST(req)
  expect(res.status).toBe(400)
  const body = (await res.json()) as { ok: boolean; error: string }
  expect(body).toEqual({ ok: false, error: "invalid idempotency key" })
})

it("returns the existing runId on Postgres 23505 unique-violation", async () => {
  mockSupabaseClient.auth.getUser.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
  })
  // First call: .from("audit_runs").insert(...).select(...).single() rejects
  // with the 23505 error. Second call: .from("audit_runs").select(...)
  // .eq(...).eq(...).maybeSingle() returns the existing row.
  mockSupabaseClient.from
    .mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: "23505", message: "duplicate key value" },
          }),
        }),
      }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: NEW_RUN_ID },
              error: null,
            }),
          }),
        }),
      }),
    })

  const { POST } = await import("@/app/api/audit-run/route")
  const req = new Request("http://app.localhost:3001/api/audit-run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": VALID_KEY,
    },
    body: JSON.stringify({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" }),
  })
  const res = await POST(req)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: true; runId: string }
  expect(body).toEqual({ ok: true, runId: NEW_RUN_ID })
})
```

Existing 4 slice-8 tests stay green. They didn't send any `Idempotency-Key` header, so the new route falls through with `idempotencyKey: null` and the existing `expect.objectContaining({...})` assertions still match (the extra `idempotency_key: null` column on the insert is fine — `objectContaining` ignores it).

### `useQueueAudit` test (extend `apps/app/src/test/offline/use-queue-audit.test.ts`)

One new test:

```ts
it("sends an idempotency-key header on every POST", async () => {
  const fetchSpy = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, runId: "r1" }), { status: 200 })
  )
  vi.stubGlobal("fetch", fetchSpy)
  const { result } = renderHook(() => useQueueAudit(OWNER))
  await result.current({ siteId: SITE, requestedUrl: URL_X })
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  const call = fetchSpy.mock.calls[0]
  const init = call?.[1] as RequestInit | undefined
  const headers = init?.headers as Record<string, string>
  expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/i)
})
```

Also extend the existing offline-enqueue test to verify the queue entry's `id` equals the would-have-been header value (already implicit — `r.queueId` is returned and used as `entries[0]?.id` — no change needed beyond a one-line assertion that confirms the equality).

### `useAuditQueueReplay` test (extend `apps/app/src/test/offline/use-audit-queue-replay.test.ts`)

One new test:

```ts
it("sends each queue entry's id as the idempotency-key on replay", async () => {
  const db = await openOfflineDB()
  await enqueueAuditRun(db, entry("q-replay-key-xyz"))

  const fetchSpy = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
  )
  vi.stubGlobal("fetch", fetchSpy)

  renderHook(() => useAuditQueueReplay(OWNER))
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled())

  const call = fetchSpy.mock.calls[0]
  const init = call?.[1] as RequestInit | undefined
  const headers = init?.headers as Record<string, string>
  expect(headers["idempotency-key"]).toBe("q-replay-key-xyz")
})
```

### Test count delta

| Sub-item | Δ |
|---|---|
| Route — with-key insert | +1 |
| Route — invalid-key 400 | +1 |
| Route — 23505 dedup | +1 |
| useQueueAudit — header sent | +1 |
| useAuditQueueReplay — header on replay | +1 |
| **Net** | **+5** |

Slice 10's 138 → slice 11's **~143**.

---

## Manual smoke (steps 39-41 in `apps/app/README.md`)

```
39. Online: click "Run audit". DevTools → Network → /api/audit-run → request
    headers include "idempotency-key: <uuid>". Refresh DB:
        PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
          -c "SELECT id, idempotency_key FROM audit_runs ORDER BY started_at DESC LIMIT 1;"
    → the newest row has a non-NULL idempotency_key. New audit proceeds normally.
40. Two-tab queue race smoke (manual): open /dashboard in tabs A + B. Sign
    in same user. DevTools → Network → "Offline" in both. Click Run audit in
    A → toast: "You are offline. Audit will run when you're back online."
    DevTools → Application → IndexedDB → seo-app-cache → audit_run_queue
    in A shows entry with id = X. Copy that entry into B's IDB manually
    (same store, same key). Uncheck Offline in both tabs simultaneously.
    Within ~1s both tabs show "Started 1 queued audit". DB:
        SELECT COUNT(*) FROM audit_runs WHERE idempotency_key = 'X';
    → exactly 1.
41. Malformed header: from /dashboard devtools console:
        fetch("/api/audit-run", { method: "POST",
          headers: { "content-type": "application/json",
                     "idempotency-key": "not-a-uuid" },
          body: JSON.stringify({ siteId: "00000000-0000-0000-0000-000000000000",
                                  requestedUrl: "https://example.com" }) })
          .then(r => r.json()).then(console.log)
    → { ok: false, error: "invalid idempotency key" } and r.status === 400.
```

---

## Migration & backwards-compat

- **Migration is additive**: new nullable column + partial unique index. Existing audit_runs rows unaffected.
- **Old installed PWAs** (clients without the header) keep working: they POST with no `Idempotency-Key`, the route inserts with `idempotency_key: null`, the partial index ignores NULL.
- **Existing queue entries in IDB** (pre-slice-11) already have UUID `id`s. New code reuses them as headers without IDB migration.
- **Slice 8's 4 existing API tests** stay green — they assert with `expect.objectContaining(...)`, which tolerates the new `idempotency_key: null` field in the insert payload.
- **No new dependencies.**

---

## Risks

- **Supabase JS error shape**. We rely on `error.code === "23505"` (PostgREST passes through Postgres SQLSTATE). If a Supabase client upgrade changes the shape, the dedup branch silently falls through to the generic 500 error. The dedup test locks the contract; a regression would fail loudly.
- **Empty header string**. `req.headers.get("idempotency-key")` returns `""` if the header is sent with an empty value (rare). Treated identically to absent: `idempotencyKey = null`. Documented.
- **Header case**. HTTP headers are case-insensitive; `req.headers.get("idempotency-key")` reads regardless of how the client cased it. Client sends `"idempotency-key"` lowercase to match `fetch`'s normalization.
- **Race tolerance vs. user-driven double-click**. Each fresh click generates a NEW key, so they're independent inserts. Idempotency keys only solve the SAME-key-twice (queue replay) problem, not impatient users. That's documented as out-of-scope.

---

## After slice 11

Slice 12 candidates (with idempotency closed, the remaining set is):

- **Per-run IDB cache** — `run_snapshots` store + `useRunDetailCache` hook.
- **SW Background Sync (Chromium)** — drain audit queue without a tab open.
- **Push notifications** for run completion.
- **Minor consistency choices from slice 10 review** — drop unused barrel export OR migrate caller; widen the `next.latestScores === prev.latestScores` change-detection in `useDashboardCache`.
