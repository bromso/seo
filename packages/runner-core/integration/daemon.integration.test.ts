import type { AuditResult, Category } from "@repo/audit-core"
import {
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  insertAuditRun,
  markAuditRunRunning,
  schema,
} from "@repo/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createQueueClient, processRun, sleep } from "../src/index.js"
import {
  createServiceDb,
  createTestUser,
  deleteTestUser,
  purgeQueue,
  truncateUserData,
} from "./helpers.js"

const enabled = process.env.RUN_INTEGRATION === "1"

const ALL: Category[] = ["performance", "seo", "best-practices", "pwa", "on-page"]

const mockAggregate = async (
  url: string,
  opts: { only?: Category[] },
  _: never
): Promise<AuditResult[]> => {
  const only = opts.only ?? ALL
  return only.map((c) => ({
    category: c,
    url,
    requestedUrl: url,
    startedAt: new Date().toISOString(),
    durationMs: 100,
    packageName: `@repo/audit-${c}`,
    packageVersion: "0.0.0",
    status: "success",
    score: 91,
    issues: [],
    raw: {},
  }))
}

;(enabled ? describe : describe.skip)("daemon integration", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("daemon")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  beforeEach(async () => {
    await truncateUserData()
    await purgeQueue()
    await service.db.insert(schema.profiles).values({ id: user.id })
  })

  it("polling: claims a queued message, processes it, acks", async () => {
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })

    const runId = await insertAuditRun(service.db, {
      siteId: site?.id,
      requestedUrl: "https://example.com",
    })

    const queue = createQueueClient(service.db)

    // Poll for up to 5s to claim the message
    let msg: Awaited<ReturnType<typeof queue.read>>
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      msg = await queue.read(60)
      if (msg) break
      await sleep(100)
    }
    expect(msg).toBeDefined()
    if (!msg) throw new Error("never claimed message")
    expect(msg.body.runId).toBe(runId)

    // Process (mocked aggregate so no Chrome)
    const result = await processRun(msg.body.runId, {
      dbApi: {
        getAuditRun: (id) => getAuditRun(service.db, id),
        markAuditRunRunning: (id) => markAuditRunRunning(service.db, id),
        getCompletedCategoriesForRun: (id) => getCompletedCategoriesForRun(service.db, id),
        insertAuditResult: (r, runId, ownerId) => insertAuditResult(service.db, r, runId, ownerId),
      },
      aggregate: mockAggregate,
      packages: {} as never,
      logger: () => {},
    })
    expect(result.status).toBe("completed")

    await queue.ack(msg.msgId)

    // Queue is now empty
    const next = await queue.read(60)
    expect(next).toBeUndefined()

    // DB state confirmed
    const rows = await service.db
      .select()
      .from(schema.auditResults)
      .where(eq(schema.auditResults.runId, runId))
    expect(rows).toHaveLength(5)
    const [run] = await service.db
      .select({ status: schema.auditRuns.status })
      .from(schema.auditRuns)
      .where(eq(schema.auditRuns.id, runId))
    expect(run?.status).toBe("completed")
  }, 30_000)

  it("retry-limit: read_ct > 3 triggers archive + synthetic failed rows", async () => {
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })
    const runId = await insertAuditRun(service.db, {
      siteId: site?.id,
      requestedUrl: "https://example.com",
    })

    const queue = createQueueClient(service.db)

    // Read 4 times with 1s visibility timeout, no ack — bumps read_ct
    for (let i = 0; i < 4; i++) {
      const m = await queue.read(1)
      expect(m).toBeDefined()
      await sleep(1100) // wait past visibility timeout so next read sees it
    }

    // 5th read sees read_ct >= 4
    const msg = await queue.read(60)
    expect(msg).toBeDefined()
    expect(msg?.readCt).toBeGreaterThan(3)

    // Mirror the daemon's retry-limit behavior: insert 5 synthetic failed rows + archive
    for (const c of ALL) {
      await insertAuditResult(
        service.db,
        {
          category: c,
          url: msg?.body.requestedUrl,
          requestedUrl: msg?.body.requestedUrl,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          packageName: `@repo/audit-${c}`,
          packageVersion: "0.0.0",
          status: "failed",
          error: {
            code: "UNKNOWN",
            message: "exceeded retry limit (3)",
            retryable: false,
          },
        },
        runId,
        user.id
      )
    }
    await queue.archive(msg?.msgId)

    // Run should now be 'failed' via the rollup trigger
    const [run] = await service.db
      .select({ status: schema.auditRuns.status })
      .from(schema.auditRuns)
      .where(eq(schema.auditRuns.id, runId))
    expect(run?.status).toBe("failed")

    // Queue is empty (archived, not just acked)
    const next = await queue.read(60)
    expect(next).toBeUndefined()
  }, 30_000)
})
