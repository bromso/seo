"use client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs"
import { CompetitorDrawer } from "@/components/competitor-drawer"
import { OfflineBanner } from "@/components/offline-banner"
import { useRealtimeScores } from "@/hooks/use-realtime-scores"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { useAuditQueueReplay } from "@/lib/offline/use-audit-queue-replay"
import { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
import { DashboardOverviewTab } from "@/views/dashboard-overview-tab"
import { DashboardTrendsTab } from "@/views/dashboard-trends-tab"

export function DashboardView({
  ownerId,
  sites,
  latestScores,
  trends,
}: {
  ownerId: string
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}) {
  useRealtimeScores(ownerId)
  useAuditQueueReplay(ownerId)
  const cached = useDashboardCache(ownerId, { sites, latestScores, trends })
  const competitors = cached.sites.filter((s) => s.is_competitor)
  return (
    <div className="space-y-6">
      <OfflineBanner />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <CompetitorDrawer competitors={competitors} />
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <DashboardOverviewTab
            ownerId={ownerId}
            sites={cached.sites}
            latestScores={cached.latestScores}
          />
        </TabsContent>
        <TabsContent value="trends">
          <DashboardTrendsTab trends={cached.trends} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
