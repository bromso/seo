import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow } from "@/lib/db-types"

type Props = {
  scores: LatestScoreRow[]
  variant?: "primary" | "neutral"
  size?: number
}

const SIZE = 144

function categoryShortChar(c: Category): string {
  switch (c) {
    case "performance":
      return "Perf"
    case "seo":
      return "SEO"
    case "best-practices":
      return "BP"
    case "pwa":
      return "PWA"
    case "on-page":
      return "OP"
  }
}

/**
 * Pure-SVG mini bar chart of one site's 5 category scores. Mirrors the visual
 * weight of `<SiteRadarMini>` so the card layout stays steady when toggling.
 */
export function SiteBarMini({ scores, variant = "primary", size = SIZE }: Props) {
  const width = size
  const height = size
  const padX = 14
  const padTop = 12
  const labelHeight = 18
  const chartHeight = height - padTop - labelHeight
  const chartTop = padTop
  const chartBottom = chartTop + chartHeight

  const fill = variant === "primary" ? "var(--brand-accent)" : "var(--ink-tertiary)"
  const fillOpacity = variant === "primary" ? 0.85 : 0.5

  const byCategory = new Map<Category, number | null>()
  for (const r of scores) {
    if (r.category) byCategory.set(r.category, r.score)
  }

  const usableW = width - padX * 2
  const slot = usableW / CATEGORIES.length
  const barW = Math.min(14, slot * 0.55)

  return (
    <svg
      role="img"
      aria-label="Score bars"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="block max-w-full"
    >
      <title>Score bars</title>
      {/* Baseline + 50/100 grid lines */}
      {[0, 50, 100].map((v) => {
        const y = chartBottom - (v / 100) * chartHeight
        return (
          <line
            key={`g-${v}`}
            x1={padX}
            y1={y}
            x2={width - padX}
            y2={y}
            stroke="var(--border-subtle)"
            strokeWidth={1}
          />
        )
      })}
      {CATEGORIES.map((c, i) => {
        const raw = byCategory.get(c)
        const value = raw === null || raw === undefined ? 0 : raw
        const h = (value / 100) * chartHeight
        const cx = padX + slot * (i + 0.5)
        const x = cx - barW / 2
        const y = chartBottom - h
        return (
          <g key={c}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 1)}
              rx={1.5}
              fill={fill}
              fillOpacity={fillOpacity}
            />
            <text
              x={cx}
              y={chartBottom + 12}
              fontSize="11"
              fontWeight={600}
              fill="var(--ink-tertiary)"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ letterSpacing: "0.04em" }}
            >
              {categoryShortChar(c)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
