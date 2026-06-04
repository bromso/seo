#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Eagerly load .env.local from the runner's package root (if present).
// In production (Docker), env comes from the container; the file won't exist.
try {
  const here = dirname(fileURLToPath(import.meta.url))
  const envFile = readFileSync(resolve(here, "..", ".env.local"), "utf8")
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "")
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // .env.local missing — fall back to process.env (container case)
}

import { buildCli } from "./cli.js"

const cli = buildCli()
cli.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`runner: ${(err as Error).message}\n`)
  process.exit(1)
})
