// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import { _resetOfflineDBCache, openOfflineDB, STORE_DASHBOARD } from "@/lib/offline/db"

afterEach(() => {
  _resetOfflineDBCache()
  indexedDB.deleteDatabase("seo-app-cache")
})

describe("openOfflineDB", () => {
  it("opens version 1 and creates the dashboard_snapshots store", async () => {
    const db = await openOfflineDB()
    expect(db.objectStoreNames.contains(STORE_DASHBOARD)).toBe(true)
    expect(db.version).toBe(1)
  })

  it("returns the same DB instance on subsequent calls (cached promise)", async () => {
    const a = await openOfflineDB()
    const b = await openOfflineDB()
    expect(b).toBe(a)
  })
})
