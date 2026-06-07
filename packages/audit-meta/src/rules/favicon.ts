import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const FAVICON_TIMEOUT_MS = 5000

export const faviconRules: Rule[] = [
  {
    id: "meta/favicon-missing",
    weight: 1,
    runAsync: async ({ $, page }) => {
      const link = $("head link[rel~='icon']").first()
      const href = link.attr("href")
      const target = href
        ? new URL(href, page.finalUrl).toString()
        : new URL("/favicon.ico", page.finalUrl).toString()
      try {
        const res = await fetch(target, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(FAVICON_TIMEOUT_MS),
        })
        if (res.status === 200) return { outcome: "pass" }
        if (res.status === 404) {
          return {
            outcome: "fail",
            issues: [
              defineIssue({
                rule: "meta/favicon-missing",
                severity: "info",
                title: "Favicon not found",
                description: `HEAD ${target} returned 404.`,
                recommendation:
                  'Add <link rel="icon" href="/favicon.ico"> and serve the file at the site root.',
              }),
            ],
          }
        }
        return { outcome: "skip", reason: `favicon HTTP ${res.status}` }
      } catch (err) {
        return { outcome: "skip", reason: `favicon fetch failed: ${(err as Error).message}` }
      }
    },
  },
]
