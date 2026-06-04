import type { AuditResult } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { auditResultToInsert } from "../src/map.js"

const RUN_ID = "00000000-0000-0000-0000-000000000001"
const OWNER_ID = "00000000-0000-0000-0000-000000000002"

const baseFields = {
  category: "on-page" as const,
  url: "https://example.com/",
  requestedUrl: "https://example.com",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 312,
  packageName: "@repo/audit-onpage",
  packageVersion: "0.0.0",
}

describe("auditResultToInsert", () => {
  it("maps success results with score/issues/raw, no error fields", () => {
    const result: AuditResult = {
      ...baseFields,
      status: "success",
      score: 88,
      issues: [],
      raw: { ok: true },
    }
    const row = auditResultToInsert(result, RUN_ID, OWNER_ID)
    expect(row.runId).toBe(RUN_ID)
    expect(row.ownerId).toBe(OWNER_ID)
    expect(row.category).toBe("on-page")
    expect(row.status).toBe("success")
    expect(row.score).toBe(88)
    expect(row.issues).toEqual([])
    expect(row.raw).toEqual({ ok: true })
    expect(row.errorCode).toBeUndefined()
    expect(row.partialReasons).toBeUndefined()
    expect(row.startedAt).toBeInstanceOf(Date)
    expect(row.startedAt?.toISOString()).toBe(baseFields.startedAt)
  })

  it("maps partial results with score/issues/raw + partialReasons", () => {
    const result: AuditResult = {
      ...baseFields,
      category: "pwa",
      status: "partial",
      score: 0,
      issues: [],
      raw: null,
      partialReasons: ["pwa-category-not-emitted-by-lighthouse"],
    }
    const row = auditResultToInsert(result, RUN_ID, OWNER_ID)
    expect(row.status).toBe("partial")
    expect(row.score).toBe(0)
    expect(row.partialReasons).toEqual(["pwa-category-not-emitted-by-lighthouse"])
    expect(row.errorCode).toBeUndefined()
  })

  it("maps failed results with error fields, no score/issues/raw", () => {
    const result: AuditResult = {
      ...baseFields,
      category: "performance",
      status: "failed",
      error: {
        code: "DNS_ERROR",
        message: "ENOTFOUND example.com",
        retryable: true,
      },
    }
    const row = auditResultToInsert(result, RUN_ID, OWNER_ID)
    expect(row.status).toBe("failed")
    expect(row.score).toBeUndefined()
    expect(row.issues).toBeUndefined()
    expect(row.raw).toBeUndefined()
    expect(row.errorCode).toBe("DNS_ERROR")
    expect(row.errorMessage).toBe("ENOTFOUND example.com")
    expect(row.errorRetryable).toBe(true)
  })

  it("rejects an AuditResult that fails schema validation", () => {
    const bad = { ...baseFields, status: "success", score: 999, issues: [], raw: {} }
    expect(() => auditResultToInsert(bad as never, RUN_ID, OWNER_ID)).toThrow()
  })
})
