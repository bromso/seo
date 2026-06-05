"use client"
import { Button } from "@repo/ui/components/button"

export function SignOutButton() {
  return (
    <form action="/sign-out" method="POST">
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  )
}
