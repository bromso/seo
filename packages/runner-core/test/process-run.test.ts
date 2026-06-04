import type { AuditResult, Category } from "@repo/audit-core"
import { describe, expect, it, vi } from "vitest"
import { silentLogger } from "../src/logger.js"
import { processRun } from "../src/process-run.js"

const RUN_ID = "00000000-0000-0000-0000-000000000001"
const OWNER_ID = "00000000-0000-0000-0000-000000000002"
const SITE_ID = "00000000-0000-0000-0000-000000000003"

const baseRun = {
  id: RUN_ID,
  siteId: SITE_ID,
  ownerId: OWNER_ID,
  status: "queued" as const,
  requestedUrl: "https://example.com",
  finalUrl: null,
  startedAt: new Date(),
  finishedAt: null,
  triggeredBy: "manual",
}

const mkResult = (
  category: Category,
  status: "success" | "partial" | "failed" = "success"
): AuditResult => {
  const base = {
    category,
    url: "https://example.com/",
    requestedUrl: "https://example.com",
    startedAt: new Date().toISOString(),
    durationMs: 1500,
    packageName: `@repo/audit-${category}`,
    packageVersion: "0.0.0",
  }
  if (status === "failed") {
    return {
      ...base,
      status: "failed",
      error: { code: "DNS_ERROR", message: "boom", retryable: true },
    }
  }
  if (status === "partial") {
    return {
      ...base,
      status: "partial",
      score: 0,
      issues: [],
      raw: null,
      partialReasons: ["pwa-category-not-emitted-by-lighthouse"],
    }
  }
  return { ...base, status: "success", score: 90, issues: [], raw: { ok: true } }
}

const CATEGORIES: Category[] = ["performance", "seo", "best-practices", "pwa", "on-page"]

function makeMockDb(overrides: {
  run?: typeof baseRun | undefined
  completedCategories?: Set<Category>
  insertResultMock?: ReturnType<typeof vi.fn>
}) {
  return {
    getAuditRun: vi.fn(async () => overrides.run),
    markAuditRunRunning: vi.fn(async () => 1),
    getCompletedCategoriesForRun: vi.fn(
      async () => overrides.completedCategories ?? new Set<Category>()
    ),
    insertAuditResult: overrides.insertResultMock ?? vi.fn(async () => "row-id"),
  }
}

describe("processRun", () => {
  it("returns skipped when run not found", async () => {
    const dbMock = makeMockDb({ run: undefined })
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate: vi.fn(),
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result).toEqual({ status: "skipped", reason: "run_not_found" })
  })

  it("returns skipped when run is already completed", async () => {
    const dbMock = makeMockDb({
      run: { ...baseRun, status: "completed" } as never,
    })
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate: vi.fn(),
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result).toEqual({ status: "skipped", reason: "already_completed" })
  })

  it("happy path: 5 success results -> completed", async () => {
    const insertResult = vi.fn(async () => "id")
    const dbMock = makeMockDb({
      run: { ...baseRun, status: "queued" } as never,
      completedCategories: new Set<Category>(),
      insertResultMock: insertResult,
    })
    const aggregate = vi.fn(async () => CATEGORIES.map((c) => mkResult(c, "success")))
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.resultsInserted).toBe(5)
    }
    expect(aggregate).toHaveBeenCalledOnce()
    expect(insertResult).toHaveBeenCalledTimes(5)
  })

  it("aggregator returns one partial -> result is partial", async () => {
    const dbMock = makeMockDb({
      run: { ...baseRun } as never,
      completedCategories: new Set<Category>(),
    })
    const aggregate = vi.fn(async () =>
      CATEGORIES.map((c) => (c === "pwa" ? mkResult(c, "partial") : mkResult(c, "success")))
    )
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result.status).toBe("partial")
    if (result.status === "partial") {
      expect(result.partialCategories).toEqual(["pwa"])
    }
  })

  it("aggregator returns one failed -> result is failed", async () => {
    const dbMock = makeMockDb({
      run: { ...baseRun } as never,
      completedCategories: new Set<Category>(),
    })
    const aggregate = vi.fn(async () =>
      CATEGORIES.map((c) => (c === "performance" ? mkResult(c, "failed") : mkResult(c, "success")))
    )
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("aggregate_failed")
    }
  })

  it("aggregate throws -> insert 5 failed rows and return failed", async () => {
    const insertResult = vi.fn(async () => "id")
    const dbMock = makeMockDb({
      run: { ...baseRun } as never,
      completedCategories: new Set<Category>(),
      insertResultMock: insertResult,
    })
    const aggregate = vi.fn(async () => {
      throw new Error("crashed")
    })
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result.status).toBe("failed")
    expect(insertResult).toHaveBeenCalledTimes(5)
    const insertedStatuses = insertResult.mock.calls.map((c) => (c[0] as AuditResult).status)
    expect(insertedStatuses).toEqual(["failed", "failed", "failed", "failed", "failed"])
  })

  it("idempotent: skips already-completed categories", async () => {
    const aggregate = vi.fn(async () =>
      CATEGORIES.filter((c) => c !== "performance" && c !== "seo").map((c) =>
        mkResult(c, "success")
      )
    )
    const dbMock = makeMockDb({
      run: { ...baseRun } as never,
      completedCategories: new Set(["performance", "seo"]),
    })
    await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    const opts = aggregate.mock.calls[0]?.[1] as { only?: Category[] }
    expect(opts?.only?.sort()).toEqual(["best-practices", "on-page", "pwa"].sort())
  })
})
