import type { Issue, IssueOccurrence, Severity } from "./types.js"

export type DefineIssueInput = {
  rule: string
  severity: Severity
  title: string
  description: string
  recommendation: string
  count?: number
  occurrences?: IssueOccurrence[]
  docsUrl?: string
}

const MAX_OCCURRENCES = 5
const MAX_SNIPPET = 200

export function defineIssue(input: DefineIssueInput): Issue {
  const all = input.occurrences ?? []
  const occurrences = all.slice(0, MAX_OCCURRENCES).map(truncateOccurrence)
  const count = input.count ?? Math.max(all.length, 1)
  return {
    rule: input.rule,
    severity: input.severity,
    title: input.title,
    description: input.description,
    recommendation: input.recommendation,
    count,
    occurrences,
    ...(input.docsUrl !== undefined ? { docsUrl: input.docsUrl } : {}),
  }
}

function truncateOccurrence(o: IssueOccurrence): IssueOccurrence {
  if (o.snippet === undefined || o.snippet.length <= MAX_SNIPPET) return o
  return { ...o, snippet: o.snippet.slice(0, MAX_SNIPPET) }
}
