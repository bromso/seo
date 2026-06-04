import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { AuditResultSchema } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { startServer } from "./server.js"

const enabled = process.env.RUN_INTEGRATION === "1"
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url))

;(enabled ? describe : describe.skip)("audit-cli — integration", () => {
  it("audits a local page and returns 5 valid AuditResults", async () => {
    const server = await startServer()
    try {
      const result = await runCli([server.url, "--json"])
      expect([0, 1]).toContain(result.code)
      const parsed = JSON.parse(result.stdout) as unknown[]
      expect(parsed).toHaveLength(5)
      for (const r of parsed) expect(() => AuditResultSchema.parse(r)).not.toThrow()
    } finally {
      await server.close()
    }
  }, 120_000)

  it("exits 2 for an invalid URL", async () => {
    const result = await runCli(["not a url"])
    expect(result.code).toBe(2)
  })
})

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString()
    })
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}
