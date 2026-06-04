import { AuditFailure } from "@repo/audit-core"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { fetchPage } from "../src/fetch.js"
import { server } from "./setup.js"

describe("fetchPage", () => {
  it("returns HTML body and finalUrl on 200", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html("<html><title>ok</title></html>"))
    )
    const page = await fetchPage("https://example.com/")
    expect(page.status).toBe(200)
    expect(page.html).toContain("<title>ok</title>")
    expect(page.finalUrl).toBe("https://example.com/")
  })

  it("follows up to 5 redirects and reports final URL", async () => {
    server.use(
      http.get("https://example.com/a", () => HttpResponse.redirect("https://example.com/b", 301)),
      http.get("https://example.com/b", () => HttpResponse.html("<html><body>final</body></html>"))
    )
    const page = await fetchPage("https://example.com/a")
    expect(page.finalUrl).toBe("https://example.com/b")
    expect(page.html).toContain("final")
  })

  it("throws AuditFailure HTTP_4XX on 404", async () => {
    server.use(
      http.get("https://example.com/missing", () => new HttpResponse(null, { status: 404 }))
    )
    await expect(fetchPage("https://example.com/missing")).rejects.toMatchObject({
      code: "HTTP_4XX",
      retryable: false,
    })
  })

  it("throws AuditFailure HTTP_5XX on 503", async () => {
    server.use(http.get("https://example.com/down", () => new HttpResponse(null, { status: 503 })))
    await expect(fetchPage("https://example.com/down")).rejects.toMatchObject({
      code: "HTTP_5XX",
      retryable: true,
    })
  })
})
