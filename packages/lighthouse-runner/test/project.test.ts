import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { project } from "../src/project.js"

const fixturesUrl = new URL("../__fixtures__/", import.meta.url)
const lhrSuccess = JSON.parse(
  readFileSync(new URL("lhr-success.json", fixturesUrl), "utf8")
) as unknown

describe("project()", () => {
  it("returns the trimmed RawLighthouseResult shape from a full LHR", () => {
    const result = project(lhrSuccess as never)
    expect(result.requestedUrl).toBeTypeOf("string")
    expect(result.finalUrl).toBeTypeOf("string")
    expect(result.categories.performance.score).toBeTypeOf("number")
    expect(result.categories.seo).toBeDefined()
    expect(result.categories["best-practices"]).toBeDefined()
    // pwa may or may not be present depending on lighthouse version
    expect(typeof result.audits).toBe("object")
  })

  it("preserves runtimeError when present", () => {
    const withErr = {
      ...(lhrSuccess as object),
      runtimeError: { code: "ERRORED_DOCUMENT_REQUEST", message: "DNS" },
    }
    const result = project(withErr as never)
    expect(result.runtimeError?.code).toBe("ERRORED_DOCUMENT_REQUEST")
  })
})
