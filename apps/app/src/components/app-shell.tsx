import Link from "next/link"
import type { ReactNode } from "react"
import { InstallButton } from "@/components/install-button"
import { SignOutButton } from "@/components/sign-out-button"

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
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm font-medium">
            SEO Audit
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {siteLabel ? <span className="text-muted-foreground">{siteLabel}</span> : null}
            <span className="text-muted-foreground">{email}</span>
            <InstallButton />
            <SignOutButton ownerId={ownerId} />
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 py-8">{children}</div>
    </div>
  )
}
