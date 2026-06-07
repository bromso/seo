import { readFileSync } from "node:fs"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { audit } from "../src/index.js"

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const html = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}.html`, import.meta.url), "utf8")

describe("audit-content integration", () => {
  it("short page -> success with skipped rule (score 100)", async () => {
    server.use(http.get("https://example.com/short", () => HttpResponse.html(html("short"))))
    const result = await audit("https://example.com/short")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("seo")
      expect(result.score).toBe(100)
    }
  })
})
