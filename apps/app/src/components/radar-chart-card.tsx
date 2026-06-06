"use client"
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

// Calm-operator palette: brand accent for the user's site, desaturated neutrals
// for competitors. Less visual shouting than the original primary-color rainbow.
const SERIES_COLORS = [
  "oklch(0.56 0.18 270)", // brand accent — user's site
  "oklch(0.62 0.07 240)", // running blue
  "oklch(0.72 0.10 75)", // caution
  "oklch(0.62 0.12 145)", // success
  "oklch(0.58 0.14 25)", // failure
  "oklch(0.55 0.06 300)", // muted violet
]

export function RadarChartCard({ rows }: { rows: LatestScoreRow[] }) {
  const { data, siteLabels } = latestScoresToRadarData(rows)
  return (
    <section className="rounded-lg border border-border-subtle bg-surface-raised">
      <header className="flex items-baseline justify-between border-b border-border-subtle px-4 py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
          Latest comparison
        </h2>
        {siteLabels.length > 0 ? (
          <span className="num text-[11px] text-ink-tertiary">
            {siteLabels.length} {siteLabels.length === 1 ? "site" : "sites"}
          </span>
        ) : null}
      </header>
      {siteLabels.length === 0 ? (
        <div className="px-4 py-6 text-[13px] text-ink-secondary">
          No completed runs yet. Trigger one above.
        </div>
      ) : (
        <div className="h-72 px-2 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="78%">
              <PolarGrid stroke="var(--border-subtle)" strokeWidth={1} />
              <PolarAngleAxis
                dataKey="category"
                tick={{ fontSize: 11, fill: "var(--ink-secondary)" }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "var(--ink-tertiary)" }}
                stroke="var(--border-subtle)"
              />
              {siteLabels.map((s, i) => (
                <Radar
                  key={s.label}
                  name={s.label}
                  dataKey={s.label}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                  fillOpacity={s.isCompetitor ? 0.08 : 0.22}
                  strokeWidth={s.isCompetitor ? 1 : 1.5}
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
