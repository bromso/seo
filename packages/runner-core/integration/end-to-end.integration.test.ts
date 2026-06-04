import { aggregate, defaultPackages } from "@repo/audit-cli/lib"
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
import { processRun } from "../src/index.js"
import {
  createServiceDb,
  createTestUser,
  deleteTestUser,
  purgeQueue,
  truncateUserData,
} from "./helpers.js"

const enabled = process.env["RUN_INTEGRATION"] === "1" && process.env["RUN_E2E"] === "1"

;(enabled ? describe : describe.skip)("end-to-end with real Chrome", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("e2e")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  beforeEach(async () => {
    await truncateUserData()
    await purgeQueue()
    await service.db.insert(schema.profiles).values({ id: user.id })
  })

  it("processes a real audit_run against https://example.com end-to-end", async () => {
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

    const result = await processRun(runId, {
      dbApi: {
        getAuditRun: (id) => getAuditRun(service.db, id),
        markAuditRunRunning: (id) => markAuditRunRunning(service.db, id),
        getCompletedCategoriesForRun: (id) => getCompletedCategoriesForRun(service.db, id),
        insertAuditResult: (r, runId, ownerId) => insertAuditResult(service.db, r, runId, ownerId),
      },
      aggregate,
      packages: defaultPackages,
      logger: () => {},
      timeoutMs: 120_000,
    })

    // PWA may be partial under Lighthouse 12 — both states are acceptable
    expect(["completed", "partial"]).toContain(result.status)

    const rows = await service.db
      .select()
      .from(schema.auditResults)
      .where(eq(schema.auditResults.runId, runId))
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(["success", "partial", "failed"]).toContain(row.status)
    }
  }, 180_000)
})
