import type { Logger } from "@repo/runner-core"
import webpush, { type PushSubscription as WebPushSub } from "web-push"

export type VapidConfig = {
  publicKey: string
  privateKey: string
  subject: string
}

export type PushPayload = {
  title: string
  body: string
  data?: { url?: string }
}

export type PushDbApi = {
  listSubscriptionsForOwner: (
    ownerId: string
  ) => Promise<Array<{ endpoint: string; p256dh: string; auth: string }>>
  deleteSubscriptionByEndpoint: (endpoint: string) => Promise<void>
}

export function readVapidFromEnv(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_EMAIL
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

export async function sendPushForRun(opts: {
  vapid: VapidConfig
  db: PushDbApi
  ownerId: string
  runId: string
  requestedUrl: string
  logger?: Logger
}): Promise<{ sent: number; deleted: number; failed: number }> {
  const { vapid, db, ownerId, runId, requestedUrl, logger } = opts
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

  const subs = await db.listSubscriptionsForOwner(ownerId)
  if (subs.length === 0) return { sent: 0, deleted: 0, failed: 0 }

  const payload: PushPayload = {
    title: "Audit completed",
    body: `Your audit for ${requestedUrl} is ready`,
    data: { url: `/dashboard/runs/${runId}` },
  }
  const body = JSON.stringify(payload)

  let sent = 0
  let deleted = 0
  let failed = 0

  for (const s of subs) {
    const sub: WebPushSub = {
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    }
    try {
      await webpush.sendNotification(sub, body)
      sent += 1
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 410 || status === 404) {
        try {
          await db.deleteSubscriptionByEndpoint(s.endpoint)
          deleted += 1
        } catch (delErr) {
          logger?.({
            kind: "warn",
            message: `failed to delete stale sub: ${(delErr as Error).message}`,
          })
        }
      } else {
        failed += 1
        logger?.({
          kind: "warn",
          message: `push send failed (status=${status}): ${(err as Error).message}`,
        })
      }
    }
  }

  return { sent, deleted, failed }
}

/** Thin wrapper that encapsulates the "should we even send" decision.
 *  Returns null when the run wasn't successful or vapid isn't configured. */
export async function maybeSendPushForCompletedRun(opts: {
  runStatus: string
  vapid: VapidConfig | null
  db: PushDbApi
  ownerId: string
  runId: string
  requestedUrl: string
  logger?: Logger
}): Promise<{ sent: number; deleted: number; failed: number } | null> {
  if (opts.runStatus !== "completed") return null
  if (!opts.vapid) return null
  const base = {
    vapid: opts.vapid,
    db: opts.db,
    ownerId: opts.ownerId,
    runId: opts.runId,
    requestedUrl: opts.requestedUrl,
  }
  return sendPushForRun(opts.logger ? { ...base, logger: opts.logger } : base)
}
