import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { microformatsRules } from "../../src/rules/microformats.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("microformats rule", () => {
  it("h-card detected -> fail with info severity issue", () => {
    const html = '<div class="h-card"><span class="p-name">Jane</span></div>'
    const outcomes = microformatsRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
    if (outcomes[0]?.outcome === "fail") {
      expect(outcomes[0].issues[0]?.severity).toBe("info")
      expect(outcomes[0].issues[0]?.title).toContain("Microformats detected")
      expect(outcomes[0].issues[0]?.description).toContain("h-card")
    }
  })

  it("no microformats -> pass", () => {
    const outcomes = microformatsRules.map((r) => r.run!({ $: load("<p>x</p>"), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("ignores partial-match classes like h-card-wrapper", () => {
    const html = '<div class="h-card-wrapper"></div>'
    const outcomes = microformatsRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })
})
