import { awaitRequest, txStore } from "@/lib/offline/_idb"
import type { QueuedAuditRun } from "@/lib/offline/audit-queue"
import { openOfflineDB, STORE_AUDIT_QUEUE, STORE_DASHBOARD } from "@/lib/offline/db"
import { clearSnapshot, type DashboardSnapshot } from "@/lib/offline/snapshot"

export async function clearDashboardCache(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    await clearSnapshot(db, ownerId)
  } catch {
    // IDB unavailable — best-effort cleanup, do not block sign-out
  }
}

export async function sweepOtherOwners(db: IDBDatabase, currentOwnerId: string): Promise<void> {
  try {
    const snaps = await awaitRequest<DashboardSnapshot[]>(
      txStore(db, STORE_DASHBOARD, "readonly").getAll()
    )
    for (const s of snaps) {
      if (s.ownerId !== currentOwnerId) {
        await awaitRequest(txStore(db, STORE_DASHBOARD, "readwrite").delete(s.ownerId))
      }
    }
    const entries = await awaitRequest<QueuedAuditRun[]>(
      txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll()
    )
    for (const e of entries) {
      if (e.ownerId !== currentOwnerId) {
        await awaitRequest(txStore(db, STORE_AUDIT_QUEUE, "readwrite").delete(e.id))
      }
    }
  } catch {
    // best-effort GC; never block startup
  }
}
