import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

export const sitemapRules: Rule[] = [
  {
    id: "onpage/sitemap-missing",
    weight: 2,
    runAsync: async ({ page }) => {
      const url = new URL("/sitemap.xml", page.finalUrl).toString()
      try {
        const res = await fetch(url, { redirect: "follow" })
        if (res.status === 200) return { outcome: "pass" }
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "onpage/sitemap-missing",
              severity: "info",
              title: "sitemap.xml is missing",
              description: `No sitemap at ${url} (HTTP ${res.status}).`,
              recommendation:
                "Add a sitemap.xml at the site root and reference it from robots.txt.",
            }),
          ],
        }
      } catch (err) {
        return { outcome: "skip", reason: `failed to fetch sitemap: ${(err as Error).message}` }
      }
    },
  },
]
