// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { _resetOfflineDBCache, openOfflineDB } from "@/lib/offline/db"
import {
  applyEventToRunSnapshot,
  MAX_RUN_SNAPSHOTS_PER_OWNER,
  type RunDetailSnapshot,
  readRunSnapshot,
  sweepRunSnapshotsLRU,
  writeRunSnapshot,
} from "@/lib/offline/run-snapshot"
import type { Envelope } from "@/lib/realtime/envelope"

const OWNER_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const OWNER_B = "8b7c1a2f-3d4e-4f5a-9b6c-1d2e3f4a5b6c"
const RUN = "22222222-2222-4222-8222-222222222222"

const SAMPLE_RUN: AuditRunRow = {
  id: RUN,
  site_id: "11111111-1111-4111-8111-111111111111",
  owner_id: OWNER_A,
  status: "running",
  requested_url: "https://example.com",
  final_url: null,
  started_at: "2026-06-05T12:00:00Z",
  finished_at: null,
  triggered_by: "manual",
}

const SAMPLE_RESULT: AuditResultRow = {
  id: "33333333-3333-4333-8333-333333333333",
  run_id: RUN,
  owner_id: OWNER_A,
  category: "performance",
  status: "success",
  score: 87,
  issues: [],
  raw: {},
  partial_reasons: null,
  error_code: null,
  error_message: null,
  error_retryable: null,
  package_name: "@repo/audit-perf",
  package_version: "0.0.0",
  duration_ms: 1100,
  started_at: "2026-06-05T12:00:01Z",
}

const SAMPLE_SNAPSHOT: RunDetailSnapshot = {
  runId: RUN,
  ownerId: OWNER_A,
  updatedAt: 1_700_000_000_000,
  run: SAMPLE_RUN,
  results: [SAMPLE_RESULT],
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

describe("run-snapshot CRUD", () => {
  it("round-trips a snapshot through writeRunSnapshot + readRunSnapshot", async () => {
    const db = await openOfflineDB()
    await writeRunSnapshot(db, SAMPLE_SNAPSHOT)
    const got = await readRunSnapshot(db, RUN)
    expect(got).toEqual(SAMPLE_SNAPSHOT)
  })

  it("readRunSnapshot returns null for an unknown runId", async () => {
    const db = await openOfflineDB()
    const got = await readRunSnapshot(db, RUN)
    expect(got).toBeNull()
  })
})

describe("applyEventToRunSnapshot", () => {
  it("updates run on a matching audit_runs UPDATE", () => {
    const env: Envelope = {
      table: "audit_runs",
      event: "UPDATE",
      row: { ...SAMPLE_RUN, status: "completed", finished_at: "2026-06-05T12:00:30Z" },
    }
    const next = applyEventToRunSnapshot(SAMPLE_SNAPSHOT, { kind: "event", envelope: env })
    expect(next.run.status).toBe("completed")
    expect(next.run.finished_at).toBe("2026-06-05T12:00:30Z")
  })

  it("appends a matching audit_results INSERT", () => {
    const newResult: AuditResultRow = {
      ...SAMPLE_RESULT,
      id: "44444444-4444-4444-8444-444444444444",
      category: "seo",
      score: 92,
    }
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: newResult,
    }
    const next = applyEventToRunSnapshot(SAMPLE_SNAPSHOT, { kind: "event", envelope: env })
    expect(next.results).toHaveLength(2)
    expect(next.results[1]?.category).toBe("seo")
  })

  it("dedups an audit_results event whose id is already present", () => {
    const env: Envelope = {
      table: "audit_results",
      event: "INSERT",
      row: SAMPLE_RESULT,
    }
    const next = applyEventToRunSnapshot(SAMPLE_SNAPSHOT, { kind: "event", envelope: env })
    expect(next).toBe(SAMPLE_SNAPSHOT)
  })
})

describe("sweepRunSnapshotsLRU", () => {
  it("keeps the 20 most-recent per owner; leaves other-owner data", async () => {
    const db = await openOfflineDB()
    for (let i = 1; i <= 22; i++) {
      await writeRunSnapshot(db, {
        runId: `run-a-${i}`,
        ownerId: OWNER_A,
        updatedAt: i,
        run: { ...SAMPLE_RUN, id: `run-a-${i}` },
        results: [],
      })
    }
    for (let i = 1; i <= 3; i++) {
      await writeRunSnapshot(db, {
        runId: `run-b-${i}`,
        ownerId: OWNER_B,
        updatedAt: 100 + i,
        run: { ...SAMPLE_RUN, id: `run-b-${i}`, owner_id: OWNER_B },
        results: [],
      })
    }
    await sweepRunSnapshotsLRU(db, OWNER_A)
    expect(await readRunSnapshot(db, "run-a-1")).toBeNull()
    expect(await readRunSnapshot(db, "run-a-2")).toBeNull()
    expect(await readRunSnapshot(db, "run-a-3")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-a-22")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-b-1")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-b-2")).not.toBeNull()
    expect(await readRunSnapshot(db, "run-b-3")).not.toBeNull()
    expect(MAX_RUN_SNAPSHOTS_PER_OWNER).toBe(20)
  })
})
