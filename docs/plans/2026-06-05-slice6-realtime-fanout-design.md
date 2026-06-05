# Slice 6 — Realtime Fan-Out Design

**Status:** Spec — ready for implementation planning.

**Driver:** Realtime efficiency. With multiple tabs open on the dashboard or run-detail pages, each tab opens its own Supabase Realtime WebSocket. Slice 6 collapses these to **one WebSocket per signed-in user across all tabs**, regardless of which views are open.

**Out of scope (deferred from the original slice 6 brief):**
- Caching last-known scores for offline view. The existing Serwist setup already caches the app shell; full offline-data UX is a future slice.
- PWA install prompt. The manifest + icons already ship; the prompt UX is a future slice.

---

## Goal

Open exactly **one** Supabase Realtime WebSocket per signed-in user, no matter how many tabs the user has on `/dashboard` or `/dashboard/runs/[runId]`. All tabs receive the same stream of events via a cross-tab channel and apply them locally.

## Non-goals

- New Realtime subscriptions or schema changes.
- Behavior changes to `useRealtimeScores`, `useRealtimeRuns`, `useRealtimeRun` — public API is identical.
- SharedWorker. Slice 6 uses `BroadcastChannel` + the Web Locks API instead, so iOS Safari (≥15.4) is supported with a single code path.

---

## Architecture

```
┌───────── Tab A (leader) ─────────┐    ┌───────── Tab B (follower) ─────┐    ┌───── Tab C (follower) ──────┐
│  useRealtimeScores                │    │  useRealtimeScores              │    │  useRealtimeRun             │
│        │                          │    │        │                        │    │        │                    │
│        ▼                          │    │        ▼                        │    │        ▼                    │
│  useFanOut(ownerId) ──────────────┼────┼─→ useFanOut(ownerId) ───────────┼────┼─→ useFanOut(ownerId)       │
│        │                          │    │        │                        │    │        │                    │
│        ▼                          │    │        ▼                        │    │        ▼                    │
│  BroadcastChannel("realtime:U")   │←──→│  BroadcastChannel("realtime:U") │←──→│  BroadcastChannel("realtime:U")│
│        │                          │    │                                 │    │                              │
│        │ (this tab holds the lock)│    │                                 │    │                              │
│        ▼                          │    │                                 │    │                              │
│  Supabase Realtime WebSocket      │    │                                 │    │                              │
│   • audit_runs    owner=U         │    │                                 │    │                              │
│   • audit_results owner=U         │    │                                 │    │                              │
└───────────────────────────────────┘    └─────────────────────────────────┘    └──────────────────────────────┘
```

**Leader election** uses the Web Locks API:

```ts
navigator.locks.request(
  `realtime-leader:${ownerId}`,
  { mode: "exclusive", signal: abort },
  () => new Promise<void>(resolve => abort.addEventListener("abort", () => resolve())),
)
```

The Promise inside `request()` never resolves naturally, so the lock is held for the lifetime of the leader tab. When the leader tab closes, the browser releases the lock and immediately grants it to one of the waiting tabs. Typical handoff gap: <100ms.

**Subscription strategy:** The leader opens two **wide owner-scoped subscriptions** on Supabase Realtime — `audit_runs` and `audit_results`, both filtered server-side by `owner_id=eq.${ownerId}`. Every event is wrapped in a typed envelope and broadcast to all tabs. Each tab filters locally for the rows it cares about. RLS already caps event flow to the user's rows; the extra in-memory filter is cheap.

---

## File layout

```
apps/app/src/lib/realtime/
├── envelope.ts          Type + constructor for the BC message envelope
├── filter.ts            Pure helpers: shouldDeliverToScores/Runs/Run
├── fan-out.ts           FanOut class: leader election + Supabase subs + BC publish
├── use-fan-out.ts       React hook: ref-counted FanOut per ownerId per tab
└── index.ts             Re-exports

apps/app/src/hooks/
├── use-realtime-scores.ts   Rewired to use useFanOut + shouldDeliverToScores
├── use-realtime-runs.ts     Rewired to use useFanOut + shouldDeliverToRuns
└── use-realtime-run.ts      Rewired to use useFanOut + shouldDeliverToRun

apps/app/src/test/realtime/
├── envelope.test.ts
├── filter.test.ts
└── fan-out.test.ts          Uses injected BroadcastChannel + locks stubs
```

---

## Public API

```ts
// lib/realtime/envelope.ts
export type Envelope =
  | { table: "audit_runs"; event: "INSERT" | "UPDATE"; row: AuditRunRow }
  | { table: "audit_results"; event: "INSERT"; row: AuditResultRow }

// lib/realtime/fan-out.ts
export type FanOutSignal =
  | { kind: "event"; envelope: Envelope }
  | { kind: "resync" } // gap detected; consumer should re-query its initial state

export type FanOutSubscriber = (s: FanOutSignal) => void

export interface FanOut {
  subscribe(cb: FanOutSubscriber): () => void  // returns unsubscribe
  close(): void
}

// lib/realtime/use-fan-out.ts
export function useFanOut(ownerId: string): FanOut
```

The three existing hooks become thin filters. Example:

```ts
// use-realtime-scores.ts
export function useRealtimeScores(ownerId: string): void {
  const router = useRouter()
  const fanOut = useFanOut(ownerId)
  useEffect(
    () =>
      fanOut.subscribe((s) => {
        if (s.kind === "resync") {
          router.refresh()
          return
        }
        if (shouldDeliverToScores(s.envelope)) router.refresh()
      }),
    [fanOut, router],
  )
}
```

`useFanOut(ownerId)` is **idempotent inside one tab**: the first caller creates the FanOut, subsequent callers get the same instance via a tab-level registry, and the instance is torn down only when its refcount hits zero. A tab open on `/dashboard` AND `/dashboard/runs/<id>` therefore has exactly one FanOut, not two.

---

## Message protocol

Every cross-tab message uses this envelope:

```ts
type BCMessage =
  | { kind: "event"; envelope: Envelope; seq: number; sentAt: number }
  | { kind: "leader-claim"; tabId: string; sentAt: number }  // debug only
```

- `seq` is a monotonic counter incremented by the leader for each event it forwards.
- Followers track the last `seq` they observed. On a gap (e.g., they were sleeping or just joined post-leader-handoff), the `FanOut` emits a synthetic `{ kind: "resync" }` signal to every local subscriber **in addition to** the missed events it can't replay.
- `leader-claim` is diagnostic only — not used for product behavior. Lets devtools show "Tab X owns the socket."

**Per-hook gap recovery:**

- `useRealtimeScores` — on `resync`, calls `router.refresh()`. RSC re-runs and queries the `latest_scores_per_site` view; full state is rebuilt.
- `useRealtimeRuns(siteId, initial)` — on `resync`, re-queries `audit_runs` for `siteId` via the Supabase browser client and replaces local state. The query is small (≤20 rows) and runs at most once per gap.
- `useRealtimeRun(runId)` — same pattern, re-queries the single run + its results.

The gap window is bounded: the leader-handoff is <100ms in practice, and sleeping tabs trigger the visibility-change pipeline on resume.

---

## Lifecycle

**Tab startup (any tab):**
1. `useFanOut(ownerId)` creates or reuses the per-ownerId FanOut.
2. FanOut opens the BroadcastChannel `realtime:${ownerId}`.
3. FanOut fires `navigator.locks.request(...)` in the background. The call doesn't block; this tab is now a waiter.
4. Hook subscribers are attached.

**On lock acquired (this tab becomes leader):**
5. FanOut calls `createBrowserSupabase()` and opens the two channels.
6. Supabase events → `onMessage(envelope)` → posts `{ kind: "event", envelope, seq: next, sentAt: now }` to the BC.
7. Local subscribers also receive the event (the leader is a participant in its own channel).

**Tab close (leader):**
8. Web Locks API auto-releases the lock; one of the waiting tabs gets it next and runs step 5.

**Tab close (follower):**
9. BroadcastChannel closes; the lock waiter is cancelled via AbortSignal.

**User signs out:**
10. The dashboard view unmounts → last `useFanOut(ownerId)` consumer disappears → refcount 0 → FanOut closes (BC closed, lock waiter aborted, Supabase channels removed if held).

---

## Testing strategy

**Pure-function unit tests (TDD):**

`envelope.test.ts` (~3 tests):
- Construct an envelope from a Supabase INSERT payload for `audit_runs`.
- Construct an envelope from a Supabase UPDATE payload for `audit_runs`.
- Construct an envelope from a Supabase INSERT payload for `audit_results`.

`filter.test.ts` (~8 tests):
- `shouldDeliverToScores(e)` returns true for `audit_results` envelopes, false for `audit_runs`.
- `shouldDeliverToRuns(e, siteId)` returns true only when `e.table === "audit_runs"` AND `e.row.site_id === siteId`. INSERT and UPDATE.
- `shouldDeliverToRun(e, runId)` returns true for `audit_runs UPDATE id=runId` OR `audit_results INSERT run_id=runId`.

`fan-out.test.ts` (~5 tests, with injected `locks` + `BroadcastChannel` + Supabase client stubs):
- New FanOut with no other tabs becomes leader, opens Supabase channels.
- New FanOut with leader already elsewhere stays follower, does NOT open Supabase channels.
- Forwarded event reaches the local subscriber with `kind: "event"`.
- `close()` releases the lock + removes Supabase channels + closes BC.
- Receiving a message with `seq` greater than `lastSeq + 1` emits a synthetic `resync` to subscribers.

`use-fan-out.test.ts` (~2 tests):
- Two `useFanOut(ownerId)` consumers in the same tab share one instance (refcount).
- Last consumer unmounting tears the instance down.

Total new tests: **~18**. Slice 5's 68 → slice 6's ~86.

**Manual smoke (appended to `apps/app/README.md` as steps 20-24):**

20. Sign in, open `/dashboard` in tab A and tab B. Open DevTools → Network → WS in both. Expect exactly **one** WebSocket connection (in tab A — the leader).
21. Queue an audit from tab B → both tabs refresh.
22. Close tab A → tab B acquires the leader lock and opens a new WebSocket within ~100ms.
23. Open `/dashboard/runs/<runId>` in a third tab → still one WebSocket total; the run detail updates live.
24. iOS Safari ≥15.4: same flow. The fan-out works via BroadcastChannel + Web Locks (no SharedWorker required).

---

## Migration & backwards-compat

- The hooks `useRealtimeScores`, `useRealtimeRuns`, `useRealtimeRun` keep identical external signatures.
- Slice 5's tests for the dashboard, dashboard actions, and run-detail flow stay green with no changes.
- **No schema changes.** No new migrations.
- **No new dependencies.** Web Locks and BroadcastChannel are standard browser APIs in the supported targets (Chrome ≥69, Firefox ≥96, Safari ≥15.4, iOS Safari ≥15.4).

---

## Risks

- **Web Locks unavailable.** Web Locks is available on iOS 15.4+ (released March 2022) and all modern desktop browsers. If a tab runs in an unsupported context (older iOS, headless test env), `navigator.locks` is `undefined`. The FanOut should detect this and fall back to **per-tab subscription mode** — i.e., today's slice-5 behavior. This is a smooth degradation: the same hook public API, slightly more sockets.
- **BroadcastChannel unavailable.** Same as above — fall back to per-tab subs. BroadcastChannel landed earlier than Web Locks, so any environment with Web Locks also has BC.
- **Leader-handoff gap.** Up to ~100ms with no socket open. The `seq`-gap detection on the next event triggers `router.refresh()` to backfill.
- **One-tab-many-users.** If the user signs out and signs back in as a different user in the same tab, the ownerId changes. The hook re-renders, the new `useFanOut(newOwnerId)` claims a new BC and lock; the old FanOut tears down via refcount. No cross-user leak.

---

## After slice 6

Slice 7 candidates (informed by what was deferred here):

- **Last-known scores cache** — write `latest_scores_per_site` rows into IndexedDB on each successful fetch; SW returns cached HTML + cached scores when offline. Adds a `RealtimeFanOut` listener that updates the IDB cache as new events arrive, so the cache stays current while the dashboard is open.
- **PWA install prompt** — `beforeinstallprompt` capture + a non-intrusive in-app install button (dashboard header dropdown). iOS install via "Add to Home Screen" instructions card.
- **Background sync** — queue audit runs while offline; flush when network returns. Lower priority.
