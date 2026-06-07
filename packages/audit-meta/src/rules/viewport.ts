import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

export const viewportRules: Rule[] = [
  {
    id: "meta/viewport-missing",
    weight: 4,
    run: ({ $ }) => {
      const meta = $('head > meta[name="viewport"]').first()
      const content = (meta.attr("content") ?? "").toLowerCase()
      if (meta.length === 0) {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/viewport-missing",
              severity: "error",
              title: "Missing viewport meta tag",
              description: 'The page has no <meta name="viewport"> element.',
              recommendation:
                'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>.',
            }),
          ],
        }
      }
      if (!content.includes("width=device-width")) {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/viewport-missing",
              severity: "error",
              title: "Viewport meta does not include width=device-width",
              description: `Viewport content is "${content}".`,
              recommendation:
                'Set content to include width=device-width, e.g. "width=device-width, initial-scale=1".',
            }),
          ],
        }
      }
      return { outcome: "pass" }
    },
  },
]
