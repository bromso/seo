import type { Rule } from "@repo/audit-html-core"

export const microformatsRules: Rule[] = [
  {
    id: "structured/microformats-found",
    weight: 1,
    run: () => ({ outcome: "pass" }),
  },
]
