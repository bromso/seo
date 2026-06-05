import { openOfflineDB, STORE_AUDIT_QUEUE } from "@/lib/offline/db"

export type QueuedAuditRun = {
  id: string
  ownerId: string
  siteId: string
  requestedUrl: string
  queuedAt: number
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_AUDIT_QUEUE, mode).objectStore(STORE_AUDIT_QUEUE)
}

function awaitRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function enqueueAuditRun(db: IDBDatabase, entry: QueuedAuditRun): Promise<void> {
  await awaitRequest(txStore(db, "readwrite").put(entry))
}

export async function readQueueForOwner(
  db: IDBDatabase,
  ownerId: string
): Promise<QueuedAuditRun[]> {
  const all = await awaitRequest<QueuedAuditRun[]>(txStore(db, "readonly").getAll())
  return all.filter((e) => e.ownerId === ownerId)
}

export async function removeFromQueue(db: IDBDatabase, id: string): Promise<void> {
  await awaitRequest(txStore(db, "readwrite").delete(id))
}

export async function clearAuditQueue(ownerId: string): Promise<void> {
  try {
    const db = await openOfflineDB()
    const entries = await readQueueForOwner(db, ownerId)
    await Promise.all(entries.map((e) => removeFromQueue(db, e.id)))
  } catch {
    // IDB unavailable — best-effort cleanup
  }
}
