// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import { readRunSnapshot, writeRunSnapshot } from "@/lib/offline/run-snapshot"
import { useRunDetailCache } from "@/lib/offline/use-run-detail-cache"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const RUN = "22222222-2222-4222-8222-222222222222"

const RUN_ROW: AuditRunRow = {
  id: RUN,
  site_id: "11111111-1111-4111-8111-111111111111",
  owner_id: OWNER,
  status: "running",
  requested_url: "https://example.com",
  final_url: null,
  started_at: "2026-06-05T12:00:00Z",
  finished_at: null,
  triggered_by: "manual",
}

const RESULTS: AuditResultRow[] = []

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

describe("useRunDetailCache", () => {
  it("writes the live snapshot to IDB after the debounce window", async () => {
    const live = { run: RUN_ROW, results: RESULTS }
    renderHook(() => useRunDetailCache(OWNER, RUN, live))
    await waitFor(
      async () => {
        const db = await openOfflineDB()
        const got = await readRunSnapshot(db, RUN)
        expect(got?.runId).toBe(RUN)
        expect(got?.ownerId).toBe(OWNER)
        expect(got?.run).toEqual(RUN_ROW)
      },
      { timeout: 2000 }
    )
  })

  it("returns IDB snapshot when fresher than props on mount", async () => {
    const db = await openOfflineDB()
    const fresherRun: AuditRunRow = { ...RUN_ROW, status: "completed" }
    const fresherResults: AuditResultRow[] = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        run_id: RUN,
        owner_id: OWNER,
        category: "performance",
        status: "success",
        score: 95,
        issues: [],
        raw: null,
        partial_reasons: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        package_name: "lighthouse",
        package_version: "12.0.0",
        duration_ms: 30000,
        started_at: "2026-06-05T12:00:00Z",
      },
    ]
    await writeRunSnapshot(db, {
      runId: RUN,
      ownerId: OWNER,
      updatedAt: Date.now() + 10_000,
      run: fresherRun,
      results: fresherResults,
    })

    const live = { run: RUN_ROW, results: RESULTS }
    const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))

    await waitFor(
      () => {
        expect(result.current.run.status).toBe("completed")
        expect(result.current.results).toHaveLength(1)
      },
      { timeout: 2000 }
    )
  })

  it("writes baseline snapshot when no IDB entry exists", async () => {
    const live = { run: RUN_ROW, results: RESULTS }
    renderHook(() => useRunDetailCache(OWNER, RUN, live))

    await waitFor(
      async () => {
        const db = await openOfflineDB()
        const got = await readRunSnapshot(db, RUN)
        expect(got).not.toBeNull()
        expect(got?.ownerId).toBe(OWNER)
        expect(got?.runId).toBe(RUN)
        expect(got?.run.id).toBe(RUN_ROW.id)
      },
      { timeout: 2000 }
    )
  })

  it("writes props as baseline when IDB is older than mount-time", async () => {
    const db = await openOfflineDB()
    const olderRun: AuditRunRow = { ...RUN_ROW, status: "failed" }
    await writeRunSnapshot(db, {
      runId: RUN,
      ownerId: OWNER,
      updatedAt: Date.now() - 10_000,
      run: olderRun,
      results: [],
    })

    const live = { run: RUN_ROW, results: RESULTS }
    renderHook(() => useRunDetailCache(OWNER, RUN, live))

    await waitFor(
      async () => {
        const got = await readRunSnapshot(db, RUN)
        expect(got?.run.status).toBe(RUN_ROW.status)
      },
      { timeout: 2000 }
    )
  })

  it("race guard: does not overwrite a realtime update with stale IDB", async () => {
    const db = await openOfflineDB()
    const idbRun: AuditRunRow = { ...RUN_ROW, status: "completed" }
    await writeRunSnapshot(db, {
      runId: RUN,
      ownerId: OWNER,
      updatedAt: Date.now() + 10_000,
      run: idbRun,
      results: [],
    })

    const propsLive = { run: RUN_ROW, results: RESULTS }
    const { result, rerender } = renderHook(
      ({ live }: { live: { run: AuditRunRow; results: AuditResultRow[] } }) =>
        useRunDetailCache(OWNER, RUN, live),
      { initialProps: { live: propsLive } }
    )

    // Simulate realtime: rerender with a new `live` reference synchronously
    // after mount, before the IDB read microtask drains.
    const realtimeLive = {
      run: { ...RUN_ROW, status: "running" as const, started_at: "2026-06-05T12:01:00Z" },
      results: RESULTS,
    }
    rerender({ live: realtimeLive })

    // Let the IDB read settle.
    await new Promise((r) => setTimeout(r, 100))

    expect(result.current.run).toBe(realtimeLive.run)
    expect(result.current.results).toBe(realtimeLive.results)
    expect(result.current.run.status).toBe("running")
  })

  it("exposes cacheUpdatedAt initialized to ~now on first render", () => {
    const before = Date.now()
    const live = { run: RUN_ROW, results: RESULTS }
    const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))
    const after = Date.now()
    expect(result.current.cacheUpdatedAt).toBeGreaterThanOrEqual(before)
    expect(result.current.cacheUpdatedAt).toBeLessThanOrEqual(after)
  })

  it("exposes cacheUpdatedAt = existing.updatedAt after IDB swap", async () => {
    const db = await openOfflineDB()
    const idbStamp = Date.now() + 10_000
    await writeRunSnapshot(db, {
      runId: RUN,
      ownerId: OWNER,
      updatedAt: idbStamp,
      run: { ...RUN_ROW, status: "completed" },
      results: [],
    })

    const live = { run: RUN_ROW, results: RESULTS }
    const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))

    await waitFor(
      () => {
        expect(result.current.cacheUpdatedAt).toBe(idbStamp)
      },
      { timeout: 2000 }
    )
  })
})
