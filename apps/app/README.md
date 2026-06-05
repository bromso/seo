# @repo/app

The multi-site dashboard: comparison view with up to 5 competitors. Next.js 16 App Router. Authenticates via Supabase, lets the user add their site + competitors, trigger audits, and watch results stream in via Realtime.

## Setup

```bash
# Boot Supabase
bunx supabase start

# Apply DB migrations (through 0003 — pgmq, Realtime publication)
bun --filter @repo/db migrate

# Copy env vars
cp apps/app/.env.example apps/app/.env.local
# Fill NEXT_PUBLIC_SUPABASE_ANON_KEY from `bunx supabase status -o env`
```

## Dev loop

In three separate terminals:

```bash
bun --filter @repo/runner dev     # 1. Runner daemon (consumes pgmq jobs)
bun --filter @repo/app dev        # 2. Dashboard (app.localhost:3001)
# 3. Browser → http://app.localhost:3001
```

## Scripts

| Script | Purpose |
|---|---|
| `bun --filter @repo/app dev` | Start Next dev server on `app.localhost:3001` |
| `bun --filter @repo/app build` | Production build (webpack) |
| `bun --filter @repo/app start` | Production server |
| `bun --filter @repo/app test` | Vitest unit + Server-Action tests |
| `bun --filter @repo/app check-types` | TypeScript check |

## Manual smoke checklist

Run before shipping the PR. Takes ~2 minutes.

1. `bunx supabase start` — confirm running
2. `bun --filter @repo/db migrate` — confirm "migrations applied"
3. Start the runner daemon: `bun --filter @repo/runner dev`
4. Start the dashboard: `bun --filter @repo/app dev`
5. Open `http://app.localhost:3001` → redirects to `/sign-in`
6. Sign up with a fresh email + 8+ char password → redirects to `/onboarding`
7. Enter `https://example.com` → redirects to `/dashboard`
8. Click "Run new audit" → toast appears; you're navigated to `/dashboard/runs/<runId>`
9. Watch the 5 category cards populate (typically completes in ~10 seconds with the runner running)
10. Click "Back to dashboard" → the new run appears in the history table
11. Click "Sign out" → redirects to `/sign-in`
12. Try opening `/dashboard` while signed out → redirects back to `/sign-in`
13. Open "Manage competitors" drawer → add a competitor URL
14. Drawer shows it in the list; close drawer
15. Click "Run audits on all sites" → toast: "Queued N audits"
16. Watch the radar populate as runs complete (~10s/run, N runs = ~10N seconds)
17. Switch to "Trends" tab → 5 line charts populate per category
18. Open the drawer, delete a competitor → it disappears from the radar
    and trends within a second (Realtime cascade)
19. Try to add a 6th competitor → form shows "Limit reached (5 of 5)"
20. Sign in. Open `/dashboard` in tab A and tab B. Open DevTools → Network → WS in both.
    Expect exactly ONE WebSocket connection (in tab A — the leader).
21. Queue an audit from tab B → both tabs refresh.
22. Close tab A → tab B acquires the leader lock and opens a new WebSocket within ~100ms.
23. Open `/dashboard/runs/<runId>` in a third tab → still one WebSocket total; the run
    detail updates live.
24. iOS Safari ≥15.4: same flow. The fan-out uses BroadcastChannel + Web Locks (no
    SharedWorker required).

## Architecture

- **Auth:** `@supabase/ssr` middleware refreshes the session cookie on every request and gates protected routes. Sign-in / sign-up forms are custom (react-hook-form + zod) using `@supabase/supabase-js`'s browser client.
- **Reads:** All data reads go through `@supabase/supabase-js` (PostgREST). Drizzle types from `@repo/db` are imported as TS types only; the runtime client is Supabase JS.
- **Mutations:** Next.js Server Actions construct an authenticated server-side Supabase client from cookies and `.insert()` directly. RLS auto-enforces. The `audit_runs` insert fires slice 3's pgmq trigger; the runner picks up the job.
- **Realtime:** Client components use `useRealtimeRuns` (dashboard) and `useRealtimeRun` (per-run page) hooks that subscribe to `postgres_changes` on the relevant tables. RLS gates events server-side.

## Design doc

See [`docs/plans/2026-06-04-slice4-dashboard-design.md`](../../docs/plans/2026-06-04-slice4-dashboard-design.md).
