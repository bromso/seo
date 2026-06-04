import { describe, expect, it } from "vitest"
import { AuditResultSchema, IssueSchema } from "../src/index.js"

const validIssue = {
  rule: "onpage/missing-meta-description",
  severity: "warn" as const,
  title: "Missing meta description",
  description: 'No <meta name="description"> on the page.',
  recommendation: "Add a 150-160 character meta description.",
  count: 1,
  occurrences: [],
}

const validSuccessResult = {
  status: "success" as const,
  category: "on-page" as const,
  url: "https://example.com/",
  requestedUrl: "https://example.com",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 312,
  packageName: "@repo/audit-onpage",
  packageVersion: "0.0.0",
  score: 78,
  issues: [validIssue],
  raw: { ok: true },
}

const validFailureResult = {
  status: "failed" as const,
  category: "performance" as const,
  url: "https://nope.invalid/",
  requestedUrl: "https://nope.invalid",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 8000,
  packageName: "@repo/audit-perf",
  packageVersion: "0.0.0",
  error: {
    code: "DNS_ERROR" as const,
    message: "getaddrinfo ENOTFOUND nope.invalid",
    retryable: true,
  },
}

describe("IssueSchema", () => {
  it("accepts a valid issue", () => {
    expect(() => IssueSchema.parse(validIssue)).not.toThrow()
  })

  it("rejects count < 1", () => {
    expect(() => IssueSchema.parse({ ...validIssue, count: 0 })).toThrow()
  })

  it("rejects more than 5 occurrences", () => {
    const tooMany = Array.from({ length: 6 }, () => ({ selector: "img" }))
    expect(() => IssueSchema.parse({ ...validIssue, occurrences: tooMany })).toThrow()
  })
})

describe("AuditResultSchema", () => {
  it("accepts a success result", () => {
    expect(() => AuditResultSchema.parse(validSuccessResult)).not.toThrow()
  })

  it("accepts a failure result with no score/issues", () => {
    expect(() => AuditResultSchema.parse(validFailureResult)).not.toThrow()
  })

  it("rejects a success result missing score", () => {
    const { score, ...withoutScore } = validSuccessResult
    expect(() => AuditResultSchema.parse(withoutScore)).toThrow()
  })

  it("rejects score out of 0..100", () => {
    expect(() => AuditResultSchema.parse({ ...validSuccessResult, score: 101 })).toThrow()
  })
})
