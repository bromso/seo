# @repo/runner

Audit runner daemon. Polls the Postgres-backed pgmq queue for `audit_runs` messages, executes the slice 1 audit pipeline (via `@repo/audit-cli/lib`), persists results via `@repo/db`, and lets Supabase Realtime fan progress out to subscribed clients (via `postgres_changes` on `audit_runs` + `audit_results`).

## Setup

```bash
# Boot the local Supabase stack (Docker required)
bunx supabase start

# Apply migrations (includes 0003_queue.sql)
bun --filter @repo/db migrate

# Copy env vars
cp apps/runner/.env.example apps/runner/.env.local
# Fill SUPABASE_SERVICE_ROLE_KEY from `bunx supabase status -o env`
```

## Running the daemon (locally)

```bash
bun --filter @repo/runner dev
```

Logs structured JSON to stderr.

## Enqueueing a test job

```bash
# Get an owner uuid (slice 2's seed creates a demo user)
OWNER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -At -c "SELECT id FROM profiles LIMIT 1")

bun --filter @repo/runner enqueue https://example.com --owner-id "$OWNER_ID"
```

Output:

```
runId: <uuid>
```

The DB trigger publishes the runId to pgmq immediately. If the daemon is running, it claims and processes within seconds.

## Docker

```bash
docker build -t seo-runner -f apps/runner/Dockerfile .

docker run --rm \
  -e DATABASE_URL="postgresql://host.docker.internal:54322/postgres?user=postgres&password=postgres" \
  -e SUPABASE_URL="http://host.docker.internal:54321" \
  -e SUPABASE_SERVICE_ROLE_KEY="<key>" \
  seo-runner
```

The image bundles Chromium for Lighthouse and sets `LH_NO_SANDBOX=1`.

## Realtime subscription (dashboard preview)

The runner writes audit_runs and audit_results rows; Supabase Realtime emits `postgres_changes` events for both. A dashboard would subscribe like:

```ts
supabase
  .channel(`audit-run:${runId}`)
  .on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "audit_results",
    filter: `run_id=eq.${runId}`,
  }, (payload) => { /* render score */ })
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "audit_runs",
    filter: `id=eq.${runId}`,
  }, (payload) => { /* status badge */ })
  .subscribe()
```

## Configuration

| Env var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (local Supabase or production) |
| `SUPABASE_URL` | Supabase API URL (used by integration tests for Auth admin API) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT (bypasses RLS) |
| `DEFAULT_OWNER_ID` | Optional default for `runner enqueue --owner-id` |
| `LH_NO_SANDBOX=1` | Set when running Chrome inside Docker |

## Architecture

See [`docs/plans/2026-06-04-slice3-runner-design.md`](../../docs/plans/2026-06-04-slice3-runner-design.md).
