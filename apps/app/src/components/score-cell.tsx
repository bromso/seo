import { cn } from "@repo/ui/lib/utils"

type Props = {
  score: number | null
  delta?: number | null
  emphasis?: "default" | "muted"
  className?: string
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-ink-tertiary"
  if (score >= 90) return "text-ink-primary"
  if (score >= 50) return "text-ink-primary"
  return "text-status-failure"
}

function deltaColor(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || delta === 0) return "text-ink-tertiary"
  return delta > 0 ? "text-status-success" : "text-status-failure"
}

function deltaGlyph(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || delta === 0) return "·"
  return delta > 0 ? "↑" : "↓"
}

/**
 * A monospace numeric score plus optional delta-from-previous.
 * Used in the dense site list and the run-detail header.
 */
export function ScoreCell({ score, delta, emphasis = "default", className }: Props) {
  const muted = emphasis === "muted"
  return (
    <span className={cn("num inline-flex items-baseline gap-1", className)}>
      <span
        className={cn(
          "font-medium tabular-nums",
          muted ? "text-ink-tertiary" : scoreColor(score),
          "text-[17px] leading-none"
        )}
      >
        {score === null ? "—" : score}
      </span>
      {delta !== undefined && delta !== null ? (
        <span className={cn("text-[13px] tabular-nums leading-none", deltaColor(delta))}>
          {deltaGlyph(delta)}
          {delta !== 0 ? Math.abs(delta) : ""}
        </span>
      ) : null}
    </span>
  )
}
