import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

export const canonicalRules: Rule[] = [
  {
    id: "onpage/canonical-missing",
    weight: 3,
    run: ({ $ }) => {
      const href = $('head > link[rel="canonical"]').attr("href")?.trim() ?? ""
      if (href.length > 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/canonical-missing",
            severity: "info",
            title: "Missing canonical link",
            description: 'No <link rel="canonical"> on the page.',
            recommendation: "Add a canonical link pointing to the preferred URL for this content.",
          }),
        ],
      }
    },
  },
  {
    id: "onpage/canonical-points-elsewhere",
    weight: 3,
    run: ({ $, page }) => {
      const href = $('head > link[rel="canonical"]').attr("href")?.trim() ?? ""
      if (href.length === 0) return { outcome: "pass" }
      const resolved = new URL(href, page.finalUrl).toString()
      const final = new URL(page.finalUrl).toString()
      if (resolved === final) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/canonical-points-elsewhere",
            severity: "warn",
            title: "Canonical link points to a different URL",
            description: `Canonical href "${resolved}" differs from page URL "${final}".`,
            recommendation:
              "If intentional (e.g. duplicate content), this is fine. Otherwise update the canonical.",
          }),
        ],
      }
    },
  },
]
