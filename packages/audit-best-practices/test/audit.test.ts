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

describe("audit-best-practices", () => {
  it("projects a high-scoring LHR to a success result with score === 100 and no issues", async () => {
    const result = await audit("https://example.com", { lighthouseResult: lhrGood })
    expect(() => AuditResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("best-practices")
      expect(result.score).toBe(100)
      expect(result.issues).toHaveLength(0)
    }
  })

  it("projects a low-scoring LHR with issues for failing audits", async () => {
    const result = await audit("https://example.com", { lighthouseResult: lhrBad })
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.issues.some((i) => i.rule === "bp/errors-in-console")).toBe(true)
      expect(result.issues.some((i) => i.rule === "bp/no-vulnerable-libraries")).toBe(true)
    }
  })
})
