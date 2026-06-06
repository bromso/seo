# Slice 22 — Server-Push on Run Completion (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/push-deliver-slice22`
**Carry-forward from:** Slice 21 (subscribe flow shipped, but no notifications get sent yet).

---

## Goal

When the runner finishes a run with `status = "completed"`, send a web push notification to every device the owner has subscribed (slice 21). Click on the notification opens `/dashboard/runs/<runId>`. Stale subscriptions (HTTP 410/404 from the push service) get auto-deleted from the DB.

Slice 22 completes the user-facing push notifications feature that slice 21 laid the foundation for.

---

## Non-Goals (slice 23+)

- Notify on `partial` / `failed` (status-specific copy).
- Per-event preferences (subscribe to specific events, not all).
- Push retry queue for transient failures.
- Periodic stale-subscription sweep (deferred — relies entirely on 410 firing).
- Whoami endpoint, `/offline` polish, 60s ticker.

---

## Architecture

Three coordinated changes:

1. **Runner-side helper**: a new `apps/runner/src/push.ts` wraps the `web-push` Node lib with VAPID config from env vars and exposes `sendPushForRun(opts)`. Queries `push_subscriptions` via service-role DB access. Handles 410/404 by deleting the dead subscription; logs everything else as `failed`.

2. **Daemon integration**: `apps/runner/src/daemon.ts` reads VAPID on startup (warns once if missing), then calls `sendPushForRun` inside the polling loop after `processRun` returns with `status === "completed"`. Ack happens regardless of push outcome — a failed push must not cause the run to re-process.

3. **Service Worker**: `apps/app/src/app/sw.ts` adds two new listeners — `push` (renders the notification via `self.registration.showNotification`) and `notificationclick` (focuses an existing tab or opens a new one to the encoded URL).

---

## Setup & env vars

User already generated VAPID keys in slice 21. Three env vars now used by slice 22:

```dotenv
# apps/runner/.env  (NEW for slice 22 — runner-side only)
VAPID_PUBLIC_KEY=<same base64url public key>
VAPID_PRIVATE_KEY=<base64url private key>
VAPID_EMAIL=mailto:you@example.com
```

The runner reads these on startup via `readVapidFromEnv()`. **If any are missing, push delivery is silently skipped** with a single `kind: "warn"` log at daemon startup. The runner keeps processing audits — just no pushes.

---

## Runner-side `push.ts` helper

New file: `apps/runner/src/push.ts`

```ts
import webpush, { type PushSubscription as WebPushSub } from "web-push"
import type { Logger } from "@repo/runner-core"

export type VapidConfig = {
  publicKey: string
  privateKey: string
  subject: string  // "mailto:..."
}

export type PushPayload = {
  title: string
  body: string
  data?: { url?: string }
}

export type PushDbApi = {
  listSubscriptionsForOwner: (
    ownerId: string
  ) => Promise<Array<{ endpoint: string; p256dh: string; auth: string }>>
  deleteSubscriptionByEndpoint: (endpoint: string) => Promise<void>
}

export function readVapidFromEnv(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_EMAIL
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

export async function sendPushForRun(opts: {
  vapid: VapidConfig
  db: PushDbApi
  ownerId: string
  runId: string
  requestedUrl: string
  logger?: Logger
}): Promise<{ sent: number; deleted: number; failed: number }> {
  const { vapid, db, ownerId, runId, requestedUrl, logger } = opts
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

  const subs = await db.listSubscriptionsForOwner(ownerId)
  if (subs.length === 0) return { sent: 0, deleted: 0, failed: 0 }

  const payload: PushPayload = {
    title: "Audit completed",
    body: `Your audit for ${requestedUrl} is ready`,
    data: { url: `/dashboard/runs/${runId}` },
  }
  const body = JSON.stringify(payload)

  let sent = 0
  let deleted = 0
  let failed = 0

  for (const s of subs) {
    const sub: WebPushSub = {
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    }
    try {
      await webpush.sendNotification(sub, body)
      sent += 1
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 410 || status === 404) {
        try {
          await db.deleteSubscriptionByEndpoint(s.endpoint)
          deleted += 1
        } catch (delErr) {
          logger?.({
            kind: "warn",
            message: `failed to delete stale sub: ${(delErr as Error).message}`,
          })
        }
      } else {
        failed += 1
        logger?.({
          kind: "warn",
          message: `push send failed (status=${status}): ${(err as Error).message}`,
        })
      }
    }
  }

  return { sent, deleted, failed }
}
```

Three design choices:
- **Dependency injection** (`db` + `vapid`) keeps the helper testable without real Supabase or real `web-push` (tests mock `webpush.sendNotification`).
- **410/404 → delete**, all other errors → log + count as failed. No retry queue (carry-forward).
- **Empty subscription list** is the happy path — early-return zero counts.

---

## Daemon integration

Modify `apps/runner/src/daemon.ts`. Three changes:

**(a) Type additions**

```ts
import { sendPushForRun, type PushDbApi, readVapidFromEnv, type VapidConfig } from "./push"

export type DaemonOptions = {
  // …existing fields…
  pushDbApi?: PushDbApi      // injected for tests; default queries push_subscriptions
  vapid?: VapidConfig         // injected for tests; default reads from env
}
```

**(b) Startup (after `createDbClient`, before the polling loop)**

```ts
const vapid = opts.vapid ?? readVapidFromEnv()
if (!vapid) {
  logger({ kind: "warn", message: "VAPID env vars missing; push notifications disabled" })
}

const pushDbApi: PushDbApi = opts.pushDbApi ?? {
  async listSubscriptionsForOwner(ownerId) {
    const rows = await db
      .select({
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.ownerId, ownerId))
    return rows
  },
  async deleteSubscriptionByEndpoint(endpoint) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  },
}
```

Drizzle imports: `import { pushSubscriptions } from "@repo/db"` (re-export confirmed via `packages/db/src/schema/index.ts` slice 21) + `import { eq } from "drizzle-orm"`.

**(c) Hook point (after `processRun` returns successfully, before `queue.ack(msg.msgId)`)**

```ts
const result = await processRun(msg.body.runId, { /* …existing… */ })
logger({ kind: "progress", message: `run ${msg.body.runId} -> ${result.status}` })

if (result.status === "completed" && vapid) {
  try {
    const { sent, deleted, failed } = await sendPushForRun({
      vapid,
      db: pushDbApi,
      ownerId: msg.body.ownerId,
      runId: msg.body.runId,
      requestedUrl: msg.body.requestedUrl,
      logger,
    })
    logger({
      kind: "progress",
      message: `push: sent=${sent} deleted=${deleted} failed=${failed}`,
    })
  } catch (err) {
    logger({ kind: "warn", message: `push delivery threw: ${(err as Error).message}` })
  }
}

await queue.ack(msg.msgId)
```

Three notes:
- **Ack happens regardless of push result.** A failed push must NOT cause the run to be re-processed.
- **Synchronous in the polling loop**: typical sub count is 1-3 per owner; total < 1s. If scale demands it, slice 23+ can move push to a background task.
- **Gate: `result.status === "completed"`**. Per design, only successful runs notify; `partial` / `failed` stay silent.

---

## Service Worker push + click handlers

Modify `apps/app/src/app/sw.ts`. Append two new listeners AFTER the existing slice-17 `sync` listener (no other changes):

```ts
self.addEventListener("push", (event) => {
  const e = event as PushEvent
  if (!e.data) return
  const payload = (() => {
    try {
      return e.data.json() as { title?: string; body?: string; data?: { url?: string } }
    } catch {
      return { title: "Audit completed", body: "" }
    }
  })()
  e.waitUntil(
    self.registration.showNotification(payload.title ?? "Audit completed", {
      body: payload.body ?? "",
      data: payload.data ?? {},
      icon: "/icon-192.png",
      badge: "/icon-96.png",
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  const e = event as NotificationEvent & { waitUntil: (p: Promise<unknown>) => void }
  e.notification.close()
  const data = e.notification.data as { url?: string } | undefined
  const targetUrl = data?.url ?? "/dashboard"
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.endsWith(targetUrl) && "focus" in c) {
          return (c as WindowClient).focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
```

Three design points:
- **Defensive JSON parse**: malformed payloads fall back to a neutral notification rather than crashing the SW. (Runner always sends well-formed JSON, but defensive parsing matches the spec's "third-party push services occasionally test with empty bodies".)
- **`icon` / `badge`** reference PWA manifest icons. If they don't exist at the documented paths, browsers fall back to a default. T6's build step verifies this; if absent, drop those keys.
- **Focus-or-open**: standard PWA pattern — focus existing dashboard tab if open, otherwise open a new tab to the specific run page.

---

## Testing strategy

Tests delta: **188 → 193 (+5 net new)**. Push lives in `apps/runner`; tests go in `apps/runner/tests/`.

### `push.test.ts` (new, +4)

```ts
- sendPushForRun returns zero counts when subscription list is empty
- sendPushForRun sends one push per subscription and returns sent count
- sendPushForRun on 410: deletes subscription, counts deleted
- sendPushForRun on 500: keeps subscription, counts failed
```

Mocking: `vi.mock("web-push", ...)` overrides `sendNotification` to return success or throw `{ statusCode: 410 | 500 }`. The DB injection is a plain object with vitest spies for `listSubscriptionsForOwner` + `deleteSubscriptionByEndpoint`.

### `daemon.test.ts` (existing or new) (+1)

```ts
- on processRun returning { status: "completed" }, daemon calls sendPushForRun
```

The daemon test injects `pushDbApi` + `vapid` via `DaemonOptions`, mocks `processRun` (and the queue), and asserts `sendPushForRun` (or the underlying spies) was called once with the expected args after a successful run.

**Negative status guards** (partial/failed don't fire push): YAGNI — covered by the positive gate `result.status === "completed" && vapid`. If desired later, add as a third daemon test.

### SW push handler tests

**NONE** — same posture as slice 17's SW sync handler. Service Worker code can't be reliably unit-tested in vitest; verified via build + manual smoke.

### Final test count

App: **188 unchanged**. Runner: existing + **5 new**.

---

## Files

| Action | Path | Why |
|---|---|---|
| Create | `apps/runner/src/push.ts` | Helper: `readVapidFromEnv`, `sendPushForRun`, types |
| Create | `apps/runner/tests/push.test.ts` | 4 helper tests |
| Modify | `apps/runner/src/daemon.ts` | Wire push call after `processRun` success |
| Create or Modify | `apps/runner/tests/daemon.test.ts` | +1 integration test (create if no daemon test file exists) |
| Modify | `apps/runner/package.json` | Add `web-push` + `@types/web-push` |
| Modify | `apps/app/src/app/sw.ts` | Add `push` + `notificationclick` listeners |

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | `web-push` doesn't ship reliable ESM | low | Pin `^3.6.7`. Runner uses `tsx` / `tsdown` which handle CJS interop. |
| 2 | Drizzle `pushSubscriptions` re-export not reachable from runner | low | Slice 21 added `export * from "./push-subscriptions"` to `packages/db/src/schema/index.ts`. T2 verifies the import path actually resolves; adjust to `@repo/db/schema` or full path if needed. |
| 3 | Notification icons don't exist at documented paths | medium | If T6 build doesn't reveal an icon, drop the keys; browser falls back to default. |
| 4 | Synchronous push slows queue throughput | low | Sub count is small. Carry-forward to slice 23+ if scale matters. |
| 5 | `apps/runner` vitest config missing | low | Verify in T1 (read `apps/runner/package.json` for the `test` script). If absent, slice 22 grows by ~1 file. |

---

## Smoke test (manual, post-implementation)

Requires VAPID env vars in `apps/runner/.env` and an active subscription from slice 21.

1. Ensure `.env` has `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` (slice 21 generated these).
2. `bun --filter @repo/runner build && bun --filter @repo/runner start` (or whatever the daemon's run script is).
3. In the browser, sign in, click "Enable notifications" (slice 21), grant.
4. Trigger an audit on the dashboard.
5. Wait for runner to process it (poll interval is 1s).
6. **A web push notification appears** with title "Audit completed" and body "Your audit for <url> is ready".
7. Click the notification → dashboard opens or focuses on `/dashboard/runs/<id>`.
8. Trigger a second audit while the first tab is closed — confirm a fresh tab opens to the run page on click.
9. (Optional) Test the 410 path by manually deleting the SW registration via DevTools, then triggering an audit — runner should log `deleted=1` and the DB row should disappear.

---

## Definition of Done

- [ ] `bun --filter @repo/app test` → 188 passing (unchanged)
- [ ] `bun --filter @repo/runner test` → existing + 5 new (record baseline + final at execution time)
- [ ] `bun --filter @repo/app check-types` + `bun --filter @repo/runner check-types` → clean
- [ ] `bun --filter @repo/app build` → clean (SW build picks up new handlers)
- [ ] `bun --filter @repo/runner build` → clean (includes `web-push` import)
- [ ] `bun --filter @repo/app lint` + `bun --filter @repo/runner lint` → clean (warnings may be pre-existing)
- [ ] Smoke test (manual): trigger → wait → notification appears → click → opens `/dashboard/runs/<id>`

---

## Slice 23 candidates (carry-forward)

- Notify on `partial` / `failed` with status-specific copy
- Per-event preferences (settings page)
- Push retry queue for transient failures
- Periodic stale-subscription sweep
- Whoami endpoint
- Polish `/offline` page
- 60s relative-time ticker for OfflineBanner
- Move push delivery to a background worker if queue throughput becomes a concern
