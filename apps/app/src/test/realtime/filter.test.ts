import { describe, expect, it } from "vitest"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import type { Envelope } from "@/lib/realtime/envelope"
import {
  shouldDeliverToRun,
  shouldDeliverToRuns,
  shouldDeliverToScores,
} from "@/lib/realtime/filter"

const SITE_A = "11111111-1111-4111-8111-111111111111"
const SITE_B = "22222222-2222-4222-8222-222222222222"
const RUN_A = "33333333-3333-4333-8333-333333333333"
const RUN_B = "44444444-4444-4444-8444-444444444444"

function runEnv(event: "INSERT" | "UPDATE", row: Partial<AuditRunRow>): Envelope {
  return {
    table: "audit_runs",
    event,
    row: {
      id: RUN_A,
      site_id: SITE_A,
      owner_id: "x",
      status: "running",
      requested_url: "u",
      final_url: null,
      started_at: "t",
      finished_at: null,
      triggered_by: "manual",
      ...row,
    },
  }
}

function resultEnv(row: Partial<AuditResultRow>): Envelope {
  return {
    table: "audit_results",
    event: "INSERT",
    row: {
      id: "x",
      run_id: RUN_A,
      owner_id: "x",
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
      started_at: "t",
      ...row,
    },
  }
}

describe("shouldDeliverToScores", () => {
  it("is true for audit_results envelopes", () => {
    expect(shouldDeliverToScores(resultEnv({}))).toBe(true)
  })
  it("is false for audit_runs envelopes", () => {
    expect(shouldDeliverToScores(runEnv("INSERT", {}))).toBe(false)
  })
})

describe("shouldDeliverToRuns", () => {
  it("is true for audit_runs INSERT matching site_id", () => {
    expect(shouldDeliverToRuns(runEnv("INSERT", { site_id: SITE_A }), SITE_A)).toBe(true)
  })
  it("is true for audit_runs UPDATE matching site_id", () => {
    expect(shouldDeliverToRuns(runEnv("UPDATE", { site_id: SITE_A }), SITE_A)).toBe(true)
  })
  it("is false for audit_runs event for a different site", () => {
    expect(shouldDeliverToRuns(runEnv("INSERT", { site_id: SITE_B }), SITE_A)).toBe(false)
  })
  it("is false for audit_results envelopes", () => {
    expect(shouldDeliverToRuns(resultEnv({}), SITE_A)).toBe(false)
  })
})

describe("shouldDeliverToRun", () => {
  it("is true for audit_runs UPDATE matching run id", () => {
    expect(shouldDeliverToRun(runEnv("UPDATE", { id: RUN_A }), RUN_A)).toBe(true)
  })
  it("is true for audit_results INSERT matching run_id", () => {
    expect(shouldDeliverToRun(resultEnv({ run_id: RUN_A }), RUN_A)).toBe(true)
  })
  it("is false for audit_runs INSERT (irrelevant to a single-run view)", () => {
    expect(shouldDeliverToRun(runEnv("INSERT", { id: RUN_A }), RUN_A)).toBe(false)
  })
  it("is false for events scoped to a different run", () => {
    expect(shouldDeliverToRun(runEnv("UPDATE", { id: RUN_B }), RUN_A)).toBe(false)
    expect(shouldDeliverToRun(resultEnv({ run_id: RUN_B }), RUN_A)).toBe(false)
  })
})
