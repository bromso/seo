import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import type { CheerioAPI } from "cheerio"

function extractCharset($: CheerioAPI): string | null {
  const direct = $("head > meta[charset]").first().attr("charset")
  if (direct) return direct.trim().toLowerCase()
  const httpEquiv = $('head > meta[http-equiv="Content-Type" i]').first().attr("content") ?? ""
  const m = httpEquiv.match(/charset=([^;\s]+)/i)
  return m?.[1] ? m[1].trim().toLowerCase() : null
}

export const encodingRules: Rule[] = [
  {
    id: "meta/encoding-missing",
    weight: 2,
    run: ({ $ }) => {
      const charset = extractCharset($)
      if (charset === null) {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/encoding-missing",
              severity: "warn",
              title: "Missing <meta charset>",
              description: "The <head> declares no character encoding.",
              recommendation: 'Add <meta charset="utf-8"> as the first child of <head>.',
            }),
          ],
        }
      }
      if (charset !== "utf-8") {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/encoding-missing",
              severity: "warn",
              title: "Charset is not utf-8",
              description: `Declared charset is "${charset}".`,
              recommendation: 'Use <meta charset="utf-8">.',
            }),
          ],
        }
      }
      return { outcome: "pass" }
    },
  },
]
