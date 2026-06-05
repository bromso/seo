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

import { applyEventToSnapshot } from "@/lib/offline/snapshot"
import type { Envelope } from "@/lib/realtime/envelope"

describe("applyEventToSnapshot", () => {
  it("returns snapshot unchanged for a resync signal", () => {
    const next = applyEventToSnapshot(SAMPLE, { kind: "resync" })
    expect(next).toBe(SAMPLE)
  })

  it("returns snapshot unchanged for an audit_runs event (dashboard scores only react to results)", () => {
    const env: Envelope = {
      table: "audit_runs",
      event: "UPDATE",
      row: {
        id: "22222222-2222-4222-8222-222222222222",
        site_id: "11111111-1111-4111-8111-111111111111",
        owner_id: OWNER,
        status: "completed",
        requested_url: "https://example.com",
        final_url: "https://example.com/",
        started_at: "2026-06-05T12:00:00Z",
        finished_at: "2026-06-05T12:00:30Z",
        triggered_by: "manual",
      },
    }
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next).toBe(SAMPLE)
  })

  it("replaces the matching (site_id, category) latestScores row on an audit_results INSERT", () => {
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "33333333-3333-4333-8333-333333333333",
        run_id: "22222222-2222-4222-8222-222222222222",
        owner_id: OWNER,
        category: "performance",
        status: "success",
        score: 94,
        issues: [],
        raw: {},
        partial_reasons: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        package_name: "@repo/audit-perf",
        package_version: "0.0.0",
        duration_ms: 1100,
        started_at: "2026-06-05T13:00:00Z",
      },
    }
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next).not.toBe(SAMPLE)
    expect(next.latestScores).toHaveLength(1)
    expect(next.latestScores[0]?.score).toBe(94)
    expect(next.trends).toHaveLength(2)
    expect(next.trends[1]).toMatchObject({
      site_id: "11111111-1111-4111-8111-111111111111",
      category: "performance",
      score: 94,
      measured_at: "2026-06-05T13:00:00Z",
    })
  })

  it("ignores audit_results events for runs not tied to a known site", () => {
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "44444444-4444-4444-8444-444444444444",
        run_id: "99999999-9999-4999-8999-999999999999",
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
        started_at: "2026-06-05T14:00:00Z",
      },
    }
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next).toBe(SAMPLE)
  })
})

describe("applyEventToSnapshot — trend dedup + pruning", () => {
  it("does not append a duplicate trend row (same site_id, category, measured_at)", () => {
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "rid-dup",
        run_id: "22222222-2222-4222-8222-222222222222",
        owner_id: OWNER,
        category: "performance",
        status: "success",
        score: 87,
        issues: [],
        raw: {},
        partial_reasons: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        package_name: "x",
        package_version: "0",
        duration_ms: 0,
        started_at: "2026-06-05T12:00:00Z",
      },
    }
    const before = SAMPLE.trends.length
    const next = applyEventToSnapshot(SAMPLE, { kind: "event", envelope: env })
    expect(next.trends).toHaveLength(before)
  })

  it("prunes trends older than 30 days when a new event arrives", () => {
    const stale: ScoreTrendRow = {
      site_id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      label: "My site",
      is_competitor: false,
      category: "performance",
      score: 50,
      measured_at: "2026-04-01T12:00:00Z",
    }
    const seeded: DashboardSnapshot = {
      ...SAMPLE,
      trends: [...SAMPLE.trends, stale],
    }
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "rid-prune",
        run_id: "22222222-2222-4222-8222-222222222222",
        owner_id: OWNER,
        category: "seo",
        status: "success",
        score: 90,
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
    }
    const next = applyEventToSnapshot(seeded, { kind: "event", envelope: env })
    expect(next.trends.some((t) => t.measured_at === "2026-04-01T12:00:00Z")).toBe(false)
  })

  it("keeps trends inside the 30-day window", () => {
    const recent: ScoreTrendRow = {
      site_id: "11111111-1111-4111-8111-111111111111",
      owner_id: OWNER,
      label: "My site",
      is_competitor: false,
      category: "performance",
      score: 60,
      measured_at: "2026-05-20T12:00:00Z",
    }
    const seeded: DashboardSnapshot = {
      ...SAMPLE,
      trends: [...SAMPLE.trends, recent],
    }
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: {
        id: "rid-keep",
        run_id: "22222222-2222-4222-8222-222222222222",
        owner_id: OWNER,
        category: "seo",
        status: "success",
        score: 90,
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
    }
    const next = applyEventToSnapshot(seeded, { kind: "event", envelope: env })
    expect(next.trends.some((t) => t.measured_at === "2026-05-20T12:00:00Z")).toBe(true)
  })
})
