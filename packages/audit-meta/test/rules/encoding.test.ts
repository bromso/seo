import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { encodingRules } from "../../src/rules/encoding.js"

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
  encodingRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("encoding rule", () => {
  it("utf-8 charset -> pass", () => {
    expect(runAll(fx("encoding-utf8")).every((o) => o.outcome === "pass")).toBe(true)
  })
  it("http-equiv content-type utf-8 -> pass", () => {
    expect(runAll(fx("encoding-http-equiv")).every((o) => o.outcome === "pass")).toBe(true)
  })
  it("utf-16 charset -> fail", () => {
    expect(runAll(fx("encoding-utf16")).some((o) => o.outcome === "fail")).toBe(true)
  })
  it("missing charset -> fail", () => {
    expect(runAll(fx("encoding-missing")).some((o) => o.outcome === "fail")).toBe(true)
  })
})
