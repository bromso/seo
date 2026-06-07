import { aggregate, defaultPackages } from "@repo/audit-cli/lib"
import type { AuditResult, Category, LogEvent } from "@repo/audit-core"
import {
  createDbClient,
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  markAuditRunRunning,
  schema,
} from "@repo/db"
import { consoleLogger, createQueueClient, type Logger, processRun, sleep } from "@repo/runner-core"
import { eq } from "drizzle-orm"
import {
  maybeSendPushForCompletedRun,
  type PushDbApi,
  readVapidFromEnv,
  type VapidConfig,
} from "./push.js"

const ALL_CATEGORIES: Category[] = ["performance", "seo", "best-practices", "pwa", "on-page"]

export function installCrashHandlers(logger: (e: LogEvent) => void): () => void {
  const onUnhandled = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    logger({
      kind: "warn",
      message: `unhandledRejection (process continues): ${message}`,
    })
  }
  const onUncaught = (err: Error) => {
    logger({
      kind: "warn",
      message: `uncaughtException (process continues): ${err.message}`,
    })
  }
  process.on("unhandledRejection", onUnhandled)
  process.on("uncaughtException", onUncaught)
  return () => {
    process.off("unhandledRejection", onUnhandled)
    process.off("uncaughtException", onUncaught)
  }
}

export type MarkRunCrashedArgs = {
  db: unknown
  queue: { ack: (msgId: number) => Promise<void> }
  msgId: number
  runId: string
  ownerId: string
  requestedUrl: string
  errorMessage: string
  logger: (e: LogEvent) => void
  getCompletedCategoriesForRun: (runId: string) => Promise<Set<Category>>
  insertAuditResult: (result: AuditResult, runId: string, ownerId: string) => Promise<string>
  markAuditRunFailed: (runId: string) => Promise<number>
}

export async function markRunCrashed(args: MarkRunCrashedArgs): Promise<void> {
  const completed = await args.getCompletedCategoriesForRun(args.runId)
  const missing = ALL_CATEGORIES.filter((c) => !completed.has(c))
  const startedAt = new Date().toISOString()
  for (const c of missing) {
    const synth: AuditResult = {
      category: c,
      url: args.requestedUrl,
      requestedUrl: args.requestedUrl,
      startedAt,
      durationMs: 0,
      packageName: `@repo/audit-${c}`,
      packageVersion: "0.0.0",
      status: "failed",
      error: { code: "UNKNOWN", message: args.errorMessage, retryable: false },
    }
    try {
      await args.insertAuditResult(synth, args.runId, args.ownerId)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === "23505") {
        // Row was inserted by a concurrent path (processRun managed to write
        // this category before crashing). Benign — keep going.
        continue
      }
      throw err
    }
  }
  await args.markAuditRunFailed(args.runId)
  await args.queue.ack(args.msgId)
  args.logger({
    kind: "progress",
    message: `run ${args.runId} marked failed after crash: ${args.errorMessage}`,
  })
}

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

  const vapid: VapidConfig | null = opts.vapid !== undefined ? opts.vapid : readVapidFromEnv()
  if (!vapid) {
    logger({ kind: "warn", message: "VAPID env vars missing; push notifications disabled" })
  }

  const pushDbApi: PushDbApi = opts.pushDbApi ?? {
    async listSubscriptionsForOwner(ownerId: string) {
      const rows = await db
        .select({
          endpoint: schema.pushSubscriptions.endpoint,
          p256dh: schema.pushSubscriptions.p256dh,
          auth: schema.pushSubscriptions.auth,
        })
        .from(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.ownerId, ownerId))
      return rows
    },
    async deleteSubscriptionByEndpoint(endpoint: string) {
      await db
        .delete(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.endpoint, endpoint))
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
