import { defineIssue, type IssueOccurrence } from "@repo/audit-core"
import type { Rule } from "../rules.js"

const BCP47 = /^(x-default|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/

export const hreflangRules: Rule[] = [
  {
    id: "onpage/hreflang-malformed",
    weight: 2,
    run: ({ $ }) => {
      const offenders: IssueOccurrence[] = []
      $('head > link[rel="alternate"][hreflang]').each((_, el) => {
        const value = $(el).attr("hreflang") ?? ""
        if (!BCP47.test(value)) {
          offenders.push({ snippet: $.html(el).slice(0, 200) })
        }
      })
      if (offenders.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/hreflang-malformed",
            severity: "warn",
            title: "Malformed hreflang values",
            description: `${offenders.length} hreflang link(s) do not match BCP 47 format.`,
            recommendation:
              "Use ISO 639-1 language codes optionally with ISO 3166 region (e.g. en-US).",
            occurrences: offenders,
          }),
        ],
      }
    },
  },
]
