// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import { _resetOfflineDBCache, openOfflineDB, STORE_DASHBOARD } from "@/lib/offline/db"
import type { DashboardSnapshot } from "@/lib/offline/snapshot"
import { readSnapshot } from "@/lib/offline/snapshot"

afterEach(() => {
  _resetOfflineDBCache()
  indexedDB.deleteDatabase("seo-app-cache")
})

describe("openOfflineDB", () => {
  it("opens the current DB version and creates the dashboard_snapshots store", async () => {
    const db = await openOfflineDB()
    expect(db.objectStoreNames.contains(STORE_DASHBOARD)).toBe(true)
    expect(db.version).toBeGreaterThanOrEqual(1)
  })

  it("returns the same DB instance on subsequent calls (cached promise)", async () => {
    const a = await openOfflineDB()
    const b = await openOfflineDB()
    expect(b).toBe(a)
  })
})

describe("openOfflineDB — V1→V2 migration", () => {
  it("opens version 2 and exposes audit_run_queue store", async () => {
    const db = await openOfflineDB()
    expect(db.version).toBe(2)
    expect(db.objectStoreNames.contains(STORE_DASHBOARD)).toBe(true)
    expect(db.objectStoreNames.contains("audit_run_queue")).toBe(true)
  })

  it("preserves existing dashboard_snapshots data when migrating from V1", async () => {
    // Manually open V1 first to simulate an installed-with-slice-7 user.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("seo-app-cache", 1)
      req.onupgradeneeded = () => {
        const v1 = req.result
        if (!v1.objectStoreNames.contains("dashboard_snapshots")) {
          v1.createObjectStore("dashboard_snapshots", { keyPath: "ownerId" })
        }
      }
      req.onsuccess = () => {
        const v1 = req.result
        const tx = v1.transaction("dashboard_snapshots", "readwrite")
        const snap: DashboardSnapshot = {
          ownerId: "owner-x",
          updatedAt: 1,
          sites: [],
          latestScores: [],
          trends: [],
        }
        tx.objectStore("dashboard_snapshots").put(snap)
        tx.oncomplete = () => {
          v1.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    _resetOfflineDBCache()
    const db = await openOfflineDB()
    expect(db.version).toBe(2)
    const got = await readSnapshot(db, "owner-x")
    expect(got?.ownerId).toBe("owner-x")
    expect(db.objectStoreNames.contains("audit_run_queue")).toBe(true)

    // Sanity: writing to the new store works.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("audit_run_queue", "readwrite")
      tx.objectStore("audit_run_queue").put({
        id: "qid-1",
        ownerId: "owner-x",
        siteId: "s",
        requestedUrl: "https://example.com",
        queuedAt: 1,
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  })
})
