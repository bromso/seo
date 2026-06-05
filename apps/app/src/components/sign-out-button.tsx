"use client"
import { Button } from "@repo/ui/components/button"
import { useTransition } from "react"
import { clearDashboardCache } from "@/lib/offline/clear-cache"

export function SignOutButton({ ownerId }: { ownerId: string }) {
  const [pending, start] = useTransition()
  return (
    <form
      action="/sign-out"
      method="POST"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        start(async () => {
          await clearDashboardCache(ownerId)
          form.submit()
        })
      }}
    >
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </form>
  )
}
