import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const LLMS_TIMEOUT_MS = 5000

export const llmsTxtRules: Rule[] = [
  {
    id: "structured/llms-txt-missing",
    weight: 1,
    runAsync: async ({ page }) => {
      const url = new URL("/llms.txt", page.finalUrl).toString()
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(LLMS_TIMEOUT_MS),
        })
        if (res.status === 200) return { outcome: "pass" }
        if (res.status === 404) {
          return {
            outcome: "fail",
            issues: [
              defineIssue({
                rule: "structured/llms-txt-missing",
                severity: "info",
                title: "llms.txt is missing",
                description: `No llms.txt at ${url}.`,
                recommendation:
                  "Add an llms.txt at the site root to help LLM crawlers discover key pages.",
              }),
            ],
          }
        }
        return { outcome: "skip", reason: `llms.txt HTTP ${res.status}` }
      } catch (err) {
        return { outcome: "skip", reason: `llms.txt fetch failed: ${(err as Error).message}` }
      }
    },
  },
]
