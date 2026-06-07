import type { Rule, RuleContext, RuleOutcome } from "./rules.js"

export async function executeRule(rule: Rule, ctx: RuleContext): Promise<RuleOutcome> {
  try {
    if (rule.runAsync) return await rule.runAsync(ctx)
    if (rule.run) return rule.run(ctx)
    return { outcome: "skip", reason: "no implementation" }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { outcome: "skip", reason: `unexpected: ${message}` }
  }
}
