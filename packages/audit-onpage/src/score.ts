import type { Issue } from "@repo/audit-core"
import type { Rule, RuleOutcome } from "./rules.js"

export function deriveScore(
  rules: Rule[],
  outcomes: RuleOutcome[]
): { score: number; issues: Issue[] } {
  let totalWeight = 0
  let passedWeight = 0
  const issues: Issue[] = []
  rules.forEach((rule, i) => {
    const outcome = outcomes[i]
    if (!outcome || outcome.outcome === "skip") return
    totalWeight += rule.weight
    if (outcome.outcome === "pass") {
      passedWeight += rule.weight
    } else {
      issues.push(...outcome.issues)
    }
  })
  const score = totalWeight === 0 ? 100 : Math.round((100 * passedWeight) / totalWeight)
  return { score, issues }
}
