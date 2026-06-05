import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { STORE_DASHBOARD } from "@/lib/offline/db"

export type DashboardSnapshot = {
  ownerId: string
  updatedAt: number
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_DASHBOARD, mode).objectStore(STORE_DASHBOARD)
}

function awaitRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function readSnapshot(
  db: IDBDatabase,
  ownerId: string
): Promise<DashboardSnapshot | null> {
  const got = await awaitRequest<DashboardSnapshot | undefined>(
    txStore(db, "readonly").get(ownerId)
  )
  return got ?? null
}

export async function writeSnapshot(db: IDBDatabase, snap: DashboardSnapshot): Promise<void> {
  await awaitRequest(txStore(db, "readwrite").put(snap))
}

export async function clearSnapshot(db: IDBDatabase, ownerId: string): Promise<void> {
  await awaitRequest(txStore(db, "readwrite").delete(ownerId))
}
