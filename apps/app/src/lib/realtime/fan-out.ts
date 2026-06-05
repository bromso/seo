import { type Envelope, fromSupabasePayload } from "@/lib/realtime/envelope"

export type FanOutSignal = { kind: "event"; envelope: Envelope } | { kind: "resync" }

export type FanOutSubscriber = (s: FanOutSignal) => void

type SupabaseChannelLike = {
  name: string
}

type SupabaseChannelBuilder = {
  on: (
    type: "postgres_changes",
    filter: unknown,
    cb: (payload: { table: string; eventType: string; new: unknown }) => void
  ) => SupabaseChannelBuilder
  subscribe: () => SupabaseChannelLike
}

type SupabaseLike = {
  channel: (name: string) => SupabaseChannelBuilder
  removeChannel: (c: SupabaseChannelLike) => Promise<unknown>
}

export type FanOutDeps = {
  bcFactory: (name: string) => BroadcastChannel
  locks: LockManager
  /**
   * Returns a Supabase client. Typed as `unknown` so tests can hand in a fake
   * without leaking the public Supabase type into the wider surface; the
   * implementation narrows to `SupabaseLike` internally.
   */
  supabaseFactory: () => unknown
  now: () => number
}

type BCMessage =
  | { kind: "event"; envelope: Envelope; seq: number; sentAt: number }
  | { kind: "leader-claim"; tabId: string; sentAt: number }

export class FanOut {
  readonly ownerId: string
  private deps: FanOutDeps
  private bc: BroadcastChannel
  private subscribers = new Set<FanOutSubscriber>()
  private abort = new AbortController()
  private leaderResolved = false
  private leaderPromise: Promise<void>
  private resolveReady!: () => void
  private channelsHeld: SupabaseChannelLike[] = []
  private supabase: SupabaseLike | null = null
  private seqOut = 0
  private seqIn: number | null = null

  isLeader = false

  constructor(ownerId: string, deps: FanOutDeps) {
    this.ownerId = ownerId
    this.deps = deps
    this.bc = deps.bcFactory(`realtime:${ownerId}`)
    this.bc.onmessage = (ev) => this.onBCMessage(ev.data as BCMessage)
    this.leaderPromise = new Promise<void>((r) => {
      this.resolveReady = r
    })
    void this.tryAcquireLeader()
  }

  /**
   * Resolves when this tab has become the leader (lock acquired + Supabase
   * channels open). Followers' `ready()` never resolves — followers don't
   * need to await readiness because BC messages can arrive any time after
   * construction. Test code uses `flushMicrotasks()` to settle follower state.
   */
  ready(): Promise<void> {
    return this.leaderPromise
  }

  subscribe(cb: FanOutSubscriber): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  close(): void {
    this.abort.abort()
    this.bc.close()
    if (this.supabase) {
      for (const c of this.channelsHeld) {
        void this.supabase.removeChannel(c)
      }
      this.channelsHeld = []
    }
    this.subscribers.clear()
  }

  private async tryAcquireLeader(): Promise<void> {
    try {
      await this.deps.locks.request(
        `realtime-leader:${this.ownerId}`,
        { mode: "exclusive", signal: this.abort.signal },
        () =>
          new Promise<void>((resolve) => {
            this.becomeLeader()
            this.abort.signal.addEventListener("abort", () => resolve())
          })
      )
    } catch {
      // aborted — close() was called before leadership granted
    } finally {
      if (!this.leaderResolved) this.markReady()
    }
  }

  private becomeLeader(): void {
    this.isLeader = true
    const supabase = this.deps.supabaseFactory() as SupabaseLike
    this.supabase = supabase
    const runsChan = supabase
      .channel(`audit_runs:${this.ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "audit_runs",
          filter: `owner_id=eq.${this.ownerId}`,
        },
        (payload) => this.onSupabasePayload(payload)
      )
      .subscribe()
    const resultsChan = supabase
      .channel(`audit_results:${this.ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_results",
          filter: `owner_id=eq.${this.ownerId}`,
        },
        (payload) => this.onSupabasePayload(payload)
      )
      .subscribe()
    this.channelsHeld = [runsChan, resultsChan]
    this.markReady()
  }

  private markReady(): void {
    if (this.leaderResolved) return
    this.leaderResolved = true
    this.resolveReady()
  }

  private onSupabasePayload(payload: { table: string; eventType: string; new: unknown }): void {
    const envelope = fromSupabasePayload(payload)
    if (!envelope) return
    this.seqOut += 1
    const msg: BCMessage = {
      kind: "event",
      envelope,
      seq: this.seqOut,
      sentAt: this.deps.now(),
    }
    this.bc.postMessage(msg)
    // Leader also emits locally — it's a participant in its own channel.
    this.dispatch({ kind: "event", envelope })
  }

  private onBCMessage(msg: BCMessage): void {
    if (msg.kind !== "event") return
    if (this.seqIn !== null && msg.seq > this.seqIn + 1) {
      this.dispatch({ kind: "resync" })
    }
    this.seqIn = msg.seq
    this.dispatch({ kind: "event", envelope: msg.envelope })
  }

  private dispatch(signal: FanOutSignal): void {
    for (const cb of this.subscribers) cb(signal)
  }
}
