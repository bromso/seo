import type { Issue } from "@repo/audit-core"
import type { CheerioAPI } from "cheerio"
import type { FetchedPage } from "./types.js"

export type RuleContext = {
  $: CheerioAPI
  page: FetchedPage
}

export type RuleOutcome =
  | { outcome: "pass" }
  | { outcome: "fail"; issues: Issue[] }
  | { outcome: "skip"; reason: string }

export type Rule = {
  id: string
  weight: number
  run?: (ctx: RuleContext) => RuleOutcome
  runAsync?: (ctx: RuleContext) => Promise<RuleOutcome>
}
