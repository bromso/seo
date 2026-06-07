import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import { readOgTag } from "./open-graph-facebook.js"

const REQUIRED = ["og:title", "og:image", "og:description", "og:url"] as const

export const ogLinkedinRules: Rule[] = [
  {
    id: "structured/og-linkedin-missing",
    weight: 2,
    run: ({ $ }) => {
      const missing = REQUIRED.filter((t) => !readOgTag($, t))
      if (missing.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/og-linkedin-missing",
            severity: "warn",
            title: "Missing Open Graph tags for LinkedIn",
            description: `Missing required tags: ${missing.join(", ")}.`,
            recommendation:
              'Add <meta property="og:title">, <meta property="og:image">, <meta property="og:description">, and <meta property="og:url"> in <head>.',
          }),
        ],
      }
    },
  },
]
