"use client"
import Link from "next/link"
import { CategoryScoreCard } from "@/components/category-score-card"
import { IssueList } from "@/components/issue-list"
import { RunStatusBadge } from "@/components/run-status-badge"
import { useRealtimeRun } from "@/hooks/use-realtime-run"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { formatRelativeTime } from "@/lib/format"

const ALL_CATEGORIES = ["performance", "seo", "best-practices", "pwa", "on-page"] as const

export function RunDetailView({
  initialRun,
  initialResults,
}: {
  initialRun: AuditRunRow
  initialResults: AuditResultRow[]
}) {
  const { run, results } = useRealtimeRun(initialRun.id, initialRun, initialResults)
  const byCategory = Object.fromEntries(results.map((r) => [r.category, r]))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-muted-foreground underline">
            ← Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Run {run.id.slice(0, 8)}</h1>
          <p className="text-sm text-muted-foreground">
            {run.requested_url} · started {formatRelativeTime(run.started_at)}
          </p>
        </div>
        <RunStatusBadge status={run.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {ALL_CATEGORIES.map((c) => (
          <CategoryScoreCard key={c} category={c} result={byCategory[c]} runId={run.id} />
        ))}
      </div>

      {results
        .filter(
          (r) =>
            r.status !== "failed" && Array.isArray(r.issues) && (r.issues as unknown[]).length > 0
        )
        .map((r) => (
          <IssueList key={r.id} category={r.category} issues={r.issues as unknown[]} />
        ))}
    </div>
  )
}
