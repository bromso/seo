import { describe, expect, it } from "vitest"
import { AuditFailure, ErrorCodes } from "../src/index.js"

describe("AuditFailure", () => {
  it("is throwable and round-trips its fields", () => {
    const err = new AuditFailure({
      code: "HTTP_4XX",
      message: "page not found (404)",
      retryable: false,
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("HTTP_4XX")
    expect(err.retryable).toBe(false)
    expect(err.message).toContain("page not found")
  })

  it("defaults retryable based on code class when not provided", () => {
    const err = new AuditFailure({ code: "HTTP_5XX", message: "boom" })
    expect(err.retryable).toBe(true)
  })

  it("preserves the original cause", () => {
    const cause = new Error("inner")
    const err = new AuditFailure({
      code: "UNKNOWN",
      message: "wrap",
      cause,
    })
    expect(err.cause).toBe(cause)
  })
})

describe("ErrorCodes", () => {
  it("exposes all expected codes", () => {
    expect(ErrorCodes.DNS_ERROR).toBe("DNS_ERROR")
    expect(ErrorCodes.HTTP_4XX).toBe("HTTP_4XX")
    expect(ErrorCodes.UNKNOWN).toBe("UNKNOWN")
  })
})
