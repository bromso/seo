"use client"
import { useEffect, useState } from "react"
import { formatRelativeTime } from "@/lib/format"

type Props = { cachedAt?: number | null }

export function OfflineBanner({ cachedAt }: Props = {}) {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    return () => {
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
    }
  }, [])

  if (online) return null
  const message = cachedAt
    ? `You are offline. Showing data cached ${formatRelativeTime(new Date(cachedAt))}.`
    : "You are offline. Showing the last data we cached on this device."
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {message}
    </div>
  )
}
