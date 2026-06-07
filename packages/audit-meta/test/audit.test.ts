import { readFileSync } from "node:fs"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { audit } from "../src/index.js"
import { server } from "./setup.js"

const html = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}.html`, import.meta.url), "utf8")

describe("audit-meta integration", () => {
  it("clean page -> success with score 100", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html(html("all-good"))),
      http.head("https://example.com/favicon.png", () => new HttpResponse(null, { status: 200 }))
    )
    const result = await audit("https://example.com/")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("on-page")
      expect(result.score).toBe(100)
      expect(result.issues).toEqual([])
    }
  })

  it("broken page -> success with issues", async () => {
    server.use(
      http.get("https://example.com/broken", () => HttpResponse.html(html("all-broken"))),
      http.head("https://example.com/favicon.ico", () => new HttpResponse(null, { status: 404 }))
    )
    const result = await audit("https://example.com/broken")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.issues.length).toBeGreaterThan(0)
      const ruleIds = result.issues.map((i) => i.rule)
      expect(ruleIds).toContain("meta/viewport-missing")
      expect(ruleIds).toContain("meta/lang-missing")
      expect(ruleIds).toContain("meta/doctype-missing")
      expect(ruleIds).toContain("meta/encoding-missing")
      expect(ruleIds).toContain("meta/favicon-missing")
    }
  })
})
