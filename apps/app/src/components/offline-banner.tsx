"use client"
import { useEffect, useState } from "react"
import { formatRelativeTime } from "@/lib/format"

type Props = { cachedAt?: number | null }

export function OfflineBanner({ cachedAt }: Props = {}) {
  // Always start "online" on first render so server-rendered HTML matches client
  // hydration. The actual navigator.onLine value is read in the mount effect.
  const [online, setOnline] = useState<boolean>(true)

  useEffect(() => {
    setOnline(navigator.onLine)
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
  const ageText = cachedAt ? formatRelativeTime(new Date(cachedAt)) : "earlier"
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-raised px-2.5 py-1.5 text-[12px] text-ink-secondary"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-status-caution" />
      <span>{`Offline · showing data cached ${ageText}`}</span>
    </div>
  )
}
