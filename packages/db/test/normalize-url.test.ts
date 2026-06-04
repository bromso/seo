import { describe, expect, it } from "vitest"
import { canonicalUrl } from "../src/normalize-url.js"

describe("canonicalUrl", () => {
  it("adds https:// when scheme is missing", () => {
    expect(canonicalUrl("example.com")).toBe("https://example.com/")
  })

  it("preserves http:// when explicitly given", () => {
    expect(canonicalUrl("http://example.com")).toBe("http://example.com/")
  })

  it("lowercases the host", () => {
    expect(canonicalUrl("Example.COM/Path")).toBe("https://example.com/Path")
  })

  it("strips fragments", () => {
    expect(canonicalUrl("https://example.com/page#section")).toBe("https://example.com/page")
  })

  it("strips userinfo", () => {
    expect(canonicalUrl("https://user:pass@example.com/")).toBe("https://example.com/")
  })

  it("strips utm_* tracking params", () => {
    expect(canonicalUrl("https://example.com/?utm_source=x&utm_medium=y&q=keep")).toBe(
      "https://example.com/?q=keep"
    )
  })

  it("strips gclid and fbclid", () => {
    expect(canonicalUrl("https://example.com/?gclid=abc&fbclid=def")).toBe("https://example.com/")
  })

  it("removes trailing slash on non-root paths", () => {
    expect(canonicalUrl("https://example.com/path/")).toBe("https://example.com/path")
  })

  it("keeps trailing slash on root", () => {
    expect(canonicalUrl("https://example.com/")).toBe("https://example.com/")
  })

  it("preserves explicit port", () => {
    expect(canonicalUrl("https://example.com:8443/api")).toBe("https://example.com:8443/api")
  })

  it("throws on invalid URL", () => {
    expect(() => canonicalUrl("not a url at all")).toThrow(/canonicalUrl/)
  })

  it("handles IDN by leaving punycode/host as-is (lowercased)", () => {
    expect(canonicalUrl("https://EXÄMPLE.com/")).toMatch(/^https:\/\/[a-z0-9.\-x]+\/$/)
  })
})
