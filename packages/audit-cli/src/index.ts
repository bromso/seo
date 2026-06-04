#!/usr/bin/env node
import { audit as auditBP } from "@repo/audit-best-practices"
import { AuditResultSchema } from "@repo/audit-core"
import { audit as auditOnpage } from "@repo/audit-onpage"
import { audit as auditPerf } from "@repo/audit-perf"
import { audit as auditPwa } from "@repo/audit-pwa"
import { audit as auditSeo } from "@repo/audit-seo"
import { runLighthouse } from "@repo/lighthouse-runner"
import { aggregate } from "./aggregate.js"
import { parseArgs } from "./args.js"
import { renderJson } from "./render/json.js"
import { renderPretty } from "./render/pretty.js"

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>
  try {
    args = parseArgs(process.argv)
  } catch (err) {
    process.stderr.write(`audit-cli: ${(err as Error).message}\n`)
    return 2
  }

  const useJson = args.json || (!process.stdout.isTTY && !args.pretty)

  const results = await aggregate(
    args.url,
    {
      timeoutMs: args.timeout,
      formFactor: args.formFactor,
      ...(args.only !== undefined ? { only: args.only } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    },
    {
      runLighthouse: (u, o) => runLighthouse(u, o),
      perf: (u, o) => auditPerf(u, o),
      seo: (u, o) => auditSeo(u, o),
      bestPractices: (u, o) => auditBP(u, o),
      pwa: (u, o) => auditPwa(u, o),
      onpage: (u, o) => auditOnpage(u, o),
    }
  )

  for (const r of results) AuditResultSchema.parse(r)

  if (useJson) {
    process.stdout.write(renderJson(results))
    process.stdout.write("\n")
  } else {
    process.stdout.write(renderPretty(results, { color: !args.noColor }))
  }

  return results.every((r) => r.status === "success") ? 0 : 1
}

main().then((code) => process.exit(code))
