import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuditFailure, AuditResultSchema, withTiming } from "../src/index.js"

const meta = {
  category: "on-page" as const,
  packageName: "@repo/audit-onpage",
  packageVersion: "0.0.0",
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("withTiming", () => {
  it("returns a valid success result", async () => {
    const audit = withTiming(meta)(async () => ({
      score: 88,
      issues: [],
      raw: { ok: true },
    }))
    const result = await audit("https://example.com")
    expect(() => AuditResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.score).toBe(88)
      expect(result.category).toBe("on-page")
      expect(result.packageVersion).toBe("0.0.0")
      expect(result.startedAt).toBe("2026-06-04T12:00:00.000Z")
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.requestedUrl).toBe("https://example.com")
    }
  })

  it("returns a partial result when inner returns partialReasons", async () => {
    const audit = withTiming(meta)(async () => ({
      score: 0,
      issues: [],
      raw: null,
      partialReasons: ["pwa-category-not-emitted-by-lighthouse"],
    }))
    const result = await audit("https://example.com")
    expect(result.status).toBe("partial")
    if (result.status === "partial") {
      expect(result.partialReasons).toEqual(["pwa-category-not-emitted-by-lighthouse"])
    }
  })

  it("converts AuditFailure into a failed result", async () => {
    const audit = withTiming(meta)(async () => {
      throw new AuditFailure({
        code: "HTTP_4XX",
        message: "404 not found",
      })
    })
    const result = await audit("https://example.com/missing")
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.error.code).toBe("HTTP_4XX")
      expect(result.error.retryable).toBe(false)
      expect(result.error.message).toContain("404 not found")
    }
  })

  it("converts unknown errors into UNKNOWN failed results", async () => {
    const audit = withTiming(meta)(async () => {
      throw new TypeError("not a function")
    })
    const result = await audit("https://example.com")
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.error.code).toBe("UNKNOWN")
      expect(result.error.retryable).toBe(true)
    }
  })

  it("aborts via signal and reports ABORTED", async () => {
    const audit = withTiming(meta)(async ({ opts }) => {
      await new Promise((resolve, reject) => {
        opts?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        )
        // never resolves on its own
      })
      return { score: 0, issues: [], raw: null }
    })
    const ac = new AbortController()
    queueMicrotask(() => ac.abort())
    const result = await audit("https://example.com", { signal: ac.signal })
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.error.code).toBe("ABORTED")
    }
  })
})
