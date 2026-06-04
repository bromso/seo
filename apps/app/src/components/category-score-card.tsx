import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import { RunStatusBadge } from "@/components/run-status-badge"
import type { AuditResultRow } from "@/lib/db-types"
import { formatScore, scoreColorClass } from "@/lib/format"

export function CategoryScoreCard({
  category,
  result,
}: {
  category: string
  result: AuditResultRow | undefined
  runId: string
}) {
  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base capitalize">{category}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">waiting…</p>
        </CardContent>
      </Card>
    )
  }
  const issuesCount = Array.isArray(result.issues) ? (result.issues as unknown[]).length : 0
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <CardTitle className="text-base capitalize">{category}</CardTitle>
        <RunStatusBadge status={result.status === "success" ? "completed" : result.status} />
      </CardHeader>
      <CardContent className="space-y-2">
        <div className={`text-3xl font-semibold ${scoreColorClass(result.score)}`}>
          {formatScore(result.score)}
        </div>
        {result.status === "failed" && result.error_message ? (
          <p className="text-sm text-destructive">{result.error_message}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {issuesCount} {issuesCount === 1 ? "issue" : "issues"}
          </p>
        )}
        {result.partial_reasons && result.partial_reasons.length > 0 ? (
          <p className="text-xs text-muted-foreground">{result.partial_reasons.join("; ")}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
