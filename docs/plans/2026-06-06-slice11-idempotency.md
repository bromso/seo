# Slice 11 — Idempotency Keys End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the slice-8 two-tab replay race by threading a client-generated UUID through the queue → HTTP header → DB column → Postgres unique constraint. A duplicate POST returns the existing `runId` instead of inserting a second `audit_runs` row.

**Architecture:** Migration `0005` adds a nullable `audit_runs.idempotency_key TEXT` column + a partial unique index `(owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. The Drizzle schema in `packages/db/src/schema/audit-runs.ts` gains the matching column. `POST /api/audit-run` reads the `Idempotency-Key` header, validates as UUID, stores it on insert, and on Postgres 23505 unique-violation reads back the existing row's `id`. `useQueueAudit` generates one UUID per click — used both as the request header AND the queue entry's `id`. `useAuditQueueReplay` sends each queue entry's `id` as the header on replay.

**Tech Stack:** Postgres + Drizzle ORM (`@repo/db`), Next.js 16 route handlers, `@supabase/ssr`, Vitest with happy-dom, `crypto.randomUUID()` (native), zod's `z.uuid()`.

**Spec:** [`docs/plans/2026-06-06-slice11-idempotency-design.md`](2026-06-06-slice11-idempotency-design.md)

---

## Conventions used throughout

- Working branch: `feat/idempotency-slice11` (already created off `main`; spec committed at `9f086c1`).
- Conventional commits: `feat(db):` / `feat(app):` / `test(app):` / `docs(app):`.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 10's 138 tests must keep passing after every task; slice 11 adds 5 net new.
- Tests live at `apps/app/src/test/`.
- Use `bun --filter @repo/app <script>` and `bun --filter @repo/db <script>` for per-package scripts.
- Migration applies via `bun --filter @repo/db migrate` against a running local Supabase.

---

## Task 1: DB migration 0005 (column + partial unique index)

**Files:**
- Create: `packages/db/migrations/0005_idempotency_key.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (append idx:5)
- Modify: `packages/db/src/schema/audit-runs.ts` (add column)

No new tests in this task; the route tests in T2 verify the column is read/written. Manual DB inspection confirms the migration applied.

### Step 1: Confirm local Supabase is running

```bash
bunx supabase status | head -3
```

If "Stopped", run `bunx supabase start` and wait for the DB to be reachable.

### Step 2: Create `packages/db/migrations/0005_idempotency_key.sql`

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

### Step 3: Append the journal entry

Open `packages/db/migrations/meta/_journal.json`. There are 5 existing entries (idx 0..4). Append a sixth:

```json
{
  "idx": 5,
  "version": "7",
  "when": <Date.now() at write time>,
  "tag": "0005_idempotency_key",
  "breakpoints": true
}
```

Use the current `Date.now()` value (a monotonic millisecond integer). Match the `version` field of the existing entries — read one to confirm the value (likely `"7"`).

### Step 4: Update Drizzle schema in `packages/db/src/schema/audit-runs.ts`

Replace the file content with:

```ts
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { runStatusEnum } from "./enums"
import { profiles } from "./profiles"
import { sites } from "./sites"

export const auditRuns = pgTable(
  "audit_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("queued"),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredBy: text("triggered_by").notNull().default("manual"),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => ({
    siteStartedAtIdx: index("audit_runs_site_started_idx").on(t.siteId, t.startedAt.desc()),
    ownerIdx: index("audit_runs_owner_idx").on(t.ownerId),
    statusIdx: index("audit_runs_status_idx").on(t.status),
  })
)
```

The partial unique index is NOT declared in Drizzle (Drizzle's `uniqueIndex` doesn't easily express `WHERE` clauses). The raw SQL migration is the source of truth.

### Step 5: Apply the migration

```bash
bun --filter @repo/db migrate
```

Expected: "migrations applied" without errors.

If the migrator complains about an out-of-order journal entry, double-check the index/timestamp.

### Step 6: Verify in psql

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "\d public.audit_runs"
```

Expected output includes:
- `idempotency_key | text |` line
- `"audit_runs_owner_idempotency_uq" UNIQUE, btree (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL`

### Step 7: Verify package builds + tests still green

```bash
bun --filter @repo/db check-types
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: all clean. Test count stays at **138**.

### Step 8: Commit

```bash
git add packages/db/migrations/0005_idempotency_key.sql packages/db/migrations/meta/_journal.json packages/db/src/schema/audit-runs.ts
git commit -m "feat(db): add audit_runs.idempotency_key + partial unique index"
```

---

## Task 2: API route — accept `Idempotency-Key` header + dedup on 23505

**Files:**
- Modify: `apps/app/src/app/api/audit-run/route.ts`
- Modify: `apps/app/src/test/api/audit-run-route.test.ts` (append 3 tests)

### Step 1: Failing tests — append to `audit-run-route.test.ts`

At the top of the file, add (or confirm it already exists):

```ts
const VALID_KEY = "11111111-1111-4111-8111-111111111111"
```

At the END of the existing `describe("POST /api/audit-run", …)` block, append three new tests:

```ts
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
    body: JSON.stringify({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    }),
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
    body: JSON.stringify({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    }),
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
    body: JSON.stringify({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    }),
  })
  const res = await POST(req)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: true; runId: string }
  expect(body).toEqual({ ok: true, runId: NEW_RUN_ID })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 3 new failures. The "with-key" test fails because the current route doesn't read the header. The "invalid-key" test fails (current route accepts anything). The "23505" test fails because the route currently returns 500 on any DB error.

### Step 3: Modify `apps/app/src/app/api/audit-run/route.ts`

Replace the full file content with:

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

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

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: 3 new tests pass + all 4 slice-8 tests still pass → **141 total** (138 + 3).

The 4 slice-8 tests don't send `Idempotency-Key` headers. They use `expect.objectContaining({...})` on the insert assertion, which tolerates the additional `idempotency_key: null` field.

### Step 5: Commit

```bash
git add apps/app/src/app/api/audit-run/route.ts apps/app/src/test/api/audit-run-route.test.ts
git commit -m "feat(app): accept Idempotency-Key header + dedup on 23505 in /api/audit-run"
```

---

## Task 3: `useQueueAudit` sends header + reuses UUID in queue entry

**Files:**
- Modify: `apps/app/src/lib/offline/use-queue-audit.ts`
- Modify: `apps/app/src/test/offline/use-queue-audit.test.ts` (append 1 test)

### Step 1: Failing test — append to `use-queue-audit.test.ts`

At the END of the existing `describe("useQueueAudit", …)` block, append:

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
  const headers = init?.headers as Record<string, string> | undefined
  expect(headers?.["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/i)
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 1 new failure (current code doesn't send the header).

### Step 3: Replace `apps/app/src/lib/offline/use-queue-audit.ts`

Full file content (note: `idempotencyKey` is generated ONCE per callback invocation and reused for both the header AND the queue entry's `id`):

```ts
"use client"
import { useCallback } from "react"
import { enqueueAuditRun, type QueuedAuditRun } from "@/lib/offline/audit-queue"
import { openOfflineDB } from "@/lib/offline/db"

export type QueueAuditResult =
  | { ok: true; runId: string }
  | { ok: true; queued: true; queueId: string }
  | { ok: false; error: string }

export type QueueAuditInput = {
  siteId: string
  requestedUrl: string
}

export function useQueueAudit(
  ownerId: string
): (input: QueueAuditInput) => Promise<QueueAuditResult> {
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

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: 1 new test passes + all 4 existing useQueueAudit tests still pass → **142 total** (141 + 1).

The existing offline-enqueue test asserts `entries[0]?.id === r.queueId`. Since both come from the SAME `idempotencyKey` now, this remains true.

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/use-queue-audit.ts apps/app/src/test/offline/use-queue-audit.test.ts
git commit -m "feat(app): useQueueAudit sends Idempotency-Key header (UUID per click)"
```

---

## Task 4: `useAuditQueueReplay` sends entry id as header

**Files:**
- Modify: `apps/app/src/lib/offline/use-audit-queue-replay.ts`
- Modify: `apps/app/src/test/offline/use-audit-queue-replay.test.ts` (append 1 test)

### Step 1: Failing test — append to `use-audit-queue-replay.test.ts`

At the END of the file, append:

```ts
describe("useAuditQueueReplay — Idempotency-Key header", () => {
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
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.["idempotency-key"]).toBe("q-replay-key-xyz")
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 1 new failure (current replay code doesn't send the header).

### Step 3: Modify `apps/app/src/lib/offline/use-audit-queue-replay.ts`

Locate the `fetch("/api/audit-run", ...)` call inside the `drain` loop. Update the headers object to include `idempotency-key`. The full updated fetch call:

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

No other changes to this file.

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: 1 new test passes + all 4 existing replay tests still pass → **143 total** (142 + 1).

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/use-audit-queue-replay.ts apps/app/src/test/offline/use-audit-queue-replay.test.ts
git commit -m "feat(app): useAuditQueueReplay sends queue entry id as Idempotency-Key"
```

---

## Task 5: README smoke checklist + final DoD sweep

**Files:**
- Modify: `apps/app/README.md` (append steps 39-41)

### Step 1: Append smoke steps to `apps/app/README.md`

Find the existing "Manual smoke checklist" section (ending at slice 9's step 38). Add after step 38:

```
39. Online: click "Run audit". DevTools → Network → /api/audit-run → request
    headers include "idempotency-key: <uuid>". Verify on the DB side:
        PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
          -c "SELECT id, idempotency_key FROM audit_runs ORDER BY started_at DESC LIMIT 1;"
    → the newest row has a non-NULL idempotency_key. New audit proceeds normally.
40. Two-tab queue race smoke: open /dashboard in tabs A + B, signed in as the
    same user. DevTools → Network → "Offline" in both. Click "Run audit" in A
    → toast: "You are offline. Audit will run when you're back online."
    DevTools → Application → IndexedDB → seo-app-cache → audit_run_queue in A
    shows entry with id = X. Copy that entry into B's IDB manually
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

### Step 2: Full DoD sweep

```bash
# 1. Tests
bun --filter @repo/app test
# Expected: ~143 passing (138 baseline + 5 new)

# 2. Typecheck (app)
bun --filter @repo/app check-types

# 3. Typecheck (db)
bun --filter @repo/db check-types

# 4. Build (app)
bun --filter @repo/app build

# 5. Lint
bun --filter @repo/app lint
```

All clean. Any warnings are pre-existing.

### Step 3: Final commit

```bash
git add apps/app/README.md
git commit -m "docs(app): add slice 11 smoke checklist (steps 39-41)"
```

---

## Report Format

(For the implementer to fill in after T5.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/db check-types` clean | … |
  | 4 | `bun --filter @repo/app test` (~143 tests) | … |
  | 5 | Migration 0005 applied; column + partial index in psql | … |
  | 6 | Online: Idempotency-Key header sent | Deferred to user verification |
  | 7 | Two-tab queue race produces only one audit_runs row | Deferred to user verification |
  | 8 | Malformed Idempotency-Key returns 400 | Deferred to user verification |
- Total test count
- Commit SHA list (5 commits expected)
- Slice 11 release note (one line)
- Any carry-forwards for slice 12

---

## After slice 11

Slice 12 candidates (slimmer list with idempotency closed):

- **Per-run IDB cache** — `run_snapshots` store + `useRunDetailCache` hook.
- **SW Background Sync (Chromium)** — drain audit queue without a tab open.
- **Push notifications** for run completion.
- **Minor consistency choices from slice 10 review** — drop unused barrel export OR migrate caller; widen `next.latestScores === prev.latestScores` change-detection in `useDashboardCache`.
- **Online-double-click race** (this slice closes the queue-replay race, not the impatient-click case) — debounce on Run buttons or pending-state UX.
