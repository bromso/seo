import { afterEach, describe, expect, it } from "vitest"
import { FanOut } from "@/lib/realtime/fan-out"
import {
  FakeBroadcastChannel,
  FakeLockManager,
  FakeSupabaseClient,
  makeNow,
  resetBroadcastChannels,
} from "@/test/realtime/fakes"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

afterEach(() => {
  resetBroadcastChannels()
})

function makeFanOut(opts?: { locks?: FakeLockManager; supabase?: FakeSupabaseClient }) {
  const locks = opts?.locks ?? new FakeLockManager()
  const supabase = opts?.supabase ?? new FakeSupabaseClient()
  const fanOut = new FanOut(OWNER, {
    bcFactory: (name) => new FakeBroadcastChannel(name) as unknown as BroadcastChannel,
    locks: locks as unknown as LockManager,
    supabaseFactory: () => supabase as unknown,
    now: makeNow(),
  })
  return { fanOut, locks, supabase }
}

describe("FanOut — leader path", () => {
  it("becomes leader and opens both Supabase channels", async () => {
    const { fanOut, supabase } = makeFanOut()
    await fanOut.ready()
    expect(fanOut.isLeader).toBe(true)
    const names = supabase.channels.map((c) => c.name)
    expect(names).toContain(`audit_runs:${OWNER}`)
    expect(names).toContain(`audit_results:${OWNER}`)
    expect(supabase.channels.every((c) => c.subscribed)).toBe(true)
    fanOut.close()
  })
})
