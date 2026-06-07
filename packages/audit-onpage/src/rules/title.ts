import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const MIN_LEN = 30
const MAX_LEN = 60

export const titleRules: Rule[] = [
  {
    id: "onpage/title-missing",
    weight: 5,
    run: ({ $ }) => {
      const text = $("head > title").first().text().trim()
      if (text.length > 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/title-missing",
            severity: "error",
            title: "Missing <title> element",
            description: "The page has no <title>, or it is empty.",
            recommendation: `Add a descriptive <title> of ${MIN_LEN}–${MAX_LEN} characters.`,
          }),
        ],
      }
    },
  },
  {
    id: "onpage/title-too-short",
    weight: 3,
    run: ({ $ }) => {
      const text = $("head > title").first().text().trim()
      if (text.length === 0 || text.length >= MIN_LEN) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/title-too-short",
            severity: "warn",
            title: "Page title is too short",
            description: `Title is ${text.length} characters; recommended minimum is ${MIN_LEN}.`,
            recommendation: `Expand the title to ${MIN_LEN}–${MAX_LEN} characters.`,
          }),
        ],
      }
    },
  },
  {
    id: "onpage/title-too-long",
    weight: 2,
    run: ({ $ }) => {
      const text = $("head > title").first().text().trim()
      if (text.length <= MAX_LEN) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/title-too-long",
            severity: "warn",
            title: "Page title is too long",
            description: `Title is ${text.length} characters; recommended maximum is ${MAX_LEN}.`,
            recommendation: `Shorten the title to ${MIN_LEN}–${MAX_LEN} characters.`,
          }),
        ],
      }
    },
  },
]
