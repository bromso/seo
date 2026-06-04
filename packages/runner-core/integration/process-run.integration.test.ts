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
import { silentLogger } from "../src/logger.js"
import { processRun } from "../src/process-run.js"
import {
  createServiceDb,
  createTestUser,
  deleteTestUser,
  purgeQueue,
  truncateUserData,
} from "./helpers.js"

const enabled = process.env["RUN_INTEGRATION"] === "1"

const ALL: Category[] = ["performance", "seo", "best-practices", "pwa", "on-page"]

;(enabled ? describe : describe.skip)("processRun integration", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("processrun")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  beforeEach(async () => {
    await truncateUserData()
    await purgeQueue()
    await service.db.insert(schema.profiles).values({ id: user.id })
  })

  it("end-to-end: insertAuditRun -> queue -> processRun -> 5 results -> rollup completed", async () => {
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })

    const runId = await insertAuditRun(service.db, {
      siteId: site!.id,
      requestedUrl: "https://example.com",
    })

    // Mock aggregate returns 5 success results
    const aggregate = async (url: string, _opts: never, _packages: never): Promise<AuditResult[]> =>
      ALL.map((c) => ({
        category: c,
        url,
        requestedUrl: url,
        startedAt: new Date().toISOString(),
        durationMs: 1000,
        packageName: `@repo/audit-${c}`,
        packageVersion: "0.0.0",
        status: "success",
        score: 90,
        issues: [],
        raw: { ok: true },
      }))

    const result = await processRun(runId, {
      dbApi: {
        getAuditRun: (id) => getAuditRun(service.db, id),
        markAuditRunRunning: (id) => markAuditRunRunning(service.db, id),
        getCompletedCategoriesForRun: (id) => getCompletedCategoriesForRun(service.db, id),
        insertAuditResult: (r, runId, ownerId) => insertAuditResult(service.db, r, runId, ownerId),
      },
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })

    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.resultsInserted).toBe(5)
    }

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
  })

  it("idempotent: re-running after partial insert skips already-completed categories", async () => {
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })

    const runId = await insertAuditRun(service.db, {
      siteId: site!.id,
      requestedUrl: "https://example.com",
    })

    // Manually insert 2 successful results to simulate a crashed prior run
    for (const c of ["performance", "seo"] as Category[]) {
      await insertAuditResult(
        service.db,
        {
          category: c,
          url: "https://example.com/",
          requestedUrl: "https://example.com",
          startedAt: new Date().toISOString(),
          durationMs: 1000,
          packageName: `@repo/audit-${c}`,
          packageVersion: "0.0.0",
          status: "success",
          score: 88,
          issues: [],
          raw: {},
        },
        runId,
        user.id
      )
    }

    let aggregateCalls = 0
    const aggregate = async (
      url: string,
      opts: { only?: Category[] },
      _: never
    ): Promise<AuditResult[]> => {
      aggregateCalls++
      const only = opts.only ?? ALL
      return only.map((c) => ({
        category: c,
        url,
        requestedUrl: url,
        startedAt: new Date().toISOString(),
        durationMs: 1000,
        packageName: `@repo/audit-${c}`,
        packageVersion: "0.0.0",
        status: "success",
        score: 92,
        issues: [],
        raw: {},
      }))
    }

    const result = await processRun(runId, {
      dbApi: {
        getAuditRun: (id) => getAuditRun(service.db, id),
        markAuditRunRunning: (id) => markAuditRunRunning(service.db, id),
        getCompletedCategoriesForRun: (id) => getCompletedCategoriesForRun(service.db, id),
        insertAuditResult: (r, runId, ownerId) => insertAuditResult(service.db, r, runId, ownerId),
      },
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })

    expect(aggregateCalls).toBe(1)
    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.resultsInserted).toBe(3)
    }
  })
})
