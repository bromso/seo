import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { headingRules } from "../../src/rules/headings.js"

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
  headingRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("heading rules", () => {
  it("headings-ok -> all pass", () => {
    const outcomes = runAll(load_fixture("headings-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("headings-no-h1 -> h1-missing fails", () => {
    const outcomes = runAll(load_fixture("headings-no-h1"))
    expect(
      outcomes.some((o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/h1-missing")
    ).toBe(true)
  })

  it("headings-multiple-h1 -> h1-multiple fails", () => {
    const outcomes = runAll(load_fixture("headings-multiple-h1"))
    expect(
      outcomes.some((o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/h1-multiple")
    ).toBe(true)
  })

  it("headings-broken-order -> heading-order-broken fails", () => {
    const outcomes = runAll(load_fixture("headings-broken-order"))
    expect(
      outcomes.some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/heading-order-broken"
      )
    ).toBe(true)
  })
})
