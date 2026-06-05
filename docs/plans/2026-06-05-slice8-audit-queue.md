# Slice 8 — Offline Audit Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user clicks "Run audit" while offline, queue the request in IndexedDB and replay it via `POST /api/audit-run` when `window.online` fires. Wire three call sites (`RunAuditButton`, `SiteScoreCard`'s Run button, `RunAllButton`) through a new `useQueueAudit(ownerId)` hook. Mount a `useAuditQueueReplay(ownerId)` hook on the dashboard that drains the queue on reconnect. Sign-out clears both the dashboard snapshot AND the audit queue.

**Architecture:** New thin `POST /api/audit-run` endpoint mirrors the existing `runAuditAction`. `lib/offline/audit-queue.ts` adds CRUD on a new `audit_run_queue` IDB store (DB version bumped 1→2, additive migration). The `useQueueAudit` hook does online fetch + offline enqueue. The `useAuditQueueReplay` hook listens for `online` events and drains. `RunAllButton` is rewritten to iterate over sites client-side using the same hook, replacing `runAuditAllAction` (which is deleted along with its 4 tests).

**Tech Stack:** Next.js 16 App Router route handlers, `@supabase/ssr`, IndexedDB (native), `fake-indexeddb` (already installed), happy-dom (Vitest env), `crypto.randomUUID()` (native modern browsers).

**Spec:** [`docs/plans/2026-06-05-slice8-audit-queue-design.md`](2026-06-05-slice8-audit-queue-design.md)

---

## Conventions used throughout

- Working branch: `feat/audit-queue-slice8` (already created off `main`; spec committed at `df03275`).
- Conventional commits: `feat(app):` / `test(app):` / `docs(app):` / `chore(app):`.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 7's 108 tests must keep passing after every task (minus the 4 tests we delete in T8: net floor is 104, ceiling 120).
- Tests live at `apps/app/src/test/`.
- Use `bun --filter @repo/app <script>` for per-package operations.
- All IDB operations go through `openOfflineDB()` so tests can swap in `fake-indexeddb/auto`.
- All FanOut + offline imports come from existing slice 6/7 barrels.

---

## Task 1: DB V1→V2 migration (add `audit_run_queue` store)

**Files:**
- Modify: `apps/app/src/lib/offline/db.ts`
- Modify: `apps/app/src/test/offline/db.test.ts`

### Step 1: Append migration test

At the END of `apps/app/src/test/offline/db.test.ts`, after the existing `describe("openOfflineDB", ...)` block, append:

```ts
import type { DashboardSnapshot } from "@/lib/offline/snapshot"
import { readSnapshot } from "@/lib/offline/snapshot"

describe("openOfflineDB — V1→V2 migration", () => {
  it("opens version 2 and exposes audit_run_queue store", async () => {
    const db = await openOfflineDB()
    expect(db.version).toBe(2)
    expect(db.objectStoreNames.contains(STORE_DASHBOARD)).toBe(true)
    expect(db.objectStoreNames.contains("audit_run_queue")).toBe(true)
  })

  it("preserves existing dashboard_snapshots data when migrating from V1", async () => {
    // Manually open V1 first to simulate an installed-with-slice-7 user.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("seo-app-cache", 1)
      req.onupgradeneeded = () => {
        const v1 = req.result
        if (!v1.objectStoreNames.contains("dashboard_snapshots")) {
          v1.createObjectStore("dashboard_snapshots", { keyPath: "ownerId" })
        }
      }
      req.onsuccess = () => {
        const v1 = req.result
        const tx = v1.transaction("dashboard_snapshots", "readwrite")
        const snap: DashboardSnapshot = {
          ownerId: "owner-x",
          updatedAt: 1,
          sites: [],
          latestScores: [],
          trends: [],
        }
        tx.objectStore("dashboard_snapshots").put(snap)
        tx.oncomplete = () => {
          v1.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    _resetOfflineDBCache()
    const db = await openOfflineDB()
    expect(db.version).toBe(2)
    const got = await readSnapshot(db, "owner-x")
    expect(got?.ownerId).toBe("owner-x")
    expect(db.objectStoreNames.contains("audit_run_queue")).toBe(true)

    // Sanity: writing to the new store works.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("audit_run_queue", "readwrite")
      tx.objectStore("audit_run_queue").put({
        id: "qid-1",
        ownerId: "owner-x",
        siteId: "s",
        requestedUrl: "https://example.com",
        queuedAt: 1,
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  })
})
```


### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 2 new failures (V2 not yet shipped — first test fails on `version === 2` assertion; second fails the same way after migration attempt).

### Step 3: Modify `apps/app/src/lib/offline/db.ts`

Bump `DB_VERSION` to `2` and add `STORE_AUDIT_QUEUE`. The full updated file:

```ts
export const DB_NAME = "seo-app-cache"
export const DB_VERSION = 2
export const STORE_DASHBOARD = "dashboard_snapshots"
export const STORE_AUDIT_QUEUE = "audit_run_queue"

let cachedDb: Promise<IDBDatabase> | null = null

export function openOfflineDB(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb
  cachedDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      if (event.oldVersion < 1 && !db.objectStoreNames.contains(STORE_DASHBOARD)) {
        db.createObjectStore(STORE_DASHBOARD, { keyPath: "ownerId" })
      }
      if (event.oldVersion < 2 && !db.objectStoreNames.contains(STORE_AUDIT_QUEUE)) {
        db.createObjectStore(STORE_AUDIT_QUEUE, { keyPath: "id" })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  return cachedDb
}

/** Test-only: clear the cached promise so the next call re-opens fresh. */
export function _resetOfflineDBCache(): void {
  const prev = cachedDb
  cachedDb = null
  if (prev) {
    void prev.then((db) => db.close()).catch(() => {})
  }
}
```

Two changes vs the existing file:
1. `DB_VERSION = 2`; new `STORE_AUDIT_QUEUE` constant.
2. `onupgradeneeded` uses `event.oldVersion` guards (additive migration; preserves V1 data).

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
```

Expected: all V1 db tests still pass + 2 new migration tests pass → **110 total** (108 + 2).

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/db.ts apps/app/src/test/offline/db.test.ts
git commit -m "feat(app): bump offline DB to V2 with audit_run_queue store"
```

---

## Task 2: `audit-queue.ts` CRUD + tests

**Files:**
- Create: `apps/app/src/lib/offline/audit-queue.ts`
- Create: `apps/app/src/test/offline/audit-queue.test.ts`

### Step 1: Failing test

Create `apps/app/src/test/offline/audit-queue.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  clearAuditQueue,
  enqueueAuditRun,
  type QueuedAuditRun,
  readQueueForOwner,
  removeFromQueue,
} from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"

const OWNER_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const OWNER_B = "8b7c1a2f-3d4e-4f5a-9b6c-1d2e3f4a5b6c"

function entry(over: Partial<QueuedAuditRun> & Pick<QueuedAuditRun, "id">): QueuedAuditRun {
  return {
    ownerId: OWNER_A,
    siteId: "11111111-1111-4111-8111-111111111111",
    requestedUrl: "https://example.com",
    queuedAt: 1,
    ...over,
  }
}

beforeEach(async () => {
  _resetOfflineDBCache()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })
})

afterEach(() => {
  _resetOfflineDBCache()
})

describe("audit-queue", () => {
  it("enqueueAuditRun + readQueueForOwner round-trips a single entry", async () => {
    const db = await openOfflineDB()
    const e = entry({ id: "q1" })
    await enqueueAuditRun(db, e)
    const got = await readQueueForOwner(db, OWNER_A)
    expect(got).toEqual([e])
  })

  it("readQueueForOwner returns only matching owner entries", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry({ id: "q1", ownerId: OWNER_A }))
    await enqueueAuditRun(db, entry({ id: "q2", ownerId: OWNER_B }))
    await enqueueAuditRun(db, entry({ id: "q3", ownerId: OWNER_A }))
    const got = await readQueueForOwner(db, OWNER_A)
    expect(got).toHaveLength(2)
    expect(got.map((g) => g.id).sort()).toEqual(["q1", "q3"])
  })

  it("removeFromQueue deletes the one entry", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry({ id: "q1" }))
    await enqueueAuditRun(db, entry({ id: "q2" }))
    await removeFromQueue(db, "q1")
    const got = await readQueueForOwner(db, OWNER_A)
    expect(got.map((g) => g.id)).toEqual(["q2"])
  })

  it("clearAuditQueue removes all entries for that owner only", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry({ id: "q1", ownerId: OWNER_A }))
    await enqueueAuditRun(db, entry({ id: "q2", ownerId: OWNER_B }))
    await enqueueAuditRun(db, entry({ id: "q3", ownerId: OWNER_A }))
    await clearAuditQueue(OWNER_A)
    expect(await readQueueForOwner(db, OWNER_A)).toEqual([])
    expect(await readQueueForOwner(db, OWNER_B)).toHaveLength(1)
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 4 new failures (module not found).

### Step 3: Implement `apps/app/src/lib/offline/audit-queue.ts`

```ts
import { openOfflineDB, STORE_AUDIT_QUEUE } from "@/lib/offline/db"

export type QueuedAuditRun = {
  id: string
  ownerId: string
  siteId: string
  requestedUrl: string
  queuedAt: number
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_AUDIT_QUEUE, mode).objectStore(STORE_AUDIT_QUEUE)
}

function awaitRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function enqueueAuditRun(db: IDBDatabase, entry: QueuedAuditRun): Promise<void> {
  await awaitRequest(txStore(db, "readwrite").put(entry))
}

export async function readQueueForOwner(
  db: IDBDatabase,
  ownerId: string
): Promise<QueuedAuditRun[]> {
  const all = await awaitRequest<QueuedAuditRun[]>(txStore(db, "readonly").getAll())
  return all.filter((e) => e.ownerId === ownerId)
}

export async function removeFromQueue(db: IDBDatabase, id: string): Promise<void> {
  await awaitRequest(txStore(db, "readwrite").delete(id))
}

export async function clearAuditQueue(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    const entries = await readQueueForOwner(db, ownerId)
    await Promise.all(entries.map((e) => removeFromQueue(db, e.id)))
  } catch {
    // IDB unavailable — best-effort cleanup, do not block sign-out
  }
}
```

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
```

Expected: 4 new tests pass → **114 total**.

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/audit-queue.ts apps/app/src/test/offline/audit-queue.test.ts
git commit -m "feat(app): add audit_run_queue CRUD (enqueue/read/remove/clear)"
```

---

## Task 3: `POST /api/audit-run` route + tests

**Files:**
- Create: `apps/app/src/app/api/audit-run/route.ts`
- Create: `apps/app/src/test/api/audit-run-route.test.ts`

### Step 1: Failing test

Create `apps/app/src/test/api/audit-run-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockCreateServerSupabase, mockSupabaseClient } = vi.hoisted(() => {
  const mockSupabaseClient = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  }
  const mockCreateServerSupabase = vi.fn(async () => mockSupabaseClient)
  return { mockCreateServerSupabase, mockSupabaseClient }
})

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: mockCreateServerSupabase,
}))

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const VALID_SITE_ID = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const NEW_RUN_ID = "b1f2e3d4-c5b6-4a78-9012-3456789abcde"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeRequest(body: unknown): Request {
  return new Request("http://app.localhost:3001/api/audit-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/audit-run", () => {
  it("returns 400 on invalid input", async () => {
    const { POST } = await import("@/app/api/audit-run/route")
    const res = await POST(makeRequest({ siteId: "not-a-uuid", requestedUrl: "not-a-url" }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  })

  it("returns 401 when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import("@/app/api/audit-run/route")
    const res = await POST(
      makeRequest({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" })
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns 500 on insert failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
        }),
      }),
    })
    const { POST } = await import("@/app/api/audit-run/route")
    const res = await POST(
      makeRequest({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" })
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body).toEqual({ ok: false, error: "boom" })
  })

  it("returns 200 with runId on success", async () => {
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
    const res = await POST(
      makeRequest({ siteId: VALID_SITE_ID, requestedUrl: "https://example.com" })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; runId: string }
    expect(body).toEqual({ ok: true, runId: NEW_RUN_ID })
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: VALID_SITE_ID,
        owner_id: VALID_USER_ID,
        requested_url: "https://example.com",
        triggered_by: "manual",
      })
    )
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 4 new failures (module not found).

### Step 3: Implement `apps/app/src/app/api/audit-run/route.ts`

```ts
import { NextResponse } from "next/server"
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
    })
    .select("id")
    .single()

  if (error) {
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

Expected: 4 new tests pass → **118 total**. Typecheck clean.

### Step 5: Commit

```bash
git add apps/app/src/app/api/audit-run/route.ts apps/app/src/test/api/audit-run-route.test.ts
git commit -m "feat(app): add POST /api/audit-run route (mirrors runAuditAction)"
```

---

## Task 4: `useQueueAudit` hook + tests

**Files:**
- Create: `apps/app/src/lib/offline/use-queue-audit.ts`
- Create: `apps/app/src/test/offline/use-queue-audit.test.ts`

### Step 1: Failing test

Create `apps/app/src/test/offline/use-queue-audit.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readQueueForOwner } from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { useQueueAudit } from "@/lib/offline/use-queue-audit"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const URL_X = "https://example.com"

beforeEach(async () => {
  _resetOfflineDBCache()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })
  // Default to online
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  })
})

afterEach(() => {
  _resetOfflineDBCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useQueueAudit", () => {
  it("returns { ok:true, runId } on a successful online fetch and does NOT enqueue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, runId: "r1" }), { status: 200 })
      )
    )
    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r).toEqual({ ok: true, runId: "r1" })
    const db = await openOfflineDB()
    expect(await readQueueForOwner(db, OWNER)).toEqual([])
  })

  it("enqueues on network error and returns { ok:true, queued:true, queueId }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down")
      })
    )
    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r.ok).toBe(true)
    if (r.ok && "queued" in r) {
      expect(r.queued).toBe(true)
      expect(typeof r.queueId).toBe("string")
      const db = await openOfflineDB()
      const entries = await readQueueForOwner(db, OWNER)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        id: r.queueId,
        ownerId: OWNER,
        siteId: SITE,
        requestedUrl: URL_X,
      })
    } else {
      throw new Error("expected queued result")
    }
  })

  it("returns the server error without queueing when online and server says !ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 })
      )
    )
    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r).toEqual({ ok: false, error: "HTTP 500" })
    const db = await openOfflineDB()
    expect(await readQueueForOwner(db, OWNER)).toEqual([])
  })

  it("enqueues a non-ok server response when navigator.onLine is false", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 503 })
      )
    )
    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r.ok).toBe(true)
    if (r.ok && "queued" in r) {
      expect(r.queued).toBe(true)
    } else {
      throw new Error("expected queued result")
    }
    const db = await openOfflineDB()
    expect(await readQueueForOwner(db, OWNER)).toHaveLength(1)
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 4 new failures (module not found).

### Step 3: Implement `apps/app/src/lib/offline/use-queue-audit.ts`

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
    async (input: QueueAuditInput) => {
      async function enqueue(): Promise<QueueAuditResult> {
        try {
          const id = crypto.randomUUID()
          const db = await openOfflineDB()
          const entry: QueuedAuditRun = {
            id,
            ownerId,
            siteId: input.siteId,
            requestedUrl: input.requestedUrl,
            queuedAt: Date.now(),
          }
          await enqueueAuditRun(db, entry)
          return { ok: true, queued: true, queueId: id }
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
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
      } catch {
        // Network error — definitely offline.
        return enqueue()
      }

      if (!res.ok) {
        // HTTP error. If we're offline-ish, queue; otherwise surface.
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

Expected: 4 new tests pass → **122 total**.

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/use-queue-audit.ts apps/app/src/test/offline/use-queue-audit.test.ts
git commit -m "feat(app): add useQueueAudit hook (online POST or IDB enqueue)"
```

---

## Task 5: `useAuditQueueReplay` hook + tests

**Files:**
- Create: `apps/app/src/lib/offline/use-audit-queue-replay.ts`
- Create: `apps/app/src/test/offline/use-audit-queue-replay.test.ts`

### Step 1: Failing test

Create `apps/app/src/test/offline/use-audit-queue-replay.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  enqueueAuditRun,
  type QueuedAuditRun,
  readQueueForOwner,
} from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { useAuditQueueReplay } from "@/lib/offline/use-audit-queue-replay"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

function entry(id: string): QueuedAuditRun {
  return {
    id,
    ownerId: OWNER,
    siteId: "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5",
    requestedUrl: "https://example.com",
    queuedAt: 1,
  }
}

beforeEach(async () => {
  _resetOfflineDBCache()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true })
})

afterEach(() => {
  _resetOfflineDBCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useAuditQueueReplay", () => {
  it("drains a non-empty queue on mount when online and removes successful entries", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))
    await enqueueAuditRun(db, entry("q2"))

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    renderHook(() => useAuditQueueReplay(OWNER))

    await waitFor(async () => {
      const left = await readQueueForOwner(db, OWNER)
      expect(left).toEqual([])
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("drains the queue when the window 'online' event fires", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    renderHook(() => useAuditQueueReplay(OWNER))
    // While offline, mount-fire is skipped — no drain yet.
    expect(fetchMock).not.toHaveBeenCalled()

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true })
    window.dispatchEvent(new Event("online"))

    await waitFor(async () => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const left = await readQueueForOwner(db, OWNER)
      expect(left).toEqual([])
    })
  })

  it("retains entries whose replay fetch returns !ok", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))
    await enqueueAuditRun(db, entry("q2"))

    let i = 0
    const fetchMock = vi.fn(async () => {
      i += 1
      // First call ok, second call !ok
      if (i === 1) {
        return new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderHook(() => useAuditQueueReplay(OWNER))

    await waitFor(async () => {
      const left = await readQueueForOwner(db, OWNER)
      expect(left).toHaveLength(1)
      expect(left[0]?.id).toBe("q2")
    })
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 3 new failures (module not found).

### Step 3: Implement `apps/app/src/lib/offline/use-audit-queue-replay.ts`

```ts
"use client"
import { useEffect } from "react"
import { toast } from "sonner"
import {
  type QueuedAuditRun,
  readQueueForOwner,
  removeFromQueue,
} from "@/lib/offline/audit-queue"
import { openOfflineDB } from "@/lib/offline/db"

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
            // leave in queue
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

    if (typeof navigator === "undefined" || navigator.onLine) {
      void drain()
    }

    const handler = () => {
      void drain()
    }
    window.addEventListener("online", handler)
    return () => {
      window.removeEventListener("online", handler)
    }
  }, [ownerId])
}
```

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: 3 new tests pass → **125 total**.

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/use-audit-queue-replay.ts apps/app/src/test/offline/use-audit-queue-replay.test.ts
git commit -m "feat(app): add useAuditQueueReplay hook (drain on online event)"
```

---

## Task 6: Rewire `RunAuditButton` to use `useQueueAudit`

**Files:**
- Modify: `apps/app/src/components/run-audit-button.tsx`
- Modify: `apps/app/src/views/run-detail-view.tsx` (pass `ownerId` prop)

### Step 1: Read the current component to confirm shape

```bash
cat apps/app/src/components/run-audit-button.tsx
```

Confirm it currently takes `(siteId, url)` and calls `runAuditAction` directly. Note the existing `toast`/`router.push` logic so we preserve it.

### Step 2: Replace `apps/app/src/components/run-audit-button.tsx`

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
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

### Step 3: Update `apps/app/src/views/run-detail-view.tsx` caller

Find the line that renders `<RunAuditButton ... />`. Pass `ownerId={initialRun.owner_id}`:

```tsx
<RunAuditButton ownerId={initialRun.owner_id} siteId={initialRun.site_id} url={initialRun.requested_url} />
```

(Exact prop names depend on the current call site; preserve `siteId` and `url` from the existing usage and prepend `ownerId`.)

If `RunAuditButton` isn't currently rendered in `run-detail-view.tsx`, grep:

```bash
grep -rn "RunAuditButton" apps/app/src --include="*.tsx"
```

Update every caller to pass `ownerId`.

### Step 4: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. Test count unchanged (no new tests; the button-level behavior is exercised through the hook tests above).

### Step 5: Commit

```bash
git add apps/app/src/components/run-audit-button.tsx apps/app/src/views/run-detail-view.tsx
git commit -m "feat(app): rewire RunAuditButton through useQueueAudit"
```

---

## Task 7: Rewire `SiteScoreCard`'s Run button through `useQueueAudit`

**Files:**
- Modify: `apps/app/src/components/site-score-card.tsx`
- Modify: `apps/app/src/views/dashboard-overview-tab.tsx` (pass `ownerId`)

### Step 1: Read the current component

```bash
cat apps/app/src/components/site-score-card.tsx
```

Find the section that calls `runAuditAction(...)` inside the `<Button>` onClick handler.

### Step 2: Replace the import + the onClick

Replace this import line:

```tsx
import { runAuditAction } from "@/app/(app)/dashboard/actions"
```

with:

```tsx
import { useQueueAudit } from "@/lib/offline/use-queue-audit"
```

Add `ownerId` to the component's props:

```tsx
export function SiteScoreCard({
  ownerId,
  site,
  scores,
  selfScores,
}: {
  ownerId: string
  site: SiteRow
  scores: LatestScoreRow[]
  selfScores: LatestScoreRow[] | null
}) {
```

Inside the component body, add the hook:

```tsx
const queue = useQueueAudit(ownerId)
```

Replace the existing onClick body for the Run button. The new body:

```tsx
onClick={() => {
  start(async () => {
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
  })
}}
```

### Step 3: Update `apps/app/src/views/dashboard-overview-tab.tsx` to pass `ownerId`

Find the SiteScoreCard render line. Add `ownerId={ownerId}`:

```tsx
<SiteScoreCard
  key={site.id}
  ownerId={ownerId}
  site={site}
  scores={rowsBySite.get(site.id) ?? []}
  selfScores={site.is_competitor ? selfScores : null}
/>
```

This requires `ownerId` to be in `DashboardOverviewTab`'s own props. Add it:

```tsx
export function DashboardOverviewTab({
  ownerId,
  sites,
  latestScores,
}: {
  ownerId: string
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
}) {
```

(The dashboard-view that renders this tab is updated in Task 9.)

### Step 4: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Tests pass. Build may fail temporarily if dashboard-view isn't yet passing `ownerId` — that's OK; Task 9 fixes it. If you want to check-build now, do Task 9 first and combine the commits. For atomicity, prefer:

```bash
bun --filter @repo/app build
```

If build fails due to missing `ownerId` prop on the `DashboardOverviewTab` caller in `dashboard-view.tsx`, jump to Task 9 to add that prop, then come back.

### Step 5: Commit (after Task 9 lands)

This task and Task 9 should land together to keep the tree green. Stage both file sets and commit once both are done:

```bash
git add apps/app/src/components/site-score-card.tsx apps/app/src/views/dashboard-overview-tab.tsx
# (Task 9 also stages dashboard-view.tsx)
git commit -m "feat(app): rewire SiteScoreCard through useQueueAudit"
```

---

## Task 8: Rewrite `RunAllButton` client-side + delete `runAuditAllAction`

**Files:**
- Modify: `apps/app/src/components/run-all-button.tsx` (full rewrite)
- Modify: `apps/app/src/views/dashboard-overview-tab.tsx` (pass `ownerId` + `sites` instead of `siteCount`)
- Modify: `apps/app/src/app/(app)/dashboard/actions.ts` (delete `runAuditAllAction` + `RunAuditAllResult`)
- Delete: `apps/app/src/test/actions/run-audit-all-action.test.ts`

### Step 1: Replace `apps/app/src/components/run-all-button.tsx`

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
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
          let succeeded = 0
          let queued = 0
          let failed = 0
          for (const site of sites) {
            const r = await queue({ siteId: site.id, requestedUrl: site.url })
            if (!r.ok) failed += 1
            else if ("queued" in r) queued += 1
            else succeeded += 1
          }
          if (succeeded > 0) {
            toast.success(`Queued ${succeeded} audit${succeeded === 1 ? "" : "s"}`)
          }
          if (queued > 0) {
            toast(
              `You are offline. ${queued} audit${queued === 1 ? "" : "s"} will run when you're back online.`
            )
          }
          if (failed > 0) {
            toast.error(`${failed} audit${failed === 1 ? "" : "s"} failed.`)
          }
          router.refresh()
        })
      }}
    >
      {pending ? "Queueing…" : `Run audits on all sites (${sites.length})`}
    </Button>
  )
}
```

### Step 2: Update `apps/app/src/views/dashboard-overview-tab.tsx`

Replace the `<RunAllButton siteCount={sites.length} />` line with:

```tsx
<RunAllButton ownerId={ownerId} sites={sites} />
```

### Step 3: Delete `runAuditAllAction` from `apps/app/src/app/(app)/dashboard/actions.ts`

Open the file and delete:
- The `export type RunAuditAllResult = ...` line
- The entire `export async function runAuditAllAction(): Promise<RunAuditAllResult> { ... }` block

Keep `runAuditAction`, `addCompetitorAction`, `removeCompetitorAction` intact.

### Step 4: Delete `apps/app/src/test/actions/run-audit-all-action.test.ts`

```bash
rm apps/app/src/test/actions/run-audit-all-action.test.ts
```

This removes 4 tests.

### Step 5: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Expected: test count drops from 125 → **121** (4 deleted). check-types + build pass IF Task 9 has landed (dashboard-view needs to pass `ownerId` to DashboardOverviewTab). Coordinate with Task 9.

### Step 6: Commit (with Tasks 7 and 9)

Tasks 7, 8, 9 are interdependent through shared props on `DashboardOverviewTab`. They can land as three commits OR one combined commit. Prefer three separate commits but in this exact order so each is buildable:

1. Task 9 first (add `ownerId` prop to dashboard-view → DashboardOverviewTab signature change).
2. Then Task 7 (SiteScoreCard wiring).
3. Then Task 8 (RunAllButton rewrite + action delete).

If you prefer atomic, bundle 7+8+9 into one commit:

```bash
git add apps/app/src/components/run-all-button.tsx \
  apps/app/src/components/site-score-card.tsx \
  apps/app/src/views/dashboard-overview-tab.tsx \
  apps/app/src/views/dashboard-view.tsx \
  apps/app/src/app/\(app\)/dashboard/actions.ts \
  apps/app/src/test/actions/run-audit-all-action.test.ts
git commit -m "feat(app): rewrite RunAllButton client-side; delete runAuditAllAction"
```

(Adapt the staging command above for whichever commit-grouping you pick. Each commit must leave the tree building.)

---

## Task 9: Mount `useAuditQueueReplay` in `dashboard-view`; pass `ownerId` to `DashboardOverviewTab`

**Files:**
- Modify: `apps/app/src/views/dashboard-view.tsx`

### Step 1: Read the current file

```bash
cat apps/app/src/views/dashboard-view.tsx
```

It currently calls `useRealtimeScores(ownerId)` and `useDashboardCache(ownerId, ...)`. Add the replay hook + pass `ownerId` down.

### Step 2: Replace `apps/app/src/views/dashboard-view.tsx`

```tsx
"use client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs"
import { CompetitorDrawer } from "@/components/competitor-drawer"
import { OfflineBanner } from "@/components/offline-banner"
import { useRealtimeScores } from "@/hooks/use-realtime-scores"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { useAuditQueueReplay } from "@/lib/offline/use-audit-queue-replay"
import { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
import { DashboardOverviewTab } from "@/views/dashboard-overview-tab"
import { DashboardTrendsTab } from "@/views/dashboard-trends-tab"

export function DashboardView({
  ownerId,
  sites,
  latestScores,
  trends,
}: {
  ownerId: string
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}) {
  useRealtimeScores(ownerId)
  useAuditQueueReplay(ownerId)
  const cached = useDashboardCache(ownerId, { sites, latestScores, trends })
  const competitors = cached.sites.filter((s) => s.is_competitor)
  return (
    <div className="space-y-6">
      <OfflineBanner />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <CompetitorDrawer competitors={competitors} />
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <DashboardOverviewTab
            ownerId={ownerId}
            sites={cached.sites}
            latestScores={cached.latestScores}
          />
        </TabsContent>
        <TabsContent value="trends">
          <DashboardTrendsTab trends={cached.trends} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

### Step 3: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS (assuming Tasks 7 + 8 also landed, so DashboardOverviewTab accepts `ownerId` and RunAllButton accepts `ownerId/sites`).

### Step 4: Commit (combined with Tasks 7 + 8 per Task 8 Step 6)

See Task 8 Step 6 for the combined commit guidance.

---

## Task 10: Sign-out clears the audit queue

**Files:**
- Modify: `apps/app/src/components/sign-out-button.tsx`

### Step 1: Replace `apps/app/src/components/sign-out-button.tsx`

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import { useTransition } from "react"
import { clearAuditQueue } from "@/lib/offline/audit-queue"
import { clearDashboardCache } from "@/lib/offline/clear-cache"

export function SignOutButton({ ownerId }: { ownerId: string }) {
  const [pending, start] = useTransition()
  return (
    <form
      action="/sign-out"
      method="POST"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        start(async () => {
          await Promise.all([clearDashboardCache(ownerId), clearAuditQueue(ownerId)])
          form.submit()
        })
      }}
    >
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </form>
  )
}
```

### Step 2: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS.

### Step 3: Commit

```bash
git add apps/app/src/components/sign-out-button.tsx
git commit -m "feat(app): clear audit queue on sign-out (in parallel with dashboard cache)"
```

---

## Task 11: Update offline barrel `index.ts`

**Files:**
- Modify: `apps/app/src/lib/offline/index.ts`

### Step 1: Replace `apps/app/src/lib/offline/index.ts`

```ts
export {
  clearAuditQueue,
  enqueueAuditRun,
  type QueuedAuditRun,
  readQueueForOwner,
  removeFromQueue,
} from "@/lib/offline/audit-queue"
export { clearDashboardCache } from "@/lib/offline/clear-cache"
export {
  _resetOfflineDBCache,
  DB_NAME,
  DB_VERSION,
  openOfflineDB,
  STORE_AUDIT_QUEUE,
  STORE_DASHBOARD,
} from "@/lib/offline/db"
export {
  applyEventToSnapshot,
  clearSnapshot,
  type DashboardSnapshot,
  readSnapshot,
  writeSnapshot,
} from "@/lib/offline/snapshot"
export { useAuditQueueReplay } from "@/lib/offline/use-audit-queue-replay"
export { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
export {
  type QueueAuditInput,
  type QueueAuditResult,
  useQueueAudit,
} from "@/lib/offline/use-queue-audit"
```

### Step 2: Verify

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Both PASS.

### Step 3: Commit

```bash
git add apps/app/src/lib/offline/index.ts
git commit -m "feat(app): export audit-queue + queue hooks from offline barrel"
```

---

## Task 12: README smoke checklist + DoD sweep + final commit

**Files:**
- Modify: `apps/app/README.md` (append steps 30-34)

### Step 1: Append to `apps/app/README.md`

Find the existing "Manual smoke checklist" section (ending at slice 7's step 29). Add after step 29:

```
30. Sign in, online. Click "Run audit" on any site card. Toast: "Audit queued — XXXXXXXX".
    Navigate happens as before. (No regression vs slice 5.)
31. Sign in, then DevTools → Network → Offline. Click "Run audit" → toast:
    "You are offline. Audit will run when you're back online." No navigation.
    DevTools → Application → IndexedDB → seo-app-cache → audit_run_queue
    shows one entry keyed by a UUID.
32. Uncheck Offline. Within ~1 second a toast appears: "Queued audit started —
    XXXXXXXX". The audit_run_queue entry disappears. Dashboard refreshes via
    FanOut as the run progresses.
33. Offline, click "Run audits on all sites (N)" → N entries land in audit_run_queue.
    Go online → N success toasts pop in sequence; queue empties.
34. Sign out → audit_run_queue is empty for your owner_id (DevTools).
```

### Step 2: Full DoD sweep

```bash
# 1. Tests
bun --filter @repo/app test
# Expected: ~121 passing (108 baseline + 16 new − 4 deleted = 120; off-by-one due to
# inevitable +1 here or there is fine; the absolute number isn't load-bearing).

# 2. Typecheck
bun --filter @repo/app check-types

# 3. Build
bun --filter @repo/app build

# 4. Lint
bun --filter @repo/app lint
```

All clean (warnings are pre-existing; no new errors).

### Step 3: Final commit

```bash
git add apps/app/README.md
git commit -m "docs(app): add slice 8 smoke checklist (steps 30-34)"
```

---

## Report Format

(For the implementer to fill in after T12.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (~120 tests) | … |
  | 4 | "Run audit" online: existing behavior preserved | Deferred to user verification |
  | 5 | "Run audit" offline: enqueues + toasts; IDB entry visible | Deferred |
  | 6 | Reconnect: queue drains; per-entry toast | Deferred |
  | 7 | "Run audits on all sites" offline: N entries in queue | Deferred |
  | 8 | Sign-out clears the queue | Deferred |
- Total test count
- Commit SHA list
- Slice 8 release note (one line)
- Any carry-forwards for slice 9

---

## After slice 8

Slice 9 candidates:

- **PWA install prompt** — `beforeinstallprompt` capture + Install button.
- **Per-run IDB cache** — `run_snapshots` store + a `useRunDetailCache` hook mirroring slice 7's dashboard pattern.
- **Service Worker Background Sync (Chromium)** — drain the queue even without a tab open.
- **Idempotency keys end-to-end** — pass the queue UUID as a header; API rejects duplicate inserts. Closes the two-tab race window.
- **Delete `runAuditAction`** — Server Action is now caller-less.
- **Trend dedup + 30-day pruning** (slice 7 carry-forward).
- **Cross-user IDB GC on sign-in** (slice 7 carry-forward).
