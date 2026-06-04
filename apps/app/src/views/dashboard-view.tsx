"use client"
import { RunAuditButton } from "@/components/run-audit-button"
import { RunListTable } from "@/components/run-list-table"
import { SiteSummaryCard } from "@/components/site-summary-card"
import { useRealtimeRuns } from "@/hooks/use-realtime-runs"
import type { AuditRunRow, SiteRow } from "@/lib/db-types"

export function DashboardView({
  site,
  initialRuns,
}: {
  site: SiteRow
  initialRuns: AuditRunRow[]
}) {
  const runs = useRealtimeRuns(site.id, initialRuns)
  return (
    <div className="space-y-6">
      <SiteSummaryCard site={site} />
      <RunAuditButton siteId={site.id} url={site.url} />
      <RunListTable runs={runs} />
    </div>
  )
}
