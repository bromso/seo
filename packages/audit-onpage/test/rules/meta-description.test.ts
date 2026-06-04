import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { metaDescriptionRules } from "../../src/rules/meta-description.js"

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
  metaDescriptionRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("meta-description rules", () => {
  it("meta-ok -> all pass", () => {
    const outcomes = runAll(load_fixture("meta-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("meta-missing -> meta-description-missing fails", () => {
    const outcomes = runAll(load_fixture("meta-missing"))
    expect(
      outcomes.some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/meta-description-missing"
      )
    ).toBe(true)
  })

  it("meta-too-long -> meta-description-too-long fails", () => {
    const outcomes = runAll(load_fixture("meta-too-long"))
    expect(
      outcomes.some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/meta-description-too-long"
      )
    ).toBe(true)
  })
})
