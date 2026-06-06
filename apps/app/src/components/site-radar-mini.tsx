import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow } from "@/lib/db-types"

type Props = {
  /** All score rows for one site (one per category). */
  scores: LatestScoreRow[]
  /** Use the brand accent (your site) or a neutral stroke (competitors). */
  variant?: "primary" | "neutral"
  /** Pixel size of the chart's bounding box. Default 144. */
  size?: number
}

const SIZE = 144
const PADDING = 18
const RING_COUNT = 4

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
 * Pure-SVG mini radar chart of a single site's 5 category scores. Lightweight
 * (no recharts), color-tinted by variant, labelled with category abbreviations.
 */
export function SiteRadarMini({ scores, variant = "primary", size = SIZE }: Props) {
  const center = size / 2
  const radius = (size - PADDING * 2) / 2
  const stroke = variant === "primary" ? "var(--brand-accent)" : "var(--ink-tertiary)"
  const fillOpacity = variant === "primary" ? 0.18 : 0.08

  const byCategory = new Map<Category, number | null>()
  for (const r of scores) {
    if (r.category) byCategory.set(r.category, r.score)
  }

  const angleStep = (Math.PI * 2) / CATEGORIES.length

  const points = CATEGORIES.map((c, i) => {
    const raw = byCategory.get(c)
    const value = raw === null || raw === undefined ? 0 : raw
    const r = (value / 100) * radius
    const angle = -Math.PI / 2 + i * angleStep
    const x = center + Math.cos(angle) * r
    const y = center + Math.sin(angle) * r
    return { x, y, value, label: categoryShortChar(c) }
  })

  const polygon = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")

  const axisEnds = CATEGORIES.map((_, i) => {
    const angle = -Math.PI / 2 + i * angleStep
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    }
  })

  const labelPositions = CATEGORIES.map((c, i) => {
    const angle = -Math.PI / 2 + i * angleStep
    const r = radius + 10
    return {
      label: categoryShortChar(c),
      x: center + Math.cos(angle) * r,
      y: center + Math.sin(angle) * r,
      angle,
    }
  })

  return (
    <svg
      role="img"
      aria-label="Score radar"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="block max-w-full"
    >
      <title>Score radar</title>
      {/* Concentric rings */}
      {Array.from({ length: RING_COUNT }, (_, i) => {
        const r = ((i + 1) / RING_COUNT) * radius
        return (
          <circle
            key={`r-${i}`}
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth={1}
          />
        )
      })}
      {/* Spokes */}
      {axisEnds.map((p, i) => (
        <line
          key={`a-${i}`}
          x1={center}
          y1={center}
          x2={p.x}
          y2={p.y}
          stroke="var(--border-subtle)"
          strokeWidth={1}
        />
      ))}
      {/* Data polygon */}
      <polygon
        points={polygon}
        fill={stroke}
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Vertex dots */}
      {points.map((p, i) => (
        <circle key={`v-${i}`} cx={p.x} cy={p.y} r={2} fill={stroke} />
      ))}
      {/* Axis labels */}
      {labelPositions.map((p, i) => {
        const anchor =
          Math.cos(p.angle) > 0.3 ? "start" : Math.cos(p.angle) < -0.3 ? "end" : "middle"
        return (
          <text
            key={`l-${i}`}
            x={p.x}
            y={p.y}
            fontSize="11"
            fontWeight={600}
            fill="var(--ink-tertiary)"
            textAnchor={anchor}
            dominantBaseline="middle"
            style={{ letterSpacing: "0.04em" }}
          >
            {p.label}
          </text>
        )
      })}
    </svg>
  )
}
