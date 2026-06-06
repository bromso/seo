"use client"
import { CompetitorDrawer } from "@/components/competitor-drawer"
import { OfflineBanner } from "@/components/offline-banner"
import { PushNotificationsButton } from "@/components/push-notifications-button"
import { RadarChartCard } from "@/components/radar-chart-card"
import { RunAllButton } from "@/components/run-all-button"
import { SiteCard } from "@/components/site-card"
import { SiteRow } from "@/components/site-row"
import { ViewModeToggle } from "@/components/view-mode-toggle"
import { useRealtimeScores } from "@/hooks/use-realtime-scores"
import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow, ScoreTrendRow, SiteRow as SiteRowType } from "@/lib/db-types"
import { formatRelativeTime } from "@/lib/format"
import { useAuditQueueReplay } from "@/lib/offline/use-audit-queue-replay"
import { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
import { usePersistedChartMode } from "@/lib/use-persisted-chart-mode"
import { usePersistedViewMode } from "@/lib/use-persisted-view-mode"

function categoryShort(c: Category): string {
  switch (c) {
    case "performance":
      return "Perf"
    case "seo":
      return "SEO"
    case "best-practices":
      return "BP"
    case "pwa":
      return "PWA"
    case "on-page":
      return "OP"
  }
}

export function DashboardView({
  ownerId,
  sites,
  latestScores,
  trends: _trends,
}: {
  ownerId: string
  sites: SiteRowType[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}) {
  useRealtimeScores(ownerId)
  useAuditQueueReplay(ownerId)
  const cached = useDashboardCache(ownerId, { sites, latestScores, trends: _trends })
  const { mode, setMode } = usePersistedViewMode("table")
  const { mode: chartMode, setMode: setChartMode } = usePersistedChartMode("radar")

  const rowsBySite = new Map<string, LatestScoreRow[]>()
  for (const row of cached.latestScores) {
    const arr = rowsBySite.get(row.site_id) ?? []
    arr.push(row)
    rowsBySite.set(row.site_id, arr)
  }

  const selfSite = cached.sites.find((s) => !s.is_competitor) ?? null
  const competitors = cached.sites.filter((s) => s.is_competitor)
  const orderedSites = selfSite ? [selfSite, ...competitors] : competitors
  const selfScores = selfSite ? (rowsBySite.get(selfSite.id) ?? null) : null

  const lastRun = cached.latestScores
    .map((s) => s.run_started_at)
    .filter((t): t is string => t !== null)
    .sort((a, b) => (a > b ? -1 : 1))[0]

  const runningCount = cached.latestScores.filter((s) => s.run_status === "running").length

  return (
    <div className="space-y-8">
      {/* Page header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink-primary">
            Sites
          </h1>
          <p className="text-[16px] text-ink-secondary">
            <span className="num text-ink-primary">{cached.sites.length}</span>{" "}
            {cached.sites.length === 1 ? "site" : "sites"}
            {lastRun ? (
              <>
                {" · last audit "}
                <span className="num text-ink-primary">{formatRelativeTime(lastRun)}</span>
              </>
            ) : null}
            {runningCount > 0 ? (
              <>
                {" · "}
                <span className="text-status-running">
                  <span className="num">{runningCount}</span> running
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <PushNotificationsButton />
          <RunAllButton ownerId={ownerId} sites={cached.sites} />
          <CompetitorDrawer competitors={competitors} />
        </div>
      </header>

      <OfflineBanner cachedAt={cached.cacheUpdatedAt} />

      {/* Chart hero — radar or grouped bars, toggleable */}
      <RadarChartCard rows={cached.latestScores} mode={chartMode} onModeChange={setChartMode} />

      {/* Sites list — toggle + content */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
            All sites
          </h2>
          <ViewModeToggle value={mode} onChange={setMode} />
        </div>

        {orderedSites.length === 0 ? (
          <div className="surface-metal rounded-lg px-4 py-10 text-center text-[16px] text-ink-secondary">
            No sites yet. Add one to start auditing.
          </div>
        ) : mode === "table" ? (
          <div className="surface-metal rounded-lg overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[24px_minmax(0,1.6fr)_repeat(5,minmax(64px,80px))_minmax(64px,76px)_minmax(96px,104px)_32px] items-center gap-x-4 px-4 py-3 border-b border-border-subtle bg-surface-sunken/50">
              <span />
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                Site
              </span>
              {CATEGORIES.map((c) => (
                <span
                  key={c}
                  className="text-right text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary"
                  title={c}
                >
                  {categoryShort(c)}
                </span>
              ))}
              <span className="text-right text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                Δ
              </span>
              <span className="text-right text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                Last
              </span>
              <span />
            </div>
            {orderedSites.map((site) => (
              <SiteRow
                key={site.id}
                ownerId={ownerId}
                site={site}
                scores={rowsBySite.get(site.id) ?? []}
                selfScores={site.is_competitor ? selfScores : null}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {orderedSites.map((site) => (
              <SiteCard
                key={site.id}
                ownerId={ownerId}
                site={site}
                scores={rowsBySite.get(site.id) ?? []}
                selfScores={site.is_competitor ? selfScores : null}
                chartMode={chartMode}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
