"use client"
import { useEffect } from "react"
import { toast } from "sonner"
import { type QueuedAuditRun, readQueueForOwner, removeFromQueue } from "@/lib/offline/audit-queue"
import { openOfflineDB } from "@/lib/offline/db"

export function useAuditQueueReplay(ownerId: string): void {
  useEffect(() => {
    const drain = async () => {
      let entries: QueuedAuditRun[] = []
      try {
        const db = await openOfflineDB()
        entries = await readQueueForOwner(db, ownerId)
      } catch {
        return
      }
      if (entries.length === 0) return

      let successes = 0
      let failures = 0
      for (const entry of entries) {
        try {
          const res = await fetch("/api/audit-run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              siteId: entry.siteId,
              requestedUrl: entry.requestedUrl,
            }),
          })
          if (!res.ok) {
            failures += 1
            continue
          }
          const body = (await res.json()) as
            | { ok: true; runId: string }
            | { ok: false; error: string }
          if (!body.ok) {
            failures += 1
            continue
          }
          try {
            const db = await openOfflineDB()
            await removeFromQueue(db, entry.id)
          } catch {
            // leave in queue
          }
          successes += 1
        } catch {
          failures += 1
        }
      }
      if (successes > 0) {
        toast.success(`Started ${successes} queued audit${successes === 1 ? "" : "s"}`)
      }
      if (failures > 0) {
        toast.error(`${failures} queued audit${failures === 1 ? "" : "s"} failed to start.`)
      }
    }

    if (typeof navigator === "undefined" || navigator.onLine) {
      void drain()
    }

    const handler = () => {
      void drain()
    }
    window.addEventListener("online", handler)
    return () => {
      window.removeEventListener("online", handler)
    }
  }, [ownerId])
}
