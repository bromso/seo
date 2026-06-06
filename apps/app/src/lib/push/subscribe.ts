"use client"

export type PushSubscriptionPayload = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Convert a base64url-encoded VAPID public key to the Uint8Array
 *  that PushManager.subscribe requires. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(normalized)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf
}

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false
  return Boolean(navigator.serviceWorker)
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return await reg.pushManager.getSubscription()
}

export async function subscribeToPush(
  vapidPublicKey: string
): Promise<PushSubscriptionPayload | null> {
  if (!isPushSupported()) return null
  if (typeof Notification === "undefined") return null

  let permission = Notification.permission
  if (permission === "default") {
    permission = await Notification.requestPermission()
  }
  if (permission !== "granted") return null

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return toPayload(existing)

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  })
  return toPayload(subscription)
}

export async function unsubscribeFromPush(): Promise<string | null> {
  if (!isPushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return endpoint
}

function toPayload(sub: PushSubscription): PushSubscriptionPayload {
  const json = sub.toJSON()
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
  }
}
