import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { ogLinkedinRules } from "../../src/rules/open-graph-linkedin.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("og-linkedin rule", () => {
  it("all 4 required tags present -> pass", () => {
    const html =
      '<meta property="og:title" content="x"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.png"><meta property="og:url" content="https://example.com/">'
    const outcomes = ogLinkedinRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("missing og:url -> fail", () => {
    const html =
      '<meta property="og:title" content="x"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.png">'
    const outcomes = ogLinkedinRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
  })
})
