import { awaitRequest, txStore } from "@/lib/offline/_idb"
import type { QueuedAuditRun } from "@/lib/offline/audit-queue"
import {
  openOfflineDB,
  STORE_AUDIT_QUEUE,
  STORE_DASHBOARD,
  STORE_RUN_SNAPSHOTS,
} from "@/lib/offline/db"
import { clearRunSnapshotsForOwner, type RunDetailSnapshot } from "@/lib/offline/run-snapshot"
import { clearSnapshot, type DashboardSnapshot } from "@/lib/offline/snapshot"

export async function clearDashboardCache(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    await clearSnapshot(db, ownerId)
  } catch {
    // IDB unavailable — best-effort cleanup, do not block sign-out
  }
}

export async function clearAuditRunSnapshots(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    await clearRunSnapshotsForOwner(db, ownerId)
  } catch {
    // best-effort cleanup
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
    const runSnaps = await awaitRequest<RunDetailSnapshot[]>(
      txStore(db, STORE_RUN_SNAPSHOTS, "readonly").getAll()
    )
    for (const r of runSnaps) {
      if (r.ownerId !== currentOwnerId) {
        await awaitRequest(txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").delete(r.runId))
      }
    }
  } catch {
    // best-effort GC; never block startup
  }
}
