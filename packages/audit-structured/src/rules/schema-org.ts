import { defineIssue, type IssueOccurrence } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

function hasSchemaOrgContext(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== "object") return false
  const ctx = (parsed as { "@context"?: unknown })["@context"]
  if (typeof ctx === "string") return ctx.includes("schema.org")
  if (Array.isArray(ctx)) return ctx.some((c) => typeof c === "string" && c.includes("schema.org"))
  return false
}

export const schemaOrgRules: Rule[] = [
  {
    id: "structured/schema-org-invalid",
    weight: 4,
    run: ({ $ }) => {
      const blocks = $('script[type="application/ld+json"]').toArray()
      if (blocks.length === 0) {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "structured/schema-org-invalid",
              severity: "warn",
              title: "No structured data",
              description: 'The page has no <script type="application/ld+json"> blocks.',
              recommendation:
                "Add JSON-LD structured data describing the primary entity on the page (Article, Product, Organization, …).",
            }),
          ],
        }
      }
      const failures: IssueOccurrence[] = []
      let validCount = 0
      blocks.forEach((el, idx) => {
        const raw = $(el).text().trim()
        try {
          const parsed = JSON.parse(raw)
          if (hasSchemaOrgContext(parsed)) {
            validCount++
          } else {
            failures.push({
              snippet: `block ${idx}: missing schema.org @context`,
            })
          }
        } catch (err) {
          failures.push({
            snippet: `block ${idx}: ${(err as Error).message.slice(0, 100)}`,
          })
        }
      })
      if (validCount > 0 && failures.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/schema-org-invalid",
            severity: "warn",
            title:
              validCount > 0 ? "Some JSON-LD blocks are invalid" : "All JSON-LD blocks are invalid",
            description: `${failures.length} of ${blocks.length} JSON-LD blocks failed to parse or lack a schema.org @context.`,
            recommendation:
              'Validate JSON syntax and include "@context": "https://schema.org" on each block.',
            occurrences: failures.slice(0, 5),
          }),
        ],
      }
    },
  },
]
