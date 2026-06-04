import { describe, expect, it } from "vitest"
import { runLighthouse } from "../src/index.js"
import { startServer } from "./server.js"

const enabled = process.env.RUN_INTEGRATION === "1"

;(enabled ? describe : describe.skip)("runLighthouse — integration", () => {
  it("audits a local page and returns categories", async () => {
    const server = await startServer()
    try {
      const lhr = await runLighthouse(server.url, { timeoutMs: 60_000 })
      expect(lhr.categories.performance).toBeDefined()
      expect(lhr.categories.seo).toBeDefined()
      expect(lhr.categories["best-practices"]).toBeDefined()
      expect(typeof lhr.audits).toBe("object")
    } finally {
      await server.close()
    }
  }, 90_000)
})
