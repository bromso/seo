"use client"
import { RadarChartCard } from "@/components/radar-chart-card"
import { RunAllButton } from "@/components/run-all-button"
import { SiteScoreCard } from "@/components/site-score-card"
import type { LatestScoreRow, SiteRow } from "@/lib/db-types"
import { usePersistedChartMode } from "@/lib/use-persisted-chart-mode"

export function DashboardOverviewTab({
  ownerId,
  sites,
  latestScores,
}: {
  ownerId: string
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
}) {
  const { mode: chartMode, setMode: setChartMode } = usePersistedChartMode("radar")

  const rowsBySite = new Map<string, LatestScoreRow[]>()
  for (const row of latestScores) {
    const arr = rowsBySite.get(row.site_id) ?? []
    arr.push(row)
    rowsBySite.set(row.site_id, arr)
  }

  const selfSite = sites.find((s) => !s.is_competitor) ?? null
  const competitors = sites.filter((s) => s.is_competitor)
  const orderedSites = selfSite ? [selfSite, ...competitors] : competitors
  const selfScores = selfSite ? (rowsBySite.get(selfSite.id) ?? null) : null

  return (
    <div className="space-y-6">
      <RadarChartCard rows={latestScores} mode={chartMode} onModeChange={setChartMode} />
      <RunAllButton ownerId={ownerId} sites={sites} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {orderedSites.map((site) => (
          <SiteScoreCard
            key={site.id}
            ownerId={ownerId}
            site={site}
            scores={rowsBySite.get(site.id) ?? []}
            selfScores={site.is_competitor ? selfScores : null}
          />
        ))}
      </div>
    </div>
  )
}
