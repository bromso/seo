"use client"
import { Button } from "@repo/ui/components/button"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  getCurrentSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/subscribe"

export function PushNotificationsButton() {
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!isPushSupported()) return
    setSupported(true)
    void getCurrentSubscription().then((sub) => setSubscribed(sub !== null))
  }, [])

  if (!supported) return null

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        start(async () => {
          if (subscribed) {
            const endpoint = await unsubscribeFromPush()
            if (!endpoint) {
              toast.error("Already unsubscribed")
              setSubscribed(false)
              return
            }
            const res = await fetch("/api/push-subscribe", {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ endpoint }),
            })
            if (!res.ok) {
              toast.error("Failed to unsubscribe")
              return
            }
            toast.success("Notifications disabled")
            setSubscribed(false)
            return
          }

          const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
          if (!key) {
            toast.error("Push notifications not configured")
            return
          }
          const payload = await subscribeToPush(key)
          if (!payload) {
            toast.error("Notification permission denied")
            return
          }
          const res = await fetch("/api/push-subscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              endpoint: payload.endpoint,
              keys: payload.keys,
              userAgent: navigator.userAgent,
            }),
          })
          if (!res.ok) {
            toast.error("Failed to enable notifications")
            return
          }
          toast.success("Notifications enabled")
          setSubscribed(true)
        })
      }}
    >
      {pending ? "…" : subscribed ? "Disable notifications" : "Enable notifications"}
    </Button>
  )
}
