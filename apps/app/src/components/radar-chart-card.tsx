"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts"
import type { LatestScoreRow } from "@/lib/db-types"
import { latestScoresToRadarData } from "@/lib/radar-data"

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2"]

export function RadarChartCard({ rows }: { rows: LatestScoreRow[] }) {
  const { data, siteLabels } = latestScoresToRadarData(rows)
  if (siteLabels.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Latest comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No completed runs yet. Click "Run audits on all sites" to start.
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest comparison</CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid />
            <PolarAngleAxis dataKey="category" />
            <PolarRadiusAxis angle={90} domain={[0, 100]} />
            {siteLabels.map((s, i) => (
              <Radar
                key={s.label}
                name={s.label}
                dataKey={s.label}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={s.isCompetitor ? 0.15 : 0.4}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
