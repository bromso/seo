import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const BCP47 = /^[a-z]{2,3}(-[a-zA-Z0-9]{1,8})*$/i

export const langRules: Rule[] = [
  {
    id: "meta/lang-missing",
    weight: 3,
    run: ({ $ }) => {
      const lang = $("html").attr("lang")?.trim() ?? ""
      if (lang.length > 0 && BCP47.test(lang)) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "meta/lang-missing",
            severity: "warn",
            title: "Missing or malformed `lang` attribute on <html>",
            description:
              lang.length === 0
                ? "The <html> element has no lang attribute."
                : `The lang value "${lang}" does not match the BCP-47 shape.`,
            recommendation:
              'Set <html lang="en"> (or the appropriate BCP-47 tag, e.g. "pt-BR", "zh-Hans-CN").',
          }),
        ],
      }
    },
  },
]
