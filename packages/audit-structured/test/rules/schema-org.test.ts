import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { schemaOrgRules } from "../../src/rules/schema-org.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("schema-org rule", () => {
  it("valid JSON-LD with @context schema.org -> pass", () => {
    const html =
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","name":"x"}</script>'
    const outcomes = schemaOrgRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("no JSON-LD -> fail with 'No structured data'", () => {
    const outcomes = schemaOrgRules.map((r) => r.run!({ $: load("<p>hi</p>"), page }))
    const fail = outcomes.find((o) => o.outcome === "fail")
    expect(fail).toBeDefined()
    if (fail?.outcome === "fail") {
      expect(fail.issues[0]?.title).toContain("No structured data")
    }
  })

  it("invalid JSON in JSON-LD -> fail", () => {
    const html = '<script type="application/ld+json">{ not json }</script>'
    const outcomes = schemaOrgRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })

  it("JSON-LD without @context -> fail", () => {
    const html = '<script type="application/ld+json">{"@type":"Article"}</script>'
    const outcomes = schemaOrgRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
})
