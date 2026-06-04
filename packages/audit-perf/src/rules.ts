import { defineIssue, type Issue } from "@repo/audit-core"
import type { LighthouseAudit, RawLighthouseResult } from "@repo/lighthouse-runner"

type RuleSpec = {
  rule: string
  lhAuditId: string
  title: string
  description: (a: LighthouseAudit) => string
  recommendation: string
  severityFor: (score: number | null) => "error" | "warn" | "info" | null
}

const RULES: RuleSpec[] = [
  {
    rule: "perf/lcp",
    lhAuditId: "largest-contentful-paint",
    title: "Largest Contentful Paint is slow",
    description: (a) => `LCP measured at ${a.displayValue ?? "unknown"} (target < 2.5s).`,
    recommendation:
      "Optimize the largest above-the-fold image or text block: preload it, serve correctly sized assets, and avoid render-blocking JS.",
    severityFor: severityForNumeric,
  },
  {
    rule: "perf/cls",
    lhAuditId: "cumulative-layout-shift",
    title: "Cumulative Layout Shift",
    description: (a) => `CLS measured at ${a.displayValue ?? "unknown"} (target < 0.1).`,
    recommendation:
      "Set width/height on images and embeds; reserve space for dynamically injected content.",
    severityFor: severityForNumeric,
  },
  {
    rule: "perf/tbt",
    lhAuditId: "total-blocking-time",
    title: "Total Blocking Time is high",
    description: (a) => `TBT measured at ${a.displayValue ?? "unknown"} (target < 200ms).`,
    recommendation:
      "Break up long JavaScript tasks, defer non-critical scripts, and offload work to workers.",
    severityFor: severityForNumeric,
  },
]

function severityForNumeric(score: number | null): "error" | "warn" | null {
  if (score === null) return null
  if (score < 0.5) return "error"
  if (score < 0.9) return "warn"
  return null
}

export function projectPerf(lhr: RawLighthouseResult): {
  score: number
  issues: Issue[]
  raw: unknown
} {
  const cat = lhr.categories.performance
  const score = Math.round((cat.score ?? 0) * 100)
  const issues: Issue[] = []
  for (const spec of RULES) {
    const a = lhr.audits[spec.lhAuditId]
    if (!a) continue
    const severity = spec.severityFor(a.score)
    if (severity === null) continue
    issues.push(
      defineIssue({
        rule: spec.rule,
        severity,
        title: spec.title,
        description: spec.description(a),
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
