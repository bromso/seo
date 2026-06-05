// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type * as fanOutModule from "@/lib/realtime/fan-out"
import { _resetFanOutRegistry, useFanOut } from "@/lib/realtime/use-fan-out"
import {
  FakeBroadcastChannel,
  FakeLockManager,
  FakeSupabaseClient,
  makeNow,
  resetBroadcastChannels,
} from "@/test/realtime/fakes"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

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

describe("useFanOut", () => {
  it("shares one FanOut instance across multiple callers in the same tab", () => {
    const a = renderHook(() => useFanOut(OWNER))
    const b = renderHook(() => useFanOut(OWNER))
    expect(a.result.current).toBe(b.result.current)
    a.unmount()
    b.unmount()
  })

  it("tears down the FanOut when the last caller unmounts", () => {
    const a = renderHook(() => useFanOut(OWNER))
    const first = a.result.current
    a.unmount()
    const b = renderHook(() => useFanOut(OWNER))
    expect(b.result.current).not.toBe(first)
    b.unmount()
  })
})
