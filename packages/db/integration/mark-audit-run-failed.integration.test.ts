import { sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { markAuditRunFailed } from "../src/queries"
import { auditRuns, profiles, sites } from "../src/schema/index"
import { createServiceDb, createTestUser, deleteTestUser, truncateUserData } from "./helpers"

const enabled = process.env["RUN_INTEGRATION"] === "1"

;(enabled ? describe : describe.skip)("markAuditRunFailed", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("mark-failed")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
    await service.close()
  })

  beforeEach(async () => {
    await truncateUserData()
    await service.db.insert(profiles).values({ id: user.id })
  })

  async function insertRun(status: "queued" | "running" | "completed" | "partial" | "failed") {
    const [site] = await service.db
      .insert(sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: sites.id })
    if (!site) throw new Error("site insert failed")
    const [run] = await service.db
      .insert(auditRuns)
      .values({
        siteId: site.id,
        ownerId: user.id,
        requestedUrl: "https://example.com",
        status: sql`${status}::run_status`,
      })
      .returning({ id: auditRuns.id })
    if (!run) throw new Error("run insert failed")
    return run.id
  }

  async function readStatus(runId: string): Promise<string> {
    const rows = await service.db
      .select({ status: auditRuns.status })
      .from(auditRuns)
      .where(sql`${auditRuns.id} = ${runId}`)
    return rows[0]?.status ?? "missing"
  }

  it("marks a running run as failed and returns 1", async () => {
    const runId = await insertRun("running")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(1)
    expect(await readStatus(runId)).toBe("failed")
  })

  it("does not overwrite a completed run", async () => {
    const runId = await insertRun("completed")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(0)
    expect(await readStatus(runId)).toBe("completed")
  })

  it("does not overwrite a partial run", async () => {
    const runId = await insertRun("partial")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(0)
    expect(await readStatus(runId)).toBe("partial")
  })

  it("does not overwrite an already-failed run", async () => {
    const runId = await insertRun("failed")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(0)
    expect(await readStatus(runId)).toBe("failed")
  })

  it("marks a queued run as failed and returns 1 (daemon may crash before markAuditRunRunning)", async () => {
    const runId = await insertRun("queued")
    const count = await markAuditRunFailed(service.db, runId)
    expect(count).toBe(1)
    expect(await readStatus(runId)).toBe("failed")
  })
})
