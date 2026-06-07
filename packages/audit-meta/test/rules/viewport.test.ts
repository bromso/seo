import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { viewportRules } from "../../src/rules/viewport.js"

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
  viewportRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("viewport rule", () => {
  it("viewport with width=device-width -> pass", () => {
    const outcomes = runAll(fx("viewport-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("missing viewport meta -> fail with meta/viewport-missing", () => {
    const outcomes = runAll(fx("viewport-missing"))
    const fail = outcomes.find((o) => o.outcome === "fail")
    expect(fail).toBeDefined()
    if (fail?.outcome === "fail") {
      expect(fail.issues[0]?.rule).toBe("meta/viewport-missing")
      expect(fail.issues[0]?.severity).toBe("error")
    }
  })

  it("viewport without width=device-width -> fail with meta/viewport-missing", () => {
    const outcomes = runAll(fx("viewport-no-device-width"))
    const fail = outcomes.find((o) => o.outcome === "fail")
    expect(fail).toBeDefined()
  })
})
