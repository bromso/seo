import { readFileSync } from "node:fs"
import { AuditResultSchema } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { audit } from "../src/index.js"

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../__fixtures__/${name}.json`, import.meta.url), "utf8"))

describe("audit-pwa", () => {
  it("good LHR -> success with high score", async () => {
    const r = await audit("https://example.com", { lighthouseResult: load("lhr-good") })
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    if (r.status === "success") {
      expect(r.category).toBe("pwa")
      expect(r.score).toBeGreaterThanOrEqual(90)
    }
  })

  it("bad LHR -> success with low score and issues", async () => {
    const r = await audit("https://example.com", { lighthouseResult: load("lhr-bad") })
    if (r.status === "success") {
      expect(r.score).toBeLessThan(40)
      expect(r.issues.some((i) => i.rule === "pwa/installable-manifest")).toBe(true)
      expect(r.issues.some((i) => i.rule === "pwa/service-worker")).toBe(true)
    }
  })

  it("LHR without pwa category -> partial with reason", async () => {
    const r = await audit("https://example.com", { lighthouseResult: load("lhr-no-pwa") })
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    expect(r.status).toBe("partial")
    if (r.status === "partial") {
      expect(r.partialReasons).toContain("pwa-category-not-emitted-by-lighthouse")
      expect(r.score).toBe(0)
    }
  })
})
