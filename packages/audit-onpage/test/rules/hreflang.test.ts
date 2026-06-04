import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { hreflangRules } from "../../src/rules/hreflang.js"

const load_fixture = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.html`, import.meta.url), "utf8")

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const runAll = (html: string) =>
  hreflangRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("hreflang rules", () => {
  it("hreflang-ok -> all pass", () => {
    const outcomes = runAll(load_fixture("hreflang-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("hreflang-malformed -> hreflang-malformed fails", () => {
    const outcomes = runAll(load_fixture("hreflang-malformed"))
    expect(
      outcomes.some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/hreflang-malformed"
      )
    ).toBe(true)
  })
})
