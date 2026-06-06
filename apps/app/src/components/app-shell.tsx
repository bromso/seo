import type { ReactNode } from "react"
import { TopBar } from "@/components/top-bar"

export function AppShell({
  ownerId,
  email,
  siteLabel,
  children,
}: {
  ownerId: string
  email: string
  siteLabel: string | null
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-surface-base text-ink-primary">
      <TopBar ownerId={ownerId} email={email} siteLabel={siteLabel} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">{children}</main>
    </div>
  )
}
