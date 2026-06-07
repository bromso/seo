import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { ogTwitterRules } from "../../src/rules/open-graph-twitter.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("og-twitter rule", () => {
  it("all twitter:* tags present -> pass", () => {
    const html =
      '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="x"><meta name="twitter:description" content="d"><meta name="twitter:image" content="https://example.com/i.png">'
    const outcomes = ogTwitterRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("twitter:card + og:* fallbacks -> pass", () => {
    const html =
      '<meta name="twitter:card" content="summary_large_image"><meta property="og:title" content="x"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.png">'
    const outcomes = ogTwitterRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("missing twitter:card -> fail", () => {
    const html =
      '<meta property="og:title" content="x"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.png">'
    const outcomes = ogTwitterRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
  })
})
