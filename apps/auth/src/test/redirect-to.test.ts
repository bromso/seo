import { describe, expect, it } from "vitest"
import { parseAndValidateRedirectTo } from "@/lib/redirect-to"

const ALLOWLIST = ["http://app.localhost:3001", "https://app.brand.com"]

describe("parseAndValidateRedirectTo", () => {
  it("returns the URL for an allowlisted origin", () => {
    expect(parseAndValidateRedirectTo("http://app.localhost:3001/dashboard", ALLOWLIST)).toBe(
      "http://app.localhost:3001/dashboard"
    )
    expect(parseAndValidateRedirectTo("https://app.brand.com/dashboard/runs/abc", ALLOWLIST)).toBe(
      "https://app.brand.com/dashboard/runs/abc"
    )
  })

  it("returns null for foreign origins", () => {
    expect(parseAndValidateRedirectTo("https://evil.example/steal", ALLOWLIST)).toBeNull()
    expect(parseAndValidateRedirectTo("http://app.localhost:9999/dashboard", ALLOWLIST)).toBeNull()
  })

  it("returns null for malformed input", () => {
    expect(parseAndValidateRedirectTo("not a url", ALLOWLIST)).toBeNull()
    expect(parseAndValidateRedirectTo("javascript:alert(1)", ALLOWLIST)).toBeNull()
  })

  it("returns null for undefined input", () => {
    expect(parseAndValidateRedirectTo(undefined, ALLOWLIST)).toBeNull()
  })
})
