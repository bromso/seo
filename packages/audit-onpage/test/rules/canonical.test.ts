import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { canonicalRules } from "../../src/rules/canonical.js"

const load_fixture = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.html`, import.meta.url), "utf8")

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const runAll = (html: string, finalUrl = "https://example.com/") =>
  canonicalRules.map((r) => r.run!({ $: load(html), page: { ...page, finalUrl, html } }))

describe("canonical rules", () => {
  it("canonical-ok -> all pass", () => {
    const outcomes = runAll(load_fixture("canonical-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("canonical-missing -> canonical-missing fails", () => {
    const outcomes = runAll(load_fixture("canonical-missing"))
    expect(
      outcomes.some((o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/canonical-missing")
    ).toBe(true)
  })

  it("canonical-elsewhere -> canonical-points-elsewhere fails", () => {
    const outcomes = runAll(load_fixture("canonical-elsewhere"))
    expect(
      outcomes.some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/canonical-points-elsewhere"
      )
    ).toBe(true)
  })
})
