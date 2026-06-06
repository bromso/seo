// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { enqueueAuditRun, type QueuedAuditRun, readQueueForOwner } from "@/lib/offline/audit-queue"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { replayAuditQueueOnce } from "@/lib/offline/replay-audit-queue"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"

function entry(id: string, ownerId: string = OWNER): QueuedAuditRun {
  return {
    id,
    ownerId,
    siteId: SITE,
    requestedUrl: "https://example.com",
    queuedAt: Date.now(),
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
  vi.restoreAllMocks()
})

describe("replayAuditQueueOnce", () => {
  it("removes entries on 2xx success and counts them as successes", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))
    await enqueueAuditRun(db, entry("q2"))

    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, runId: "r" }), { status: 200 })
    ) as unknown as typeof fetch

    const result = await replayAuditQueueOnce(db, fetcher, OWNER)
    expect(result).toEqual({ successes: 2, failures: 0 })
    expect(await readQueueForOwner(db, OWNER)).toEqual([])
  })

  it("leaves entries on 4xx/5xx and counts them as failures", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))

    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: false, error: "rejected" }), { status: 400 })
    ) as unknown as typeof fetch

    const result = await replayAuditQueueOnce(db, fetcher, OWNER)
    expect(result).toEqual({ successes: 0, failures: 1 })
    const left = await readQueueForOwner(db, OWNER)
    expect(left).toHaveLength(1)
    expect(left[0]?.id).toBe("q1")
  })

  it("catches network throws, leaves entries, and counts them as failures", async () => {
    const db = await openOfflineDB()
    await enqueueAuditRun(db, entry("q1"))

    const fetcher = vi.fn(async () => {
      throw new TypeError("network down")
    }) as unknown as typeof fetch

    const result = await replayAuditQueueOnce(db, fetcher, OWNER)
    expect(result).toEqual({ successes: 0, failures: 1 })
    expect(await readQueueForOwner(db, OWNER)).toHaveLength(1)
  })
})
