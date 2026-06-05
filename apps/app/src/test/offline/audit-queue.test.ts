// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  clearAuditQueue,
  enqueueAuditRun,
  type QueuedAuditRun,
  readQueueForOwner,
  removeFromQueue,
} from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"

const OWNER_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const OWNER_B = "8b7c1a2f-3d4e-4f5a-9b6c-1d2e3f4a5b6c"

function entry(over: Partial<QueuedAuditRun> & Pick<QueuedAuditRun, "id">): QueuedAuditRun {
  return {
    ownerId: OWNER_A,
    siteId: "11111111-1111-4111-8111-111111111111",
    requestedUrl: "https://example.com",
    queuedAt: 1,
    ...over,
  }
}

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

describe("audit-queue", () => {
  it("enqueueAuditRun + readQueueForOwner round-trips a single entry", async () => {
    const db = await openOfflineDB()
    const e = entry({ id: "q1" })
    await enqueueAuditRun(db, e)
    const got = await readQueueForOwner(db, OWNER_A)
    expect(got).toEqual([e])
  })

  it("readQueueForOwner returns only matching owner entries", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry({ id: "q1", ownerId: OWNER_A }))
    await enqueueAuditRun(db, entry({ id: "q2", ownerId: OWNER_B }))
    await enqueueAuditRun(db, entry({ id: "q3", ownerId: OWNER_A }))
    const got = await readQueueForOwner(db, OWNER_A)
    expect(got).toHaveLength(2)
    expect(got.map((g) => g.id).sort()).toEqual(["q1", "q3"])
  })

  it("removeFromQueue deletes the one entry", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry({ id: "q1" }))
    await enqueueAuditRun(db, entry({ id: "q2" }))
    await removeFromQueue(db, "q1")
    const got = await readQueueForOwner(db, OWNER_A)
    expect(got.map((g) => g.id)).toEqual(["q2"])
  })

  it("clearAuditQueue removes all entries for that owner only", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry({ id: "q1", ownerId: OWNER_A }))
    await enqueueAuditRun(db, entry({ id: "q2", ownerId: OWNER_B }))
    await enqueueAuditRun(db, entry({ id: "q3", ownerId: OWNER_A }))
    await clearAuditQueue(OWNER_A)
    expect(await readQueueForOwner(db, OWNER_A)).toEqual([])
    expect(await readQueueForOwner(db, OWNER_B)).toHaveLength(1)
  })
})
