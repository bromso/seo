export const DB_NAME = "seo-app-cache"
export const DB_VERSION = 1
export const STORE_DASHBOARD = "dashboard_snapshots"

let cachedDb: Promise<IDBDatabase> | null = null

export function openOfflineDB(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb
  cachedDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_DASHBOARD)) {
        db.createObjectStore(STORE_DASHBOARD, { keyPath: "ownerId" })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // Auto-close on versionchange (e.g. another tab upgrades or deletes) so
      // we never block delete/upgrade requests with a stale connection.
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
  if (prev) prev.then((db) => db.close()).catch(() => {})
}
