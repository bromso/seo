import { defineIssue, type Issue } from "@repo/audit-core"
import type { RawLighthouseResult } from "@repo/lighthouse-runner"

const RULES: Array<{
  rule: string
  lhAuditId: string
  title: string
  description: string
  recommendation: string
}> = [
  {
    rule: "bp/is-on-https",
    lhAuditId: "is-on-https",
    title: "Page is served over HTTP",
    description: "All sites should be served over HTTPS.",
    recommendation: "Migrate to HTTPS and redirect HTTP traffic to it.",
  },
  {
    rule: "bp/no-vulnerable-libraries",
    lhAuditId: "no-vulnerable-libraries",
    title: "Page uses libraries with known vulnerabilities",
    description: "One or more JS libraries on the page have public CVEs.",
    recommendation: "Update vulnerable libraries to patched versions.",
  },
  {
    rule: "bp/errors-in-console",
    lhAuditId: "errors-in-console",
    title: "Browser console has errors",
    description: "Errors logged to the console may indicate broken functionality.",
    recommendation: "Investigate and fix the console errors.",
  },
]

export function projectBP(lhr: RawLighthouseResult): {
  score: number
  issues: Issue[]
  raw: unknown
} {
  const cat = lhr.categories["best-practices"]
  const score = Math.round((cat.score ?? 0) * 100)
  const issues: Issue[] = []
  for (const spec of RULES) {
    const a = lhr.audits[spec.lhAuditId]
    if (!a || a.score === null || a.score === 1) continue
    const severity = a.score < 0.5 ? "error" : "warn"
    issues.push(
      defineIssue({
        rule: spec.rule,
        severity,
        title: spec.title,
        description: spec.description,
        recommendation: spec.recommendation,
      })
    )
  }
  return { score, issues, raw: { categoryScore: cat.score } }
}
