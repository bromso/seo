import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

export const headingRules: Rule[] = [
  {
    id: "onpage/h1-missing",
    weight: 4,
    run: ({ $ }) => {
      const h1s = $("h1")
      if (h1s.length >= 1) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/h1-missing",
            severity: "error",
            title: "Page has no <h1>",
            description: "Every indexable page should have exactly one <h1>.",
            recommendation: "Add a single <h1> describing the page topic.",
          }),
        ],
      }
    },
  },
  {
    id: "onpage/h1-multiple",
    weight: 2,
    run: ({ $ }) => {
      const h1s = $("h1")
      if (h1s.length <= 1) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/h1-multiple",
            severity: "warn",
            title: "Page has multiple <h1> elements",
            description: `Found ${h1s.length} <h1> elements; only one is recommended.`,
            recommendation: "Demote secondary <h1> elements to <h2> or below.",
            count: h1s.length,
          }),
        ],
      }
    },
  },
  {
    id: "onpage/heading-order-broken",
    weight: 2,
    run: ({ $ }) => {
      const levels: number[] = []
      $("h1, h2, h3, h4, h5, h6").each((_, el) => {
        const tag = (el as { tagName?: string }).tagName ?? ""
        levels.push(Number.parseInt(tag.slice(1), 10))
      })
      let prev = 0
      for (const lvl of levels) {
        if (lvl > prev + 1) {
          return {
            outcome: "fail",
            issues: [
              defineIssue({
                rule: "onpage/heading-order-broken",
                severity: "warn",
                title: "Heading order skips levels",
                description: `Heading sequence jumps from h${prev} to h${lvl}.`,
                recommendation: "Use heading levels in document order without skipping.",
              }),
            ],
          }
        }
        prev = lvl
      }
      return { outcome: "pass" }
    },
  },
]
