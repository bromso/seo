import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, "..", ".env.local")

let content: string
try {
  content = readFileSync(envPath, "utf8")
} catch {
  // .env.local not found — skip silently; vars may already be set in the shell
  content = ""
}

for (const line of content.split("\n")) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) continue
  const eqIdx = trimmed.indexOf("=")
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  const value = trimmed.slice(eqIdx + 1).trim()
  if (key && !(key in process.env)) {
    process.env[key] = value
  }
}
