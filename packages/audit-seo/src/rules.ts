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
    rule: "seo/document-title",
    lhAuditId: "document-title",
    title: "Document is missing a <title>",
    description: "Every page needs a unique, descriptive <title> element.",
    recommendation: "Add a 30–60 character <title> describing the page content.",
  },
  {
    rule: "seo/meta-description",
    lhAuditId: "meta-description",
    title: "Document is missing a meta description",
    description: "Search engines display this text in result snippets.",
    recommendation: "Add a 150–160 character meta description summarizing the page.",
  },
  {
    rule: "seo/is-crawlable",
    lhAuditId: "is-crawlable",
    title: "Page is blocked from indexing",
    description: "robots.txt or a meta robots tag prevents this page from being indexed.",
    recommendation:
      "Remove disallow rules or `noindex` directives if the page should be indexable.",
  },
  {
    rule: "seo/crawlable-anchors",
    lhAuditId: "crawlable-anchors",
    title: "Anchors are not crawlable",
    description:
      "Some links use href values that crawlers cannot follow (e.g. javascript: or empty).",
    recommendation: "Use real URLs in anchor href attributes.",
  },
]

export function projectSeo(lhr: RawLighthouseResult): {
  score: number
  issues: Issue[]
  raw: unknown
} {
  const cat = lhr.categories.seo
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
  return {
    score,
    issues,
    raw: { categoryScore: cat.score, projectedAuditIds: RULES.map((r) => r.lhAuditId) },
  }
}
