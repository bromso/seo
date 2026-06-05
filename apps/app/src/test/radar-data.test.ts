import { describe, expect, it } from "vitest"
import type { LatestScoreRow } from "@/lib/db-types"
import { latestScoresToRadarData } from "@/lib/radar-data"

const baseRow = {
  site_id: "site-id",
  owner_id: "owner",
  url: "https://example.com",
  label: null,
  is_competitor: false,
  run_id: "run-id",
  run_status: "completed" as const,
  run_started_at: "2026-06-05T12:00:00Z",
  result_status: "success" as const,
} satisfies Omit<LatestScoreRow, "category" | "score">

function mkRow(
  override: Partial<LatestScoreRow> & {
    category: LatestScoreRow["category"]
    score: number | null
  }
): LatestScoreRow {
  return { ...baseRow, ...override }
}

describe("latestScoresToRadarData", () => {
  it("returns 5 axis entries (one per category) in CATEGORIES order", () => {
    const rows: LatestScoreRow[] = [
      mkRow({ site_id: "self", label: "My site", category: "performance", score: 87 }),
      mkRow({ site_id: "self", label: "My site", category: "seo", score: 90 }),
      mkRow({ site_id: "self", label: "My site", category: "best-practices", score: 93 }),
      mkRow({ site_id: "self", label: "My site", category: "pwa", score: 0 }),
      mkRow({ site_id: "self", label: "My site", category: "on-page", score: 78 }),
    ]
    const { data } = latestScoresToRadarData(rows)
    expect(data.map((d) => d.category)).toEqual([
      "performance",
      "seo",
      "best-practices",
      "pwa",
      "on-page",
    ])
  })

  it("keys site scores by site label", () => {
    const rows: LatestScoreRow[] = [
      mkRow({ site_id: "self", label: "My site", category: "performance", score: 87 }),
      mkRow({
        site_id: "c1",
        label: "Competitor A",
        is_competitor: true,
        category: "performance",
        score: 92,
      }),
    ]
    const { data, siteLabels } = latestScoresToRadarData(rows)
    expect(data[0]).toMatchObject({
      category: "performance",
      "My site": 87,
      "Competitor A": 92,
    })
    expect(siteLabels).toEqual([
      { label: "My site", isCompetitor: false },
      { label: "Competitor A", isCompetitor: true },
    ])
  })

  it("uses the URL as the label when label is null", () => {
    const rows: LatestScoreRow[] = [
      mkRow({
        site_id: "self",
        url: "https://example.com",
        label: null,
        category: "performance",
        score: 87,
      }),
    ]
    const { siteLabels } = latestScoresToRadarData(rows)
    expect(siteLabels[0]?.label).toBe("https://example.com")
  })

  it("renders sites with no run yet as null entries (one row per category, all null)", () => {
    const rows: LatestScoreRow[] = [
      {
        ...baseRow,
        site_id: "no-runs",
        label: "Fresh site",
        run_id: null,
        run_status: null,
        run_started_at: null,
        category: null,
        result_status: null,
        score: null,
      },
    ]
    const { data, siteLabels } = latestScoresToRadarData(rows)
    expect(siteLabels).toEqual([{ label: "Fresh site", isCompetitor: false }])
    expect(data).toHaveLength(5)
    for (const row of data) {
      expect(row["Fresh site"]).toBeNull()
    }
  })

  it("returns 5 empty axis rows + empty siteLabels for empty input", () => {
    const { data, siteLabels } = latestScoresToRadarData([])
    expect(siteLabels).toEqual([])
    expect(data.map((d) => d.category)).toEqual([
      "performance",
      "seo",
      "best-practices",
      "pwa",
      "on-page",
    ])
  })
})
