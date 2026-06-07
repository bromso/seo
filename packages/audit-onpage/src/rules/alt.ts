import { defineIssue, type IssueOccurrence } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

export const altRules: Rule[] = [
  {
    id: "onpage/alt-missing",
    weight: 3,
    run: ({ $ }) => {
      const offenders: IssueOccurrence[] = []
      $("img").each((_, el) => {
        const alt = $(el).attr("alt")
        if (alt === undefined) {
          const id = $(el).attr("id")
          offenders.push({
            selector: id ? `img#${id}` : "img",
            snippet: $.html(el).slice(0, 200),
          })
        }
      })
      if (offenders.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/alt-missing",
            severity: "warn",
            title: "Images missing alt text",
            description: `${offenders.length} <img> elements have no alt attribute.`,
            recommendation: 'Add descriptive alt text. For purely decorative images use alt="".',
            occurrences: offenders,
          }),
        ],
      }
    },
  },
]
