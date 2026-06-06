// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { type DashboardSnapshot, writeSnapshot } from "@/lib/offline/snapshot"
import { useDashboardCache } from "@/lib/offline/use-dashboard-cache"
import type { FanOutDeps } from "@/lib/realtime/fan-out"
import { _resetFanOutRegistry } from "@/lib/realtime/use-fan-out"
import {
  FakeBroadcastChannel,
  FakeLockManager,
  FakeSupabaseClient,
  makeNow,
  resetBroadcastChannels,
} from "@/test/realtime/fakes"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE = "11111111-1111-4111-8111-111111111111"
const RUN = "22222222-2222-4222-8222-222222222222"

const SITES: SiteRow[] = [
  {
    id: SITE,
    owner_id: OWNER,
    url: "https://example.com",
    normalized_url: "https://example.com/",
    label: "My site",
    is_competitor: false,
    created_at: "2026-06-05T12:00:00Z",
  },
]

const LATEST_SCORES: LatestScoreRow[] = [
  {
    site_id: SITE,
    owner_id: OWNER,
    url: "https://example.com",
    label: "My site",
    is_competitor: false,
    run_id: RUN,
    run_status: "completed",
    run_started_at: "2026-06-05T12:00:00Z",
    category: "performance",
    result_status: "success",
    score: 87,
  },
]

const TRENDS: ScoreTrendRow[] = []

let leaderSupabase: FakeSupabaseClient

beforeEach(async () => {
  _resetOfflineDBCache()
  _resetFanOutRegistry()
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("seo-app-cache")
    req.onsuccess = () => r()
    req.onerror = () => r()
  })

  leaderSupabase = new FakeSupabaseClient()
  ;(globalThis as unknown as { __realtimeDeps?: FanOutDeps }).__realtimeDeps = {
    bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
    locks: new FakeLockManager() as unknown as LockManager,
    supabaseFactory: () => leaderSupabase as unknown,
    now: makeNow(),
  }
})

afterEach(() => {
  resetBroadcastChannels()
  _resetFanOutRegistry()
  _resetOfflineDBCache()
  delete (globalThis as unknown as { __realtimeDeps?: FanOutDeps }).__realtimeDeps
})

describe("useDashboardCache", () => {
  it("returns propsSnapshot synchronously on first render", () => {
    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )
    expect(result.current.sites).toBe(SITES)
    expect(result.current.latestScores).toBe(LATEST_SCORES)
    expect(result.current.trends).toBe(TRENDS)
  })

  it("writes propsSnapshot to IDB after mount when IDB is empty", async () => {
    renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )
    await waitFor(async () => {
      const db = await openOfflineDB()
      const tx = db.transaction("dashboard_snapshots", "readonly")
      const got = await new Promise<DashboardSnapshot | undefined>((r) => {
        const req = tx.objectStore("dashboard_snapshots").get(OWNER)
        req.onsuccess = () => r(req.result as DashboardSnapshot | undefined)
      })
      expect(got?.sites).toEqual(SITES)
      expect(got?.latestScores).toEqual(LATEST_SCORES)
    })
  })

  it("hydrates from IDB on mount when IDB has fresher data than props", async () => {
    const db = await openOfflineDB()
    const fresher: DashboardSnapshot = {
      ownerId: OWNER,
      updatedAt: Date.now() + 60_000,
      sites: SITES,
      latestScores: [{ ...LATEST_SCORES[0]!, score: 99 }],
      trends: TRENDS,
    }
    await writeSnapshot(db, fresher)

    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )

    await waitFor(() => {
      expect(result.current.latestScores[0]?.score).toBe(99)
    })
  })

  it("updates state when a FanOut audit_results INSERT arrives and writes to IDB", async () => {
    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )

    await waitFor(() => {
      expect(leaderSupabase.channels.length).toBe(2)
    })

    act(() => {
      leaderSupabase.emit(`audit_results:${OWNER}`, {
        table: "audit_results",
        eventType: "INSERT",
        new: {
          id: "rid1",
          run_id: RUN,
          owner_id: OWNER,
          category: "performance",
          status: "success",
          score: 50,
          issues: [],
          raw: {},
          partial_reasons: null,
          error_code: null,
          error_message: null,
          error_retryable: null,
          package_name: "x",
          package_version: "0",
          duration_ms: 0,
          started_at: "2026-06-05T13:00:00Z",
        },
      })
    })

    await waitFor(
      () => {
        expect(result.current.latestScores[0]?.score).toBe(50)
      },
      { timeout: 2000 }
    )
  })

  it("exposes cacheUpdatedAt initialized to ~now on first render", () => {
    const before = Date.now()
    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )
    const after = Date.now()
    expect(result.current.cacheUpdatedAt).toBeGreaterThanOrEqual(before)
    expect(result.current.cacheUpdatedAt).toBeLessThanOrEqual(after)
  })

  it("exposes cacheUpdatedAt = existing.updatedAt after IDB swap", async () => {
    const db = await openOfflineDB()
    const idbStamp = Date.now() + 60_000
    await writeSnapshot(db, {
      ownerId: OWNER,
      updatedAt: idbStamp,
      sites: SITES,
      latestScores: [{ ...LATEST_SCORES[0]!, score: 99 }],
      trends: TRENDS,
    })

    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )

    await waitFor(() => {
      expect(result.current.cacheUpdatedAt).toBe(idbStamp)
    })
  })

  it("advances cacheUpdatedAt past propsFetchedAt when a fan-out event applies", async () => {
    const { result } = renderHook(() =>
      useDashboardCache(OWNER, { sites: SITES, latestScores: LATEST_SCORES, trends: TRENDS })
    )

    const before = result.current.cacheUpdatedAt

    await waitFor(() => {
      expect(leaderSupabase.channels.length).toBe(2)
    })

    // Wait at least 2ms so Date.now() inside the fan-out handler is strictly
    // greater than `before` (= propsFetchedAt captured at mount). Without this,
    // a sub-millisecond emit can land on the same Date.now() tick.
    await new Promise((r) => setTimeout(r, 2))

    act(() => {
      leaderSupabase.emit(`audit_results:${OWNER}`, {
        table: "audit_results",
        eventType: "INSERT",
        new: {
          id: "rid1",
          run_id: RUN,
          owner_id: OWNER,
          category: "performance",
          status: "success",
          score: 50,
          issues: [],
          raw: {},
          partial_reasons: null,
          error_code: null,
          error_message: null,
          error_retryable: null,
          package_name: "x",
          package_version: "0",
          duration_ms: 0,
          started_at: "2026-06-05T13:00:00Z",
        },
      })
    })

    await waitFor(
      () => {
        expect(result.current.cacheUpdatedAt).toBeGreaterThan(before)
      },
      { timeout: 2000 }
    )
  })
})
