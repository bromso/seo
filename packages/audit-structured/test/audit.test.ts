import { readFileSync } from "node:fs"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { audit } from "../src/index.js"
import { server } from "./setup.js"

const html = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}.html`, import.meta.url), "utf8")

describe("audit-structured integration", () => {
  it("clean page -> success with score 100", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html(html("all-good"))),
      http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 200 }))
    )
    const result = await audit("https://example.com/")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("seo")
      expect(result.score).toBe(100)
    }
  })

  it("broken page -> success with multiple issues", async () => {
    server.use(
      http.get("https://example.com/broken", () => HttpResponse.html(html("all-broken"))),
      http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 404 }))
    )
    const result = await audit("https://example.com/broken")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      const ids = result.issues.map((i) => i.rule)
      expect(ids).toContain("structured/schema-org-invalid")
      expect(ids).toContain("structured/llms-txt-missing")
      expect(ids).toContain("structured/og-facebook-missing")
      expect(ids).toContain("structured/og-twitter-missing")
      expect(ids).toContain("structured/og-pinterest-missing")
      expect(ids).toContain("structured/og-linkedin-missing")
    }
  })
})
