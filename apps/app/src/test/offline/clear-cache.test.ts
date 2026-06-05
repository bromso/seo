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

import { enqueueAuditRun, readQueueForOwner } from "@/lib/offline/audit-queue"
import { sweepOtherOwners } from "@/lib/offline/clear-cache"

const OWNER_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const OWNER_B = "8b7c1a2f-3d4e-4f5a-9b6c-1d2e3f4a5b6c"

describe("sweepOtherOwners", () => {
  it("deletes other-owner snapshots and queue entries; keeps current-owner data", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, {
      ownerId: OWNER_A,
      updatedAt: 1,
      sites: [],
      latestScores: [],
      trends: [],
    })
    await writeSnapshot(db, {
      ownerId: OWNER_B,
      updatedAt: 2,
      sites: [],
      latestScores: [],
      trends: [],
    })
    await enqueueAuditRun(db, {
      id: "q1",
      ownerId: OWNER_A,
      siteId: "s",
      requestedUrl: "https://example.com",
      queuedAt: 1,
    })
    await enqueueAuditRun(db, {
      id: "q2",
      ownerId: OWNER_B,
      siteId: "s",
      requestedUrl: "https://example.com",
      queuedAt: 1,
    })

    await sweepOtherOwners(db, OWNER_A)

    expect(await readSnapshot(db, OWNER_A)).not.toBeNull()
    expect(await readSnapshot(db, OWNER_B)).toBeNull()
    expect(await readQueueForOwner(db, OWNER_A)).toHaveLength(1)
    expect(await readQueueForOwner(db, OWNER_B)).toHaveLength(0)
  })

  it("is a no-op when only current-owner data exists", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, {
      ownerId: OWNER_A,
      updatedAt: 1,
      sites: [],
      latestScores: [],
      trends: [],
    })
    await sweepOtherOwners(db, OWNER_A)
    expect(await readSnapshot(db, OWNER_A)).not.toBeNull()
  })
})

import { clearAuditRunSnapshots } from "@/lib/offline/clear-cache"
import { readRunSnapshot, writeRunSnapshot } from "@/lib/offline/run-snapshot"

const SAMPLE_RUN_FOR = (id: string, ownerId: string) => ({
  id,
  site_id: "11111111-1111-4111-8111-111111111111",
  owner_id: ownerId,
  status: "running" as const,
  requested_url: "https://example.com",
  final_url: null,
  started_at: "2026-06-05T12:00:00Z",
  finished_at: null,
  triggered_by: "manual",
})

describe("sweepOtherOwners — run snapshots", () => {
  it("also deletes other-owner run snapshots", async () => {
    const db = await openOfflineDB()
    await writeRunSnapshot(db, {
      runId: "run-a-1",
      ownerId: OWNER_A,
      updatedAt: 1,
      run: SAMPLE_RUN_FOR("run-a-1", OWNER_A),
      results: [],
    })
    await writeRunSnapshot(db, {
      runId: "run-b-1",
      ownerId: OWNER_B,
      updatedAt: 1,
      run: SAMPLE_RUN_FOR("run-b-1", OWNER_B),
      results: [],
    })
    await sweepOtherOwners(db, OWNER_A)
    expect(await readRunSnapshot(db, "run-a-1")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-b-1")).toBeNull()
  })
})

describe("clearAuditRunSnapshots", () => {
  it("removes only the current owner's run snapshots", async () => {
    const db = await openOfflineDB()
    await writeRunSnapshot(db, {
      runId: "run-a-1",
      ownerId: OWNER_A,
      updatedAt: 1,
      run: SAMPLE_RUN_FOR("run-a-1", OWNER_A),
      results: [],
    })
    await writeRunSnapshot(db, {
      runId: "run-b-1",
      ownerId: OWNER_B,
      updatedAt: 1,
      run: SAMPLE_RUN_FOR("run-b-1", OWNER_B),
      results: [],
    })
    await clearAuditRunSnapshots(OWNER_A)
    expect(await readRunSnapshot(db, "run-a-1")).toBeNull()
    expect(await readRunSnapshot(db, "run-b-1")).not.toBeNull()
  })

  it("is a no-op when no snapshots exist for the owner", async () => {
    await expect(clearAuditRunSnapshots(OWNER_A)).resolves.toBeUndefined()
  })
})
