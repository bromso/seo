"use client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs"
import { CompetitorDrawer } from "@/components/competitor-drawer"
import { useRealtimeScores } from "@/hooks/use-realtime-scores"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
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
  const competitors = sites.filter((s) => s.is_competitor)
  return (
    <div className="space-y-6">
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
          <DashboardOverviewTab sites={sites} latestScores={latestScores} />
        </TabsContent>
        <TabsContent value="trends">
          <DashboardTrendsTab trends={trends} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
