import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { httpsRules } from "../../src/rules/https.js"

const mk = (finalUrl: string, html: string) => ({
  requestedUrl: finalUrl,
  finalUrl,
  status: 200,
  contentType: "text/html",
  html,
})

describe("https rules", () => {
  it("https + no http resources -> all pass", () => {
    const page = mk("https://example.com/", '<img src="https://cdn.example.com/x.png">')
    const outcomes = httpsRules.map((r) => r.run!({ $: load(page.html), page }))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("http scheme -> https-scheme fails", () => {
    const page = mk("http://example.com/", "<html></html>")
    const outcomes = httpsRules.map((r) => r.run!({ $: load(page.html), page }))
    expect(
      outcomes.some((o) => o.outcome === "fail" && o.issues[0]?.rule === "meta/https-scheme")
    ).toBe(true)
  })

  it("https with http img src -> mixed-content fails", () => {
    const page = mk("https://example.com/", '<img src="http://insecure.test/a.png">')
    const outcomes = httpsRules.map((r) => r.run!({ $: load(page.html), page }))
    expect(
      outcomes.some((o) => o.outcome === "fail" && o.issues[0]?.rule === "meta/https-mixed-content")
    ).toBe(true)
  })

  it("ignores http://localhost as mixed content", () => {
    const page = mk("https://example.com/", '<img src="http://localhost:3000/dev.png">')
    const outcomes = httpsRules.map((r) => r.run!({ $: load(page.html), page }))
    expect(
      outcomes.every(
        (o) => !(o.outcome === "fail" && o.issues[0]?.rule === "meta/https-mixed-content")
      )
    ).toBe(true)
  })
})
