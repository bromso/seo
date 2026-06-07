import type { AuditResult } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { type AuditPackages, aggregate } from "../src/aggregate.js"

const base = {
  url: "https://example.com/",
  requestedUrl: "https://example.com/",
  startedAt: "2026-06-07T10:00:00.000Z",
  durationMs: 50,
  packageVersion: "0.0.0",
}

const mkSuccess = (
  packageName: string,
  category: AuditResult["category"],
  score: number
): AuditResult =>
  ({
    ...base,
    packageName,
    category,
    status: "success",
    score,
    issues: [],
    raw: { ruleSummary: [{ rule: "x/x", weight: 1, outcome: "pass" }] },
  }) as AuditResult

const stubPkgs: AuditPackages = {
  runLighthouse: async () => undefined,
  perf: async () => mkSuccess("@repo/audit-perf", "performance", 80),
  seo: async () => mkSuccess("@repo/audit-seo", "seo", 90),
  bestPractices: async () => mkSuccess("@repo/audit-best-practices", "best-practices", 70),
  pwa: async () => mkSuccess("@repo/audit-pwa", "pwa", 60),
  onpage: async () => mkSuccess("@repo/audit-onpage", "on-page", 95),
  meta: async () => mkSuccess("@repo/audit-meta", "on-page", 85),
  structured: async () => mkSuccess("@repo/audit-structured", "seo", 50),
  content: async () => mkSuccess("@repo/audit-content", "seo", 100),
}

describe("aggregate end-to-end with merger", () => {
  it("returns one result per category after merging", async () => {
    const results = await aggregate("https://example.com/", {}, stubPkgs)
    const categories = new Set(results.map((r) => r.category))
    expect(categories.size).toBe(results.length)
    expect(results.length).toBe(5)
  })

  it("on-page result is merged from onpage + meta packages", async () => {
    const results = await aggregate("https://example.com/", {}, stubPkgs)
    const onpage = results.find((r) => r.category === "on-page")
    expect(onpage?.packageName).toBe("merged")
    if (onpage?.status === "success") {
      // equal weights (both have 1 rule, weight 1) => avg of 95 and 85 = 90
      expect(onpage.score).toBe(90)
    }
  })

  it("seo result is merged from 3 contributors (seo + structured + content)", async () => {
    const results = await aggregate("https://example.com/", {}, stubPkgs)
    const seo = results.find((r) => r.category === "seo")
    expect(seo?.packageName).toBe("merged")
    if (seo?.status === "success") {
      // equal weights => avg of 90, 50, 100 = 80
      expect(seo.score).toBe(80)
    }
  })

  it("--only on-page returns only the merged on-page result", async () => {
    const results = await aggregate("https://example.com/", { only: ["on-page"] }, stubPkgs)
    expect(results).toHaveLength(1)
    expect(results[0]?.category).toBe("on-page")
  })
})
