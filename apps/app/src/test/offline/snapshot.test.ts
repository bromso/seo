// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import {
  clearSnapshot,
  type DashboardSnapshot,
  readSnapshot,
  writeSnapshot,
} from "@/lib/offline/snapshot"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

const SAMPLE: DashboardSnapshot = {
  ownerId: OWNER,
  updatedAt: 1_700_000_000_000,
  sites: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      url: "https://example.com",
      normalized_url: "https://example.com/",
      label: "My site",
      is_competitor: false,
      created_at: "2026-06-05T12:00:00Z",
    } satisfies SiteRow,
  ],
  latestScores: [
    {
      site_id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      url: "https://example.com",
      label: "My site",
      is_competitor: false,
      run_id: "22222222-2222-4222-8222-222222222222",
      run_status: "completed",
      run_started_at: "2026-06-05T12:00:00Z",
      category: "performance",
      result_status: "success",
      score: 87,
    } satisfies LatestScoreRow,
  ],
  trends: [
    {
      site_id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      label: "My site",
      is_competitor: false,
      category: "performance",
      score: 87,
      measured_at: "2026-06-05T12:00:00Z",
    } satisfies ScoreTrendRow,
  ],
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

describe("snapshot CRUD", () => {
  it("round-trips a snapshot through writeSnapshot + readSnapshot", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, SAMPLE)
    const got = await readSnapshot(db, OWNER)
    expect(got).toEqual(SAMPLE)
  })

  it("readSnapshot returns null for an unknown ownerId", async () => {
    const db = await openOfflineDB()
    const got = await readSnapshot(db, OWNER)
    expect(got).toBeNull()
  })

  it("writeSnapshot for an existing ownerId overwrites (no duplicates)", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, SAMPLE)
    const next: DashboardSnapshot = { ...SAMPLE, updatedAt: 1_700_000_000_999 }
    await writeSnapshot(db, next)
    const got = await readSnapshot(db, OWNER)
    expect(got?.updatedAt).toBe(1_700_000_000_999)
  })

  it("clearSnapshot removes the entry; subsequent read returns null", async () => {
    const db = await openOfflineDB()
    await writeSnapshot(db, SAMPLE)
    await clearSnapshot(db, OWNER)
    const got = await readSnapshot(db, OWNER)
    expect(got).toBeNull()
  })
})
