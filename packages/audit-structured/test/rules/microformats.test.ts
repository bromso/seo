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
  it("always passes — no score impact regardless of microformat presence", () => {
    expect(
      microformatsRules.map((r) =>
        r.run!({
          $: load('<div class="h-card"><span class="p-name">Jane</span></div>'),
          page,
        })
      )[0]?.outcome
    ).toBe("pass")
  })

  it("passes when no microformats are present", () => {
    expect(microformatsRules.map((r) => r.run!({ $: load("<p>x</p>"), page }))[0]?.outcome).toBe(
      "pass"
    )
  })
})
