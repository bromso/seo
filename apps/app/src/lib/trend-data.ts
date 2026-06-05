import type { Category } from "@/lib/constants"
import type { ScoreTrendRow } from "@/lib/db-types"

export type TrendDatum = {
  measuredAt: string
} & Record<string, number | string>

export type TrendData = {
  data: TrendDatum[]
  siteLabels: string[]
}

export function scoreTrendsToChartData(rows: ScoreTrendRow[], category: Category): TrendData {
  const filtered = rows.filter((r) => r.category === category)

  const siteLabels: string[] = []
  const seenLabels = new Set<string>()
  const idToLabel = new Map<string, string>()
  for (const r of filtered) {
    const label = r.label ?? r.site_id
    idToLabel.set(r.site_id, label)
    if (!seenLabels.has(label)) {
      seenLabels.add(label)
      siteLabels.push(label)
    }
  }

  const byTime = new Map<string, TrendDatum>()
  for (const r of filtered) {
    const label = idToLabel.get(r.site_id) ?? r.site_id
    const existing = byTime.get(r.measured_at)
    if (existing) {
      existing[label] = r.score
    } else {
      byTime.set(r.measured_at, { measuredAt: r.measured_at, [label]: r.score })
    }
  }

  const data = [...byTime.values()].sort((a, b) =>
    a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0
  )

  return { data, siteLabels }
}
