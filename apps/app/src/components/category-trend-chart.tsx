"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { Category } from "@/lib/constants"
import type { ScoreTrendRow } from "@/lib/db-types"
import { scoreTrendsToChartData } from "@/lib/trend-data"

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2"]

function formatTick(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function CategoryTrendChart({
  category,
  rows,
}: {
  category: Category
  rows: ScoreTrendRow[]
}) {
  const { data, siteLabels } = scoreTrendsToChartData(rows, category)

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base capitalize">{category}</CardTitle>
        </CardHeader>
        <CardContent className="h-48">
          <p className="text-sm text-muted-foreground">No data in the last 30 days.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base capitalize">{category}</CardTitle>
      </CardHeader>
      <CardContent className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="measuredAt" tickFormatter={formatTick} />
            <YAxis domain={[0, 100]} />
            <Tooltip labelFormatter={(v) => formatTick(String(v))} />
            {siteLabels.map((label, i) => (
              <Line
                key={label}
                type="monotone"
                dataKey={label}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
