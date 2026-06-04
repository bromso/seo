import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { sitemapRules } from "../../src/rules/sitemap.js"
import { server } from "../setup.js"

const xml = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.xml`, import.meta.url), "utf8")

const basePage = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("sitemap rule", () => {
  it("sitemap present (200) -> pass", async () => {
    server.use(
      http.get("https://example.com/sitemap.xml", () =>
        HttpResponse.text(xml("sitemap"), { headers: { "Content-Type": "application/xml" } })
      )
    )
    const outcome = await sitemapRules[0]!.runAsync!({
      $: load("<html></html>"),
      page: basePage,
    })
    expect(outcome.outcome).toBe("pass")
  })

  it("sitemap missing (404) -> sitemap-missing fails", async () => {
    server.use(
      http.get("https://example.com/sitemap.xml", () => new HttpResponse(null, { status: 404 }))
    )
    const outcome = await sitemapRules[0]!.runAsync!({
      $: load("<html></html>"),
      page: basePage,
    })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues[0]?.rule).toBe("onpage/sitemap-missing")
    }
  })
})
