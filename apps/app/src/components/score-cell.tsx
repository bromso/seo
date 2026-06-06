import { cn } from "@repo/ui/lib/utils"

type Props = {
  score: number | null
  delta?: number | null
  /** "inline" (default) puts score and delta side-by-side; "stacked" puts delta
   *  on its own line beneath the score — cleaner reading rhythm in cells where
   *  there's room for two lines. */
  layout?: "inline" | "stacked"
  emphasis?: "default" | "muted"
  className?: string
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-ink-tertiary"
  if (score < 50) return "text-status-failure"
  return "text-ink-primary"
}

function deltaColor(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || delta === 0) return "text-ink-tertiary"
  return delta > 0 ? "text-status-success" : "text-status-failure"
}

/** Format a delta as a signed number for clean scan-ability: "+16", "-10", "·". */
function formatDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined) return "·"
  if (delta === 0) return "·"
  return delta > 0 ? `+${delta}` : String(delta)
}

/**
 * A monospace numeric score with optional delta-from-previous.
 * - `inline`: "57 +16" (default; used in dense table rows)
 * - `stacked`: score on top, delta on the line beneath (used in cards)
 */
export function ScoreCell({
  score,
  delta,
  layout = "inline",
  emphasis = "default",
  className,
}: Props) {
  const muted = emphasis === "muted"
  const scoreClass = cn(
    "num font-medium tabular-nums leading-none",
    muted ? "text-ink-tertiary" : scoreColor(score),
    "text-[17px]"
  )
  const deltaClass = cn("num tabular-nums leading-none text-[13px]", deltaColor(delta))

  if (layout === "stacked") {
    return (
      <span className={cn("inline-flex flex-col gap-1.5", className)}>
        <span className={scoreClass}>{score === null ? "—" : score}</span>
        {delta !== undefined ? <span className={deltaClass}>{formatDelta(delta)}</span> : null}
      </span>
    )
  }

  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className={scoreClass}>{score === null ? "—" : score}</span>
      {delta !== undefined ? <span className={deltaClass}>{formatDelta(delta)}</span> : null}
    </span>
  )
}
