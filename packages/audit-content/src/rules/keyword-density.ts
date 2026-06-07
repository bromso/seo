import { defineIssue, type Issue, type IssueOccurrence } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import { STOPWORDS_EN } from "../stopwords-en.js"

const WORD_RE = /[\p{L}\p{N}]+/gu
const MIN_TOKENS = 50
const MAX_TOKENS = 100_000
const TOP_N = 10
const STUFFING_THRESHOLD = 0.05

function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? []
}

function buildNgrams(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>()
  if (tokens.length < n) return counts
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n).join(" ")
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

function topByCount(counts: Map<string, number>, k: number): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
}

export const keywordDensityRules: Rule[] = [
  {
    id: "content/keyword-density",
    weight: 1,
    run: ({ $ }) => {
      const text = $("body").clone().find("script,style,noscript").remove().end().text()
      const allTokens = tokenize(text)
      if (allTokens.length < MIN_TOKENS) {
        return { outcome: "skip", reason: `page has only ${allTokens.length} tokens` }
      }
      const tokens = allTokens.slice(0, MAX_TOKENS)
      const issues: Issue[] = []
      for (const n of [1, 2, 3, 4] as const) {
        const sourceTokens = n === 1 ? tokens.filter((t) => !STOPWORDS_EN.has(t)) : tokens
        const counts = buildNgrams(sourceTokens, n)
        const total = [...counts.values()].reduce((a, b) => a + b, 0)
        if (total === 0) continue
        const top = topByCount(counts, TOP_N)
        const occurrences: IssueOccurrence[] = top.map(([term, count]) => ({
          snippet: `${term} — ${count}× (${((count / total) * 100).toFixed(2)}%)`,
        }))
        issues.push(
          defineIssue({
            rule: "content/keyword-density",
            severity: "info",
            title: `Top ${n}-word phrases`,
            description: `Top ${Math.min(TOP_N, top.length)} ${n}-word phrases by frequency (out of ${total} total ${n}-grams).`,
            recommendation:
              n === 1
                ? "Use this to spot keyword bias. v1 English-only; stopwords filtered."
                : "Use this to spot unintentional repetition of phrases.",
            occurrences: occurrences.slice(0, 5),
          })
        )
        if (n === 1) {
          for (const [term, count] of top) {
            const density = count / total
            if (density > STUFFING_THRESHOLD) {
              issues.push(
                defineIssue({
                  rule: "content/keyword-density",
                  severity: "warn",
                  title: `Possible keyword stuffing: "${term}" appears in ${(density * 100).toFixed(1)}% of ${n}-grams`,
                  description: `"${term}" occurs ${count} times out of ${total} ${n}-grams (>${(STUFFING_THRESHOLD * 100).toFixed(0)}% threshold).`,
                  recommendation:
                    "Vary phrasing and use related terms to keep content natural and readable.",
                })
              )
            }
          }
        }
      }
      if (issues.length === 0) return { outcome: "pass" }
      return { outcome: "fail", issues }
    },
  },
]
