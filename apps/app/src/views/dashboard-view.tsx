"use client"
import { CompetitorDrawer } from "@/components/competitor-drawer"
import { OfflineBanner } from "@/components/offline-banner"
import { PushNotificationsButton } from "@/components/push-notifications-button"
import { RunAllButton } from "@/components/run-all-button"
import { SiteRow } from "@/components/site-row"
import { useRealtimeScores } from "@/hooks/use-realtime-scores"
import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow, ScoreTrendRow, SiteRow as SiteRowType } from "@/lib/db-types"
import { formatRelativeTime } from "@/lib/format"
import { useAuditQueueReplay } from "@/lib/offline/use-audit-queue-replay"
import { useDashboardCache } from "@/lib/offline/use-dashboard-cache"

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
    <div className="space-y-6">
      {/* Page header — title row, meta row, action row */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink-primary">
            Sites
          </h1>
          <p className="text-[13px] text-ink-secondary">
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

      {/* Sites table */}
      <section className="rounded-lg border border-border-subtle bg-surface-raised overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[20px_minmax(0,1.6fr)_repeat(5,minmax(56px,72px))_minmax(60px,72px)_minmax(80px,92px)_28px] items-center gap-x-3 px-3 py-2 border-b border-border-subtle bg-surface-sunken/50">
          <span />
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
            Site
          </span>
          {CATEGORIES.map((c) => (
            <span
              key={c}
              className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary"
              title={c}
            >
              {categoryShort(c)}
            </span>
          ))}
          <span className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
            Δ
          </span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
            Last
          </span>
          <span />
        </div>

        {/* Rows */}
        <div>
          {orderedSites.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-ink-secondary">
              No sites yet. Add one to start auditing.
            </div>
          ) : (
            orderedSites.map((site) => (
              <SiteRow
                key={site.id}
                ownerId={ownerId}
                site={site}
                scores={rowsBySite.get(site.id) ?? []}
                selfScores={site.is_competitor ? selfScores : null}
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}
