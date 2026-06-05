import { describe, expect, it } from "vitest"
import type { ScoreTrendRow } from "@/lib/db-types"
import { scoreTrendsToChartData } from "@/lib/trend-data"

const baseRow = {
  site_id: "site-id",
  owner_id: "owner",
  label: null,
  is_competitor: false,
} satisfies Omit<ScoreTrendRow, "category" | "score" | "measured_at">

function mkRow(
  o: Partial<ScoreTrendRow> & {
    category: ScoreTrendRow["category"]
    score: number
    measured_at: string
    label?: string | null
  }
): ScoreTrendRow {
  return { ...baseRow, ...o }
}

describe("scoreTrendsToChartData", () => {
  it("filters to the requested category", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({
        label: "My site",
        category: "performance",
        score: 80,
        measured_at: "2026-06-01T12:00:00Z",
      }),
      mkRow({
        label: "My site",
        category: "seo",
        score: 88,
        measured_at: "2026-06-01T12:00:00Z",
      }),
    ]
    const { data, siteLabels } = scoreTrendsToChartData(rows, "performance")
    expect(siteLabels).toEqual(["My site"])
    expect(data).toEqual([{ measuredAt: "2026-06-01T12:00:00Z", "My site": 80 }])
  })

  it("sorts data points by measured_at ascending", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({
        label: "My site",
        category: "performance",
        score: 90,
        measured_at: "2026-06-03T12:00:00Z",
      }),
      mkRow({
        label: "My site",
        category: "performance",
        score: 70,
        measured_at: "2026-06-01T12:00:00Z",
      }),
      mkRow({
        label: "My site",
        category: "performance",
        score: 80,
        measured_at: "2026-06-02T12:00:00Z",
      }),
    ]
    const { data } = scoreTrendsToChartData(rows, "performance")
    expect(data.map((d) => d.measuredAt)).toEqual([
      "2026-06-01T12:00:00Z",
      "2026-06-02T12:00:00Z",
      "2026-06-03T12:00:00Z",
    ])
  })

  it("groups multiple sites side-by-side per timestamp", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({
        site_id: "a",
        label: "My site",
        category: "performance",
        score: 80,
        measured_at: "2026-06-01T12:00:00Z",
      }),
      mkRow({
        site_id: "b",
        label: "Competitor",
        is_competitor: true,
        category: "performance",
        score: 90,
        measured_at: "2026-06-01T12:00:00Z",
      }),
    ]
    const { data, siteLabels } = scoreTrendsToChartData(rows, "performance")
    expect(siteLabels.sort()).toEqual(["Competitor", "My site"])
    expect(data).toEqual([
      {
        measuredAt: "2026-06-01T12:00:00Z",
        "My site": 80,
        Competitor: 90,
      },
    ])
  })

  it("returns empty data + empty siteLabels for no matching rows", () => {
    const { data, siteLabels } = scoreTrendsToChartData([], "performance")
    expect(data).toEqual([])
    expect(siteLabels).toEqual([])
  })

  it("uses url as label when label is null", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({
        site_id: "x",
        label: null,
        category: "performance",
        score: 88,
        measured_at: "2026-06-01T12:00:00Z",
      }),
    ]
    const { siteLabels } = scoreTrendsToChartData(rows, "performance")
    expect(siteLabels.length).toBe(1)
    expect(siteLabels[0]).toBeTruthy()
  })

  it("falls back to site_id when label is the empty string", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({
        site_id: "site-a",
        label: "",
        category: "performance",
        score: 50,
        measured_at: "2026-06-01T12:00:00Z",
      }),
      mkRow({
        site_id: "site-b",
        label: "",
        is_competitor: true,
        category: "performance",
        score: 70,
        measured_at: "2026-06-01T12:00:00Z",
      }),
    ]
    const { siteLabels, data } = scoreTrendsToChartData(rows, "performance")
    expect(siteLabels).toEqual(["site-a", "site-b"])
    expect(data[0]).toMatchObject({
      measuredAt: "2026-06-01T12:00:00Z",
      "site-a": 50,
      "site-b": 70,
    })
  })
})
