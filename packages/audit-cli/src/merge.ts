import type { AuditResult, Category, Issue } from "@repo/audit-core"

type RuleSummaryRow = { rule: string; weight: number; outcome: string }

function totalWeight(r: AuditResult): number {
  if (r.status === "failed") return 0
  const raw = r.raw as { ruleSummary?: RuleSummaryRow[] } | null
  const rows = raw?.ruleSummary ?? []
  return rows.reduce((acc, row) => acc + (typeof row.weight === "number" ? row.weight : 0), 0)
}

function mergeOneCategory(category: Category, contributors: AuditResult[]): AuditResult {
  const first = contributors[0]
  if (!first) throw new Error("mergeOneCategory called with empty contributors")
  const succeeded = contributors.filter(
    (c): c is AuditResult & { status: "success" | "partial" } =>
      c.status === "success" || c.status === "partial"
  )
  const failedOnes = contributors.filter(
    (c): c is AuditResult & { status: "failed" } => c.status === "failed"
  )
  const partialOnes = contributors.filter(
    (c): c is AuditResult & { status: "partial" } => c.status === "partial"
  )
  const startedAtMs = Math.min(...contributors.map((c) => new Date(c.startedAt).getTime()))
  const endedAtMs = Math.max(
    ...contributors.map((c) => new Date(c.startedAt).getTime() + c.durationMs)
  )

  const baseFields = {
    category,
    url: first.url,
    requestedUrl: first.requestedUrl,
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs,
    packageName: "merged",
    packageVersion: "merged",
  }

  if (succeeded.length === 0) {
    const message =
      "all contributors failed: " +
      failedOnes.map((c) => `${c.packageName}: ${c.error.message}`).join("; ")
    return {
      ...baseFields,
      status: "failed",
      error: { code: "UNKNOWN", message, retryable: false },
    }
  }

  let weightedSum = 0
  let weightTotal = 0
  for (const c of succeeded) {
    const w = totalWeight(c)
    if (w === 0) continue
    weightedSum += c.score * w
    weightTotal += w
  }
  const score = weightTotal === 0 ? 100 : Math.round(weightedSum / weightTotal)

  const issues: Issue[] = succeeded.flatMap((c) => c.issues)
  const raw = Object.fromEntries(succeeded.map((c) => [c.packageName, c.raw]))

  const partialReasons: string[] = [
    ...failedOnes.map((c) => `${c.packageName} failed: ${c.error.message}`),
    ...partialOnes.flatMap((c) => c.partialReasons.map((r) => `${c.packageName}: ${r}`)),
  ]

  if (partialReasons.length > 0) {
    return {
      ...baseFields,
      status: "partial",
      score,
      issues,
      raw,
      partialReasons,
    }
  }

  return {
    ...baseFields,
    status: "success",
    score,
    issues,
    raw,
  }
}

export function mergeByCategory(results: AuditResult[]): AuditResult[] {
  const byCategory = new Map<Category, AuditResult[]>()
  for (const r of results) {
    const arr = byCategory.get(r.category) ?? []
    arr.push(r)
    byCategory.set(r.category, arr)
  }
  const out: AuditResult[] = []
  for (const [category, contributors] of byCategory) {
    if (contributors.length === 1 && contributors[0]) {
      out.push(contributors[0])
    } else {
      out.push(mergeOneCategory(category, contributors))
    }
  }
  return out
}
