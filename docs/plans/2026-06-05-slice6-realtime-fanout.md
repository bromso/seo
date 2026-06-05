# Slice 6 — Realtime Fan-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open exactly one Supabase Realtime WebSocket per signed-in user across all tabs by introducing a `FanOut` module that elects a leader tab via the Web Locks API and broadcasts received events to all tabs over a `BroadcastChannel`. Existing hook signatures stay unchanged; slice 5 behavior is preserved.

**Architecture:** A new `apps/app/src/lib/realtime/` module exposes a `FanOut` class and a `useFanOut(ownerId)` React hook. The leader (winner of `navigator.locks.request("realtime-leader:<ownerId>")`) subscribes to two wide owner-scoped Supabase channels (`audit_runs`, `audit_results`) and forwards every event onto a `BroadcastChannel("realtime:<ownerId>")`. Followers don't open WebSocket connections at all; they just listen on the BC. Existing hooks (`useRealtimeScores`, `useRealtimeRuns`, `useRealtimeRun`) are rewired to consume the shared fan-out and apply locally-filtered events.

**Tech Stack:** Web Locks API (`navigator.locks`), `BroadcastChannel`, `@supabase/supabase-js`, Vitest with happy-dom (existing apps/app harness), TypeScript 5.x.

**Spec:** [`docs/plans/2026-06-05-slice6-realtime-fanout-design.md`](2026-06-05-slice6-realtime-fanout-design.md)

---

## Conventions used throughout

- Working branch: `feat/realtime-fanout-slice6` (already created off `main`).
- Conventional commits with `feat(app):` / `test(app):` / `docs(app):` scopes.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 5's 68 tests must continue to pass after every task.
- Tests live at `apps/app/src/test/realtime/`.
- Use `bun --filter @repo/app <script>` for per-package operations.
- `FanOut` accepts injected dependencies (`bcFactory`, `locks`, `supabaseFactory`, `now`) so tests never touch real `navigator` globals.
- No new dependencies. No schema changes.

---

## Task 1: `lib/realtime/envelope.ts` + tests

**Files:**
- Create: `apps/app/src/lib/realtime/envelope.ts`
- Create: `apps/app/src/test/realtime/envelope.test.ts`

The envelope is the typed wrapper around a Supabase Realtime payload that flows over the BroadcastChannel.

- [ ] **Step 1: Failing test**

`apps/app/src/test/realtime/envelope.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { fromSupabasePayload, type Envelope } from "@/lib/realtime/envelope"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"

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
      fromSupabasePayload({ table: "audit_results", eventType: "DELETE", new: RESULT }),
    ).toBeNull()
  })

  it("returns null for unsupported tables", () => {
    expect(
      fromSupabasePayload({ table: "sites", eventType: "INSERT", new: {} }),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 5 new failures (module not found).

- [ ] **Step 3: Implement `src/lib/realtime/envelope.ts`**

```ts
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"

export type Envelope =
  | { table: "audit_runs"; event: "INSERT" | "UPDATE"; row: AuditRunRow }
  | { table: "audit_results"; event: "INSERT"; row: AuditResultRow }

export type SupabasePayloadShape = {
  table: string
  eventType: string
  new: unknown
}

export function fromSupabasePayload(p: SupabasePayloadShape): Envelope | null {
  if (p.table === "audit_runs") {
    if (p.eventType === "INSERT" || p.eventType === "UPDATE") {
      return { table: "audit_runs", event: p.eventType, row: p.new as AuditRunRow }
    }
    return null
  }
  if (p.table === "audit_results") {
    if (p.eventType === "INSERT") {
      return { table: "audit_results", event: "INSERT", row: p.new as AuditResultRow }
    }
    return null
  }
  return null
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 5 new tests pass. Total: 68 + 5 = 73.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/realtime/envelope.ts apps/app/src/test/realtime/envelope.test.ts
git commit -m "feat(app): add realtime envelope + fromSupabasePayload with TDD"
```

---

## Task 2: `lib/realtime/filter.ts` + tests

**Files:**
- Create: `apps/app/src/lib/realtime/filter.ts`
- Create: `apps/app/src/test/realtime/filter.test.ts`

Pure predicate helpers: each hook calls the one that matches its scope.

- [ ] **Step 1: Failing test**

`apps/app/src/test/realtime/filter.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { Envelope } from "@/lib/realtime/envelope"
import {
  shouldDeliverToRun,
  shouldDeliverToRuns,
  shouldDeliverToScores,
} from "@/lib/realtime/filter"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"

const SITE_A = "11111111-1111-4111-8111-111111111111"
const SITE_B = "22222222-2222-4222-8222-222222222222"
const RUN_A = "33333333-3333-4333-8333-333333333333"
const RUN_B = "44444444-4444-4444-8444-444444444444"

function runEnv(event: "INSERT" | "UPDATE", row: Partial<AuditRunRow>): Envelope {
  return {
    table: "audit_runs",
    event,
    row: { id: RUN_A, site_id: SITE_A, owner_id: "x", status: "running", requested_url: "u", final_url: null, started_at: "t", finished_at: null, triggered_by: "manual", ...row },
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 10 new failures (module not found).

- [ ] **Step 3: Implement `src/lib/realtime/filter.ts`**

```ts
import type { Envelope } from "@/lib/realtime/envelope"

export function shouldDeliverToScores(e: Envelope): boolean {
  return e.table === "audit_results"
}

export function shouldDeliverToRuns(e: Envelope, siteId: string): boolean {
  return e.table === "audit_runs" && e.row.site_id === siteId
}

export function shouldDeliverToRun(e: Envelope, runId: string): boolean {
  if (e.table === "audit_runs") return e.event === "UPDATE" && e.row.id === runId
  if (e.table === "audit_results") return e.row.run_id === runId
  return false
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 10 new tests pass. Total: 73 + 10 = 83.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/realtime/filter.ts apps/app/src/test/realtime/filter.test.ts
git commit -m "feat(app): add realtime filter predicates (scores/runs/run) with TDD"
```

---

## Task 3: Test fakes for fan-out

**Files:**
- Create: `apps/app/src/test/realtime/fakes.ts`

Fakes for `BroadcastChannel`, `LockManager`, and a minimal Supabase Realtime client. Reused by the FanOut tests.

- [ ] **Step 1: Create `src/test/realtime/fakes.ts`**

```ts
import { vi } from "vitest"

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
      arr.filter((e) => e.instance !== this),
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
  done: Promise<void>
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
    cb: (lock: { name: string; mode: "exclusive" }) => Promise<T> | T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tryAcquire = () => {
        if (!this.holders.has(name)) {
          let release!: () => void
          const done = new Promise<void>((r) => {
            release = r
          })
          this.holders.set(name, { release, done })
          ;(async () => {
            try {
              const result = await cb({ name, mode: "exclusive" })
              resolve(result)
            } catch (err) {
              reject(err)
            } finally {
              this.holders.delete(name)
              release()
              const arr = this.waiters.get(name)
              const next = arr?.shift()
              if (next) {
                this.waiters.set(name, arr ?? [])
                Promise.resolve().then(() => {
                  this.request(name, { mode: "exclusive", signal: next.signal }, next.cb).then(
                    next.resolve,
                    next.reject,
                  )
                })
              }
            }
          })()
        } else {
          const arr = this.waiters.get(name) ?? []
          arr.push({
            signal: options.signal,
            resolve: resolve as (v: unknown) => void,
            reject,
            cb: cb as (lock: unknown) => Promise<unknown>,
          })
          this.waiters.set(name, arr)
          if (options.signal) {
            options.signal.addEventListener("abort", () => {
              const list = this.waiters.get(name) ?? []
              const idx = list.findIndex((w) => w.resolve === (resolve as unknown))
              if (idx >= 0) list.splice(idx, 1)
              this.waiters.set(name, list)
              reject(new DOMException("aborted", "AbortError"))
            })
          }
        }
      }
      tryAcquire()
    })
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
      on: (
        _type: "postgres_changes",
        _filter: unknown,
        cb: ChannelHandler,
      ) => {
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

/** Convenience: silence unused-import warnings when test only uses one fake. */
export const _unused = vi.fn
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app check-types
```

Expected: clean (fakes are reachable but not used yet).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/test/realtime/fakes.ts
git commit -m "test(app): add FakeBroadcastChannel + FakeLockManager + FakeSupabaseClient"
```

---

## Task 4: `FanOut` — leader path (becomes leader when lock is free)

**Files:**
- Create: `apps/app/src/lib/realtime/fan-out.ts`
- Create: `apps/app/src/test/realtime/fan-out.test.ts`

The first FanOut test: with no prior holder, a new FanOut wins the lock and opens both Supabase channels.

- [ ] **Step 1: Failing test**

`apps/app/src/test/realtime/fan-out.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: FAIL — `FanOut` not exported.

- [ ] **Step 3: Implement `src/lib/realtime/fan-out.ts` (skeleton + leader path)**

```ts
import { fromSupabasePayload, type Envelope } from "@/lib/realtime/envelope"

export type FanOutSignal =
  | { kind: "event"; envelope: Envelope }
  | { kind: "resync" }

export type FanOutSubscriber = (s: FanOutSignal) => void

type SupabaseChannelLike = {
  name: string
}

type SupabaseLike = {
  channel: (name: string) => {
    on: (
      type: "postgres_changes",
      filter: unknown,
      cb: (payload: { table: string; eventType: string; new: unknown }) => void,
    ) => unknown
    subscribe: () => SupabaseChannelLike
  }
  removeChannel: (c: SupabaseChannelLike) => Promise<unknown>
}

export type FanOutDeps = {
  bcFactory: (name: string) => BroadcastChannel
  locks: LockManager
  supabaseFactory: () => SupabaseLike
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
          }),
      )
    } catch {
      // aborted — close() was called before leadership granted
    } finally {
      if (!this.leaderResolved) this.markReady()
    }
  }

  private becomeLeader(): void {
    this.isLeader = true
    this.supabase = this.deps.supabaseFactory()
    const runsChan = this.supabase
      .channel(`audit_runs:${this.ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "audit_runs",
          filter: `owner_id=eq.${this.ownerId}`,
        },
        (payload) => this.onSupabasePayload(payload),
      )
      .subscribe()
    const resultsChan = this.supabase
      .channel(`audit_results:${this.ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_results",
          filter: `owner_id=eq.${this.ownerId}`,
        },
        (payload) => this.onSupabasePayload(payload),
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 1 new test passes. Total: 83 + 1 = 84.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/realtime/fan-out.ts apps/app/src/test/realtime/fan-out.test.ts
git commit -m "feat(app): add FanOut leader path (lock acquisition + Supabase subs)"
```

---

## Task 5: FanOut — follower path (does NOT open Supabase channels)

**Files:**
- Modify: `apps/app/src/test/realtime/fan-out.test.ts` (append test)

When the lock is already held by another tab, the new FanOut stays follower and opens no WebSocket.

- [ ] **Step 1: Append test**

Add at the end of `fan-out.test.ts`:

```ts
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
        }),
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
```

- [ ] **Step 2: Run — expect FAIL initially? Verify**

```bash
bun --filter @repo/app test
```

The test should already PASS (leader code only runs after lock acquisition, which doesn't happen as follower). If it fails, debug the FakeLockManager FIFO logic before proceeding.

Expected: 85 total tests passing.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/test/realtime/fan-out.test.ts
git commit -m "test(app): add FanOut follower path test"
```

---

## Task 6: FanOut — event forwarding (BC publish + local delivery)

**Files:**
- Modify: `apps/app/src/test/realtime/fan-out.test.ts` (append)

- [ ] **Step 1: Append test**

```ts
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
```

- [ ] **Step 2: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 87 total tests passing (2 new).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/test/realtime/fan-out.test.ts
git commit -m "test(app): add FanOut event-forwarding tests (local + BC)"
```

---

## Task 7: FanOut — `resync` signal on `seq` gap

**Files:**
- Modify: `apps/app/src/test/realtime/fan-out.test.ts` (append)

Simulate a missed-message gap: post a `seq=1` event, then a `seq=3` event, expect the follower to emit `resync` before delivering the `seq=3` event.

- [ ] **Step 1: Append test**

```ts
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
    // Force a gap: leader emits an extra event the follower will "miss"… we
    // simulate this by manually bumping the leader's seq counter via a direct
    // BC post is impossible; instead we trigger two emits and assert that the
    // follower sees both. The gap path is covered by injecting a synthetic
    // out-of-order message:
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
```

- [ ] **Step 2: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 88 total tests passing (1 new).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/test/realtime/fan-out.test.ts
git commit -m "test(app): add FanOut resync-on-seq-gap test"
```

---

## Task 8: FanOut — `close()` cleanup

**Files:**
- Modify: `apps/app/src/test/realtime/fan-out.test.ts` (append)

- [ ] **Step 1: Append test**

```ts
describe("FanOut — close", () => {
  it("removes all supabase channels and stops dispatching after close()", async () => {
    const { fanOut, supabase } = makeFanOut()
    await fanOut.ready()
    expect(supabase.channels.length).toBe(2)

    const received: unknown[] = []
    fanOut.subscribe((s) => received.push(s))

    fanOut.close()
    expect(supabase.channels.length).toBe(0)

    // Post-close events should not reach the (now-cleared) subscriber set.
    // Emit on a fresh client — even if the old subscribers were live, the
    // FanOut shouldn't be listening any more.
    supabase.emit(`audit_runs:${OWNER}`, {
      table: "audit_runs",
      eventType: "INSERT",
      new: { id: "r1", site_id: "s1", owner_id: OWNER },
    })
    expect(received).toHaveLength(0)
  })

  it("releases the leadership lock so the next tab can take over", async () => {
    const locks = new FakeLockManager()
    const f1 = makeFanOut({ locks }).fanOut
    await f1.ready()
    expect(f1.isLeader).toBe(true)

    const supabase2 = new FakeSupabaseClient()
    const f2 = new FanOut(OWNER, {
      bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
      locks: locks as unknown as LockManager,
      supabaseFactory: () => supabase2 as unknown,
      now: makeNow(),
    })
    await flushMicrotasks()
    expect(f2.isLeader).toBe(false)

    f1.close()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(f2.isLeader).toBe(true)
    expect(supabase2.channels.length).toBe(2)

    f2.close()
  })
})
```

- [ ] **Step 2: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 90 total tests passing (2 new).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/test/realtime/fan-out.test.ts
git commit -m "test(app): add FanOut close() cleanup + leader-handoff tests"
```

---

## Task 9: `useFanOut` hook + per-tab registry

**Files:**
- Create: `apps/app/src/lib/realtime/use-fan-out.ts`
- Create: `apps/app/src/test/realtime/use-fan-out.test.ts`

React hook with ref-counted registry. Two callers in the same tab share one FanOut.

- [ ] **Step 1: Failing test**

`apps/app/src/test/realtime/use-fan-out.test.ts`:

```ts
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FakeBroadcastChannel,
  FakeLockManager,
  FakeSupabaseClient,
  makeNow,
  resetBroadcastChannels,
} from "@/test/realtime/fakes"
import * as fanOutModule from "@/lib/realtime/fan-out"
import { _resetFanOutRegistry, useFanOut } from "@/lib/realtime/use-fan-out"

const OWNER = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

afterEach(() => {
  resetBroadcastChannels()
  _resetFanOutRegistry()
  vi.restoreAllMocks()
})

// Inject the FanOut constructor's deps via a global override.
beforeEach(() => {
  // Spy on the FanOut constructor by reassigning deps in module under test
  ;(globalThis as unknown as { __realtimeDeps?: fanOutModule.FanOutDeps }).__realtimeDeps = {
    bcFactory: (n) => new FakeBroadcastChannel(n) as unknown as BroadcastChannel,
    locks: new FakeLockManager() as unknown as LockManager,
    supabaseFactory: () => new FakeSupabaseClient() as unknown,
    now: makeNow(),
  }
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
```

> Note: `beforeEach` import — add to the imports line at the top: `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"`.

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: module not found.

- [ ] **Step 3: Implement `src/lib/realtime/use-fan-out.ts`**

```ts
"use client"
import { useEffect, useState } from "react"
import { createBrowserSupabase } from "@/lib/supabase-browser"
import { FanOut, type FanOutDeps } from "@/lib/realtime/fan-out"

type RegistryEntry = { fanOut: FanOut; refs: number }
const registry = new Map<string, RegistryEntry>()

/** Test-only: clear the registry between cases. */
export function _resetFanOutRegistry(): void {
  for (const entry of registry.values()) entry.fanOut.close()
  registry.clear()
}

function defaultDeps(): FanOutDeps {
  return {
    bcFactory: (name) => new BroadcastChannel(name),
    locks: navigator.locks,
    supabaseFactory: () => createBrowserSupabase() as unknown,
    now: () => Date.now(),
  }
}

function getDeps(): FanOutDeps {
  const overridden = (globalThis as unknown as { __realtimeDeps?: FanOutDeps }).__realtimeDeps
  return overridden ?? defaultDeps()
}

export function useFanOut(ownerId: string): FanOut {
  const [instance] = useState<FanOut>(() => {
    const existing = registry.get(ownerId)
    if (existing) {
      existing.refs += 1
      return existing.fanOut
    }
    const fanOut = new FanOut(ownerId, getDeps())
    registry.set(ownerId, { fanOut, refs: 1 })
    return fanOut
  })

  useEffect(() => {
    return () => {
      const entry = registry.get(ownerId)
      if (!entry) return
      entry.refs -= 1
      if (entry.refs <= 0) {
        entry.fanOut.close()
        registry.delete(ownerId)
      }
    }
  }, [ownerId])

  return instance
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 2 new tests pass. Total: 90 + 2 = 92.

If `@testing-library/react` is not installed in apps/app, install it first:

```bash
bun add -d -F @repo/app @testing-library/react
```

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/realtime/use-fan-out.ts apps/app/src/test/realtime/use-fan-out.test.ts apps/app/package.json
git commit -m "feat(app): add useFanOut hook with per-tab ref-counted registry"
```

---

## Task 10: `lib/realtime/index.ts` re-exports

**Files:**
- Create: `apps/app/src/lib/realtime/index.ts`

- [ ] **Step 1: Create `index.ts`**

```ts
export { fromSupabasePayload, type Envelope } from "@/lib/realtime/envelope"
export { shouldDeliverToRun, shouldDeliverToRuns, shouldDeliverToScores } from "@/lib/realtime/filter"
export { FanOut, type FanOutDeps, type FanOutSignal, type FanOutSubscriber } from "@/lib/realtime/fan-out"
export { useFanOut } from "@/lib/realtime/use-fan-out"
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/realtime/index.ts
git commit -m "feat(app): export realtime barrel"
```

---

## Task 11: Rewire `useRealtimeScores`

**Files:**
- Modify: `apps/app/src/hooks/use-realtime-scores.ts` (replace entirely)

- [ ] **Step 1: Replace `src/hooks/use-realtime-scores.ts`**

```ts
"use client"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { shouldDeliverToScores } from "@/lib/realtime/filter"
import { useFanOut } from "@/lib/realtime/use-fan-out"

export function useRealtimeScores(ownerId: string): void {
  const router = useRouter()
  const fanOut = useFanOut(ownerId)
  useEffect(() => {
    return fanOut.subscribe((s) => {
      if (s.kind === "resync") {
        router.refresh()
        return
      }
      if (shouldDeliverToScores(s.envelope)) {
        router.refresh()
      }
    })
  }, [fanOut, router])
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. (No new tests; slice 5's behavior preserved.)

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/hooks/use-realtime-scores.ts
git commit -m "feat(app): rewire useRealtimeScores onto FanOut"
```

---

## Task 12: Rewire `useRealtimeRuns` (with resync re-query)

**Files:**
- Modify: `apps/app/src/hooks/use-realtime-runs.ts` (replace entirely)

The runs hook has local state. On `resync`, re-query `audit_runs` for the siteId.

- [ ] **Step 1: Replace `src/hooks/use-realtime-runs.ts`**

```ts
"use client"
import { useCallback, useEffect, useState } from "react"
import type { AuditRunRow } from "@/lib/db-types"
import { shouldDeliverToRuns } from "@/lib/realtime/filter"
import { useFanOut } from "@/lib/realtime/use-fan-out"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function useRealtimeRuns(
  ownerId: string,
  siteId: string,
  initial: AuditRunRow[],
): AuditRunRow[] {
  const [runs, setRuns] = useState(initial)
  const fanOut = useFanOut(ownerId)

  const resync = useCallback(async () => {
    const supabase = createBrowserSupabase()
    const { data } = await supabase
      .from("audit_runs")
      .select(
        "id,site_id,owner_id,status,requested_url,final_url,started_at,finished_at,triggered_by",
      )
      .eq("site_id", siteId)
      .order("started_at", { ascending: false })
      .limit(20)
      .returns<AuditRunRow[]>()
    if (data) setRuns(data)
  }, [siteId])

  useEffect(() => {
    return fanOut.subscribe((s) => {
      if (s.kind === "resync") {
        void resync()
        return
      }
      if (!shouldDeliverToRuns(s.envelope, siteId)) return
      const row = s.envelope.row as AuditRunRow
      if (s.envelope.event === "INSERT") {
        setRuns((prev) => [row, ...prev].slice(0, 20))
      } else {
        setRuns((prev) => prev.map((r) => (r.id === row.id ? row : r)))
      }
    })
  }, [fanOut, siteId, resync])

  return runs
}
```

> Note the **signature change**: `useRealtimeRuns` now takes `ownerId` as the first param. Update the caller in `apps/app/src/views/dashboard-view.tsx` (slice 4) — but slice 5 replaced that view, so the only caller is `useRealtimeRun` and the new dashboard view doesn't use this hook directly. Verify with grep:
>
> ```bash
> grep -rn "useRealtimeRuns" apps/app/src
> ```
>
> If a caller exists, update it to pass `ownerId` as the first arg. If no caller (slice 5 left it unused), proceed.

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/hooks/use-realtime-runs.ts
# include any updated callers
git commit -m "feat(app): rewire useRealtimeRuns onto FanOut (resync re-queries audit_runs)"
```

---

## Task 13: Rewire `useRealtimeRun` (with resync re-query)

**Files:**
- Modify: `apps/app/src/hooks/use-realtime-run.ts` (replace entirely)

Same pattern: subscribes via FanOut, applies filtered events to local state, re-queries on resync.

- [ ] **Step 1: Read the current hook to preserve external shape**

```bash
cat apps/app/src/hooks/use-realtime-run.ts
```

Note the public type signature and re-implement preserving it. Most likely it accepts `(runId, initialRun, initialResults)` and returns the live tuple.

- [ ] **Step 2: Replace `src/hooks/use-realtime-run.ts`**

```ts
"use client"
import { useCallback, useEffect, useState } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { shouldDeliverToRun } from "@/lib/realtime/filter"
import { useFanOut } from "@/lib/realtime/use-fan-out"
import { createBrowserSupabase } from "@/lib/supabase-browser"

type State = { run: AuditRunRow | null; results: AuditResultRow[] }

export function useRealtimeRun(
  ownerId: string,
  runId: string,
  initial: State,
): State {
  const [state, setState] = useState<State>(initial)
  const fanOut = useFanOut(ownerId)

  const resync = useCallback(async () => {
    const supabase = createBrowserSupabase()
    const [{ data: run }, { data: results }] = await Promise.all([
      supabase
        .from("audit_runs")
        .select(
          "id,site_id,owner_id,status,requested_url,final_url,started_at,finished_at,triggered_by",
        )
        .eq("id", runId)
        .maybeSingle<AuditRunRow>(),
      supabase
        .from("audit_results")
        .select(
          "id,run_id,owner_id,category,status,score,issues,raw,partial_reasons,error_code,error_message,error_retryable,package_name,package_version,duration_ms,started_at",
        )
        .eq("run_id", runId)
        .returns<AuditResultRow[]>(),
    ])
    setState({ run: run ?? null, results: results ?? [] })
  }, [runId])

  useEffect(() => {
    return fanOut.subscribe((s) => {
      if (s.kind === "resync") {
        void resync()
        return
      }
      if (!shouldDeliverToRun(s.envelope, runId)) return
      if (s.envelope.table === "audit_runs" && s.envelope.event === "UPDATE") {
        const row = s.envelope.row
        setState((prev) => ({ ...prev, run: row }))
      } else if (s.envelope.table === "audit_results" && s.envelope.event === "INSERT") {
        const row = s.envelope.row
        setState((prev) => ({ ...prev, results: [...prev.results, row] }))
      }
    })
  }, [fanOut, runId, resync])

  return state
}
```

Update the caller (`apps/app/src/views/run-detail-view.tsx`) to pass `ownerId` as the first param. Find and grep:

```bash
grep -rn "useRealtimeRun(" apps/app/src
```

For each call site: prepend `ownerId` (the dashboard page already redirects to `/sign-in` if no user, so callers can pass `user.id` from the page query).

- [ ] **Step 3: Build + typecheck**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/hooks/use-realtime-run.ts apps/app/src/views/run-detail-view.tsx apps/app/src/app
git commit -m "feat(app): rewire useRealtimeRun onto FanOut (resync re-queries run + results)"
```

---

## Task 14: Graceful fallback when `navigator.locks` is unavailable

**Files:**
- Modify: `apps/app/src/lib/realtime/use-fan-out.ts`

If the browser lacks Web Locks (iOS < 15.4, headless test contexts) the FanOut should still subscribe, just per-tab. Implementation: detect `navigator.locks` at runtime; if missing, swap in a "always-leader" stub LockManager so every tab opens its own subscription.

- [ ] **Step 1: Modify `defaultDeps()`**

Replace `defaultDeps()` in `use-fan-out.ts` with:

```ts
// Fallback BC stub for environments without the global. The "always-leader"
// lock fallback means every tab opens its own subscriptions and never needs
// to receive a remote message, so postMessage is a safe no-op.
class StubBC {
  onmessage: ((ev: MessageEvent) => void) | null = null
  constructor(public readonly name: string) {}
  postMessage(_data: unknown): void {}
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return false
  }
}

function defaultDeps(): FanOutDeps {
  const realLocks =
    typeof navigator !== "undefined" && "locks" in navigator
      ? (navigator as { locks: LockManager }).locks
      : null
  const locks: LockManager =
    realLocks ??
    // Synchronous "always-leader" stub. Every tab opens its own Supabase
    // channels — slice-5 behavior preserved for older browsers / non-DOM envs.
    ({
      async request<T>(
        name: string,
        _opts: { mode: "exclusive"; signal?: AbortSignal },
        cb: (lock: { name: string; mode: "exclusive" }) => Promise<T> | T,
      ): Promise<T> {
        return cb({ name, mode: "exclusive" })
      },
    } as unknown as LockManager)
  return {
    bcFactory: (name) =>
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(name)
        : (new StubBC(name) as unknown as BroadcastChannel),
    locks,
    supabaseFactory: () => createBrowserSupabase() as unknown,
    now: () => Date.now(),
  }
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/realtime/use-fan-out.ts
git commit -m "feat(app): fall back to per-tab subs when navigator.locks is missing"
```

---

## Task 15: README smoke checklist + DoD sweep

**Files:**
- Modify: `apps/app/README.md` (append steps 20-24)

- [ ] **Step 1: Append smoke steps to `apps/app/README.md`**

Find the existing "Manual smoke checklist" section (ending at slice 5's step 19). After step 19 add:

```
20. Sign in. Open `/dashboard` in tab A and tab B. Open DevTools → Network → WS in both.
    Expect exactly ONE WebSocket connection (in tab A — the leader).
21. Queue an audit from tab B → both tabs refresh.
22. Close tab A → tab B acquires the leader lock and opens a new WebSocket within ~100ms.
23. Open `/dashboard/runs/<runId>` in a third tab → still one WebSocket total; the run
    detail updates live.
24. iOS Safari ≥15.4: same flow. The fan-out uses BroadcastChannel + Web Locks (no
    SharedWorker required).
```

- [ ] **Step 2: Full DoD sweep**

```bash
# 1. All tests
bun --filter @repo/app test
# Expected: ~92 passing (68 slice 5 + 24 slice 6)

# 2. Typecheck
bun --filter @repo/app check-types
# Clean

# 3. Build
bun --filter @repo/app build
# Clean

# 4. Lint (Biome) — runs in pre-commit, but verify standalone
bun --filter @repo/app lint
```

Document the results in the commit message and final report.

- [ ] **Step 3: Final commit**

```bash
git add apps/app/README.md
git commit -m "docs(app): add slice 6 smoke checklist (steps 20-24)"
```

---

## Report Format

(For the implementer to fill in after T15.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (~92 tests) | … |
  | 4 | Exactly 1 WebSocket across N tabs (devtools) | Deferred to user verification |
  | 5 | Leader handoff <100ms after closing leader tab | Deferred to user verification |
  | 6 | iOS Safari path works (BC + Web Locks, no SharedWorker) | Deferred to user verification |
- Total test count
- Commit SHA list (15 commits expected)
- Slice 6 release note (one line)
- Any carry-forwards for slice 7

---

## After slice 6

Slice 7 candidates (deferred from this slice):

- **Last-known scores cache** — write `latest_scores_per_site` rows into IndexedDB on each successful fetch; SW returns cached HTML + cached scores when offline. Use the new FanOut as the eventbus that keeps the cache fresh while open.
- **PWA install prompt** — `beforeinstallprompt` capture + a non-intrusive in-app install button. iOS "Add to Home Screen" instructions card.
- **Background sync** — queue audit runs while offline; flush when network returns.
