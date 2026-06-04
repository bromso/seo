import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { titleRules } from "../../src/rules/title.js"

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
  titleRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("title rules", () => {
  it("ok title -> all pass", () => {
    const outcomes = runAll(load_fixture("title-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("missing title -> title-missing fails", () => {
    const outcomes = runAll(load_fixture("title-missing"))
    const missing = outcomes.find(
      (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/title-missing"
    )
    expect(missing).toBeDefined()
  })

  it("too-short title -> title-too-short fails", () => {
    const outcomes = runAll(load_fixture("title-too-short"))
    expect(
      outcomes.some((o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/title-too-short")
    ).toBe(true)
  })

  it("too-long title -> title-too-long fails", () => {
    const outcomes = runAll(load_fixture("title-too-long"))
    expect(
      outcomes.some((o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/title-too-long")
    ).toBe(true)
  })
})
