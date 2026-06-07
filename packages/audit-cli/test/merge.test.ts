import type { AuditResult } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { mergeByCategory } from "../src/merge.js"

const base = {
  url: "https://example.com/",
  requestedUrl: "https://example.com/",
  startedAt: "2026-06-07T10:00:00.000Z",
  durationMs: 100,
  packageVersion: "0.0.0",
}

const success = (overrides: Partial<AuditResult> & { packageName: string }): AuditResult =>
  ({
    ...base,
    category: "seo",
    status: "success",
    score: 90,
    issues: [],
    raw: { ruleSummary: [{ rule: "r/x", weight: 1, outcome: "pass" }] },
    ...overrides,
  }) as AuditResult

const failed = (overrides: Partial<AuditResult> & { packageName: string }): AuditResult =>
  ({
    ...base,
    category: "seo",
    status: "failed",
    error: { code: "UNKNOWN", message: "boom", retryable: false },
    ...overrides,
  }) as AuditResult

describe("mergeByCategory", () => {
  it("single-package category passes through untouched", () => {
    const input = [success({ packageName: "@repo/audit-perf", category: "performance" })]
    const out = mergeByCategory(input)
    expect(out).toHaveLength(1)
    expect(out[0]?.packageName).toBe("@repo/audit-perf")
  })

  it("two successful contributors -> single merged success result", () => {
    const a = success({
      packageName: "@repo/audit-seo",
      score: 90,
      raw: { ruleSummary: [{ rule: "seo/a", weight: 4, outcome: "pass" }] },
    })
    const b = success({
      packageName: "@repo/audit-structured",
      score: 50,
      raw: { ruleSummary: [{ rule: "str/b", weight: 2, outcome: "fail" }] },
    })
    const out = mergeByCategory([a, b])
    expect(out).toHaveLength(1)
    const m = out[0]
    expect(m?.status).toBe("success")
    expect(m?.category).toBe("seo")
    expect(m?.packageName).toBe("merged")
    if (m?.status === "success") {
      // weighted average: (90*4 + 50*2) / 6 = 460/6 = 76.67 -> 77
      expect(m.score).toBe(77)
    }
  })

  it("one failed + one success -> merged partial with partialReasons", () => {
    const a = success({ packageName: "@repo/audit-seo", score: 80 })
    const b = failed({ packageName: "@repo/audit-structured" })
    const out = mergeByCategory([a, b])
    expect(out).toHaveLength(1)
    const m = out[0]
    expect(m?.status).toBe("partial")
    if (m?.status === "partial") {
      expect(m.partialReasons.some((r) => r.includes("@repo/audit-structured"))).toBe(true)
      expect(m.score).toBe(80)
    }
  })

  it("all contributors failed -> merged failed with aggregated message", () => {
    const a = failed({ packageName: "@repo/audit-seo" })
    const b = failed({ packageName: "@repo/audit-structured" })
    const out = mergeByCategory([a, b])
    expect(out).toHaveLength(1)
    expect(out[0]?.status).toBe("failed")
    if (out[0]?.status === "failed") {
      expect(out[0].error.message).toContain("@repo/audit-seo")
      expect(out[0].error.message).toContain("@repo/audit-structured")
    }
  })

  it("concatenates issues from all successful contributors", () => {
    const issueA = {
      rule: "x/a",
      severity: "warn" as const,
      title: "a",
      description: "a",
      recommendation: "a",
      count: 1,
      occurrences: [],
    }
    const issueB = {
      rule: "x/b",
      severity: "info" as const,
      title: "b",
      description: "b",
      recommendation: "b",
      count: 1,
      occurrences: [],
    }
    const a = success({ packageName: "@repo/audit-seo", issues: [issueA] })
    const b = success({ packageName: "@repo/audit-structured", issues: [issueB] })
    const out = mergeByCategory([a, b])
    if (out[0]?.status === "success") {
      const ruleIds = out[0].issues.map((i) => i.rule)
      expect(ruleIds).toContain("x/a")
      expect(ruleIds).toContain("x/b")
    }
  })
})
