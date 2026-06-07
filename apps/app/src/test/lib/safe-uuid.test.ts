import { describe, expect, it } from "vitest"
import { safeRandomUUID } from "@/lib/safe-uuid"

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("safeRandomUUID", () => {
  it("returns a valid UUID v4 string when crypto.randomUUID is available", () => {
    const id = safeRandomUUID()
    expect(id).toMatch(UUID_V4_RE)
  })

  it("returns a valid UUID v4 string when crypto.randomUUID is absent (insecure-context fallback)", () => {
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    })
    try {
      const id = safeRandomUUID()
      expect(id).toMatch(UUID_V4_RE)
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: original,
      })
    }
  })

  it("produces unique values across calls", () => {
    const a = safeRandomUUID()
    const b = safeRandomUUID()
    expect(a).not.toBe(b)
  })
})
