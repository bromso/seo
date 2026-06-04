import { describe, expect, it } from "vitest"
import { parseArgs } from "../src/args.js"

describe("parseArgs", () => {
  it("requires a URL", () => {
    expect(() => parseArgs(["node", "audit-cli"])).toThrow(/url is required/i)
  })
  it("rejects non-URL strings", () => {
    expect(() => parseArgs(["node", "audit-cli", "not a url"])).toThrow()
  })
  it("accepts a valid URL", () => {
    const args = parseArgs(["node", "audit-cli", "https://example.com"])
    expect(args.url).toBe("https://example.com")
    expect(args.only).toBeUndefined()
    expect(args.json).toBe(false)
    expect(args.pretty).toBe(false)
    expect(args.formFactor).toBe("mobile")
    expect(args.timeout).toBe(30_000)
  })
  it("parses --only with comma-separated categories", () => {
    const args = parseArgs([
      "node",
      "audit-cli",
      "https://example.com",
      "--only",
      "performance,seo",
    ])
    expect(args.only).toEqual(["performance", "seo"])
  })
  it("rejects unknown categories in --only", () => {
    expect(() => parseArgs(["node", "audit-cli", "https://example.com", "--only", "nope"])).toThrow(
      /unknown category/i
    )
  })
  it("--json and --pretty are mutually exclusive", () => {
    expect(() =>
      parseArgs(["node", "audit-cli", "https://example.com", "--json", "--pretty"])
    ).toThrow(/mutually exclusive/i)
  })
})
