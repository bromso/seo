import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow } from "@/lib/db-types"

export type RadarDatum = {
  category: Category
} & Record<string, number | string | null>

export type RadarSiteLabel = { label: string; isCompetitor: boolean }

export type RadarData = {
  data: RadarDatum[]
  siteLabels: RadarSiteLabel[]
}

export function latestScoresToRadarData(rows: LatestScoreRow[]): RadarData {
  const siteLabels: RadarSiteLabel[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.site_id)) continue
    seen.add(r.site_id)
    siteLabels.push({
      label: r.label ?? r.url,
      isCompetitor: r.is_competitor,
    })
  }

  const idToLabel = new Map<string, string>()
  for (const r of rows) {
    if (!idToLabel.has(r.site_id)) {
      idToLabel.set(r.site_id, r.label ?? r.url)
    }
  }

  const data: RadarDatum[] = CATEGORIES.map((category) => {
    const datum: RadarDatum = { category }
    for (const { label } of siteLabels) {
      datum[label] = null
    }
    for (const r of rows) {
      if (r.category !== category) continue
      const label = idToLabel.get(r.site_id)
      if (!label) continue
      datum[label] = r.score
    }
    return datum
  })

  return { data, siteLabels }
}
