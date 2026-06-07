import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const HTML5_DOCTYPE = /^\s*<!doctype\s+html\s*>/i

export const doctypeRules: Rule[] = [
  {
    id: "meta/doctype-missing",
    weight: 2,
    run: ({ page }) => {
      const head = page.html.slice(0, 200)
      if (HTML5_DOCTYPE.test(head)) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "meta/doctype-missing",
            severity: "warn",
            title: "Missing or non-HTML5 doctype",
            description: "The document does not start with <!DOCTYPE html>.",
            recommendation: 'Add "<!DOCTYPE html>" as the first line of the document.',
          }),
        ],
      }
    },
  },
]
