import { load } from "cheerio"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { llmsTxtRules } from "../../src/rules/llms-txt.js"
import { server } from "../setup.js"

const basePage = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("llms-txt rule", () => {
  it("HEAD /llms.txt 200 -> pass", async () => {
    server.use(
      http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 200 }))
    )
    const outcome = await llmsTxtRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("pass")
  })

  it("HEAD /llms.txt 404 -> fail with info severity", async () => {
    server.use(
      http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 404 }))
    )
    const outcome = await llmsTxtRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues[0]?.rule).toBe("structured/llms-txt-missing")
      expect(outcome.issues[0]?.severity).toBe("info")
    }
  })

  it("HEAD /llms.txt 500 -> skip", async () => {
    server.use(
      http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 500 }))
    )
    const outcome = await llmsTxtRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("skip")
  })
})
