import { load } from "cheerio"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { faviconRules } from "../../src/rules/favicon.js"
import { server } from "../setup.js"

const basePage = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("favicon rule", () => {
  it("link[rel=icon] HEAD 200 -> pass", async () => {
    server.use(
      http.head("https://example.com/favicon.png", () => new HttpResponse(null, { status: 200 }))
    )
    const $ = load('<link rel="icon" href="/favicon.png">')
    const outcome = await faviconRules[0]!.runAsync!({ $, page: basePage })
    expect(outcome.outcome).toBe("pass")
  })

  it("no link[rel=icon] + /favicon.ico 200 -> pass", async () => {
    server.use(
      http.head("https://example.com/favicon.ico", () => new HttpResponse(null, { status: 200 }))
    )
    const outcome = await faviconRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("pass")
  })

  it("no favicon anywhere -> fail with meta/favicon-missing", async () => {
    server.use(
      http.head("https://example.com/favicon.ico", () => new HttpResponse(null, { status: 404 }))
    )
    const outcome = await faviconRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues[0]?.rule).toBe("meta/favicon-missing")
      expect(outcome.issues[0]?.severity).toBe("info")
    }
  })

  it("fetch throws -> skip", async () => {
    server.use(http.head("https://example.com/favicon.ico", () => HttpResponse.error()))
    const outcome = await faviconRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("skip")
  })
})
