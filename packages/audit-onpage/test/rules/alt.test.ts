import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { altRules } from "../../src/rules/alt.js"

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
  altRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("alt rules", () => {
  it("alt-ok -> all pass", () => {
    const outcomes = runAll(load_fixture("alt-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("alt-missing -> alt-missing fails with count 2", () => {
    const outcomes = runAll(load_fixture("alt-missing"))
    const failing = outcomes.find(
      (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/alt-missing"
    )
    expect(failing).toBeDefined()
    if (failing?.outcome === "fail") {
      expect(failing.issues[0]?.count).toBe(2)
    }
  })
})
