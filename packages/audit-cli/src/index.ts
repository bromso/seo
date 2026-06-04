#!/usr/bin/env node
import { AuditResultSchema } from "@repo/audit-core"
import { parseArgs } from "./args.js"
import { aggregate, defaultPackages } from "./lib.js"
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
    defaultPackages
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
