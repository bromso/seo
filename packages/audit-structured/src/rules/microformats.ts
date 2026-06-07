import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const MICROFORMAT_CLASSES = [
  "h-card",
  "h-entry",
  "h-event",
  "h-feed",
  "h-recipe",
  "h-resume",
  "h-review",
  "h-product",
]

export const microformatsRules: Rule[] = [
  {
    id: "structured/microformats-found",
    weight: 1,
    run: ({ $ }) => {
      const found: string[] = []
      for (const cls of MICROFORMAT_CLASSES) {
        if ($(`.${cls}`).length > 0) found.push(cls)
      }
      if (found.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/microformats-found",
            severity: "info",
            title: "Microformats detected",
            description: `The page uses microformats: ${found.join(", ")}.`,
            recommendation:
              "Microformats are a positive signal for semantic content. No action needed.",
          }),
        ],
      }
    },
  },
]
