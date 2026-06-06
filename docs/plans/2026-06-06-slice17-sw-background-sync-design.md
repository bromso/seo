# Slice 17 — SW Background Sync for Audit Queue (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/sw-background-sync-slice17`
**Carry-forward from:** Slice 8 (audit queue tab-only) + slice 16 (UX symmetry shipped)

---

## Goal

When the user is offline with pending queue entries and closes the tab, the browser still drains the queue once connectivity returns — via the Background Sync API. The current `useAuditQueueReplay` only fires while a tab is open. This closes the most-significant gap in the slice-8 audit queue story.

---

## Non-Goals

- No whoami round-trip — server-side RLS handles cross-owner correctness (entries from a different session's owner stay in the queue and retry on their owner's next sync).
- No periodic Background Sync (different API; fires on schedule even without explicit `sync` events).
- No push notification on drain completion (slice 18+).
- No periodic re-registration when the page becomes visible.
- No new DB migration, no new dependencies.
- No fallback for Safari/Firefox — they continue using the existing tab-open replay path.

---

## Architecture

Three coordinated changes:

1. **Extract `replayAuditQueueOnce(db, fetcher, ownerIdFilter?)`** into a pure async function consumed by both the existing React hook and the new SW handler. Same logic as the current `useAuditQueueReplay` inner loop but without the React/toast/window-listener glue.
2. **Add `registerBackgroundSync(tag)`** — a feature-detected helper that calls `navigator.serviceWorker.ready.sync.register(tag)`. Always async-safe; never throws; returns `boolean` indicating whether registration succeeded.
3. **Wire both into the existing flows.** `useQueueAudit` calls `registerBackgroundSync("audit-run-queue")` after a successful enqueue. The SW (`apps/app/src/app/sw.ts`) adds a `sync` event listener for tag `"audit-run-queue"` that calls `replayAuditQueueOnce(db, fetch)` with no owner filter.

The existing `useAuditQueueReplay` continues to drain queue entries when a tab is open — it just delegates to the extracted function. Idempotency keys (slice 11) prevent double-POST in the rare case both paths race.

---

## Browser support

Background Sync is **Chromium-only** (Chrome, Edge, Brave, Samsung Internet, ~70% of users globally). Safari and Firefox don't implement it.

- `registerBackgroundSync` feature-detects and silently no-ops on unsupported browsers.
- The existing tab-open replay path still works for all browsers.
- Local dev (HTTP `app.localhost:3001`) — Background Sync also requires HTTPS, so `registerBackgroundSync` returns `false`. Test via an HTTPS preview deploy or `chrome --unsafely-treat-insecure-origin-as-secure=http://app.localhost:3001`.

---

## `replayAuditQueueOnce` signature

```ts
// apps/app/src/lib/offline/replay-audit-queue.ts

export type ReplayResult = { successes: number; failures: number }

export async function replayAuditQueueOnce(
  db: IDBDatabase,
  fetcher: typeof fetch,
  ownerIdFilter?: string
): Promise<ReplayResult>
```

Semantics:
- Reads queue entries (all or filtered by `ownerIdFilter`).
- For each entry, POSTs to `/api/audit-run` with body `{ siteId, requestedUrl }` and headers `content-type: application/json` + `Idempotency-Key: <entry.id>`.
- On 2xx with `body.ok === true`: removes the entry from IDB, `successes++`.
- On 4xx/5xx or `body.ok === false`: leaves entry in queue, `failures++`.
- On network throw: catches it, leaves entry, `failures++`.
- Returns `{ successes, failures }`. Never throws.

The React hook will pass `ownerIdFilter = ownerId` (current session); the SW will pass nothing (no session context).

---

## `registerBackgroundSync` signature

```ts
// apps/app/src/lib/offline/background-sync.ts

export async function registerBackgroundSync(tag: string): Promise<boolean>
```

Implementation outline:

```ts
export async function registerBackgroundSync(tag: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false
  if (!("serviceWorker" in navigator)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    if (!("sync" in reg)) return false
    // SyncManager isn't in lib.dom.d.ts; cast through unknown for narrow access.
    const syncManager = (reg as unknown as {
      sync: { register: (t: string) => Promise<void> }
    }).sync
    await syncManager.register(tag)
    return true
  } catch {
    return false
  }
}
```

The cast through `unknown` to a narrow shape avoids a `// @ts-expect-error` and keeps the helper's surface intentionally minimal.

---

## SW handler in `sw.ts`

```ts
// Inside apps/app/src/app/sw.ts, after `serwist.addEventListeners()`.

import { openOfflineDB } from "@/lib/offline/db"
import { replayAuditQueueOnce } from "@/lib/offline/replay-audit-queue"

self.addEventListener("sync", (event) => {
  const e = event as Event & { tag?: string; waitUntil: (p: Promise<unknown>) => void }
  if (e.tag !== "audit-run-queue") return
  e.waitUntil(
    (async () => {
      const db = await openOfflineDB()
      const result = await replayAuditQueueOnce(db, fetch)
      if (result.failures > 0) {
        // Throwing inside waitUntil signals failure → browser retries the sync.
        throw new Error(`replay had ${result.failures} failure(s)`)
      }
    })()
  )
})
```

**Why throw on partial failure?** Per spec, an unhandled rejection inside `event.waitUntil()` marks the sync as failed and triggers the browser's exponential backoff. This means: if the user has 3 queued audits and 1 fails (e.g., a different owner's entry rejected by RLS), the browser will retry the sync. The successful 2 entries are already removed from the queue, so the retry only sees the failed 1. This is the standard pattern.

---

## Wiring `registerBackgroundSync` into `useQueueAudit`

Current shape (slice 8 + 11) — the hook returns a `queue` function the UI calls. After enqueue success, register the sync. Pseudo-diff:

```ts
// inside the hook's returned queue() function, after enqueueAuditRun succeeds:
await enqueueAuditRun(db, entry)
void registerBackgroundSync("audit-run-queue")
return { ok: true, queued: true }
```

The `void` is intentional — registration is fire-and-forget; we don't block the queue-confirmation toast on it.

---

## Wiring the extracted function into `useAuditQueueReplay`

The slice-8 hook becomes a thin wrapper:

```ts
useEffect(() => {
  const drain = async () => {
    const db = await openOfflineDB().catch(() => null)
    if (!db) return
    const result = await replayAuditQueueOnce(db, fetch, ownerId)
    if (result.successes > 0) {
      toast.success(`Started ${result.successes} queued audit${result.successes === 1 ? "" : "s"}`)
    }
    if (result.failures > 0) {
      toast.error(`${result.failures} queued audit${result.failures === 1 ? "" : "s"} failed to start.`)
    }
  }
  if (typeof navigator === "undefined" || navigator.onLine) {
    void drain()
  }
  const handler = () => { void drain() }
  window.addEventListener("online", handler)
  return () => window.removeEventListener("online", handler)
}, [ownerId])
```

Identical behavior to slice 11's hook, just delegated to the pure function.

---

## Testing strategy

Tests delta: **168 → 174 (+6 net new)**.

### `replay-audit-queue.test.ts` (+3)

Setup: `fake-indexeddb/auto`, seed the queue with `enqueueAuditRun`, stub `fetch` via `vi.fn()`.

1. **Happy path** — fetch returns `{ ok: true, runId: "x" }`. Assert: entry is removed from IDB; `successes === 1, failures === 0`.
2. **4xx path** — fetch returns `Response(JSON.stringify({ ok: false, error: "rejected" }), { status: 400 })`. Assert: entry remains; `successes === 0, failures === 1`.
3. **Network throw** — `fetch = vi.fn(() => Promise.reject(new Error("net")))`. Assert: entry remains; `successes === 0, failures === 1`; no throw escapes.

Each test passes an explicit `fetcher` so we don't need to stub `global.fetch`.

### `background-sync.test.ts` (+2)

Setup: happy-dom + manual `navigator` shim.

1. **Registration succeeds** — stub `navigator.serviceWorker.ready` to return a fake registration with a `sync.register` spy. Call `registerBackgroundSync("foo")`. Assert: spy called with `"foo"`, function returns `true`.
2. **Silently no-ops when sync is absent** — fake registration with no `sync` key. Assert: returns `false`, no throw.

### `use-queue-audit.test.ts` (+1)

Extend the existing hook test:
- Test that after `queue()` succeeds offline, `registerBackgroundSync` was called with `"audit-run-queue"`.
- Mock `registerBackgroundSync` via `vi.mock("@/lib/offline/background-sync", () => ({ registerBackgroundSync: vi.fn(...) }))`.

### Existing tests stay green

- `use-audit-queue-replay.test.ts` (slice 8 + 11 tests) — the hook still calls the same logic, just via the extracted function. No assertion changes needed if tests check end-to-end behavior (queue empties on success, etc.).
- `audit-queue.test.ts` — pure IDB helpers, unchanged.

### SW handler — manual smoke only

Testing actual Service Workers in vitest is impractical (jsdom/happy-dom don't simulate the SW global scope reliably). The pure `replayAuditQueueOnce` covers the logic; the SW shell is verified via the manual smoke test below.

### Final test count

168 baseline → **174** (+6 net new).

---

## Files

| Action | Path | Slice-17 responsibility |
|---|---|---|
| Create | `apps/app/src/lib/offline/replay-audit-queue.ts` | Pure replay function (extracted from `useAuditQueueReplay`) |
| Create | `apps/app/src/lib/offline/background-sync.ts` | `registerBackgroundSync(tag)` helper |
| Create | `apps/app/src/test/offline/replay-audit-queue.test.ts` | 3 unit tests |
| Create | `apps/app/src/test/offline/background-sync.test.ts` | 2 unit tests |
| Modify | `apps/app/src/lib/offline/use-audit-queue-replay.ts` | Delegate to `replayAuditQueueOnce` |
| Modify | `apps/app/src/lib/offline/use-queue-audit.ts` | Call `registerBackgroundSync("audit-run-queue")` after enqueue |
| Modify | `apps/app/src/test/offline/use-queue-audit.test.ts` | +1 assertion that registration was called |
| Modify | `apps/app/src/app/sw.ts` | Add `sync` event listener |

No DB migration. No `package.json` change. No SerWist config change (the SW file is already auto-included).

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | SW imports break Next.js build (Serwist compiles `sw.ts` separately, may not resolve `@/`) | medium | Confirm the `@/lib/offline/*` path-mapped imports resolve in the SW build by running `bun --filter @repo/app build` in T4. The Serwist plugin should respect tsconfig path aliases. If it doesn't, fall back to relative imports (`../lib/offline/...`) inside `sw.ts` only. |
| 2 | Tab-open replay + SW sync double-POST the same entry | low | Idempotency keys (slice 11) dedup at the DB layer. The server returns `{ ok: true, runId: existing }` and we remove the entry idempotently. |
| 3 | SW `sync` event typings missing from `lib.webworker.d.ts` | medium | Cast `event` through `Event & { tag?: string; waitUntil: ... }`. Narrow inside the handler. |
| 4 | Cross-owner queue entries pile up indefinitely | low | The "failed" sync triggers the browser's retry; eventually the original owner signs back in, useAuditQueueReplay drains their entries with the right session, and the queue clears. If retention becomes a problem, slice 18 can add a per-entry TTL. |
| 5 | `registerBackgroundSync` racing the SW registration on first page load | low | `navigator.serviceWorker.ready` resolves once the SW is active. Worst case: the first enqueue is just before SW becomes ready → the registration await hangs briefly → still works. |
| 6 | Local dev silently never registers (HTTP) | n/a | Documented. The pure replay function is testable in vitest; the SW shell is smoke-tested on a preview deploy. |

---

## Smoke test (manual, post-implementation)

1. Deploy to a preview env with HTTPS (or `chrome --unsafely-treat-insecure-origin-as-secure=http://app.localhost:3001 --user-data-dir=/tmp/chrome-test`).
2. Sign in. Open DevTools → Application → Service Workers; confirm `sw.ts` is registered and active.
3. DevTools → Network → throttle to **Offline**.
4. Click **Run audit** on a site card → toast "Queued offline".
5. DevTools → Application → IndexedDB → `seo-app-cache` → `audit_run_queue` → confirm the entry exists.
6. DevTools → Application → Background Sync → confirm `audit-run-queue` is listed.
7. Close the tab entirely (`Cmd+W`).
8. Throttle back to **Online** at the OS level (or use DevTools' "Online" toggle in any tab).
9. DevTools → Application → Background Sync → click the "Run" arrow to trigger the sync.
10. Reopen the app — the audit appears in the dashboard with the same idempotency key.

A simpler dev-friendly check: instead of closing the tab, leave it open and use the **chrome://serviceworker-internals** "force sync" button. This still exercises the SW handler path.

---

## Definition of Done

- [ ] `bun --filter @repo/app test` → 174 passing.
- [ ] `bun --filter @repo/app check-types` → clean.
- [ ] `bun --filter @repo/app build` → clean (the SW build must succeed).
- [ ] `bun --filter @repo/app lint` → clean (warnings may be pre-existing).
- [ ] `replayAuditQueueOnce` exists in `apps/app/src/lib/offline/replay-audit-queue.ts` with the documented signature.
- [ ] `useAuditQueueReplay` delegates to `replayAuditQueueOnce`.
- [ ] `registerBackgroundSync` exists in `apps/app/src/lib/offline/background-sync.ts`.
- [ ] `useQueueAudit` calls `registerBackgroundSync("audit-run-queue")` after successful enqueue.
- [ ] `sw.ts` has a `sync` event listener for tag `"audit-run-queue"` that calls `replayAuditQueueOnce(db, fetch)`.
- [ ] No DB migration, no new dependencies.

---

## Slice 18 candidates (carry-forward)

- **Whoami endpoint** for owner-scoped SW filtering.
- **Per-entry TTL** on the queue (drop stale cross-owner entries after N days).
- **Push notifications** on run completion.
- **SW offline fallback page** (the "retry from cache" architectural pattern).
- **Drop unused barrel re-exports.**
- **60s relative-time ticker** for OfflineBanner.
