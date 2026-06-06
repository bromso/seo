import { awaitRequest, txStore } from "@/lib/offline/_idb"
import { type QueuedAuditRun, readQueueForOwner, removeFromQueue } from "@/lib/offline/audit-queue"
import { STORE_AUDIT_QUEUE } from "@/lib/offline/db"

export type ReplayResult = { successes: number; failures: number }

export async function replayAuditQueueOnce(
  db: IDBDatabase,
  fetcher: typeof fetch,
  ownerIdFilter?: string
): Promise<ReplayResult> {
  const entries = ownerIdFilter
    ? await readQueueForOwner(db, ownerIdFilter)
    : await readAllQueueEntries(db)

  let successes = 0
  let failures = 0

  for (const entry of entries) {
    try {
      const res = await fetcher("/api/audit-run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": entry.id,
        },
        body: JSON.stringify({
          siteId: entry.siteId,
          requestedUrl: entry.requestedUrl,
        }),
      })
      if (!res.ok) {
        failures += 1
        continue
      }
      const body = (await res.json()) as { ok: true; runId: string } | { ok: false; error: string }
      if (!body.ok) {
        failures += 1
        continue
      }
      try {
        await removeFromQueue(db, entry.id)
      } catch {
        // leave in queue
      }
      successes += 1
    } catch {
      failures += 1
    }
  }

  return { successes, failures }
}

async function readAllQueueEntries(db: IDBDatabase): Promise<QueuedAuditRun[]> {
  return await awaitRequest<QueuedAuditRun[]>(txStore(db, STORE_AUDIT_QUEUE, "readonly").getAll())
}
