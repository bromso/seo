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
  it("returns the live prop synchronously on first render (passthrough)", () => {
    const live = { run: RUN_ROW, results: RESULTS }
    const { result } = renderHook(() => useRunDetailCache(OWNER, RUN, live))
    expect(result.current).toBe(live)
  })

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
})
