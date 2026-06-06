"use client"
import { cn } from "@repo/ui/lib/utils"
import Link from "next/link"
import type { ReactNode } from "react"

type Props = {
  label: string
  icon: ReactNode
  onClick?: () => void
  /** When provided, renders a Next `<Link>` instead of a `<button>`. */
  href?: string
  /** "primary" gets brand-accent fill; "metal" gets the subtle surface-metal style. */
  tone?: "primary" | "metal"
  disabled?: boolean
  className?: string
  type?: "button" | "submit"
}

/**
 * Single-row auth provider button. 44px tall, icon on the left, label
 * optically centered (the icon's width is reserved on the right via a
 * spacer so the label sits in the visual middle). Renders a `<Link>`
 * when `href` is present, otherwise a `<button>`.
 */
export function AuthProviderButton({
  label,
  icon,
  onClick,
  href,
  tone = "metal",
  disabled,
  className,
  type = "button",
}: Props) {
  const base =
    "group relative inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg px-4 text-[14.5px] font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-60"
  const tonal =
    tone === "primary"
      ? "bg-brand-accent text-brand-accent-ink hover:brightness-105"
      : "surface-metal surface-metal-interactive text-ink-primary"

  const inner = (
    <>
      <span className="absolute left-4 inline-flex shrink-0 items-center">{icon}</span>
      <span className="text-pretty">{label}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={cn(base, tonal, className)}>
        {inner}
      </Link>
    )
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(base, tonal, className)}
    >
      {inner}
    </button>
  )
}
