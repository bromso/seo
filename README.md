# SEO Audit Monorepo

Multi-site SEO audit monorepo with offline-first PWA dashboard, daemon-based runner, web push notifications, and Supabase backend.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.4+-f9f1e1?logo=bun)](https://bun.sh/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.5-ef4444?logo=turborepo)](https://turbo.build/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06b6d4?logo=tailwindcss)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%2BAuth-3ECF8E?logo=supabase)](https://supabase.com/)

## Features

- **Multi-site dashboard** with offline-first IndexedDB cache (Serwist PWA).
- **Audit runner daemon** that processes queued runs against Lighthouse + on-page analyzers.
- **Web push notifications** on run completion.
- **Realtime fan-out** for live audit progress (Supabase Realtime + BroadcastChannel).
- **Idempotent audit triggers** with per-tab queue replay and Background Sync.

## Quick Start

```bash
# 1. Clone + install
git clone https://github.com/bromso/kitchensink-react.git seo
cd seo
bun install

# 2. Boot local Supabase (Docker required)
bunx supabase start

# 3. Copy + fill env files
cp apps/app/.env.example apps/app/.env.local
cp apps/runner/.env.example apps/runner/.env.local
cp packages/db/.env.example packages/db/.env.local
# Fill the empty *_KEY values from: bunx supabase status -o env

# 4. Apply DB migrations + seed demo data
bun --filter @repo/db migrate
bun --filter @repo/db seed

# 5. (Optional, for push) Generate VAPID keys and paste into apps/runner/.env.local
npx web-push generate-vapid-keys

# 6. Start web apps + Storybook
bun dev

# 7. Start the runner daemon (in a separate terminal)
bun --filter @repo/runner dev
```

This starts:
- **Dashboard** — http://app.localhost:3001
- **Marketing** — http://www.localhost:3000
- **Storybook** — http://localhost:6006
- **Runner** — headless daemon polling the audit queue

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 16 (App Router + Server Components) |
| **Runtime** | Bun |
| **Monorepo** | Turborepo |
| **UI Components** | shadcn/ui + Radix UI |
| **Styling** | Tailwind CSS v4 |
| **Backend** | Supabase (Postgres + Auth + Realtime + pgmq) |
| **Database ORM** | Drizzle |
| **PWA / Service Worker** | Serwist 9 |
| **Push Notifications** | web-push (VAPID) |
| **Testing** | Vitest + Testing Library + happy-dom |
| **Linting** | Biome |
| **Animation** | Motion (formerly Framer Motion) |

## Project Structure

```
seo/
├── apps/
│   ├── app/      # Main dashboard (Next.js 16, PWA, port 3001)
│   ├── www/      # Marketing site (Next.js 16, port 3000)
│   ├── runner/   # Audit runner daemon (Node + Drizzle + web-push)
│   └── story/    # Storybook for packages/ui (port 6006)
├── packages/
│   ├── ui/                   # Shared shadcn/ui components
│   ├── db/                   # Drizzle schema + migrations + seed
│   ├── audit-core/           # Audit type definitions
│   ├── audit-cli/            # Audit category packages aggregator
│   ├── audit-perf/           # Lighthouse Performance runner
│   ├── audit-seo/            # SEO checks
│   ├── audit-best-practices/ # Best practices checks
│   ├── audit-pwa/            # PWA checks
│   ├── audit-onpage/         # On-page SEO checks
│   ├── lighthouse-runner/    # Headless Lighthouse driver
│   ├── runner-core/          # Daemon polling + processRun loop
│   ├── tokens/               # Design tokens
│   └── typescript-config/    # Shared TS configuration
├── docker/                   # Production Dockerfiles
├── k8s/                      # Helm charts + scripts
└── docs/plans/               # Per-slice design docs + plans
```

## Environment Variables

Three env files drive local development. Empty `*_KEY` values come from `bunx supabase status -o env`.

**`apps/app/.env.local`** — Next.js dashboard (browser + server)

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://app.localhost:3001
```

**`apps/runner/.env.local`** — daemon (server-side service role)

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEFAULT_OWNER_ID=
LH_NO_SANDBOX=

# Optional: VAPID keys for web push delivery
# Generate with: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=mailto:you@example.com
```

**`packages/db/.env.local`** — Drizzle migrations + seed scripts

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

If VAPID vars are missing, the daemon still processes audits — it just logs a single warning and skips push delivery.

## Development

```bash
# Run a specific app
bun --filter @repo/app dev      # Dashboard only (app.localhost:3001)
bun --filter @repo/www dev      # Marketing only (www.localhost:3000)
bun --filter @repo/runner dev   # Daemon only
bun --filter @repo/story dev    # Storybook only (localhost:6006)

# Run tests
bun --filter @repo/app test          # Dashboard unit + Server-Action tests
bun --filter @repo/runner test       # Runner unit tests
bun --filter @repo/db test           # DB schema unit tests
RUN_INTEGRATION=1 bun --filter @repo/db test:integration   # RLS + trigger tests

# Build all apps
bun run build

# Lint, format, type-check
bun run lint
bun run format
bun run typecheck
```

## Running the Daemon

The runner polls the Postgres-backed `pgmq` queue (populated by `audit_runs` insert triggers), executes the audit pipeline via `@repo/audit-cli/lib`, persists results via `@repo/db`, and lets Supabase Realtime stream progress to subscribed clients.

After a successful run it sends a web push notification to every subscribed device for the owner (if VAPID is configured).

### Enqueueing a test job

```bash
# Get an owner uuid (seed creates a demo user)
OWNER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -At \
  -c "SELECT id FROM profiles LIMIT 1")

bun --filter @repo/runner enqueue https://example.com --owner-id "$OWNER_ID"
```

## Docker + Kubernetes

- **Local Docker dev**: `docker compose -f docker-compose.dev.yml up` — runs all apps in a single container with hot reload.
- **Production Docker build**: `docker compose build` — uses `docker/*.Dockerfile` and `apps/runner/Dockerfile`.
- **Local k8s with k3d**: see [`k8s/README.md`](./k8s/README.md).
- **Devcontainer**: open the repo in VS Code → "Reopen in Container" — installs Bun, kubectl, helm, k3d.

## Committing Changes

This project enforces commit conventions using Git hooks (Husky + lint-staged + commitlint).

```bash
# Standard commit (auto-validated)
git commit -m "feat(app): add new feature"
```

See [CLAUDE.md](./CLAUDE.md) and [CONTRIBUTING.md](./CONTRIBUTING.md) for commit message format and project guidelines.

## Slice Documentation

Every feature ships via a slice with a design doc and an implementation plan. Browse `docs/plans/` for the full history (slice 1 through current).
