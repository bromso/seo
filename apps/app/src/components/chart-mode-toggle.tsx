"use client"
import { cn } from "@repo/ui/lib/utils"
import type { ChartMode } from "@/lib/use-persisted-chart-mode"

type Props = {
  value: ChartMode
  onChange: (next: ChartMode) => void
  className?: string
}

/**
 * Segmented toggle between radar and grouped-bar chart shapes. Same shape as
 * `<ViewModeToggle>` so the two controls sit comfortably side-by-side.
 */
export function ChartModeToggle({ value, onChange, className }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Chart type"
      className={cn(
        "inline-flex items-center rounded-md border border-border-subtle bg-surface-raised p-0.5",
        className
      )}
    >
      <Btn active={value === "radar"} onClick={() => onChange("radar")} label="Radar">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <title>Radar</title>
          <polygon points="7,1.5 12.5,5.5 10.3,12.5 3.7,12.5 1.5,5.5" strokeLinejoin="round" />
          <line x1="7" y1="1.5" x2="7" y2="12.5" opacity="0.45" />
          <line x1="1.5" y1="5.5" x2="12.5" y2="5.5" opacity="0.45" />
        </svg>
      </Btn>
      <Btn active={value === "bars"} onClick={() => onChange("bars")} label="Bars">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <title>Bars</title>
          <line x1="3" y1="11" x2="3" y2="7" />
          <line x1="7" y1="11" x2="7" y2="3" />
          <line x1="11" y1="11" x2="11" y2="5" />
          <line x1="1.5" y1="12" x2="12.5" y2="12" opacity="0.45" />
        </svg>
      </Btn>
    </div>
  )
}

function Btn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-9 items-center justify-center rounded transition-colors duration-75",
        active ? "bg-surface-base text-ink-primary" : "text-ink-tertiary hover:text-ink-primary"
      )}
    >
      {children}
    </button>
  )
}
