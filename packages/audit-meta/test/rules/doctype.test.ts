import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { doctypeRules } from "../../src/rules/doctype.js"

const mkPage = (html: string) => ({
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html,
})

const runAll = (html: string) =>
  doctypeRules.map((r) => r.run!({ $: load(html), page: mkPage(html) }))

describe("doctype rule", () => {
  it("HTML5 doctype -> pass", () => {
    const outcomes = runAll("<!DOCTYPE html><html><head></head><body></body></html>")
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })
  it("lowercase doctype -> pass", () => {
    const outcomes = runAll("<!doctype html><html></html>")
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })
  it("XHTML doctype -> fail", () => {
    const outcomes = runAll(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" ""><html></html>'
    )
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
  it("missing doctype -> fail", () => {
    const outcomes = runAll("<html><head></head><body></body></html>")
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
})
