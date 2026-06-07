// CJS/ESM interop: robots-parser ships a CJS module; use createRequire to
// bypass NodeNext's ESM-only import semantics and get the callable function.
import { createRequire } from "node:module"
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const _require = createRequire(import.meta.url)
const robotsParser = _require("robots-parser") as (
  url: string,
  robotsTxt: string
) => { isAllowed(url: string, ua?: string): boolean | undefined }

export const robotsRules: Rule[] = [
  {
    id: "onpage/robots-disallowed",
    weight: 4,
    runAsync: async ({ page }) => {
      const robotsUrl = new URL("/robots.txt", page.finalUrl).toString()
      try {
        const res = await fetch(robotsUrl, { redirect: "follow" })
        if (res.status === 404) {
          return {
            outcome: "fail",
            issues: [
              defineIssue({
                rule: "onpage/robots-missing",
                severity: "info",
                title: "robots.txt is missing",
                description: `No robots.txt at ${robotsUrl}.`,
                recommendation: "Add a robots.txt at the site root.",
              }),
            ],
          }
        }
        if (res.status >= 400) {
          return { outcome: "skip", reason: `robots.txt HTTP ${res.status}` }
        }
        const body = await res.text()
        const robots = robotsParser(robotsUrl, body)
        const isAllowed = robots.isAllowed(page.finalUrl, "*") !== false
        if (isAllowed) return { outcome: "pass" }
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "onpage/robots-disallowed",
              severity: "error",
              title: "Page is disallowed by robots.txt",
              description: `robots.txt at ${robotsUrl} blocks ${page.finalUrl}.`,
              recommendation: "Update robots.txt if this URL should be crawlable.",
            }),
          ],
        }
      } catch (err) {
        return { outcome: "skip", reason: `failed to fetch robots.txt: ${(err as Error).message}` }
      }
    },
  },
]
