export const DB_NAME = "seo-app-cache"
export const DB_VERSION = 2
export const STORE_DASHBOARD = "dashboard_snapshots"
export const STORE_AUDIT_QUEUE = "audit_run_queue"

let cachedDb: Promise<IDBDatabase> | null = null

export function openOfflineDB(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb
  cachedDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      if (event.oldVersion < 1 && !db.objectStoreNames.contains(STORE_DASHBOARD)) {
        db.createObjectStore(STORE_DASHBOARD, { keyPath: "ownerId" })
      }
      if (event.oldVersion < 2 && !db.objectStoreNames.contains(STORE_AUDIT_QUEUE)) {
        db.createObjectStore(STORE_AUDIT_QUEUE, { keyPath: "id" })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  return cachedDb
}

/** Test-only: clear the cached promise so the next call re-opens fresh. */
export function _resetOfflineDBCache(): void {
  const prev = cachedDb
  cachedDb = null
  if (prev) {
    void prev.then((db) => db.close()).catch(() => {})
  }
}
