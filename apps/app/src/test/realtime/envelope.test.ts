import { describe, expect, it } from "vitest"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { type Envelope, fromSupabasePayload } from "@/lib/realtime/envelope"

const RUN: AuditRunRow = {
  id: "11111111-1111-4111-8111-111111111111",
  site_id: "22222222-2222-4222-8222-222222222222",
  owner_id: "33333333-3333-4333-8333-333333333333",
  status: "running",
  requested_url: "https://example.com",
  final_url: null,
  started_at: "2026-06-05T12:00:00Z",
  finished_at: null,
  triggered_by: "manual",
}

const RESULT: AuditResultRow = {
  id: "44444444-4444-4444-8444-444444444444",
  run_id: RUN.id,
  owner_id: RUN.owner_id,
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
  duration_ms: 1200,
  started_at: "2026-06-05T12:00:01Z",
}

describe("fromSupabasePayload", () => {
  it("maps an audit_runs INSERT", () => {
    const e: Envelope | null = fromSupabasePayload({
      table: "audit_runs",
      eventType: "INSERT",
      new: RUN,
    })
    expect(e).toEqual({ table: "audit_runs", event: "INSERT", row: RUN })
  })

  it("maps an audit_runs UPDATE", () => {
    const e = fromSupabasePayload({
      table: "audit_runs",
      eventType: "UPDATE",
      new: RUN,
    })
    expect(e).toEqual({ table: "audit_runs", event: "UPDATE", row: RUN })
  })

  it("maps an audit_results INSERT", () => {
    const e = fromSupabasePayload({
      table: "audit_results",
      eventType: "INSERT",
      new: RESULT,
    })
    expect(e).toEqual({ table: "audit_results", event: "INSERT", row: RESULT })
  })

  it("returns null for unsupported event types", () => {
    expect(
      fromSupabasePayload({ table: "audit_results", eventType: "DELETE", new: RESULT })
    ).toBeNull()
  })

  it("returns null for unsupported tables", () => {
    expect(fromSupabasePayload({ table: "sites", eventType: "INSERT", new: {} })).toBeNull()
  })
})
