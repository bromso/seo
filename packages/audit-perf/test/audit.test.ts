import { readFileSync } from "node:fs"
import { AuditResultSchema } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { audit } from "../src/index.js"

const lhrGood = JSON.parse(
  readFileSync(new URL("../__fixtures__/lhr-good.json", import.meta.url), "utf8")
)
const lhrBad = JSON.parse(
  readFileSync(new URL("../__fixtures__/lhr-bad.json", import.meta.url), "utf8")
)

describe("audit-perf", () => {
  it("projects a high-scoring LHR to a success result with score >= 90", async () => {
    const result = await audit("https://example.com", { lighthouseResult: lhrGood })
    expect(() => AuditResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("performance")
      expect(result.score).toBeGreaterThanOrEqual(90)
    }
  })

  it("projects a low-scoring LHR with issues for failing audits", async () => {
    const result = await audit("https://example.com", { lighthouseResult: lhrBad })
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.score).toBeLessThan(50)
      expect(result.issues.length).toBeGreaterThan(0)
      const lcp = result.issues.find((i) => i.rule === "perf/lcp")
      expect(lcp).toBeDefined()
      expect(lcp?.severity).toBe("error")
    }
  })
})
