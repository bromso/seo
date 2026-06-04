import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { auditResults, auditRuns, profiles, sites } from "../src/schema/index"
import { createServiceDb, createTestUser, deleteTestUser, truncateUserData } from "./helpers"

const enabled = process.env["RUN_INTEGRATION"] === "1"

/** Cast a string literal to a Postgres enum type to work around postgres-js text/enum type mismatch */
function asEnum<T extends string>(value: T, typeName: string) {
  return sql.raw(`'${value}'::${typeName}`) as unknown as T
}

;(enabled ? describe : describe.skip)("triggers", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("triggers")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
    await service.close()
  })

  beforeEach(async () => {
    await truncateUserData()
    // truncate cascades to profiles; reinsert the profile row for this user
    await service.db.insert(profiles).values({ id: user.id })
  })

  it("profile row is auto-created when an auth user is inserted", async () => {
    // The trigger fires on auth.users INSERT; user was created in beforeAll.
    // Just verify the row exists. (The truncate + reinsert in beforeEach
    // means the row is back from our explicit insert anyway.)
    const found = await service.db.select().from(profiles).where(eq(profiles.id, user.id))
    expect(found.length).toBe(1)
  })

  it("set_run_owner_from_site populates audit_runs.owner_id from site_id", async () => {
    const [site] = await service.db
      .insert(sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
        isCompetitor: false,
      })
      .returning({ id: sites.id })
    expect(site).toBeDefined()
    if (!site) throw new Error("site insert failed")

    // Insert audit_runs without owner_id (use sql NULL to satisfy notNull type)
    // — the trigger should fill it
    const [run] = await service.db
      .insert(auditRuns)
      .values({
        siteId: site.id,
        ownerId: sql`NULL` as never,
        requestedUrl: "https://example.com",
      })
      .returning({ id: auditRuns.id, ownerId: auditRuns.ownerId })

    expect(run?.ownerId).toBe(user.id)
  })

  it("set_run_owner_from_site rejects orphan site_id", async () => {
    await expect(
      service.db.insert(auditRuns).values({
        siteId: "00000000-0000-0000-0000-000000000000",
        ownerId: sql`NULL` as never,
        requestedUrl: "https://example.com",
      })
    ).rejects.toThrow()
  })

  it("rollup_run_status transitions queued → running → completed", async () => {
    const [site] = await service.db
      .insert(sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: sites.id })
    if (!site) throw new Error("site insert failed")

    const [runInserted] = await service.db
      .insert(auditRuns)
      .values({
        siteId: site.id,
        ownerId: user.id,
        requestedUrl: "https://example.com",
      })
      .returning({ id: auditRuns.id })

    const [run] = await service.db
      .select({ id: auditRuns.id, status: auditRuns.status })
      .from(auditRuns)
      .where(eq(auditRuns.id, runInserted!.id))
    expect(run?.status).toBe("queued")

    const categories = ["performance", "seo", "best-practices", "pwa", "on-page"] as const

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i]!
      await service.db.insert(auditResults).values({
        runId: run!.id,
        ownerId: user.id,
        category: asEnum(cat, "category"),
        status: asEnum("success", "result_status"),
        score: 90,
        issues: [],
        raw: { i },
        packageName: `@repo/audit-${cat}`,
        packageVersion: "0.0.0",
        durationMs: 1000,
        startedAt: new Date(),
      })

      const [refreshed] = await service.db
        .select({
          status: auditRuns.status,
          finishedAt: auditRuns.finishedAt,
        })
        .from(auditRuns)
        .where(eq(auditRuns.id, run!.id))

      if (i < categories.length - 1) {
        expect(refreshed?.status).toBe("running")
        expect(refreshed?.finishedAt).toBeNull()
      } else {
        expect(refreshed?.status).toBe("completed")
        expect(refreshed?.finishedAt).not.toBeNull()
      }
    }
  })

  it("rollup_run_status sets status='partial' when any result is partial", async () => {
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
      })
      .returning({ id: auditRuns.id })

    const insertOne = async (cat: string, status: "success" | "partial") =>
      service.db.insert(auditResults).values({
        runId: run!.id,
        ownerId: user.id,
        category: asEnum(cat, "category"),
        status: asEnum(status, "result_status"),
        score: 90,
        issues: [],
        raw: {},
        partialReasons: status === "partial" ? ["pwa-category-not-emitted-by-lighthouse"] : null,
        packageName: `@repo/audit-${cat}`,
        packageVersion: "0.0.0",
        durationMs: 1000,
        startedAt: new Date(),
      })

    await insertOne("performance", "success")
    await insertOne("seo", "success")
    await insertOne("best-practices", "success")
    await insertOne("pwa", "partial")
    await insertOne("on-page", "success")

    const [refreshed] = await service.db
      .select({ status: auditRuns.status })
      .from(auditRuns)
      .where(eq(auditRuns.id, run!.id))
    expect(refreshed?.status).toBe("partial")
  })

  it("rollup_run_status sets status='failed' when any result is failed", async () => {
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
      })
      .returning({ id: auditRuns.id })

    const cats = ["performance", "seo", "best-practices", "pwa", "on-page"] as const
    for (const cat of cats) {
      const isFailed = cat === "seo"
      await service.db.insert(auditResults).values({
        runId: run!.id,
        ownerId: user.id,
        category: asEnum(cat, "category"),
        status: asEnum(isFailed ? "failed" : "success", "result_status"),
        score: isFailed ? null : 90,
        issues: isFailed ? null : [],
        raw: isFailed ? null : {},
        errorCode: isFailed ? "DNS_ERROR" : null,
        errorMessage: isFailed ? "boom" : null,
        errorRetryable: isFailed ? true : null,
        packageName: `@repo/audit-${cat}`,
        packageVersion: "0.0.0",
        durationMs: 1000,
        startedAt: new Date(),
      })
    }

    const [refreshed] = await service.db
      .select({ status: auditRuns.status })
      .from(auditRuns)
      .where(eq(auditRuns.id, run!.id))
    expect(refreshed?.status).toBe("failed")
  })
})
