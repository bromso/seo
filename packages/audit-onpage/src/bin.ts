#!/usr/bin/env node
import { audit } from "./index.js"

const url = process.argv[2]
if (!url) {
  console.error("usage: audit-onpage <url>")
  process.exit(2)
}
const result = await audit(url)
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === "success" ? 0 : 1)
