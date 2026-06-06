# Slice 17 — SW Background Sync for Audit Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user is offline with pending audit-queue entries and closes the tab, Chromium's Background Sync API drains the queue once connectivity returns by firing a `sync` event in the Service Worker — even with no tab open.

**Architecture:** Three coordinated changes. (1) Extract a pure `replayAuditQueueOnce(db, fetcher, ownerIdFilter?)` from the existing `useAuditQueueReplay` so both the React hook and the SW handler can share the loop. (2) Add a feature-detected `registerBackgroundSync(tag)` helper that calls `navigator.serviceWorker.ready.sync.register()`; it returns `boolean` and never throws. (3) Wire `registerBackgroundSync("audit-run-queue")` into `useQueueAudit` after every successful enqueue, and add a `sync` event listener in `sw.ts` that calls `replayAuditQueueOnce(db, fetch)` with no owner filter — letting server-side validation reject cross-owner entries.

**Tech Stack:** React 19 hooks, native IndexedDB via `@/lib/offline/audit-queue`, Serwist (Service Worker bundler), Vitest + `@testing-library/react` (`renderHook`) + happy-dom + `fake-indexeddb/auto`. No new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice17-sw-background-sync-design.md`](2026-06-06-slice17-sw-background-sync-design.md)

---

## Conventions used throughout

- Working branch: `feat/sw-background-sync-slice17` (already created off `main`; spec committed at `1f20305`).
- Conventional commits: `refactor(app):` / `feat(app):` / `test(app):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- Slice 16 left **168 tests**. Slice 17 adds **6 net new** → final count **174**.
- Use `cd apps/app && bun run test` (vitest filter paths work from the package cwd).

---

## File map

| Action | File | Slice-17 responsibility |
|---|---|---|
| Create | `apps/app/src/lib/offline/replay-audit-queue.ts` | Pure replay function (extracted from `useAuditQueueReplay`) |
| Create | `apps/app/src/lib/offline/background-sync.ts` | Feature-detected registration helper |
| Create | `apps/app/src/test/offline/replay-audit-queue.test.ts` | 3 unit tests for the pure function |
| Create | `apps/app/src/test/offline/background-sync.test.ts` | 2 unit tests for the helper |
| Modify | `apps/app/src/lib/offline/use-audit-queue-replay.ts` | Delegate to `replayAuditQueueOnce` |
| Modify | `apps/app/src/lib/offline/use-queue-audit.ts` | Call `registerBackgroundSync("audit-run-queue")` after successful enqueue |
| Modify | `apps/app/src/test/offline/use-queue-audit.test.ts` | +1 test asserting the registration call |
| Modify | `apps/app/src/app/sw.ts` | Add `sync` event listener |

---

## Task 1: Extract `replayAuditQueueOnce` pure function

**Files:**
- Create: `apps/app/src/lib/offline/replay-audit-queue.ts`
- Create: `apps/app/src/test/offline/replay-audit-queue.test.ts`

### Step 1: Write the three failing tests

Create `apps/app/src/test/offline/replay-audit-queue.test.ts`:

```ts
// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  enqueueAuditRun,
  type QueuedAuditRun,
  readQueueForOwner,
} from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { replayAuditQueueOnce } from "@/lib/offline/replay-audit-queue"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"

function entry(id: string, ownerId: string = OWNER): QueuedAuditRun {
  return {
    id,
    ownerId,
    siteId: SITE,
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
})

afterEach(() => {
  _resetOfflineDBCache()
  vi.restoreAllMocks()
})

describe("replayAuditQueueOnce", () => {
  it("removes entries on 2xx success and counts them as successes", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))
    await enqueueAuditRun(db, entry("q2"))

    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
    ) as unknown as typeof fetch

    const result = await replayAuditQueueOnce(db, fetcher, OWNER)
    expect(result).toEqual({ successes: 2, failures: 0 })
    expect(await readQueueForOwner(db, OWNER)).toEqual([])
  })

  it("leaves entries on 4xx/5xx and counts them as failures", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))

    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: false, error: "rejected" }), { status: 400 })
    ) as unknown as typeof fetch

    const result = await replayAuditQueueOnce(db, fetcher, OWNER)
    expect(result).toEqual({ successes: 0, failures: 1 })
    const left = await readQueueForOwner(db, OWNER)
    expect(left).toHaveLength(1)
    expect(left[0]?.id).toBe("q1")
  })

  it("catches network throws, leaves entries, and counts them as failures", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))

    const fetcher = vi.fn(async () => {
      throw new TypeError("network down")
    }) as unknown as typeof fetch

    const result = await replayAuditQueueOnce(db, fetcher, OWNER)
    expect(result).toEqual({ successes: 0, failures: 1 })
    expect(await readQueueForOwner(db, OWNER)).toHaveLength(1)
  })
})
```

### Step 2: Run — expect 3 FAIL

```bash
cd apps/app && bun run test src/test/offline/replay-audit-queue.test.ts
```

Expected: 3 FAIL — module not found (`Failed to resolve "@/lib/offline/replay-audit-queue"`).

### Step 3: Create `apps/app/src/lib/offline/replay-audit-queue.ts`

```ts
import {
  type QueuedAuditRun,
  readQueueForOwner,
  removeFromQueue,
} from "@/lib/offline/audit-queue"
import { STORE_AUDIT_QUEUE } from "@/lib/offline/db"
import { awaitRequest, txStore } from "@/lib/offline/_idb"

export type ReplayResult = { successes: number; failures: number }

export async function replayAuditQueueOnce(
  db: IDBDatabase,
  fetcher: typeof fetch,
  ownerIdFilter?: string
): Promise<ReplayResult> {
  const entries = ownerIdFilter
    ? await readQueueForOwner(db, ownerIdFilter)
    : await readAllQueueEntries(db)

  let successes = 0
  let failures = 0

  for (const entry of entries) {
    try {
      const res = await fetcher("/api/audit-run", {
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
        await removeFromQueue(db, entry.id)
      } catch {
        // leave in queue
      }
      successes += 1
    } catch {
      failures += 1
    }
  }

  return { successes, failures }
}

async function readAllQueueEntries(db: IDBDatabase): Promise<QueuedAuditRun[]> {
  return await awaitRequest<QueuedAuditRun[]>(
    txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll()
  )
}
```

This is the same logic as the slice-8/11 inner loop of `useAuditQueueReplay`, refactored to accept an injected `fetcher` and an optional `ownerIdFilter`. The local `readAllQueueEntries` (no-filter variant) is used by the SW path.

### Step 4: Run — expect 3 PASS

```bash
cd apps/app && bun run test src/test/offline/replay-audit-queue.test.ts
```

Expected: 3 PASS.

### Step 5: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **171 passing** (168 + 3), typecheck clean. The existing `use-audit-queue-replay.test.ts` 4 tests still pass — the hook's own logic is untouched in T1.

### Step 6: Commit

```bash
git add apps/app/src/lib/offline/replay-audit-queue.ts apps/app/src/test/offline/replay-audit-queue.test.ts
git commit -m "feat(app): extract replayAuditQueueOnce pure function"
```

---

## Task 2: Delegate `useAuditQueueReplay` to the pure function

**Files:**
- Modify: `apps/app/src/lib/offline/use-audit-queue-replay.ts`

No new tests. The existing 4 tests in `use-audit-queue-replay.test.ts` verify end-to-end behavior (queue empties on success, idempotency-key header, toast aggregation) — they must continue to pass against the refactored hook.

### Step 1: Read the current hook

```bash
cat apps/app/src/lib/offline/use-audit-queue-replay.ts
```

Confirm slice-11 T4's version with inline loop + toast aggregation.

### Step 2: Replace `apps/app/src/lib/offline/use-audit-queue-replay.ts`

Full updated contents:

```ts
"use client"
import { useEffect } from "react"
import { toast } from "sonner"
import { openOfflineDB } from "@/lib/offline/db"
import { replayAuditQueueOnce } from "@/lib/offline/replay-audit-queue"

export function useAuditQueueReplay(ownerId: string): void {
  useEffect(() => {
    const drain = async () => {
      let db: IDBDatabase
      try {
        db = await openOfflineDB()
      } catch {
        return
      }
      const result = await replayAuditQueueOnce(db, fetch, ownerId)
      if (result.successes > 0) {
        toast.success(
          `Started ${result.successes} queued audit${result.successes === 1 ? "" : "s"}`
        )
      }
      if (result.failures > 0) {
        toast.error(
          `${result.failures} queued audit${result.failures === 1 ? "" : "s"} failed to start.`
        )
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

Three changes vs. the slice-11 version:
1. The inline `for (const entry of entries)` loop is removed.
2. Imports drop `readQueueForOwner` / `removeFromQueue` / `QueuedAuditRun` (no longer used here); import `replayAuditQueueOnce`.
3. The drain calls `replayAuditQueueOnce(db, fetch, ownerId)` and reads `result.successes` / `result.failures` for the toasts.

Behavior is identical: same mount-fire-when-online gate, same online-event listener, same toast aggregation.

### Step 3: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **171 passing** (unchanged), typecheck clean. All 4 existing `use-audit-queue-replay.test.ts` tests pass against the refactored hook.

### Step 4: Commit

```bash
git add apps/app/src/lib/offline/use-audit-queue-replay.ts
git commit -m "refactor(app): useAuditQueueReplay delegates to replayAuditQueueOnce"
```

---

## Task 3: `registerBackgroundSync` helper

**Files:**
- Create: `apps/app/src/lib/offline/background-sync.ts`
- Create: `apps/app/src/test/offline/background-sync.test.ts`

### Step 1: Write the two failing tests

Create `apps/app/src/test/offline/background-sync.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerBackgroundSync } from "@/lib/offline/background-sync"

type FakeReg = { sync?: { register: (tag: string) => Promise<void> } }

function installFakeServiceWorker(reg: FakeReg): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve(reg),
    },
  })
}

function uninstallFakeServiceWorker(): void {
  // happy-dom's navigator doesn't have serviceWorker by default — clean up by deleting.
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  })
}

beforeEach(() => {
  uninstallFakeServiceWorker()
})

afterEach(() => {
  uninstallFakeServiceWorker()
  vi.restoreAllMocks()
})

describe("registerBackgroundSync", () => {
  it("returns true and calls sync.register when the API is available", async () => {
    const register = vi.fn(async () => undefined)
    installFakeServiceWorker({ sync: { register } })

    const result = await registerBackgroundSync("audit-run-queue")
    expect(result).toBe(true)
    expect(register).toHaveBeenCalledWith("audit-run-queue")
  })

  it("returns false silently when sync is not available", async () => {
    installFakeServiceWorker({})

    const result = await registerBackgroundSync("audit-run-queue")
    expect(result).toBe(false)
  })
})
```

### Step 2: Run — expect 2 FAIL

```bash
cd apps/app && bun run test src/test/offline/background-sync.test.ts
```

Expected: 2 FAIL — module not found.

### Step 3: Create `apps/app/src/lib/offline/background-sync.ts`

```ts
export async function registerBackgroundSync(tag: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false
  if (!("serviceWorker" in navigator)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    if (!("sync" in reg)) return false
    const syncManager = (
      reg as unknown as {
        sync: { register: (t: string) => Promise<void> }
      }
    ).sync
    await syncManager.register(tag)
    return true
  } catch {
    return false
  }
}
```

The cast through `unknown` to a narrow shape avoids `// @ts-expect-error` and keeps the helper's surface intentionally minimal. `SyncManager` is not in `lib.dom.d.ts`.

### Step 4: Run — expect 2 PASS

```bash
cd apps/app && bun run test src/test/offline/background-sync.test.ts
```

Expected: 2 PASS.

### Step 5: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **173 passing** (171 + 2), typecheck clean.

### Step 6: Commit

```bash
git add apps/app/src/lib/offline/background-sync.ts apps/app/src/test/offline/background-sync.test.ts
git commit -m "feat(app): add registerBackgroundSync feature-detected helper"
```

---

## Task 4: Wire `registerBackgroundSync` into `useQueueAudit`

**Files:**
- Modify: `apps/app/src/lib/offline/use-queue-audit.ts`
- Modify: `apps/app/src/test/offline/use-queue-audit.test.ts`

### Step 1: Add the new failing test

Append this `it()` block at the end of the existing `describe("useQueueAudit", () => { ... })` in `apps/app/src/test/offline/use-queue-audit.test.ts`. Also add the import at the top of the file.

At the top of the file (after the existing imports):

```ts
import { registerBackgroundSync } from "@/lib/offline/background-sync"

vi.mock("@/lib/offline/background-sync", () => ({
  registerBackgroundSync: vi.fn(async () => true),
}))
```

Then at the end of the `describe` block:

```ts
  it("registers Background Sync after a successful enqueue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down")
      })
    )
    const registerSpy = registerBackgroundSync as ReturnType<typeof vi.fn>
    registerSpy.mockClear()

    const { result } = renderHook(() => useQueueAudit(OWNER))
    const r = await result.current({ siteId: SITE, requestedUrl: URL_X })
    expect(r.ok).toBe(true)

    expect(registerSpy).toHaveBeenCalledWith("audit-run-queue")
  })
```

The `vi.mock` hoists to the top of the file at compile time, so all tests in this file see the mocked `registerBackgroundSync`. The other 5 tests are unaffected — they don't enqueue (success path) or they enqueue (network-error / offline paths). For the enqueueing tests, the mocked `registerBackgroundSync` is called but its result is ignored (the hook uses `void registerBackgroundSync(...)`), so those tests' assertions still hold.

### Step 2: Run — expect 1 FAIL on the new test

```bash
cd apps/app && bun run test src/test/offline/use-queue-audit.test.ts
```

Expected: 5 PASS + 1 FAIL. The new test fails because `registerBackgroundSync` hasn't been wired into the hook yet.

### Step 3: Replace `apps/app/src/lib/offline/use-queue-audit.ts`

Full updated contents:

```ts
"use client"
import { useCallback } from "react"
import { enqueueAuditRun, type QueuedAuditRun } from "@/lib/offline/audit-queue"
import { registerBackgroundSync } from "@/lib/offline/background-sync"
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
          void registerBackgroundSync("audit-run-queue")
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

      const body = (await res.json()) as { ok: true; runId: string } | { ok: false; error: string }
      return body
    },
    [ownerId]
  )
}
```

Two changes vs. the slice-11 version:
1. Import `registerBackgroundSync`.
2. Inside the `enqueue()` helper, immediately after `enqueueAuditRun` succeeds, call `void registerBackgroundSync("audit-run-queue")`. The `void` is intentional — fire-and-forget; the queue-confirmation return doesn't wait on it.

### Step 4: Run — expect 6 PASS

```bash
cd apps/app && bun run test src/test/offline/use-queue-audit.test.ts
```

Expected: 6 PASS (5 existing + 1 new).

### Step 5: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **174 passing** (173 + 1), typecheck clean.

### Step 6: Commit

```bash
git add apps/app/src/lib/offline/use-queue-audit.ts apps/app/src/test/offline/use-queue-audit.test.ts
git commit -m "feat(app): register Background Sync after enqueueing audit runs"
```

---

## Task 5: SW `sync` event handler

**Files:**
- Modify: `apps/app/src/app/sw.ts`

No unit tests. The pure `replayAuditQueueOnce` is covered by T1's tests; the SW shell is verified via the manual smoke test in the spec. The build check here confirms that Serwist's compilation pipeline resolves the `@/lib/offline/*` path aliases — risk #1 from the spec.

### Step 1: Read the current SW

```bash
cat apps/app/src/app/sw.ts
```

Confirm the slice-7 version that ends with `serwist.addEventListeners()`.

### Step 2: Add imports and the `sync` listener

In `apps/app/src/app/sw.ts`:

Add these imports near the existing imports (after `serwist` imports):

```ts
import { openOfflineDB } from "@/lib/offline/db"
import { replayAuditQueueOnce } from "@/lib/offline/replay-audit-queue"
```

Then **after** the final `serwist.addEventListeners()` call, append:

```ts
self.addEventListener("sync", (event) => {
  const e = event as Event & { tag?: string; waitUntil: (p: Promise<unknown>) => void }
  if (e.tag !== "audit-run-queue") return
  e.waitUntil(
    (async () => {
      const db = await openOfflineDB()
      const result = await replayAuditQueueOnce(db, fetch)
      if (result.failures > 0) {
        throw new Error(`replay had ${result.failures} failure(s)`)
      }
    })()
  )
})
```

The cast `event as Event & { tag?: string; waitUntil }` narrows because the `SyncEvent` type isn't in `lib.webworker.d.ts` (older `@types` packages).

### Step 3: Run typecheck + build — both MUST succeed

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Expected: both exit 0. The build is the key check here — if Serwist can't resolve `@/lib/offline/db` from inside the SW context, the build will fail.

**If the build fails** with an unresolved-path error (something like `Could not resolve "@/lib/offline/replay-audit-queue"`), fall back to relative imports inside `sw.ts` only:

```ts
import { openOfflineDB } from "../lib/offline/db"
import { replayAuditQueueOnce } from "../lib/offline/replay-audit-queue"
```

Re-run the build. Document the fallback in the commit message.

### Step 4: Run the full test suite

```bash
bun --filter @repo/app test
```

Expected: **174 passing**, unchanged. The SW file isn't imported by any test, so its addition doesn't affect the count.

### Step 5: Commit

```bash
git add apps/app/src/app/sw.ts
git commit -m "feat(app): SW drains audit queue via Background Sync"
```

If the relative-import fallback was needed, use:

```bash
git commit -m "feat(app): SW drains audit queue via Background Sync (relative imports for SW build)"
```

---

## Task 6: Final DoD sweep

**Files:** none.

### Step 1: Confirm final state

```bash
bun --filter @repo/app test
# Expected: 174 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean (includes the SW build)

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)
```

### Step 2: Inspect call-site integrity

```bash
grep -rn "replayAuditQueueOnce\|registerBackgroundSync" apps/app/src
```

Expected hits:
- `apps/app/src/lib/offline/replay-audit-queue.ts` — definition.
- `apps/app/src/lib/offline/background-sync.ts` — definition.
- `apps/app/src/lib/offline/use-audit-queue-replay.ts` — calls `replayAuditQueueOnce(db, fetch, ownerId)`.
- `apps/app/src/lib/offline/use-queue-audit.ts` — calls `void registerBackgroundSync("audit-run-queue")`.
- `apps/app/src/app/sw.ts` — calls `replayAuditQueueOnce(db, fetch)`.
- The 4 new test files.

If a call site is missing, stop and investigate.

### Step 3: No commit

T6 is verify-only. The branch should now contain:
- `1f20305 docs(app): slice 17 design — SW Background Sync for audit queue` (pre-existing)
- 5 implementation commits from T1 / T2 / T3 / T4 / T5.

```bash
git log --oneline main..HEAD
```

---

## Report Format

(For the implementer to fill in after T6.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean (includes SW) | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (174 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `replayAuditQueueOnce` exists with signature `(db, fetcher, ownerIdFilter?)` | ✓ T1 |
  | 6 | `useAuditQueueReplay` delegates to pure function | ✓ T2 |
  | 7 | `registerBackgroundSync` exists; feature-detected | ✓ T3 |
  | 8 | `useQueueAudit` registers after enqueue | ✓ T4 |
  | 9 | `sw.ts` has `sync` handler for `"audit-run-queue"` | ✓ T5 |
- Total test count
- Commit SHA list (5 implementation commits expected)
- Whether the SW build needed the relative-import fallback
- Slice 17 release note (one line)
- Any carry-forwards for slice 18

---

## After slice 17

Slice 18 candidates:

- **Whoami endpoint** for owner-scoped SW filtering.
- **Per-entry TTL** on the queue (drop stale cross-owner entries after N days).
- **Push notifications** on run completion.
- **SW offline fallback page**.
- **Drop unused barrel re-exports.**
- **60s relative-time ticker** for OfflineBanner.
