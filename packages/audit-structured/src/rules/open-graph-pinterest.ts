import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import { readOgTag } from "./open-graph-facebook.js"

const REQUIRED = ["og:image", "og:description"] as const

export const ogPinterestRules: Rule[] = [
  {
    id: "structured/og-pinterest-missing",
    weight: 2,
    run: ({ $ }) => {
      const missing = REQUIRED.filter((t) => !readOgTag($, t))
      if (missing.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/og-pinterest-missing",
            severity: "warn",
            title: "Missing Open Graph tags for Pinterest",
            description: `Missing required tags: ${missing.join(", ")}.`,
            recommendation:
              'Add <meta property="og:image"> (at least 600px wide) and <meta property="og:description"> in <head>.',
          }),
        ],
      }
    },
  },
]
