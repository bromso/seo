import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { auditResults, auditRuns, profiles, sites } from "../src/schema/index"
import {
  createServiceDb,
  createTestUser,
  createUserDb,
  deleteTestUser,
  truncateUserData,
} from "./helpers"

const enabled = process.env["RUN_INTEGRATION"] === "1"

/** Cast a string literal to a Postgres enum type to work around postgres-js text/enum type mismatch */
function asEnum<T extends string>(value: T, typeName: string) {
  return sql.raw(`'${value}'::${typeName}`) as unknown as T
}

;(enabled ? describe : describe.skip)("RLS", () => {
  let alice: Awaited<ReturnType<typeof createTestUser>>
  let bob: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>
  let aliceDb: ReturnType<typeof createUserDb>
  let bobDb: ReturnType<typeof createUserDb>

  beforeAll(async () => {
    service = createServiceDb()
    alice = await createTestUser("alice")
    bob = await createTestUser("bob")
    aliceDb = createUserDb(alice.jwt)
    bobDb = createUserDb(bob.jwt)
  })

  afterAll(async () => {
    await deleteTestUser(alice.id)
    await deleteTestUser(bob.id)
    await aliceDb.close()
    await bobDb.close()
    await service.close()
  })

  beforeEach(async () => {
    await truncateUserData()
    // recreate the profile rows (truncate cascade nukes them; the handle_new_user
    // trigger only fires on auth.users INSERT, not our test reset).
    await service.db.insert(profiles).values([{ id: alice.id }, { id: bob.id }])
  })

  it("Alice cannot see Bob's sites", async () => {
    const [aliceSite] = await service.db
      .insert(sites)
      .values({
        ownerId: alice.id,
        url: "https://alice.example",
        normalizedUrl: "https://alice.example/",
      })
      .returning({ id: sites.id })
    const [bobSite] = await service.db
      .insert(sites)
      .values({
        ownerId: bob.id,
        url: "https://bob.example",
        normalizedUrl: "https://bob.example/",
      })
      .returning({ id: sites.id })

    const aliceRows = await aliceDb.asUser((tx) => tx.select().from(sites))
    expect(aliceRows.map((r) => r.id)).toEqual([aliceSite!.id])

    const bobRows = await bobDb.asUser((tx) => tx.select().from(sites))
    expect(bobRows.map((r) => r.id)).toEqual([bobSite!.id])
  })

  it("Alice cannot INSERT a site with Bob's owner_id", async () => {
    await expect(
      aliceDb.asUser((tx) =>
        tx.insert(sites).values({
          ownerId: bob.id,
          url: "https://shenanigans.example",
          normalizedUrl: "https://shenanigans.example/",
        })
      )
    ).rejects.toThrow(/row-level security|policy|violates/i)
  })

  it("Alice cannot SELECT Bob's audit_results", async () => {
    const [bobSite] = await service.db
      .insert(sites)
      .values({
        ownerId: bob.id,
        url: "https://bob.example",
        normalizedUrl: "https://bob.example/",
      })
      .returning({ id: sites.id })
    const [bobRun] = await service.db
      .insert(auditRuns)
      .values({
        siteId: bobSite!.id,
        ownerId: bob.id,
        requestedUrl: "https://bob.example",
      })
      .returning({ id: auditRuns.id })

    await service.db.insert(auditResults).values({
      runId: bobRun!.id,
      ownerId: bob.id,
      category: asEnum("seo", "category"),
      status: asEnum("success", "result_status"),
      score: 88,
      issues: [],
      raw: {},
      packageName: "@repo/audit-seo",
      packageVersion: "0.0.0",
      durationMs: 1000,
      startedAt: new Date(),
    })

    const aliceSees = await aliceDb.asUser((tx) => tx.select().from(auditResults))
    expect(aliceSees).toHaveLength(0)
  })

  it("Alice cannot INSERT into audit_results (no INSERT policy)", async () => {
    const [aliceSite] = await service.db
      .insert(sites)
      .values({
        ownerId: alice.id,
        url: "https://alice.example",
        normalizedUrl: "https://alice.example/",
      })
      .returning({ id: sites.id })
    const [aliceRun] = await service.db
      .insert(auditRuns)
      .values({
        siteId: aliceSite!.id,
        ownerId: alice.id,
        requestedUrl: "https://alice.example",
      })
      .returning({ id: auditRuns.id })

    await expect(
      aliceDb.asUser((tx) =>
        tx.insert(auditResults).values({
          runId: aliceRun!.id,
          ownerId: alice.id,
          category: asEnum("seo", "category"),
          status: asEnum("success", "result_status"),
          score: 90,
          issues: [],
          raw: {},
          packageName: "@repo/audit-seo",
          packageVersion: "0.0.0",
          durationMs: 1000,
          startedAt: new Date(),
        })
      )
    ).rejects.toThrow(/row-level security|policy|violates/i)
  })

  it("Alice can DELETE her own site (cascades to runs + results)", async () => {
    const [aliceSite] = await service.db
      .insert(sites)
      .values({
        ownerId: alice.id,
        url: "https://alice.example",
        normalizedUrl: "https://alice.example/",
      })
      .returning({ id: sites.id })

    await aliceDb.asUser((tx) => tx.delete(sites).where(eq(sites.id, aliceSite!.id)))

    const remaining = await aliceDb.asUser((tx) => tx.select().from(sites))
    expect(remaining).toHaveLength(0)
  })
})
