import { afterEach, describe, expect, it } from "vitest"
import { FanOut } from "@/lib/realtime/fan-out"
import {
  FakeBroadcastChannel,
  FakeLockManager,
  FakeSupabaseClient,
  flushMicrotasks,
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

describe("FanOut — follower path", () => {
  it("stays follower when the lock is held elsewhere and opens NO supabase channels", async () => {
    const locks = new FakeLockManager()
    // First, take the lock with an unrelated holder that never releases.
    let releaseHolder!: () => void
    void locks.request(
      `realtime-leader:${OWNER}`,
      { mode: "exclusive" },
      () =>
        new Promise<void>((r) => {
          releaseHolder = r
        })
    )
    await flushMicrotasks()

    const supabase = new FakeSupabaseClient()
    const { fanOut } = makeFanOut({ locks, supabase })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(fanOut.isLeader).toBe(false)
    expect(supabase.channels.length).toBe(0)

    fanOut.close()
    releaseHolder()
  })
})

describe("FanOut — event forwarding", () => {
  it("forwards Supabase events to local subscribers as kind:event", async () => {
    const { fanOut, supabase } = makeFanOut()
    await fanOut.ready()
    const received: unknown[] = []
    fanOut.subscribe((s) => received.push(s))

    supabase.emit(`audit_runs:${OWNER}`, {
      table: "audit_runs",
      eventType: "INSERT",
      new: {
        id: "r1",
        site_id: "s1",
        owner_id: OWNER,
        status: "queued",
        requested_url: "u",
        final_url: null,
        started_at: "t",
        finished_at: null,
        triggered_by: "manual",
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      kind: "event",
      envelope: { table: "audit_runs", event: "INSERT" },
    })

    fanOut.close()
  })

  it("a follower tab receives events posted by the leader over the BC", async () => {
    const locks = new FakeLockManager()
    const supabaseLeader = new FakeSupabaseClient()
    const leader = new FanOut(OWNER, {
      bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
      locks: locks as unknown as LockManager,
      supabaseFactory: () => supabaseLeader as unknown,
      now: makeNow(),
    })
    await leader.ready()

    const supabaseFollower = new FakeSupabaseClient()
    const follower = new FanOut(OWNER, {
      bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
      locks: locks as unknown as LockManager,
      supabaseFactory: () => supabaseFollower as unknown,
      now: makeNow(),
    })
    await flushMicrotasks()
    expect(follower.isLeader).toBe(false)

    const followerReceived: unknown[] = []
    follower.subscribe((s) => followerReceived.push(s))

    supabaseLeader.emit(`audit_results:${OWNER}`, {
      table: "audit_results",
      eventType: "INSERT",
      new: { id: "ar1", run_id: "r1", owner_id: OWNER, category: "performance", score: 80 },
    })

    expect(followerReceived).toHaveLength(1)
    expect(followerReceived[0]).toMatchObject({
      kind: "event",
      envelope: { table: "audit_results", event: "INSERT" },
    })

    follower.close()
    leader.close()
  })
})

describe("FanOut — resync on seq gap", () => {
  it("emits resync when an incoming BC event has seq > lastSeq + 1", async () => {
    const locks = new FakeLockManager()
    const supabaseLeader = new FakeSupabaseClient()
    const leader = new FanOut(OWNER, {
      bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
      locks: locks as unknown as LockManager,
      supabaseFactory: () => supabaseLeader as unknown,
      now: makeNow(),
    })
    await leader.ready()

    const supabaseFollower = new FakeSupabaseClient()
    const follower = new FanOut(OWNER, {
      bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
      locks: locks as unknown as LockManager,
      supabaseFactory: () => supabaseFollower as unknown,
      now: makeNow(),
    })
    await flushMicrotasks()

    const followerReceived: Array<{ kind: string }> = []
    follower.subscribe((s) => followerReceived.push(s))

    // First event seq=1 — establishes baseline.
    supabaseLeader.emit(`audit_runs:${OWNER}`, {
      table: "audit_runs",
      eventType: "INSERT",
      new: { id: "r1", site_id: "s1", owner_id: OWNER, status: "queued" },
    })
    // Force a gap: inject a synthetic out-of-order BC message directly to the
    // follower's BC channel onmessage handler. seq=5 is far past the expected 2.
    const followerBC = (follower as unknown as { bc: FakeBroadcastChannel }).bc
    followerBC.onmessage?.({
      data: {
        kind: "event",
        seq: 5,
        sentAt: 0,
        envelope: {
          table: "audit_runs",
          event: "INSERT",
          row: { id: "r2", site_id: "s1", owner_id: OWNER },
        },
      },
    } as MessageEvent)

    const kinds = followerReceived.map((s) => s.kind)
    expect(kinds).toContain("resync")
    expect(kinds).toContain("event")
    expect(kinds.indexOf("resync")).toBeLessThan(kinds.lastIndexOf("event"))

    follower.close()
    leader.close()
  })
})
