import { defineIssue } from "@repo/audit-core"
import type { Rule, RuleContext } from "@repo/audit-html-core"

export function readOgTag($: RuleContext["$"], tag: string): string | null {
  const byProperty = $(`meta[property="${tag}"]`).first().attr("content")
  if (byProperty) return byProperty
  const byName = $(`meta[name="${tag}"]`).first().attr("content")
  return byName ?? null
}

const REQUIRED = ["og:title", "og:type", "og:image", "og:url"] as const

export const ogFacebookRules: Rule[] = [
  {
    id: "structured/og-facebook-missing",
    weight: 2,
    run: ({ $ }) => {
      const missing = REQUIRED.filter((t) => !readOgTag($, t))
      if (missing.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/og-facebook-missing",
            severity: "warn",
            title: "Missing Open Graph tags for Facebook",
            description: `Missing required tags: ${missing.join(", ")}.`,
            recommendation:
              'Add <meta property="og:title">, <meta property="og:type">, <meta property="og:image">, and <meta property="og:url"> in <head>.',
          }),
        ],
      }
    },
  },
]
