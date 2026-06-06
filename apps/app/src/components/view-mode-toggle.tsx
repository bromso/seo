"use client"
import { cn } from "@repo/ui/lib/utils"

export type ViewMode = "table" | "cards"

type Props = {
  value: ViewMode
  onChange: (next: ViewMode) => void
  className?: string
}

/**
 * Segmented control toggling between dense table view and card grid view.
 * Calm-operator: 1px hairline, no shadow, accent only on active segment.
 */
export function ViewModeToggle({ value, onChange, className }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Layout"
      className={cn(
        "inline-flex items-center rounded-md border border-border-subtle bg-surface-raised p-0.5",
        className
      )}
    >
      <ToggleButton
        value="table"
        active={value === "table"}
        onClick={() => onChange("table")}
        label="Table"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <title>Table</title>
          <path d="M1.5 3h9M1.5 6h9M1.5 9h9" strokeLinecap="round" />
        </svg>
      </ToggleButton>
      <ToggleButton
        value="cards"
        active={value === "cards"}
        onClick={() => onChange("cards")}
        label="Cards"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <title>Cards</title>
          <rect x="1.5" y="1.5" width="4" height="4" rx="0.5" />
          <rect x="6.5" y="1.5" width="4" height="4" rx="0.5" />
          <rect x="1.5" y="6.5" width="4" height="4" rx="0.5" />
          <rect x="6.5" y="6.5" width="4" height="4" rx="0.5" />
        </svg>
      </ToggleButton>
    </div>
  )
}

function ToggleButton({
  value,
  active,
  onClick,
  label,
  children,
}: {
  value: ViewMode
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
      data-value={value}
      className={cn(
        "inline-flex h-7 w-9 items-center justify-center rounded transition-colors duration-75",
        active ? "bg-surface-base text-ink-primary" : "text-ink-tertiary hover:text-ink-primary"
      )}
    >
      {children}
    </button>
  )
}
