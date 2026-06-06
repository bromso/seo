import { cn } from "@repo/ui/lib/utils"

type Status = "idle" | "queued" | "running" | "success" | "caution" | "failure"

const styles: Record<Status, string> = {
  idle: "bg-ink-tertiary",
  queued: "bg-status-running",
  running: "bg-status-running animate-pulse",
  success: "bg-status-success",
  caution: "bg-status-caution",
  failure: "bg-status-failure",
}

export function StatusDot({
  status,
  className,
  label,
}: {
  status: Status
  label?: string
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", styles[status])} />
      {label ? (
        <span className="text-[13px] uppercase tracking-wider text-ink-secondary">{label}</span>
      ) : null}
    </span>
  )
}
