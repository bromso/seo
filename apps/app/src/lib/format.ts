export type RunStatus = "queued" | "running" | "completed" | "partial" | "failed"

export function formatScore(score: number | null): string {
  if (score === null) return "—"
  const clamped = Math.max(0, Math.min(100, score))
  return String(Math.round(clamped))
}

export function scoreColorClass(score: number | null): string {
  if (score === null) return "text-muted-foreground"
  if (score >= 90) return "text-green-600"
  if (score >= 50) return "text-yellow-600"
  return "text-red-600"
}

export function formatRelativeTime(input: Date | string, now: Date = new Date()): string {
  const t = typeof input === "string" ? new Date(input) : input
  const diffSec = Math.floor((now.getTime() - t.getTime()) / 1000)
  if (diffSec < 10) return "just now"
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

export type BadgeVariant = "default" | "secondary" | "outline" | "destructive"

export function statusBadgeVariant(status: RunStatus): BadgeVariant {
  switch (status) {
    case "queued":
      return "secondary"
    case "running":
      return "default"
    case "completed":
      return "default"
    case "partial":
      return "outline"
    case "failed":
      return "destructive"
  }
}
