import { readFileSync } from "node:fs"
import { AuditResultSchema } from "@repo/audit-core"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { audit } from "../src/index.js"
import { server } from "./setup.js"

const html = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}.html`, import.meta.url), "utf8")

describe("audit-onpage end-to-end", () => {
  it("scores a clean page at 100", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html(html("full-good"))),
      http.get("https://example.com/robots.txt", () =>
        HttpResponse.text("User-agent: *\nAllow: /\n")
      ),
      http.get("https://example.com/sitemap.xml", () =>
        HttpResponse.xml(
          `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>`
        )
      )
    )
    const r = await audit("https://example.com/")
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    if (r.status === "success") {
      expect(r.category).toBe("on-page")
      expect(r.score).toBe(100)
      expect(r.issues).toHaveLength(0)
    } else {
      throw new Error(`expected success, got ${r.status}`)
    }
  })

  it("scores a broken page below 70 with multiple issues", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html(html("full-bad"))),
      http.get("https://example.com/robots.txt", () =>
        HttpResponse.text("User-agent: *\nAllow: /\n")
      ),
      http.get("https://example.com/sitemap.xml", () => new HttpResponse(null, { status: 404 }))
    )
    const r = await audit("https://example.com/")
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    if (r.status === "success") {
      expect(r.score).toBeLessThan(70)
      expect(r.issues.length).toBeGreaterThanOrEqual(4)
    } else {
      throw new Error(`expected success, got ${r.status}`)
    }
  })
})
