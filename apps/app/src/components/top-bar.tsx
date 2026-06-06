"use client"
import Link from "next/link"
import { InstallButton } from "@/components/install-button"
import { SignOutButton } from "@/components/sign-out-button"

/**
 * 48px top bar. Workspace identity on the left, search stub in the middle,
 * actions on the right. Pure flex row, hairline bottom border.
 */
export function TopBar({
  ownerId,
  email,
  siteLabel,
}: {
  ownerId: string
  email: string
  siteLabel: string | null
}) {
  const initial = (siteLabel?.[0] ?? email?.[0] ?? "?").toUpperCase()
  return (
    <header className="sticky top-0 z-20 h-14 border-b border-border-subtle bg-surface-base/90 backdrop-blur-[2px]">
      <div className="flex h-full items-center gap-3 px-4">
        {/* Workspace */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 rounded px-2 py-1 text-[15px] font-medium text-ink-primary hover:bg-surface-sunken transition-colors duration-75"
        >
          <span
            aria-hidden
            className="num inline-flex h-6 w-6 items-center justify-center rounded bg-ink-primary text-[13px] font-semibold text-surface-base"
          >
            {initial}
          </span>
          <span className="truncate max-w-[180px]">{siteLabel ?? "Workspace"}</span>
        </Link>

        {/* Center search trigger */}
        <button
          type="button"
          aria-label="Search"
          disabled
          className="hidden md:flex flex-1 max-w-md items-center gap-2 rounded-md border border-border-subtle bg-surface-raised px-3 h-9 text-[14px] text-ink-tertiary cursor-not-allowed"
        >
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <title>Search</title>
            <circle cx="5" cy="5" r="3" />
            <path d="m8 8 2 2" strokeLinecap="round" />
          </svg>
          <span className="flex-1 text-left">Search sites, runs…</span>
          <span className="num inline-flex items-center gap-0.5 rounded border border-border-subtle px-1.5 py-0.5 text-[12px] text-ink-tertiary">
            ⌘K
          </span>
        </button>

        <span className="hidden md:inline-block flex-1 md:hidden" />

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2">
          <InstallButton />
          <span
            aria-hidden
            className="hidden sm:inline-block text-[14px] text-ink-tertiary num truncate max-w-[160px]"
          >
            {email}
          </span>
          <SignOutButton ownerId={ownerId} />
        </div>
      </div>
    </header>
  )
}
