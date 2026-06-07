import { withTiming } from "@repo/audit-core"
import { deriveScore, executeRule, fetchPage, parse, type Rule } from "@repo/audit-html-core"
import packageJson from "../package.json" with { type: "json" }
import { llmsTxtRules } from "./rules/llms-txt.js"
import { microformatsRules } from "./rules/microformats.js"
import { ogFacebookRules } from "./rules/open-graph-facebook.js"
import { ogLinkedinRules } from "./rules/open-graph-linkedin.js"
import { ogPinterestRules } from "./rules/open-graph-pinterest.js"
import { ogTwitterRules } from "./rules/open-graph-twitter.js"
import { schemaOrgRules } from "./rules/schema-org.js"

const RULES: Rule[] = [
  ...schemaOrgRules,
  ...microformatsRules,
  ...llmsTxtRules,
  ...ogFacebookRules,
  ...ogTwitterRules,
  ...ogPinterestRules,
  ...ogLinkedinRules,
]

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "seo",
  packageName: "@repo/audit-structured",
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
