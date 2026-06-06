import { describe, expect, it } from "vitest"
import { AddCompetitorSchema, AddSiteSchema, RunAuditSchema } from "@/lib/schemas"

describe("AddSiteSchema", () => {
  it("accepts a valid URL", () => {
    expect(AddSiteSchema.parse({ url: "https://example.com" })).toEqual({
      url: "https://example.com",
    })
  })

  it("rejects a non-URL string", () => {
    expect(() => AddSiteSchema.parse({ url: "not a url" })).toThrow()
  })

  it("accepts an optional label", () => {
    const ok = AddSiteSchema.parse({
      url: "https://example.com",
      label: "My site",
    })
    expect(ok.label).toBe("My site")
  })
})

describe("RunAuditSchema", () => {
  it("accepts uuid siteId and url", () => {
    expect(
      RunAuditSchema.parse({
        siteId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        requestedUrl: "https://example.com",
      })
    ).toEqual({
      siteId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      requestedUrl: "https://example.com",
    })
  })

  it("rejects a non-uuid siteId", () => {
    expect(() =>
      RunAuditSchema.parse({
        siteId: "not-a-uuid",
        requestedUrl: "https://example.com",
      })
    ).toThrow()
  })
})

describe("AddCompetitorSchema", () => {
  it("accepts a valid URL", () => {
    expect(AddCompetitorSchema.parse({ url: "https://competitor.test" })).toEqual({
      url: "https://competitor.test",
    })
  })

  it("rejects a non-URL string", () => {
    expect(() => AddCompetitorSchema.parse({ url: "not a url" })).toThrow()
  })

  it("accepts an optional label", () => {
    const ok = AddCompetitorSchema.parse({
      url: "https://competitor.test",
      label: "Competitor A",
    })
    expect(ok.label).toBe("Competitor A")
  })

  it("rejects a label longer than 80 chars", () => {
    expect(() =>
      AddCompetitorSchema.parse({
        url: "https://competitor.test",
        label: "a".repeat(81),
      })
    ).toThrow()
  })
})
