# @repo/db

Drizzle ORM over Supabase Postgres for the SEO Competitive Intelligence Platform. Schema, RLS policies, and row-mapping helpers for the `AuditResult` contract from `@repo/audit-core`.

## Setup

```bash
# Boot the local Supabase stack (Docker)
bunx supabase start

# Copy env vars (printed by `supabase status -o env`) into local
cp packages/db/.env.example packages/db/.env.local
# Edit packages/db/.env.local and fill SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY

# Apply migrations
bun --filter @repo/db migrate

# Seed demo data
bun --filter @repo/db seed

# Open Studio
open http://127.0.0.1:54323
```

## Scripts

| Script | Purpose |
|---|---|
| `bun --filter @repo/db generate` | Generate a new migration from schema diffs |
| `bun --filter @repo/db migrate`  | Apply pending migrations to `DATABASE_URL` |
| `bun --filter @repo/db push`     | Dev-only schema push without a migration file |
| `bun --filter @repo/db studio`   | Open `drizzle-kit studio` |
| `bun --filter @repo/db seed`     | Seed a demo user + sites + sample run |
| `bun --filter @repo/db test`     | Unit tests (16) |
| `bun --filter @repo/db test:integration` | RLS + trigger + insert-helper tests (14, requires `RUN_INTEGRATION=1`) |

## Public surface

```ts
import {
  createDbClient,
  schema,
  auditResultToInsert,
  insertAuditResult,
  insertAuditRun,
  canonicalUrl,
  type Db,
  type Site,
  type AuditRun,
  type AuditResultRow,
} from "@repo/db"

const db = createDbClient({
  connectionString: process.env.DATABASE_URL!,
  role: "service_role",
})

const runId = await insertAuditRun(db, {
  siteId: site.id,
  requestedUrl: "https://example.com",
})

for (const result of auditResultsFromCli) {
  await insertAuditResult(db, result, runId, ownerId)
}
```

## Tables

| Table | Purpose | Owner |
|---|---|---|
| `profiles` | App-specific user fields (mirrors `auth.users.id`) | self |
| `sites` | URLs a user tracks; one self + many competitors | `profiles.id` |
| `audit_runs` | One row per `audit-cli` invocation | denormalized `owner_id` |
| `audit_results` | 5 rows per run, one per category | denormalized `owner_id` |

`audit_results.owner_id` and `audit_runs.owner_id` are denormalized so every RLS policy is a single-column check (no joins). They're populated by `BEFORE INSERT` triggers from the parent row.

## RLS model

- **Owners (authenticated users):** SELECT / INSERT / UPDATE / DELETE on rows they own across `profiles`, `sites`, `audit_runs`. SELECT-only on `audit_results`.
- **service_role:** bypasses RLS (used by the runner in slice 3 and by these tests).
- **anon:** no access.

## Migrations

- `0000_init.sql` — tables + indexes + score CHECK (drizzle-kit generated)
- `0001_check_and_triggers.sql` — discriminated-union CHECK + 4 triggers (hand-written)
- `0002_policies.sql` — enable RLS + 9 policies (hand-written)

## Design doc

See [`docs/plans/2026-06-04-slice2-data-layer-design.md`](../../docs/plans/2026-06-04-slice2-data-layer-design.md).
