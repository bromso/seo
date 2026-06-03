import { AuditFailure } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { mapLhrRuntimeError, mapThrownError } from "../src/map-error.js"

describe("mapLhrRuntimeError", () => {
  it("maps NO_FCP to LIGHTHOUSE_NO_FCP retryable", () => {
    const err = mapLhrRuntimeError({ code: "NO_FCP", message: "no fcp" })
    expect(err).toBeInstanceOf(AuditFailure)
    expect(err.code).toBe("LIGHTHOUSE_NO_FCP")
    expect(err.retryable).toBe(true)
  })

  it("maps ERRORED_DOCUMENT_REQUEST (DNS/conn) to DNS_ERROR", () => {
    const err = mapLhrRuntimeError({
      code: "ERRORED_DOCUMENT_REQUEST",
      message: "net::ERR_NAME_NOT_RESOLVED",
    })
    expect(err.code).toBe("DNS_ERROR")
    expect(err.retryable).toBe(true)
  })

  it("maps an unknown runtimeError code to LIGHTHOUSE_CRASH", () => {
    const err = mapLhrRuntimeError({ code: "UNDEFINED_HORROR", message: "?" })
    expect(err.code).toBe("LIGHTHOUSE_CRASH")
    expect(err.retryable).toBe(true)
  })
})

describe("mapThrownError", () => {
  it("maps AbortError to ABORTED", () => {
    const abort = new Error("aborted")
    abort.name = "AbortError"
    const err = mapThrownError(abort)
    expect(err.code).toBe("ABORTED")
  })

  it("maps a timeout to TIMEOUT", () => {
    const t = new Error("operation timed out after 60000ms")
    ;(t as { code?: string }).code = "ETIMEDOUT"
    const err = mapThrownError(t)
    expect(err.code).toBe("TIMEOUT")
  })

  it("maps unknown errors to LIGHTHOUSE_CRASH", () => {
    const err = mapThrownError(new Error("Chrome died"))
    expect(err.code).toBe("LIGHTHOUSE_CRASH")
  })
})

describe("HTTP status mapping (via mapHttpStatus)", () => {
  it("maps 404 to HTTP_4XX non-retryable", async () => {
    const { mapHttpStatus } = await import("../src/map-error.js")
    const err = mapHttpStatus(404)
    expect(err.code).toBe("HTTP_4XX")
    expect(err.retryable).toBe(false)
  })

  it("maps 503 to HTTP_5XX retryable", async () => {
    const { mapHttpStatus } = await import("../src/map-error.js")
    const err = mapHttpStatus(503)
    expect(err.code).toBe("HTTP_5XX")
    expect(err.retryable).toBe(true)
  })
})
