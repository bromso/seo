import { aggregate, defaultPackages } from "@repo/audit-cli/lib"
import {
  createDbClient,
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  markAuditRunRunning,
} from "@repo/db"
import { consoleLogger, createQueueClient, type Logger, processRun, sleep } from "@repo/runner-core"

export type DaemonOptions = {
  connectionString: string
  pollIntervalMs?: number
  visibilityTimeoutSec?: number
  shutdownGraceMs?: number
  logger?: Logger
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
