// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useRealtimeRun } from "@/hooks/use-realtime-run"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import type * as fanOutModule from "@/lib/realtime/fan-out"
import { _resetFanOutRegistry } from "@/lib/realtime/use-fan-out"
import {
  FakeBroadcastChannel,
  FakeLockManager,
  FakeSupabaseClient,
  makeNow,
  resetBroadcastChannels,
} from "@/test/realtime/fakes"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const RUN_ID = "11111111-2222-3333-4444-555555555555"

const RUN: AuditRunRow = {
  id: RUN_ID,
  site_id: "site-1",
  owner_id: OWNER,
  status: "completed",
  requested_url: "https://example.com/",
  final_url: "https://example.com/",
  started_at: "2026-06-07T10:00:00.000Z",
  finished_at: "2026-06-07T10:00:30.000Z",
  triggered_by: "manual",
} as unknown as AuditRunRow

const RESULTS: AuditResultRow[] = []

beforeEach(() => {
  ;(globalThis as unknown as { __realtimeDeps?: fanOutModule.FanOutDeps }).__realtimeDeps = {
    bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
    locks: new FakeLockManager() as unknown as LockManager,
    supabaseFactory: () => new FakeSupabaseClient() as unknown,
    now: makeNow(),
  }
})

afterEach(() => {
  resetBroadcastChannels()
  _resetFanOutRegistry()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { __realtimeDeps?: fanOutModule.FanOutDeps }).__realtimeDeps
})

describe("useRealtimeRun", () => {
  it("returns a referentially stable wrapper across re-renders when state has not changed", () => {
    const { result, rerender } = renderHook(() => useRealtimeRun(OWNER, RUN_ID, RUN, RESULTS))
    const first = result.current
    rerender()
    const second = result.current
    rerender()
    const third = result.current
    expect(second).toBe(first)
    expect(third).toBe(first)
  })
})
