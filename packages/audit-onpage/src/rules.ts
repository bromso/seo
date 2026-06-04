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
  id: string // matches Issue.rule (e.g. "onpage/title-missing")
  weight: number // for score derivation
  run?: (ctx: RuleContext) => RuleOutcome
  runAsync?: (ctx: RuleContext) => Promise<RuleOutcome>
}
// Each Rule must define exactly one of run or runAsync. The executor in T20
// prefers runAsync when present. Most rules are sync (run); robots/sitemap
// (T19) use runAsync for network fetches.
