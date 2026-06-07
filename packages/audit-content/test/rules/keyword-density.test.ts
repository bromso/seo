import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { keywordDensityRules } from "../../src/rules/keyword-density.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const repeatText = (word: string, n: number) => `<p>${Array(n).fill(word).join(" ")}</p>`

describe("keyword-density rule", () => {
  it("under 50 tokens -> skip", () => {
    const html = "<p>only a few words here on this small page</p>"
    const outcome = keywordDensityRules[0]!.run!({ $: load(html), page })
    expect(outcome.outcome).toBe("skip")
  })

  it("balanced 100-word content -> emits info-severity issues only", () => {
    const balanced = Array(100)
      .fill(0)
      .map((_, i) => `term${i % 20}`)
      .join(" ")
    const outcome = keywordDensityRules[0]!.run!({
      $: load(`<p>${balanced}</p>`),
      page,
    })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues.every((i) => i.severity === "info")).toBe(true)
    }
  })

  it("single term > 5% -> warn-severity stuffing issue", () => {
    const html = repeatText("widget", 100) + "<p>" + Array(50).fill("filler").join(" ") + "</p>"
    const outcome = keywordDensityRules[0]!.run!({ $: load(html), page })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      const warn = outcome.issues.find((i) => i.severity === "warn")
      expect(warn).toBeDefined()
      expect(warn?.title).toContain("widget")
    }
  })

  it("excludes <script> and <style> from content", () => {
    const html =
      '<script>const x = "hidden";</script><style>.a {}</style>' + repeatText("visible", 60)
    const outcome = keywordDensityRules[0]!.run!({ $: load(html), page })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues.every((i) => !i.description.includes("hidden"))).toBe(true)
    }
  })
})
