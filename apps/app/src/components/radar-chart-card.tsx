"use client"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import { ChartModeToggle } from "@/components/chart-mode-toggle"
import type { LatestScoreRow } from "@/lib/db-types"
import { latestScoresToBarData, latestScoresToRadarData } from "@/lib/radar-data"
import type { ChartMode } from "@/lib/use-persisted-chart-mode"

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

type Props = {
  rows: LatestScoreRow[]
  mode: ChartMode
  onModeChange: (next: ChartMode) => void
}

export function RadarChartCard({ rows, mode, onModeChange }: Props) {
  const radar = latestScoresToRadarData(rows)
  const bar = latestScoresToBarData(rows)
  const siteLabels = radar.siteLabels

  return (
    <section className="rounded-lg border border-border-subtle bg-surface-raised">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <h2 className="text-[14px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
          Latest comparison
        </h2>
        <div className="flex items-center gap-3">
          {siteLabels.length > 0 ? (
            <span className="num text-[13px] text-ink-tertiary">
              {siteLabels.length} {siteLabels.length === 1 ? "site" : "sites"}
            </span>
          ) : null}
          <ChartModeToggle value={mode} onChange={onModeChange} />
        </div>
      </header>
      {siteLabels.length === 0 ? (
        <div className="px-5 py-8 text-[16px] text-ink-secondary">
          No completed runs yet. Trigger one above.
        </div>
      ) : (
        <div className="h-80 px-2 py-4">
          <ResponsiveContainer width="100%" height="100%">
            {mode === "radar" ? (
              <RadarChart data={radar.data} outerRadius="78%">
                <PolarGrid stroke="var(--border-subtle)" strokeWidth={1} />
                <PolarAngleAxis
                  dataKey="category"
                  tick={{ fontSize: 13, fill: "var(--ink-secondary)" }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={{ fontSize: 12, fill: "var(--ink-tertiary)" }}
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
            ) : (
              <BarChart
                data={bar.data}
                margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                barCategoryGap="22%"
                barGap={2}
              >
                <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 13, fill: "var(--ink-secondary)" }}
                  axisLine={{ stroke: "var(--border-subtle)" }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 12, fill: "var(--ink-tertiary)" }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Legend
                  verticalAlign="top"
                  height={28}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, color: "var(--ink-tertiary)" }}
                />
                {siteLabels.map((s, i) => (
                  <Bar
                    key={s.label}
                    dataKey={s.label}
                    fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                    fillOpacity={s.isCompetitor ? 0.55 : 0.9}
                    radius={[2, 2, 0, 0]}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
