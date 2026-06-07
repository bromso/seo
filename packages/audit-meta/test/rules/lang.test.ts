import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { langRules } from "../../src/rules/lang.js"

const fx = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.html`, import.meta.url), "utf8")

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const runAll = (html: string) =>
  langRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("lang rule", () => {
  it("valid BCP-47 lang -> pass", () => {
    expect(runAll(fx("lang-ok")).every((o) => o.outcome === "pass")).toBe(true)
  })
  it("missing lang -> fail", () => {
    const outcomes = runAll(fx("lang-missing"))
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
  it("malformed lang -> fail", () => {
    const outcomes = runAll(fx("lang-malformed"))
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
})
