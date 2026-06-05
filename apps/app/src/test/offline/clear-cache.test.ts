// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { clearDashboardCache } from "@/lib/offline/clear-cache"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { readSnapshot, writeSnapshot } from "@/lib/offline/snapshot"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

beforeEach(async () => {
  _resetOfflineDBCache()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })
})

afterEach(() => {
  _resetOfflineDBCache()
})

describe("clearDashboardCache", () => {
  it("removes the snapshot for the given ownerId", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, {
      ownerId: OWNER,
      updatedAt: 1,
      sites: [],
      latestScores: [],
      trends: [],
    })
    await clearDashboardCache(OWNER)
    const got = await readSnapshot(db, OWNER)
    expect(got).toBeNull()
  })

  it("is a no-op when no snapshot exists", async () => {
    await expect(clearDashboardCache(OWNER)).resolves.toBeUndefined()
  })
})
