"use client"
import { useCallback } from "react"
import { enqueueAuditRun, type QueuedAuditRun } from "@/lib/offline/audit-queue"
import { registerBackgroundSync } from "@/lib/offline/background-sync"
import { openOfflineDB } from "@/lib/offline/db"
import { safeRandomUUID } from "@/lib/safe-uuid"

export type QueueAuditResult =
  | { ok: true; runId: string }
  | { ok: true; queued: true; queueId: string }
  | { ok: false; error: string }

export type QueueAuditInput = {
  siteId: string
  requestedUrl: string
}

export function useQueueAudit(
  ownerId: string
): (input: QueueAuditInput) => Promise<QueueAuditResult> {
  return useCallback(
    async (input: QueueAuditInput) => {
      const idempotencyKey = safeRandomUUID()

      async function enqueue(): Promise<QueueAuditResult> {
        try {
          const db = await openOfflineDB()
          const entry: QueuedAuditRun = {
            id: idempotencyKey,
            ownerId,
            siteId: input.siteId,
            requestedUrl: input.requestedUrl,
            queuedAt: Date.now(),
          }
          await enqueueAuditRun(db, entry)
          void registerBackgroundSync("audit-run-queue")
          return { ok: true, queued: true, queueId: idempotencyKey }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "queue failed",
          }
        }
      }

      let res: Response
      try {
        res = await fetch("/api/audit-run", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(input),
        })
      } catch {
        // Network error — definitely offline.
        return enqueue()
      }

      if (!res.ok) {
        // HTTP error. If we're offline-ish, queue; otherwise surface.
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          return enqueue()
        }
        return { ok: false, error: `HTTP ${res.status}` }
      }

      const body = (await res.json()) as { ok: true; runId: string } | { ok: false; error: string }
      return body
    },
    [ownerId]
  )
}
