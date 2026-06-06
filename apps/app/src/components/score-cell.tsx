import { cn } from "@repo/ui/lib/utils"

type Props = {
  score: number | null
  delta?: number | null
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

/** Render the delta as an arrow + magnitude, or a dot when there's nothing to show. */
function formatDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined) return "·"
  if (delta === 0) return "·"
  return delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`
}

/**
 * Score (right-aligned) + delta (left-aligned), split across a 2-column
 * sub-grid. Score columns line up vertically; delta columns line up vertically.
 * The fixed gap between them stops the "57 +16 / 62 +21" jitter you get when
 * variable-width numbers butt against each other.
 */
export function ScoreCell({ score, delta, emphasis = "default", className }: Props) {
  const muted = emphasis === "muted"
  return (
    <span
      className={cn(
        "num grid grid-cols-2 items-baseline gap-x-2.5 tabular-nums leading-none",
        className
      )}
    >
      <span
        className={cn(
          "text-right text-[17px] font-medium",
          muted ? "text-ink-tertiary" : scoreColor(score)
        )}
      >
        {score === null ? "—" : score}
      </span>
      <span className={cn("text-left text-[13px]", deltaColor(delta))}>
        {delta === undefined ? "" : formatDelta(delta)}
      </span>
    </span>
  )
}
