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
    rule: "pwa/installable-manifest",
    lhAuditId: "installable-manifest",
    title: "Web app manifest is not installable",
    description: "The page does not have an installable manifest.",
    recommendation: "Add a complete web app manifest with name, icons, start_url, and display.",
  },
  {
    rule: "pwa/service-worker",
    lhAuditId: "service-worker",
    title: "No service worker registered",
    description: "A service worker enables offline usage and faster repeat visits.",
    recommendation: "Register a service worker that caches the app shell.",
  },
  {
    rule: "pwa/themed-omnibox",
    lhAuditId: "themed-omnibox",
    title: "Missing theme-color meta tag",
    description: "Browsers theme the address bar based on this tag.",
    recommendation: 'Add `<meta name="theme-color">` matching your brand color.',
  },
]

export type PwaProjection =
  | { kind: "ok"; score: number; issues: Issue[]; raw: unknown }
  | { kind: "missing"; score: 0; issues: never[]; raw: unknown; partialReasons: string[] }

export function projectPwa(lhr: RawLighthouseResult): PwaProjection {
  const cat = lhr.categories.pwa
  if (!cat) {
    return {
      kind: "missing",
      score: 0,
      issues: [],
      raw: { reason: "lhr.categories.pwa absent" },
      partialReasons: ["pwa-category-not-emitted-by-lighthouse"],
    }
  }
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
    kind: "ok",
    score,
    issues,
    raw: { categoryScore: cat.score, projectedAuditIds: RULES.map((r) => r.lhAuditId) },
  }
}
