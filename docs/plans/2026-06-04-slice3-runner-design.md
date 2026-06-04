# Slice 3 — Runner App Design

**Status:** approved
**Date:** 2026-06-04
**Predecessors:**
- [`2026-06-04-audit-packages-slice1-design.md`](2026-06-04-audit-packages-slice1-design.md)
- [`2026-06-04-slice2-data-layer-design.md`](2026-06-04-slice2-data-layer-design.md)
**Scope:** Containerized worker that consumes audit jobs from pgmq, invokes the slice 1 audit packages via `@repo/audit-cli`'s aggregator (as a library), persists `AuditResult` rows via `@repo/db`, and exposes progress to clients via Supabase Realtime (`postgres_changes`).

## Goal

Bridge slice 1 (audit packages) and slice 2 (data layer) with a queue-driven worker. After this slice, an `audit-cli`-style job lands in pgmq → the daemon picks it up → 5 `AuditResult` rows land in Postgres → any subscribed client gets Realtime events. No dashboard yet; manual end-to-end testing via a small `runner enqueue` CLI.

A successful slice 3 is:

```bash
bunx supabase start
bun --filter @repo/db migrate                                  # includes new 0003_queue.sql
bun --filter @repo/runner dev                                  # daemon polls pgmq
# Another terminal:
bun --filter @repo/runner enqueue https://example.com --owner-id <uuid>
# Daemon claims the job, runs 5 audits, writes rows, acks pgmq.
# audit_runs.status transitions queued → running → completed/partial in <60s.
```

## Architecture decisions summary

| # | Decision | Choice |
|---|---|---|
| 1 | Runtime shape | `packages/runner-core` (testable `processRun(runId)` function) + `apps/runner` (poll-loop daemon). Same code path for slice 8's K8s Job migration. |
| 2 | Enqueue path | AFTER INSERT trigger on `audit_runs` calls `pgmq.send`. Enqueue surface is just `insertAuditRun()` from `@repo/db` (already shipped in slice 2). |
| 3 | Concurrency | Single-threaded daemon. One job at a time. Multiple workers = multiple daemon instances. |
| 4 | Realtime mechanism | `postgres_changes` only. Enable Realtime replication on `audit_runs` + `audit_results`. No app-level broadcast. |
| 5 | Audit invocation | Add `lib.ts` export to `@repo/audit-cli` exposing `aggregate` + `defaultPackages`. Runner imports them. |
| 6 | Test strategy | Mock the aggregate by default for fast tests; one real-Chrome end-to-end (gated `RUN_E2E=1`). |
| 7 | Retry policy | pgmq message `read_ct ≥ 3` → archive + insert 5 `failed` AuditResult rows with code=`UNKNOWN`, message=`"exceeded retry limit (3)"`. |
| 8 | Visibility timeout | 600s (10 min) — comfortable ceiling for the worst-case 5-audit run. No heartbeats in MVP. |

## Out of scope for slice 3 (explicit)

Web dashboard, auth UI, K8s manifests, scheduled re-audits (cron), exponential backoff *within* a single run, dead-letter queue UI, multi-tenant queue partitioning, per-domain rate limiting (single-threaded daemon makes this moot for slice 3), Sentry/observability hooks (stderr logging only), broadcast-channel events beyond what `postgres_changes` emits, audit-cli refactor beyond adding a library entry point.

## Package layout

Three new units plus one small modification to `@repo/audit-cli` (slice 1).

```
seo/
  supabase/
    config.toml                              # MODIFY: ensure pgmq + Realtime enabled
  packages/
    audit-cli/                               # SLICE 1 — additive modification only
      package.json                           # add `./lib` export entry
      src/
        index.ts                             # UNCHANGED — still the CLI bin entry
        lib.ts                               # NEW: export { aggregate, defaultPackages }
    db/                                      # SLICE 2 — additive modification
      src/
        queries.ts                           # NEW: getAuditRun, markAuditRunRunning,
                                             #     getCompletedCategoriesForRun
      migrations/
        0003_queue.sql                       # NEW: pgmq extension, queue, trigger, Realtime
    runner-core/                             # NEW
      package.json
      tsconfig.json
      tsdown.config.ts
      vitest.config.ts
      vitest.integration.config.ts
      src/
        index.ts
        process-run.ts
        queue.ts
        backoff.ts
        logger.ts
        errors.ts
      test/
        process-run.test.ts
        queue.test.ts
        backoff.test.ts
      integration/
        helpers.ts                           # reuse @repo/db's pattern
        process-run.integration.test.ts      # real pgmq, real DB, mocked aggregate
        daemon.integration.test.ts           # daemon poll loop, mocked aggregate
        end-to-end.integration.test.ts       # real Chrome (gated RUN_E2E=1)
  apps/
    runner/                                  # NEW
      package.json
      tsconfig.json
      tsdown.config.ts
      Dockerfile
      .env.example
      README.md
      src/
        index.ts                             # bin entry, dispatches to subcommands
        cli.ts                               # commander wiring
        daemon.ts                            # poll loop + signal handling
        enqueue.ts                           # `runner enqueue <url>`
```

### Dependency direction (one-way)

```
@repo/audit-core   ←  @repo/audit-cli (lib.ts)
@repo/audit-cli, @repo/db   ←  @repo/runner-core
@repo/runner-core   ←  apps/runner
```

`@repo/runner-core` is the orchestration kingdom — pure-ish, fully testable. The daemon (signal handling + poll loop) lives in `apps/runner` because it's the deployment shape, not the logic.

### Scripts on `apps/runner`

| Script | Purpose |
|---|---|
| `bun --filter @repo/runner dev` | Start the poll-loop daemon in watch mode (tsx) |
| `bun --filter @repo/runner start` | Start the daemon (production) |
| `bun --filter @repo/runner enqueue <url> --owner-id <uuid>` | Manual job enqueue (slice 3 testing only) |
| `bun --filter @repo/runner build` | Produce dist/ via tsdown |
| `bun --filter @repo/runner docker:build` | `docker build .` |

## pgmq + Realtime setup

### `supabase/config.toml` changes

Confirm these are enabled (Supabase CLI defaults usually have Realtime on; pgmq extension is opt-in via SQL):

```toml
[realtime]
enabled = true
```

The pgmq extension is enabled in the migration rather than the config (Supabase ships the extension binaries; you just `CREATE EXTENSION`).

### New migration: `packages/db/migrations/0003_queue.sql`

```sql
-- Enable pgmq extension
CREATE EXTENSION IF NOT EXISTS pgmq;
--> statement-breakpoint

-- Create the audit_runs queue
SELECT pgmq.create('audit_runs');
--> statement-breakpoint

-- Trigger: publish to pgmq whenever a new audit_run row is inserted with status='queued'
CREATE OR REPLACE FUNCTION public.enqueue_audit_run() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgmq AS $$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM pgmq.send(
      'audit_runs',
      json_build_object(
        'runId', NEW.id,
        'siteId', NEW.site_id,
        'ownerId', NEW.owner_id,
        'requestedUrl', NEW.requested_url
      )::jsonb
    );
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_runs_enqueue ON public.audit_runs;
--> statement-breakpoint
CREATE TRIGGER audit_runs_enqueue
  AFTER INSERT ON public.audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_audit_run();
--> statement-breakpoint

-- Add Realtime publication for audit_runs + audit_results
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_runs;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_results;
```

**Notes:**
- The trigger fires only when `status='queued'` (the default at INSERT time). Rollup-driven UPDATEs don't fire it. Reprocessing the same row never re-enqueues.
- `SECURITY DEFINER SET search_path = public, pgmq` lets the trigger run with the table owner's privileges so it can write to `pgmq.q_audit_runs` even when called from an `authenticated`-role INSERT (the dashboard's path in slice 4).
- Realtime's `postgres_changes` events are gated by RLS — clients only see events for rows they can SELECT. The runner uses service-role for writes (RLS bypassed); the dashboard subscribes as the authenticated user.

### Additions to `@repo/db`

Three thin Drizzle helpers in `packages/db/src/queries.ts`:

```ts
export async function getAuditRun(db: Db, runId: string): Promise<AuditRun | undefined>

export async function markAuditRunRunning(db: Db, runId: string): Promise<boolean>
// Returns true if the row was updated (status was queued or already running);
// false if the row doesn't exist or is already in a terminal state.

export async function getCompletedCategoriesForRun(
  db: Db,
  runId: string,
): Promise<Set<Category>>
// Returns the set of categories that already have a row in audit_results for this run.
```

Each is ~4 lines of Drizzle. They land in `src/queries.ts` so `map.ts` stays focused on inserts.

## `@repo/runner-core`

### `queue.ts` — pgmq client wrapper

```ts
export type QueuedMessage = {
  msgId: number
  readCt: number
  enqueuedAt: Date
  body: {
    runId: string
    siteId: string
    ownerId: string
    requestedUrl: string
  }
}

export type QueueClient = {
  read: (visibilityTimeoutSec: number) => Promise<QueuedMessage | undefined>
  ack: (msgId: number) => Promise<void>
  setVisibility: (msgId: number, additionalSec: number) => Promise<void>
  archive: (msgId: number) => Promise<void>
}

export function createQueueClient(db: Db, queueName?: string): QueueClient
```

Implementation calls `pgmq.read('audit_runs', vt, qty=1)`, `pgmq.delete`, `pgmq.set_vt`, `pgmq.archive` via Drizzle's `sql` template. The wrapper validates message body shape (Zod) and normalizes Postgres timestamp → JS `Date`.

### `process-run.ts` — the testable function

```ts
export type ProcessRunOptions = {
  db: Db
  aggregate: AggregateFn                    // injected (defaults to @repo/audit-cli's)
  packages: AuditPackages                   // injected (defaults to defaultPackages)
  logger: (event: LogEvent) => void
  timeoutMs?: number                        // total wall-clock cap; default 600_000
  signal?: AbortSignal
}

export async function processRun(
  runId: string,
  opts: ProcessRunOptions,
): Promise<ProcessRunResult>

export type ProcessRunResult =
  | { status: "completed"; resultsInserted: number }
  | { status: "partial"; resultsInserted: number; partialCategories: Category[] }
  | { status: "failed"; reason: FailureReason; error?: AuditError }
  | { status: "skipped"; reason: SkipReason }

type FailureReason = "fetch_failed" | "aggregate_failed" | "db_failed" | "timeout"
type SkipReason = "run_not_found" | "already_completed"
```

### Pipeline

```
1. Load run + site from DB (getAuditRun).
   - If not found → return { status: "skipped", reason: "run_not_found" }.
   - If run.status ∈ {completed, partial, failed} → skip.
   - If run.status === "running" → proceed (idempotent — UPSERT semantics in step 5).

2. Mark run as "running" (markAuditRunRunning). UPDATE only if status was queued or running.

3. Idempotency check: getCompletedCategoriesForRun.
   - If size === 5 → call rollup, return whichever status the rollup yields.
   - Else compute missingCategories = ALL_CATEGORIES \ completedCategories.

4. Run aggregator with `--only` filter:

   const results = await aggregate(run.requested_url, {
     only: missingCategories,
     timeoutMs: opts.timeoutMs,
     signal: opts.signal,
   }, opts.packages)

   This typically takes 8–10s for 4 LH categories + on-page.

5. Persist results.
   - One INSERT ... ON CONFLICT (run_id, category) DO UPDATE per AuditResult.
   - All inside a single transaction.
   - The rollup_run_status trigger fires per INSERT → audit_runs.status flips incrementally.
   - Realtime fires postgres_changes events automatically.

6. Return status (read latest audit_runs.status post-rollup).
```

### Error handling matrix

| Failure | Action | Final run.status |
|---|---|---|
| DB connection lost step 1–2 | Throw `RunnerError("db_unreachable")` → daemon does not ack → pgmq returns msg after visibility timeout | unchanged (still queued) |
| `aggregate()` throws (programmer error in audit packages — shouldn't happen given slice 1's contract) | Catch; insert 5 `failed` AuditResult rows (code=`UNKNOWN`); rollup → `failed` | failed |
| `aggregate()` returns 5 results, 1 failed | Insert all 5; rollup → `failed` | failed |
| `aggregate()` returns 5 results, all success | Insert all 5; rollup → `completed` | completed |
| `aggregate()` returns AuditResult[] with `status: "partial"` for some | Insert all; rollup → `partial` | partial |
| Wall-clock timeout exceeded | AbortSignal fires; insert `failed` rows for incomplete categories; rollup → `failed` | failed |
| Process killed mid-run | pgmq visibility timeout (600s) expires; message returns; next worker reads idempotently | unchanged until next attempt |

### Retry policy

- pgmq's `read_ct` increments per `read`.
- When `readCt > 3` at the start of a job: call `pgmq.archive(msgId)` AND insert 5 `failed` AuditResult rows with code=`UNKNOWN`, message=`"exceeded retry limit (3)"`. Rollup → `failed`.
- The archive table preserves the message for forensics.

### Abort signal plumbing

- Daemon creates one `AbortController` per job.
- On SIGTERM / SIGINT, daemon sets `shutdownRequested = true` AND `abort()`s the in-flight job's signal.
- `processRun` honors the signal: the `aggregate()` call inherits it (slice 1's contract supports `opts.signal`); on abort, the function inserts `failed` rows for incomplete categories before throwing.
- Daemon waits up to `shutdownGraceMs` (default 30s) for the in-flight job to finish, then exits 0.

### Visibility timeout

- Default 600s (10 min) when reading from pgmq.
- Worst-case run: 5 audits × ~60s + buffer ≈ 5 min. 10 min ceiling is safe.
- No heartbeats in MVP. If a future audit (e.g., a deep crawl in slice 7) needs more time, the runner can call `queue.setVisibility(msgId, additionalSec)` between phases.

## `apps/runner`

### `daemon.ts` — the poll loop

```ts
export type DaemonOptions = {
  db: Db
  queue: QueueClient
  pollIntervalMs?: number        // default 1000 — when queue is empty
  visibilityTimeoutSec?: number  // default 600
  shutdownGraceMs?: number       // default 30_000
  logger: (event: LogEvent) => void
}

export async function runDaemon(opts: DaemonOptions): Promise<void>
```

Pseudocode:

```
let shutdownRequested = false
let currentAbort: AbortController | undefined

process.on("SIGTERM", () => {
  shutdownRequested = true
  currentAbort?.abort()
})
process.on("SIGINT", () => {
  shutdownRequested = true
  currentAbort?.abort()
})

while (!shutdownRequested) {
  const msg = await queue.read(visibilityTimeoutSec)
  if (!msg) {
    await sleep(pollIntervalMs)
    continue
  }
  if (msg.readCt > 3) {
    await archiveAndMarkDead(db, msg)
    await queue.archive(msg.msgId)
    continue
  }
  currentAbort = new AbortController()
  try {
    const result = await processRun(msg.body.runId, {
      db, aggregate, packages: defaultPackages, logger,
      signal: currentAbort.signal,
    })
    logger({ kind: "progress", message: `run ${msg.body.runId} -> ${result.status}` })
    await queue.ack(msg.msgId)
  } catch (err) {
    logger({ kind: "warn", message: `processRun threw, will retry: ${err}` })
    // No ack — message returns after visibility timeout
  } finally {
    currentAbort = undefined
  }
}

logger({ kind: "progress", message: "daemon exiting" })
```

### `cli.ts` — `commander` wiring

Two subcommands:

```
runner start                            # daemon mode (default)
runner enqueue <url>                    # test helper
  --site-id <uuid>                      # optional, defaults to first self-site for owner
  --owner-id <uuid>                     # required (or DEFAULT_OWNER_ID env)
  --label <string>                      # optional
```

`enqueue` exists for slice 3 manual testing. Once the dashboard exists in slice 4, this subcommand is redundant (and may be deleted then).

### `Dockerfile`

```dockerfile
FROM oven/bun:1.3.4 AS builder
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/runner apps/runner
COPY packages packages
RUN bun install --frozen-lockfile
RUN bun --filter @repo/audit-core build
RUN bun --filter @repo/lighthouse-runner build
RUN bun --filter @repo/audit-perf build
RUN bun --filter @repo/audit-seo build
RUN bun --filter @repo/audit-best-practices build
RUN bun --filter @repo/audit-pwa build
RUN bun --filter @repo/audit-onpage build
RUN bun --filter @repo/audit-cli build
RUN bun --filter @repo/db build
RUN bun --filter @repo/runner-core build
RUN bun --filter @repo/runner build

FROM oven/bun:1.3.4-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*
ENV LH_NO_SANDBOX=1
ENV CHROME_PATH=/usr/bin/chromium
COPY --from=builder /app/apps/runner/dist /app/apps/runner/dist
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/node_modules /app/node_modules
CMD ["node", "/app/apps/runner/dist/index.js", "start"]
```

`LH_NO_SANDBOX=1` because Docker containers typically lack the namespaces Chrome's sandbox expects. Slice 1's `lighthouse-runner` already honors this env.

## Testing strategy

| Layer | Tool | Approach |
|---|---|---|
| Unit — `queue.ts` | `vitest` | Mock the Drizzle/SQL boundary; assert pgmq.read / delete / archive / set_vt SQL is shaped correctly; assert `QueuedMessage` round-trip. |
| Unit — `process-run.ts` | `vitest` | Mock `db`, `aggregate`, `packages`. ~6 cases: happy path, retry-limit exceeded, run not found, all-failed aggregate, partial aggregate, abort mid-run. |
| Unit — `backoff.ts` / `errors.ts` | `vitest` | Pure helpers. |
| Integration — `processRun` | `vitest` (gated `RUN_INTEGRATION=1`) | Real Supabase + pgmq + DB; insert audit_run; observe pgmq message; call `processRun` with **mocked** aggregate; assert DB state. |
| Integration — daemon | `vitest` (gated) | Start daemon in-process (100ms poll); insert audit_run; assert processed within 5s; SIGTERM and assert graceful shutdown within `shutdownGraceMs`. |
| End-to-end — real Chrome | `vitest` (gated `RUN_INTEGRATION=1 AND RUN_E2E=1`) | One test: enqueue for `https://example.com`; daemon with real `defaultPackages`; assert 5 AuditResult rows land with valid scores. ~30s. |

The integration suite uses the same shared `integration/helpers.ts` pattern from slice 2 (env loading, test user creation, schema isolation, `truncateUserData`).

## Catalog additions (root `package.json`)

Production: none new (the runner uses `@repo/db`, `@repo/audit-cli`, plus drizzle-orm + postgres which are already in the catalog).

Dev: none new.

## Definition of done

- `@repo/runner-core` builds + typechecks; unit tests green (~12 tests).
- `apps/runner` builds + typechecks; `bun --filter @repo/runner dev` starts and polls.
- Migration `0003_queue.sql` applies cleanly; `pgmq` extension enabled; queue `audit_runs` exists; enqueue trigger fires on INSERT.
- `@repo/db` exposes `getAuditRun`, `markAuditRunRunning`, `getCompletedCategoriesForRun`.
- `@repo/audit-cli` exposes `aggregate` + `defaultPackages` as a library import.
- Integration tests pass under `RUN_INTEGRATION=1` (~5 tests).
- End-to-end test passes under `RUN_INTEGRATION=1 RUN_E2E=1` (1 test, real Chrome).
- Manual smoke: `runner enqueue https://example.com` → daemon processes within 60s → 5 `audit_results` rows; `audit_runs.status` is `completed` or `partial`.
- `Dockerfile` builds successfully; the image starts and the daemon polls when given valid env.
- README documents the dev loop, the `enqueue` CLI, the Dockerfile, and a snippet of the slice 4 dashboard subscription pattern (`postgres_changes` on `audit-run:{runId}` channel).

## After slice 3

Slice 4 (dashboard MVP) is the first user-facing surface. It subscribes to `postgres_changes` on `audit_runs` and `audit_results` for the user's runs, renders the radar chart and per-category drill-down, and calls `insertAuditRun()` to enqueue new runs — exercising the slice 3 trigger automatically. The `@repo/runner-core` `processRun` function is the contract slice 4 relies on (indirectly via the queue): correctness, idempotency, and rollup behavior are already proven.
