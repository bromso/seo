"use client"
import { useEffect } from "react"
import { toast } from "sonner"
import { openOfflineDB } from "@/lib/offline/db"
import { replayAuditQueueOnce } from "@/lib/offline/replay-audit-queue"

export function useAuditQueueReplay(ownerId: string): void {
  useEffect(() => {
    const drain = async () => {
      let db: IDBDatabase
      try {
        db = await openOfflineDB()
      } catch {
        return
      }
      const result = await replayAuditQueueOnce(db, fetch, ownerId)
      if (result.successes > 0) {
        toast.success(
          `Started ${result.successes} queued audit${result.successes === 1 ? "" : "s"}`
        )
      }
      if (result.failures > 0) {
        toast.error(
          `${result.failures} queued audit${result.failures === 1 ? "" : "s"} failed to start.`
        )
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
