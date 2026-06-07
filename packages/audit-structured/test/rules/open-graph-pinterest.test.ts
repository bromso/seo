import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { ogPinterestRules } from "../../src/rules/open-graph-pinterest.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("og-pinterest rule", () => {
  it("og:image + og:description present -> pass", () => {
    const html =
      '<meta property="og:image" content="https://example.com/i.png"><meta property="og:description" content="d">'
    const outcomes = ogPinterestRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("missing og:description -> fail", () => {
    const html = '<meta property="og:image" content="https://example.com/i.png">'
    const outcomes = ogPinterestRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
  })
})
