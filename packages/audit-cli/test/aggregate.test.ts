import { AuditResultSchema } from "@repo/audit-core"
import { describe, expect, it, vi } from "vitest"
import { type AuditPackages, aggregate } from "../src/aggregate.js"

const mkSuccess = (category: string): unknown => ({
  status: "success",
  category,
  url: "https://example.com/",
  requestedUrl: "https://example.com",
  startedAt: new Date().toISOString(),
  durationMs: 100,
  packageName: `@repo/audit-${category}`,
  packageVersion: "0.0.0",
  score: 90,
  issues: [],
  raw: {},
})

const stubPackages: AuditPackages = {
  runLighthouse: vi.fn(async () => ({ requestedUrl: "x", finalUrl: "x" }) as unknown as never),
  perf: vi.fn(async () => mkSuccess("performance") as never),
  seo: vi.fn(async () => mkSuccess("seo") as never),
  bestPractices: vi.fn(async () => mkSuccess("best-practices") as never),
  pwa: vi.fn(async () => mkSuccess("pwa") as never),
  onpage: vi.fn(async () => mkSuccess("on-page") as never),
}

describe("aggregate", () => {
  it("returns 5 valid AuditResults for a happy URL", async () => {
    const results = await aggregate("https://example.com", { timeoutMs: 10_000 }, stubPackages)
    expect(results).toHaveLength(5)
    for (const r of results) expect(() => AuditResultSchema.parse(r)).not.toThrow()
    expect(stubPackages.runLighthouse).toHaveBeenCalledTimes(1)
  })

  it("respects --only by skipping non-requested categories", async () => {
    const onlyPerf = await aggregate(
      "https://example.com",
      { only: ["performance"], timeoutMs: 10_000 },
      stubPackages
    )
    expect(onlyPerf).toHaveLength(1)
    expect(onlyPerf[0]?.category).toBe("performance")
  })
})
