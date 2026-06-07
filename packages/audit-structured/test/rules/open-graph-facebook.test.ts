import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { ogFacebookRules } from "../../src/rules/open-graph-facebook.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const ogHtml = (tags: Record<string, string>) =>
  Object.entries(tags)
    .map(([k, v]) => `<meta property="${k}" content="${v}">`)
    .join("")

describe("og-facebook rule", () => {
  it("all 4 required tags present -> pass", () => {
    const html = ogHtml({
      "og:title": "x",
      "og:type": "website",
      "og:image": "https://example.com/i.png",
      "og:url": "https://example.com/",
    })
    const outcomes = ogFacebookRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("missing og:image -> fail listing missing", () => {
    const html = ogHtml({
      "og:title": "x",
      "og:type": "website",
      "og:url": "https://example.com/",
    })
    const outcomes = ogFacebookRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
    if (outcomes[0]?.outcome === "fail") {
      expect(outcomes[0].issues[0]?.rule).toBe("structured/og-facebook-missing")
      expect(outcomes[0].issues[0]?.description).toContain("og:image")
    }
  })

  it("accepts og:* via name= attribute as fallback", () => {
    const html =
      '<meta name="og:title" content="x"><meta name="og:type" content="website"><meta name="og:image" content="https://example.com/i.png"><meta name="og:url" content="https://example.com/">'
    const outcomes = ogFacebookRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })
})
