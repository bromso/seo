import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import { readOgTag } from "./open-graph-facebook.js"

const TWITTER_REQUIRED: Array<{ tag: string; fallback?: string }> = [
  { tag: "twitter:card" },
  { tag: "twitter:title", fallback: "og:title" },
  { tag: "twitter:description", fallback: "og:description" },
  { tag: "twitter:image", fallback: "og:image" },
]

export const ogTwitterRules: Rule[] = [
  {
    id: "structured/og-twitter-missing",
    weight: 2,
    run: ({ $ }) => {
      const missing: string[] = []
      for (const { tag, fallback } of TWITTER_REQUIRED) {
        if (readOgTag($, tag)) continue
        if (fallback && readOgTag($, fallback)) continue
        missing.push(tag)
      }
      if (missing.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/og-twitter-missing",
            severity: "warn",
            title: "Missing Open Graph tags for Twitter",
            description: `Missing required tags: ${missing.join(", ")} (no og:* fallback found where applicable).`,
            recommendation:
              'Add <meta name="twitter:card" content="summary_large_image"> and the twitter:title / description / image tags (or rely on og:* equivalents).',
          }),
        ],
      }
    },
  },
]
