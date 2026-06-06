"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { toast } from "sonner"

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in cancelled.",
  missing_code: "Sign-in didn't complete. Try again.",
  oauth_unavailable: "That provider isn't available right now.",
}

export function AuthErrorToast() {
  const router = useRouter()
  const params = useSearchParams()
  const error = params.get("error")

  useEffect(() => {
    if (!error) return
    toast.error(ERROR_MESSAGES[error] ?? "Sign-in failed. Try again.")
    const next = new URLSearchParams(params)
    next.delete("error")
    router.replace(`?${next.toString()}`)
  }, [error, params, router])

  return null
}
