/**
 * FakeBroadcastChannel — an in-memory bus keyed by name. All instances created
 * with the same name share posted messages, modeling the browser's BC semantics
 * (sender does NOT receive its own messages).
 */
type BusEntry = { instance: FakeBroadcastChannel; cb: ((ev: MessageEvent) => void) | null }
const buses = new Map<string, BusEntry[]>()

export class FakeBroadcastChannel {
  readonly name: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  closed = false

  constructor(name: string) {
    this.name = name
    const arr = buses.get(name) ?? []
    arr.push({ instance: this, cb: null })
    buses.set(name, arr)
  }

  postMessage(data: unknown): void {
    if (this.closed) return
    const arr = buses.get(this.name) ?? []
    for (const entry of arr) {
      if (entry.instance === this) continue
      const cb = entry.instance.onmessage
      if (cb) cb({ data } as MessageEvent)
    }
  }

  close(): void {
    this.closed = true
    const arr = buses.get(this.name) ?? []
    buses.set(
      this.name,
      arr.filter((e) => e.instance !== this)
    )
  }

  addEventListener(): void {
    // unused — fanout assigns onmessage directly
  }
}

export function resetBroadcastChannels(): void {
  buses.clear()
}

/**
 * FakeLockManager — FIFO queue per lock name. The first caller's callback runs
 * immediately and holds the lock until the returned Promise resolves. Subsequent
 * callers wait. Models `navigator.locks` exclusive mode.
 */
type Holder = {
  release: () => void
}
type Waiter = {
  signal?: AbortSignal
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
  cb: (lock: unknown) => Promise<unknown> | unknown
}

export class FakeLockManager {
  private holders = new Map<string, Holder>()
  private waiters = new Map<string, Waiter[]>()

  async request<T>(
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal },
    cb: (lock: { name: string; mode: "exclusive" }) => Promise<T> | T
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Reject synchronously if signal is already aborted, mirroring navigator.locks.
      if (options.signal?.aborted) {
        reject(new DOMException("aborted", "AbortError"))
        return
      }

      if (!this.holders.has(name)) {
        this.runHolder(
          name,
          cb as (lock: unknown) => Promise<unknown> | unknown,
          resolve as (v: unknown) => void,
          reject
        )
        return
      }

      const arr = this.waiters.get(name) ?? []
      const waiter: Waiter = {
        signal: options.signal,
        resolve: resolve as (v: unknown) => void,
        reject,
        cb: cb as (lock: unknown) => Promise<unknown> | unknown,
      }
      arr.push(waiter)
      this.waiters.set(name, arr)

      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          const list = this.waiters.get(name) ?? []
          const idx = list.indexOf(waiter)
          if (idx === -1) return // already promoted or already removed
          list.splice(idx, 1)
          this.waiters.set(name, list)
          reject(new DOMException("aborted", "AbortError"))
        })
      }
    })
  }

  /**
   * Install a holder for `name` synchronously and invoke its callback. When the
   * callback settles, release the lock and promote the next FIFO waiter (if any)
   * in the same synchronous step, so no concurrent request() can slip in.
   */
  private runHolder(
    name: string,
    cb: (lock: unknown) => Promise<unknown> | unknown,
    resolve: (value: unknown) => void,
    reject: (err: unknown) => void
  ): void {
    // `release` is just a sentinel function — nothing awaits its completion.
    const release = () => {}
    this.holders.set(name, { release })
    ;(async () => {
      try {
        const result = await cb({ name, mode: "exclusive" })
        resolve(result)
      } catch (err) {
        reject(err)
      } finally {
        this.holders.delete(name)
        release()
        this.promoteNext(name)
      }
    })()
  }

  /** Promote the next FIFO waiter to holder, synchronously. No-op if queue empty. */
  private promoteNext(name: string): void {
    const arr = this.waiters.get(name) ?? []
    const next = arr.shift()
    this.waiters.set(name, arr)
    if (!next) return
    this.runHolder(name, next.cb, next.resolve, next.reject)
  }

  /** Force-release a lock from outside (simulates leader tab closing). */
  forceRelease(name: string): void {
    const holder = this.holders.get(name)
    if (holder) holder.release()
  }
}

/**
 * FakeSupabaseClient — minimal channel/on/subscribe surface used by FanOut.
 * Tests trigger events via `emitTo(channelName, payload)`.
 */
type ChannelHandler = (payload: { table: string; eventType: string; new: unknown }) => void
type ChannelRecord = {
  name: string
  handlers: ChannelHandler[]
  subscribed: boolean
}

export class FakeSupabaseClient {
  channels: ChannelRecord[] = []

  channel(name: string) {
    const rec: ChannelRecord = { name, handlers: [], subscribed: false }
    this.channels.push(rec)
    const builder = {
      on: (_type: "postgres_changes", _filter: unknown, cb: ChannelHandler) => {
        rec.handlers.push(cb)
        return builder
      },
      subscribe: () => {
        rec.subscribed = true
        return rec
      },
    }
    return builder
  }

  removeChannel(rec: ChannelRecord) {
    this.channels = this.channels.filter((c) => c !== rec)
    return Promise.resolve()
  }

  /** Test helper: fire an event to all handlers on a named channel. */
  emit(channelName: string, payload: { table: string; eventType: string; new: unknown }) {
    for (const c of this.channels) {
      if (c.name === channelName && c.subscribed) {
        for (const h of c.handlers) h(payload)
      }
    }
  }
}

/** Deterministic monotonic clock for tests. */
export function makeNow(start = 1_000_000): () => number {
  let t = start
  return () => t++
}

export function flushMicrotasks(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0))
}
