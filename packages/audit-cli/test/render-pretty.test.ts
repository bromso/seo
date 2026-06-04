import { describe, expect, it } from "vitest"
import { renderPretty } from "../src/render/pretty.js"

const success = {
  status: "success" as const,
  category: "performance" as const,
  url: "https://example.com/",
  requestedUrl: "https://example.com",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 8200,
  packageName: "@repo/audit-perf",
  packageVersion: "0.0.0",
  score: 92,
  issues: [],
  raw: {},
}

const failed = {
  status: "failed" as const,
  category: "seo" as const,
  url: "https://nope.invalid/",
  requestedUrl: "https://nope.invalid",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 8000,
  packageName: "@repo/audit-seo",
  packageVersion: "0.0.0",
  error: { code: "DNS_ERROR" as const, message: "boom", retryable: true },
}

describe("renderPretty", () => {
  it("renders a success row with category, score, and duration", () => {
    const out = renderPretty([success], { color: false })
    expect(out).toMatch(/performance/)
    expect(out).toMatch(/92/)
    expect(out).toMatch(/8\.2s/)
  })

  it("renders a failure row with the error code", () => {
    const out = renderPretty([failed], { color: false })
    expect(out).toMatch(/seo/)
    expect(out).toMatch(/DNS_ERROR/)
  })
})
