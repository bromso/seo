# Slice 22 — Server-Push on Run Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the runner finishes a run with `status = "completed"`, send a web push notification to every device the owner has subscribed (slice 21). The SW renders the notification and on click opens `/dashboard/runs/<runId>`. Stale subscriptions (410/404) auto-delete.

**Architecture:** New `apps/runner/src/push.ts` wraps the `web-push` Node lib + queries `push_subscriptions` via service-role DB. Daemon reads VAPID config on startup and calls a thin wrapper `maybeSendPushForCompletedRun` after `processRun` returns success (encapsulates the status gate so it's unit-testable). SW gets two new listeners (`push` + `notificationclick`) appended after the existing slice-17 `sync` listener.

**Tech Stack:** `web-push@^3.6.7` (new dep in apps/runner), Drizzle ORM via `@repo/db`, Vitest@^4.0.15 + node environment. No other new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice22-push-deliver-design.md`](2026-06-06-slice22-push-deliver-design.md)

---

## Conventions used throughout

- Working branch: `feat/push-deliver-slice22` (already created off `main`; spec committed at `d37b575`).
- Conventional commits: `feat(runner):` / `feat(app):` / `chore(runner):` / `test(runner):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- Slice 21 left **188 app tests**. `apps/runner` currently has **no test infrastructure**. Slice 22 adds the test infra + **5 net new runner tests**. App test count stays at 188.
- Test directory pattern (matching `packages/db/test/` and `packages/runner-core/test/`): tests live in `apps/runner/test/`, NOT `apps/runner/tests/`. The spec's "tests/" reference is corrected here.
- vitest config template (copied verbatim from `packages/runner-core/vitest.config.ts`):

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

---

## File map

| Action | Path | Slice-22 responsibility |
|---|---|---|
| Modify | `apps/runner/package.json` | Add `web-push`, `@types/web-push`, `vitest`; add `test` script |
| Create | `apps/runner/vitest.config.ts` | Standard vitest config (template above) |
| Create | `apps/runner/src/push.ts` | `readVapidFromEnv`, `sendPushForRun`, `maybeSendPushForCompletedRun`, types |
| Create | `apps/runner/test/push.test.ts` | 5 unit tests |
| Modify | `apps/runner/src/daemon.ts` | Wire push call after `processRun` success; read VAPID at startup |
| Modify | `apps/app/src/app/sw.ts` | Add `push` + `notificationclick` listeners |

No DB migration — slice 21's `push_subscriptions` table is reused.

---

## Task 1: Runner test infrastructure + new dependencies

**Files:**
- Modify: `apps/runner/package.json`
- Create: `apps/runner/vitest.config.ts`

No new tests yet — this task just establishes the scaffolding so T2 can add tests.

### Step 1: Read the current package.json

```bash
cat apps/runner/package.json
```

Confirm the file has scripts `build`, `check-types`, `lint`, `dev`, `start`, `enqueue` — but no `test` script. Dependencies don't include `web-push` or `vitest`.

### Step 2: Add the new dependencies and `test` script

Edit `apps/runner/package.json`. Add `"test": "vitest run --config vitest.config.ts"` to `scripts` after the existing `lint` script. Add `"web-push": "^3.6.7"` to `dependencies`. Add `"@types/web-push": "^3.6.4"` and `"vitest": "^4.0.15"` to `devDependencies`.

Resulting file (showing only the changed sections — keep all other fields as-is):

```json
{
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src",
    "test": "vitest run --config vitest.config.ts",
    "dev": "tsx watch src/index.ts start",
    "start": "node dist/index.js start",
    "enqueue": "tsx src/index.ts enqueue",
    "docker:build": "docker build -t seo-runner -f Dockerfile ../.."
  },
  "dependencies": {
    "@repo/audit-cli": "workspace:*",
    "@repo/audit-core": "workspace:*",
    "@repo/db": "workspace:*",
    "@repo/runner-core": "workspace:*",
    "commander": "catalog:",
    "drizzle-orm": "catalog:",
    "postgres": "catalog:",
    "web-push": "^3.6.7",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^25.0.2",
    "@types/web-push": "^3.6.4",
    "tsdown": "catalog:",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^4.0.15"
  }
}
```

### Step 3: Create `apps/runner/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

### Step 4: Install dependencies

```bash
bun install
```

Expected: clean install. `bun.lock` updates with new entries for `web-push`, `@types/web-push`, `vitest`.

### Step 5: Verify the runner still builds and typechecks

```bash
bun --filter @repo/runner check-types
bun --filter @repo/runner build
```

Expected: both clean. The `web-push` dep is imported nowhere yet, so it doesn't affect typecheck. The vitest dep is dev-only.

### Step 6: Run the (empty) test command

```bash
bun --filter @repo/runner test
```

Expected: vitest runs and reports "0 test files found" — clean exit. The `test/` directory doesn't exist yet, which is fine — vitest reports zero tests and exits 0 (or possibly 1 with "no tests found" — both acceptable for an empty harness). If it exits non-zero with "no tests found", that's OK; we'll add the first test in T2.

### Step 7: Commit

```bash
git add apps/runner/package.json apps/runner/vitest.config.ts bun.lock
git commit -m "chore(runner): add vitest + web-push (slice 22 scaffolding)"
```

---

## Task 2: `push.ts` helper + 5 unit tests

**Files:**
- Create: `apps/runner/src/push.ts`
- Create: `apps/runner/test/push.test.ts`

### Step 1: Write the five failing tests

Create `apps/runner/test/push.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}))

import webpush from "web-push"
import {
  maybeSendPushForCompletedRun,
  sendPushForRun,
  type PushDbApi,
  type VapidConfig,
} from "../src/push"

const VAPID: VapidConfig = {
  publicKey: "publicKeyBase64",
  privateKey: "privateKeyBase64",
  subject: "mailto:test@example.com",
}

const sendNotificationMock = webpush.sendNotification as ReturnType<typeof vi.fn>

function makeDb(overrides: Partial<PushDbApi> = {}): {
  listSpy: ReturnType<typeof vi.fn>
  deleteSpy: ReturnType<typeof vi.fn>
  api: PushDbApi
} {
  const listSpy = vi.fn(async () => [])
  const deleteSpy = vi.fn(async () => {})
  const api: PushDbApi = {
    listSubscriptionsForOwner: overrides.listSubscriptionsForOwner ?? listSpy,
    deleteSubscriptionByEndpoint: overrides.deleteSubscriptionByEndpoint ?? deleteSpy,
  }
  return { listSpy, deleteSpy, api }
}

describe("sendPushForRun", () => {
  it("returns zero counts when subscription list is empty", async () => {
    sendNotificationMock.mockReset()
    const { api } = makeDb()
    const result = await sendPushForRun({
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ sent: 0, deleted: 0, failed: 0 })
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it("sends one push per subscription and returns sent count", async () => {
    sendNotificationMock.mockReset()
    sendNotificationMock.mockResolvedValue(undefined)
    const { api } = makeDb({
      listSubscriptionsForOwner: vi.fn(async () => [
        { endpoint: "https://push.example.com/a", p256dh: "p1", auth: "a1" },
        { endpoint: "https://push.example.com/b", p256dh: "p2", auth: "a2" },
      ]),
    })
    const result = await sendPushForRun({
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ sent: 2, deleted: 0, failed: 0 })
    expect(sendNotificationMock).toHaveBeenCalledTimes(2)
  })

  it("on 410: deletes the subscription and counts deleted", async () => {
    sendNotificationMock.mockReset()
    sendNotificationMock.mockRejectedValue(
      Object.assign(new Error("gone"), { statusCode: 410 })
    )
    const { deleteSpy, api } = makeDb({
      listSubscriptionsForOwner: vi.fn(async () => [
        { endpoint: "https://push.example.com/stale", p256dh: "p", auth: "a" },
      ]),
    })
    const result = await sendPushForRun({
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ sent: 0, deleted: 1, failed: 0 })
    expect(deleteSpy).toHaveBeenCalledWith("https://push.example.com/stale")
  })

  it("on 500: keeps the subscription and counts failed", async () => {
    sendNotificationMock.mockReset()
    sendNotificationMock.mockRejectedValue(
      Object.assign(new Error("boom"), { statusCode: 500 })
    )
    const { deleteSpy, api } = makeDb({
      listSubscriptionsForOwner: vi.fn(async () => [
        { endpoint: "https://push.example.com/transient", p256dh: "p", auth: "a" },
      ]),
    })
    const result = await sendPushForRun({
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ sent: 0, deleted: 0, failed: 1 })
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})

describe("maybeSendPushForCompletedRun", () => {
  it("skips push delivery when run status is not 'completed'", async () => {
    sendNotificationMock.mockReset()
    const { listSpy, api } = makeDb()
    const result = await maybeSendPushForCompletedRun({
      runStatus: "partial",
      vapid: VAPID,
      db: api,
      ownerId: "owner-1",
      runId: "run-1",
      requestedUrl: "https://example.com",
    })
    expect(result).toBeNull()
    expect(listSpy).not.toHaveBeenCalled()
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })
})
```

The `vi.mock("web-push", ...)` returns a default export with the two methods the helper uses. We assert the spies on the mocked default.

### Step 2: Run — expect 5 FAIL

```bash
bun --filter @repo/runner test
```

Expected: 5 FAIL — `Cannot find module '../src/push'` from the test importer.

### Step 3: Create `apps/runner/src/push.ts`

```ts
import type { Logger } from "@repo/runner-core"
import webpush, { type PushSubscription as WebPushSub } from "web-push"

export type VapidConfig = {
  publicKey: string
  privateKey: string
  subject: string
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

/** Thin wrapper that encapsulates the "should we even send" decision.
 *  Returns null when the run wasn't successful or vapid isn't configured. */
export async function maybeSendPushForCompletedRun(opts: {
  runStatus: string
  vapid: VapidConfig | null
  db: PushDbApi
  ownerId: string
  runId: string
  requestedUrl: string
  logger?: Logger
}): Promise<{ sent: number; deleted: number; failed: number } | null> {
  if (opts.runStatus !== "completed") return null
  if (!opts.vapid) return null
  return sendPushForRun({
    vapid: opts.vapid,
    db: opts.db,
    ownerId: opts.ownerId,
    runId: opts.runId,
    requestedUrl: opts.requestedUrl,
    logger: opts.logger,
  })
}
```

Three design decisions reified here:
- **`maybeSendPushForCompletedRun`** wraps the decision gate so the daemon's hook point is one line, and the gate logic is unit-testable.
- **Dependency injection** via the `db` + `vapid` opts keeps tests free of real Supabase + real `web-push`.
- **410/404 → delete; everything else → log + count failed.**

### Step 4: Run — expect 5 PASS

```bash
bun --filter @repo/runner test
```

Expected: 5 PASS.

### Step 5: Run typecheck + build

```bash
bun --filter @repo/runner check-types
bun --filter @repo/runner build
```

Expected: both clean. The `web-push` dep resolves; the build emits `dist/push.js`.

### Step 6: Commit

```bash
git add apps/runner/src/push.ts apps/runner/test/push.test.ts
git commit -m "feat(runner): add push.ts helper (sendPushForRun + maybeSendPushForCompletedRun)"
```

---

## Task 3: Daemon integration

**Files:**
- Modify: `apps/runner/src/daemon.ts`

No new tests in this task. The decision-gate logic is tested in T2's `maybeSendPushForCompletedRun` tests. The daemon-side wiring is structurally trivial — verified by build + manual smoke.

### Step 1: Read the current daemon

```bash
cat apps/runner/src/daemon.ts
```

Confirm the slice-3-era structure: `runDaemon(opts)` creates `db` + `queue`, loops polling, calls `processRun`, ack/no-ack. We're adding two new things: (a) read VAPID + build pushDbApi at startup, (b) call `maybeSendPushForCompletedRun` after `processRun` returns and before `queue.ack`.

### Step 2: Edit `apps/runner/src/daemon.ts`

Make four changes. Full updated file:

```ts
import { aggregate, defaultPackages } from "@repo/audit-cli/lib"
import {
  createDbClient,
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  markAuditRunRunning,
  pushSubscriptions,
} from "@repo/db"
import { consoleLogger, createQueueClient, type Logger, processRun, sleep } from "@repo/runner-core"
import { eq } from "drizzle-orm"
import {
  maybeSendPushForCompletedRun,
  type PushDbApi,
  readVapidFromEnv,
  type VapidConfig,
} from "./push"

export type DaemonOptions = {
  connectionString: string
  pollIntervalMs?: number
  visibilityTimeoutSec?: number
  shutdownGraceMs?: number
  logger?: Logger
  // Slice 22: injected for tests; default reads env + queries push_subscriptions.
  vapid?: VapidConfig | null
  pushDbApi?: PushDbApi
}

export async function runDaemon(opts: DaemonOptions): Promise<void> {
  const logger = opts.logger ?? consoleLogger
  const pollIntervalMs = opts.pollIntervalMs ?? 1000
  const visibilityTimeoutSec = opts.visibilityTimeoutSec ?? 600
  const shutdownGraceMs = opts.shutdownGraceMs ?? 30_000

  const db = createDbClient({
    connectionString: opts.connectionString,
    role: "service_role",
    ssl: false,
  })
  const queue = createQueueClient(db)

  const vapid: VapidConfig | null =
    opts.vapid !== undefined ? opts.vapid : readVapidFromEnv()
  if (!vapid) {
    logger({ kind: "warn", message: "VAPID env vars missing; push notifications disabled" })
  }

  const pushDbApi: PushDbApi =
    opts.pushDbApi ?? {
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

  let shutdownRequested = false
  let currentAbort: AbortController | undefined

  const onSignal = (sig: string) => {
    if (!shutdownRequested) {
      logger({ kind: "progress", message: `received ${sig}, shutting down` })
      shutdownRequested = true
      currentAbort?.abort()
    }
  }
  process.on("SIGTERM", () => onSignal("SIGTERM"))
  process.on("SIGINT", () => onSignal("SIGINT"))

  logger({ kind: "progress", message: "daemon starting; polling pgmq" })

  while (!shutdownRequested) {
    let msg: Awaited<ReturnType<typeof queue.read>>
    try {
      msg = await queue.read(visibilityTimeoutSec)
    } catch (err) {
      logger({
        kind: "warn",
        message: `queue.read failed: ${(err as Error).message}`,
      })
      await sleep(pollIntervalMs)
      continue
    }
    if (!msg) {
      await sleep(pollIntervalMs)
      continue
    }

    logger({
      kind: "progress",
      message: `claimed msg ${msg.msgId} (read_ct=${msg.readCt}) run=${msg.body.runId}`,
    })

    if (msg.readCt > 3) {
      logger({
        kind: "warn",
        message: `msg ${msg.msgId} exceeded retry limit; archiving`,
      })
      const cats = ["performance", "seo", "best-practices", "pwa", "on-page"] as const
      const { requestedUrl: msgRequestedUrl } = msg.body
      const synthFailed = cats.map((c) => ({
        category: c,
        url: msgRequestedUrl,
        requestedUrl: msgRequestedUrl,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        packageName: `@repo/audit-${c}`,
        packageVersion: "0.0.0",
        status: "failed" as const,
        error: {
          code: "UNKNOWN" as const,
          message: "exceeded retry limit (3)",
          retryable: false,
        },
      }))
      for (const s of synthFailed) {
        try {
          await insertAuditResult(db, s, msg.body.runId, msg.body.ownerId)
        } catch (err) {
          logger({
            kind: "warn",
            message: `failed to insert synthetic failure: ${(err as Error).message}`,
          })
        }
      }
      await queue.archive(msg.msgId)
      continue
    }

    currentAbort = new AbortController()
    try {
      const result = await processRun(msg.body.runId, {
        dbApi: {
          getAuditRun: (id) => getAuditRun(db, id),
          markAuditRunRunning: (id) => markAuditRunRunning(db, id),
          getCompletedCategoriesForRun: (id) => getCompletedCategoriesForRun(db, id),
          insertAuditResult: (r, runId, ownerId) => insertAuditResult(db, r, runId, ownerId),
        },
        aggregate,
        packages: defaultPackages,
        logger,
        signal: currentAbort.signal,
      })
      logger({
        kind: "progress",
        message: `run ${msg.body.runId} -> ${result.status}`,
      })

      try {
        const pushResult = await maybeSendPushForCompletedRun({
          runStatus: result.status,
          vapid,
          db: pushDbApi,
          ownerId: msg.body.ownerId,
          runId: msg.body.runId,
          requestedUrl: msg.body.requestedUrl,
          logger,
        })
        if (pushResult) {
          logger({
            kind: "progress",
            message: `push: sent=${pushResult.sent} deleted=${pushResult.deleted} failed=${pushResult.failed}`,
          })
        }
      } catch (err) {
        logger({ kind: "warn", message: `push delivery threw: ${(err as Error).message}` })
      }

      await queue.ack(msg.msgId)
    } catch (err) {
      logger({
        kind: "warn",
        message: `processRun threw, leaving message for retry: ${(err as Error).message}`,
      })
      // No ack — pgmq returns the message after visibility timeout
    } finally {
      currentAbort = undefined
    }
  }

  void shutdownGraceMs // kept for future multi-worker shutdown coordination

  logger({ kind: "progress", message: "daemon exited cleanly" })
}
```

Four changes vs. the existing daemon:
1. New imports: `pushSubscriptions` from `@repo/db`, `eq` from `drizzle-orm`, the slice-22 helpers from `./push`.
2. `DaemonOptions` widens with optional `vapid?: VapidConfig | null` and `pushDbApi?: PushDbApi` for test injection.
3. New startup block: read VAPID (warn once if missing), build default `pushDbApi`.
4. After `processRun` returns and before `queue.ack(msg.msgId)`, call `maybeSendPushForCompletedRun` inside a try/catch that logs but doesn't disrupt the ack.

### Step 3: Verify the Drizzle import path

```bash
grep -n "pushSubscriptions" packages/db/dist/index.d.ts | head -3
```

Expected: at least one match (the re-export from `./schema/index.ts` propagates through `packages/db/src/index.ts`). If grep returns zero matches, slice 21's re-export didn't make it into the dist build — re-run `bun --filter @repo/db build` and re-check.

If the dist file shows the export, the import `import { pushSubscriptions } from "@repo/db"` will resolve.

### Step 4: Run typecheck

```bash
bun --filter @repo/runner check-types
```

Expected: clean. Both new types (`PushDbApi`, `VapidConfig`) are imported from `./push`; the Drizzle query returns rows shaped as the `PushDbApi` interface requires.

### Step 5: Run the runner tests + build

```bash
bun --filter @repo/runner test
bun --filter @repo/runner build
```

Expected: **5 passing** (T2's tests, unchanged), build clean.

### Step 6: Commit

```bash
git add apps/runner/src/daemon.ts
git commit -m "feat(runner): send push notifications after run completion"
```

---

## Task 4: Service Worker push + click handlers

**Files:**
- Modify: `apps/app/src/app/sw.ts`

No new tests. The SW is verified via build + manual smoke (matches slice 17's posture).

### Step 1: Read the current SW

```bash
cat apps/app/src/app/sw.ts
```

Confirm the slice-19 version with `Serwist` constructor + `fallbacks` block + slice-17 `sync` event listener at the bottom.

### Step 2: Append two new listeners

In `apps/app/src/app/sw.ts`, AFTER the existing `self.addEventListener("sync", ...)` block, append:

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

Add no imports — `self`, `PushEvent`, `NotificationEvent`, `WindowClient` are all ambient in the `lib.webworker.d.ts` types that Serwist's tsconfig already provides.

### Step 3: Run typecheck + build

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Expected: both clean. Build will note whether `/icon-192.png` and `/icon-96.png` exist. If the build succeeds but those files are 404s in the precache manifest:
- That's OK at runtime — browsers ignore missing icon URLs and use a default.
- If you want to be cleaner, drop the `icon` + `badge` keys from `showNotification(...)`. Functional behavior is identical either way.

### Step 4: Run the full app test suite

```bash
bun --filter @repo/app test
```

Expected: **188 passing**, unchanged. The SW isn't imported by any test.

### Step 5: Commit

```bash
git add apps/app/src/app/sw.ts
git commit -m "feat(app): SW shows notification on push + opens run page on click"
```

---

## Task 5: Final DoD sweep

**Files:** none.

### Step 1: Verify call-site integrity

```bash
grep -rn "sendPushForRun\|maybeSendPushForCompletedRun\|readVapidFromEnv" apps/runner/src apps/runner/test
```

Expected hits:
- `apps/runner/src/push.ts` — definitions.
- `apps/runner/src/daemon.ts` — calls `maybeSendPushForCompletedRun` + `readVapidFromEnv` (via `pushDbApi` default factory? actually `readVapidFromEnv` is called inline at startup).
- `apps/runner/test/push.test.ts` — tests `sendPushForRun` and `maybeSendPushForCompletedRun`.

```bash
grep -n 'addEventListener("push"\|addEventListener("notificationclick"' apps/app/src/app/sw.ts
```

Expected: 2 matches.

### Step 2: Confirm final state across the toolchain

```bash
bun --filter @repo/app test
# Expected: 188 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean (SW build picks up new handlers)

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)

bun --filter @repo/runner test
# Expected: 5 passing

bun --filter @repo/runner check-types
# Expected: clean

bun --filter @repo/runner build
# Expected: clean

bun --filter @repo/runner lint
# Expected: clean (warnings may be pre-existing)
```

### Step 3: No commit

T5 is verify-only. The branch should now contain:
- `d37b575 docs(app): slice 22 design — server-push on run completion` (pre-existing)
- 4 implementation commits from T1 / T2 / T3 / T4.

```bash
git log --oneline main..HEAD
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
  | 3 | `bun --filter @repo/app test` (188 unchanged) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `bun --filter @repo/runner test` (5 new) | … |
  | 6 | `bun --filter @repo/runner check-types` + build + lint clean | … |
  | 7 | `apps/runner/src/push.ts` exports the documented surface | ✓ T2 |
  | 8 | `daemon.ts` reads VAPID + calls `maybeSendPushForCompletedRun` | ✓ T3 |
  | 9 | `sw.ts` has `push` + `notificationclick` listeners | ✓ T4 |
- Total runner test count (should be 5)
- Total app test count (should be 188 unchanged)
- Commit SHA list (4 implementation commits expected)
- Whether `pushSubscriptions` re-export from `@repo/db` was reachable, or if the import path needed adjusting
- Whether the build flagged missing icons (`/icon-192.png` / `/icon-96.png`)
- Slice 22 release note (one line)
- Any carry-forwards for slice 23

---

## After slice 22

Slice 23 candidates:

- Notify on `partial` / `failed` with status-specific copy
- Per-event preferences (settings page)
- Push retry queue for transient failures
- Periodic stale-subscription sweep
- Whoami endpoint
- Polish `/offline` page
- 60s relative-time ticker for OfflineBanner
- Move push delivery to a background worker if queue throughput becomes a concern
