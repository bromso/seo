import Link from "next/link"
import type { ReactNode } from "react"

type Props = {
  title: string
  subtitle?: string
  /** Bottom row: typically "Don't have an account? Sign up". */
  footer?: ReactNode
  children: ReactNode
}

/**
 * Centered auth shell — a single metallic card on a calm dark surface, sized
 * so the content reads as one column at all viewport widths. Logo at the top,
 * subtle title, content, footer link. Replaces the prior shadcn Card wrapper.
 */
export function AuthShell({ title, subtitle, footer, children }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-base px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="surface-metal rounded-xl px-7 pt-9 pb-8">
          <header className="flex flex-col items-center gap-4 pb-7">
            <Link href="/" aria-label="Home" className="block">
              <Mark />
            </Link>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink-primary">
                {title}
              </h1>
              {subtitle ? (
                <p className="text-pretty text-[14px] text-ink-secondary">{subtitle}</p>
              ) : null}
            </div>
          </header>

          {children}
        </div>

        {footer ? (
          <p className="mt-6 text-center text-[13px] text-ink-secondary">{footer}</p>
        ) : null}
      </div>
    </main>
  )
}

/**
 * Workspace mark — a small surface-metal squircle with a sparkline glyph.
 * Stands in for the (currently unbranded) workspace logo.
 */
function Mark() {
  return (
    <span
      aria-hidden
      className="surface-metal inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-brand-accent"
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>Workspace</title>
        <path d="M3 13.5l4.5-6 3.5 4 3-2 4 5" />
        <circle cx="3" cy="13.5" r="0.5" fill="currentColor" />
        <circle cx="18" cy="14.5" r="0.5" fill="currentColor" />
      </svg>
    </span>
  )
}
