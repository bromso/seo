import type { AuditResult } from "@repo/audit-core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { insertAuditResult, insertAuditRun } from "../src/map"
import { auditResults, auditRuns, profiles, sites } from "../src/schema/index"
import { createServiceDb, createTestUser, deleteTestUser, truncateUserData } from "./helpers"

const enabled = process.env["RUN_INTEGRATION"] === "1"

;(enabled ? describe : describe.skip)("insert helpers", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("inserts")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
    await service.close()
  })

  beforeEach(async () => {
    await truncateUserData()
    await service.db.insert(profiles).values({ id: user.id })
  })

  it("inserts a run + 5 results and the run ends as 'completed'", async () => {
    const [site] = await service.db
      .insert(sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: sites.id })
    if (!site) throw new Error("site insert failed")

    const runId = await insertAuditRun(service.db, {
      siteId: site.id,
      requestedUrl: "https://example.com",
    })

    const cats = ["performance", "seo", "best-practices", "pwa", "on-page"] as const
    for (const cat of cats) {
      const result: AuditResult = {
        category: cat,
        url: "https://example.com/",
        requestedUrl: "https://example.com",
        startedAt: new Date().toISOString(),
        durationMs: 1500,
        packageName: `@repo/audit-${cat}`,
        packageVersion: "0.0.0",
        status: "success",
        score: 92,
        issues: [],
        raw: { ok: true },
      }
      await insertAuditResult(service.db, result, runId, user.id)
    }

    const inserted = await service.db
      .select()
      .from(auditResults)
      .where(eq(auditResults.runId, runId))
    expect(inserted).toHaveLength(5)
    expect(inserted.every((r) => r.score === 92)).toBe(true)
    expect(inserted.every((r) => r.ownerId === user.id)).toBe(true)

    const [run] = await service.db
      .select({
        status: auditRuns.status,
        finishedAt: auditRuns.finishedAt,
      })
      .from(auditRuns)
      .where(eq(auditRuns.id, runId))
    expect(run?.status).toBe("completed")
    expect(run?.finishedAt).not.toBeNull()
  })

  it("inserting a failed result fills error_* and nulls score/issues/raw", async () => {
    const [site] = await service.db
      .insert(sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: sites.id })
    if (!site) throw new Error("site insert failed")

    const runId = await insertAuditRun(service.db, {
      siteId: site.id,
      requestedUrl: "https://example.com",
    })

    const failed: AuditResult = {
      category: "performance",
      url: "https://example.com/",
      requestedUrl: "https://example.com",
      startedAt: new Date().toISOString(),
      durationMs: 8000,
      packageName: "@repo/audit-perf",
      packageVersion: "0.0.0",
      status: "failed",
      error: {
        code: "DNS_ERROR",
        message: "ENOTFOUND example.com",
        retryable: true,
      },
    }
    await insertAuditResult(service.db, failed, runId, user.id)

    const [row] = await service.db.select().from(auditResults).where(eq(auditResults.runId, runId))
    expect(row?.status).toBe("failed")
    expect(row?.score).toBeNull()
    expect(row?.issues).toBeNull()
    expect(row?.raw).toBeNull()
    expect(row?.errorCode).toBe("DNS_ERROR")
    expect(row?.errorRetryable).toBe(true)
  })

  it("rejects an AuditResult that violates the discriminated-union CHECK constraint", async () => {
    const [site] = await service.db
      .insert(sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: sites.id })
    if (!site) throw new Error("site insert failed")

    const runId = await insertAuditRun(service.db, {
      siteId: site.id,
      requestedUrl: "https://example.com",
    })

    // Bypass auditResultToInsert and try to insert an inconsistent row directly
    // (status='success' without score/issues/raw). The CHECK constraint should fire.
    // Use sql.raw casts for enums to satisfy postgres-js prepare:false.
    const { sql } = await import("drizzle-orm")
    await expect(
      service.db.insert(auditResults).values({
        runId,
        ownerId: user.id,
        category: sql.raw(`'seo'::category`) as never,
        status: sql.raw(`'success'::result_status`) as never,
        score: null,
        issues: null,
        raw: null,
        packageName: "@repo/audit-seo",
        packageVersion: "0.0.0",
        durationMs: 1000,
        startedAt: new Date(),
      })
    ).rejects.toThrow(/audit_results_status_fields_consistent/)
  })
})
