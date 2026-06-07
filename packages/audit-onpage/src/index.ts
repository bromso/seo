import { withTiming } from "@repo/audit-core"
import { deriveScore, executeRule, fetchPage, parse, type Rule } from "@repo/audit-html-core"
import packageJson from "../package.json" with { type: "json" }
import { altRules } from "./rules/alt.js"
import { canonicalRules } from "./rules/canonical.js"
import { headingRules } from "./rules/headings.js"
import { hreflangRules } from "./rules/hreflang.js"
import { metaDescriptionRules } from "./rules/meta-description.js"
import { robotsRules } from "./rules/robots.js"
import { sitemapRules } from "./rules/sitemap.js"
import { titleRules } from "./rules/title.js"

export { fetchPage } from "@repo/audit-html-core"

const RULES: Rule[] = [
  ...titleRules,
  ...metaDescriptionRules,
  ...headingRules,
  ...altRules,
  ...canonicalRules,
  ...hreflangRules,
  ...robotsRules,
  ...sitemapRules,
]

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "on-page",
  packageName: "@repo/audit-onpage",
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
