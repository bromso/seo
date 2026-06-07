import { withTiming } from "@repo/audit-core"
import { deriveScore, executeRule, fetchPage, parse, type Rule } from "@repo/audit-html-core"
import packageJson from "../package.json" with { type: "json" }
import { doctypeRules } from "./rules/doctype.js"
import { encodingRules } from "./rules/encoding.js"
import { faviconRules } from "./rules/favicon.js"
import { httpsRules } from "./rules/https.js"
import { langRules } from "./rules/lang.js"
import { viewportRules } from "./rules/viewport.js"

const RULES: Rule[] = [
  ...viewportRules,
  ...langRules,
  ...doctypeRules,
  ...encodingRules,
  ...faviconRules,
  ...httpsRules,
]

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "on-page",
  packageName: "@repo/audit-meta",
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
