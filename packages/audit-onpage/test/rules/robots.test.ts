import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { robotsRules } from "../../src/rules/robots.js"
import { server } from "../setup.js"

const txt = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.txt`, import.meta.url), "utf8")

const basePage = {
  requestedUrl: "https://example.com/private/page",
  finalUrl: "https://example.com/private/page",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("robots rule", () => {
  it("disallowed URL -> rule fires", async () => {
    server.use(
      http.get("https://example.com/robots.txt", () => HttpResponse.text(txt("robots-disallow")))
    )
    const outcome = await robotsRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues[0]?.rule).toBe("onpage/robots-disallowed")
    }
  })

  it("allowed URL -> pass", async () => {
    server.use(
      http.get("https://example.com/robots.txt", () => HttpResponse.text(txt("robots-allow")))
    )
    const outcome = await robotsRules[0]!.runAsync!({
      $: load("<html></html>"),
      page: { ...basePage, finalUrl: "https://example.com/" },
    })
    expect(outcome.outcome).toBe("pass")
  })

  it("missing robots.txt (404) -> robots-missing fires", async () => {
    server.use(
      http.get("https://example.com/robots.txt", () => new HttpResponse(null, { status: 404 }))
    )
    const outcome = await robotsRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    if (outcome.outcome === "fail") {
      expect(outcome.issues[0]?.rule).toBe("onpage/robots-missing")
    }
  })
})
