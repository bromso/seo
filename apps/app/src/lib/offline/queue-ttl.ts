import { QUEUE_TTL_DAYS } from "@/lib/constants"
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import type { QueuedAuditRun } from "@/lib/offline/audit-queue"
import { STORE_AUDIT_QUEUE } from "@/lib/offline/db"

export const QUEUE_TTL_MS = QUEUE_TTL_DAYS * 24 * 60 * 60 * 1000

export function isQueueEntryExpired(
  entry: QueuedAuditRun,
  now: number,
  ttlMs: number = QUEUE_TTL_MS
): boolean {
  return now - entry.queuedAt > ttlMs
}

export async function pruneExpiredEntries(
  db: IDBDatabase,
  now: number,
  ttlMs: number = QUEUE_TTL_MS
): Promise<number> {
  const all = await awaitRequest<QueuedAuditRun[]>(
    txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll()
  )
  const expired = all.filter((e) => isQueueEntryExpired(e, now, ttlMs))
  for (const e of expired) {
    await awaitRequest(txStore(db, STORE_AUDIT_QUEUE, "readwrite").delete(e.id))
  }
  return expired.length
}
