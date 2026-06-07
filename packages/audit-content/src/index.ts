import { withTiming } from "@repo/audit-core"
import { deriveScore, executeRule, fetchPage, parse, type Rule } from "@repo/audit-html-core"
import packageJson from "../package.json" with { type: "json" }
import { keywordDensityRules } from "./rules/keyword-density.js"

const RULES: Rule[] = [...keywordDensityRules]

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "seo",
  packageName: "@repo/audit-content",
  packageVersion,
})(async ({ url, opts }) => {
  const page = await fetchPage(url, {
    ...(opts?.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
  })
  const $ = parse(page)
  const outcomes = await Promise.all(RULES.map((r) => executeRule(r, { $, page })))
  const { score, issues } = deriveScore(RULES, outcomes)
  return {
    score,
    issues,
    raw: {
      finalUrl: page.finalUrl,
      status: page.status,
      ruleSummary: RULES.map((r, i) => ({
        rule: r.id,
        weight: r.weight,
        outcome: outcomes[i]?.outcome ?? "skip",
      })),
    },
  }
})
