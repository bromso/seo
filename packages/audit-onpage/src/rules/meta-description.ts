import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const MAX_LEN = 160

export const metaDescriptionRules: Rule[] = [
  {
    id: "onpage/meta-description-missing",
    weight: 4,
    run: ({ $ }) => {
      const content = $('head > meta[name="description"]').attr("content")?.trim() ?? ""
      if (content.length > 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/meta-description-missing",
            severity: "warn",
            title: "Missing meta description",
            description: 'No <meta name="description"> on this page.',
            recommendation: `Add a meta description of up to ${MAX_LEN} characters.`,
          }),
        ],
      }
    },
  },
  {
    id: "onpage/meta-description-too-long",
    weight: 2,
    run: ({ $ }) => {
      const content = $('head > meta[name="description"]').attr("content")?.trim() ?? ""
      if (content.length === 0 || content.length <= MAX_LEN) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/meta-description-too-long",
            severity: "info",
            title: "Meta description is too long",
            description: `Meta description is ${content.length} chars; Google typically truncates after ${MAX_LEN}.`,
            recommendation: `Shorten to ${MAX_LEN} characters or less.`,
          }),
        ],
      }
    },
  },
]
