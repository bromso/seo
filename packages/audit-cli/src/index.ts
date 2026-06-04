#!/usr/bin/env node
import { parseArgs } from "./args.js"

try {
  const args = parseArgs(process.argv)
  console.error(JSON.stringify(args, null, 2))
  process.exit(0)
} catch (err) {
  console.error(`audit-cli: ${(err as Error).message}`)
  process.exit(2)
}
