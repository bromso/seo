// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { enqueueAuditRun, readQueueForOwner } from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { isQueueEntryExpired, pruneExpiredEntries } from "@/lib/offline/queue-ttl"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const URL_X = "https://example.com"

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

describe("isQueueEntryExpired", () => {
  it("returns false when age < ttl", () => {
    const entry = {
      id: "x",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: URL_X,
      queuedAt: 1000,
    }
    expect(isQueueEntryExpired(entry, 5000, 10_000)).toBe(false)
  })

  it("returns true when age > ttl", () => {
    const entry = {
      id: "x",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: URL_X,
      queuedAt: 1000,
    }
    expect(isQueueEntryExpired(entry, 20_000, 10_000)).toBe(true)
  })
})

describe("pruneExpiredEntries", () => {
  it("deletes expired rows and leaves fresh rows; returns the count", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, {
      id: "fresh",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: URL_X,
      queuedAt: 9_000,
    })
    await enqueueAuditRun(db, {
      id: "stale",
      ownerId: OWNER,
      siteId: SITE,
      requestedUrl: URL_X,
      queuedAt: 1,
    })

    const dropped = await pruneExpiredEntries(db, 10_000, 5_000)
    expect(dropped).toBe(1)

    const left = await readQueueForOwner(db, OWNER)
    expect(left.map((e) => e.id)).toEqual(["fresh"])
  })
})
