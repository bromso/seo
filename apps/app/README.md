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
25. Sign in, open /dashboard online → data renders normally. DevTools → Application →
    IndexedDB → seo-app-cache → dashboard_snapshots shows one entry keyed by your
    owner_id (updatedAt = now).
26. Queue an audit. When it completes (Realtime fires), the IDB entry's updatedAt
    advances and the snapshot's latestScores / trends include the new result. Refresh
    DevTools view to see the update.
27. DevTools → Network → "Offline" mode. Refresh /dashboard. Page renders from the
    SW HTML cache; the useDashboardCache hook hydrates from IDB. Sticky amber banner
    appears: "You are offline. Showing the last data we cached on this device."
28. Visit `/dashboard/runs/<runId>` (a runId you previously loaded) while offline. Page renders
    from the SW HTML cache. Banner appears. No IDB write for runs (run-detail
    intentionally doesn't IDB-cache).
29. Sign out → sign in as a DIFFERENT user → the previous user's snapshot is NOT
    visible (own ownerId means own IDB key; previous entry was also cleared by
    SignOutButton).
30. Sign in, online. Click "Run audit" on any site card. Toast: "Audit queued —
    XXXXXXXX". Navigate happens as before. (No regression vs slice 5.)
31. Sign in, then DevTools → Network → Offline. Click "Run audit" → toast:
    "You are offline. Audit will run when you're back online." No navigation.
    DevTools → Application → IndexedDB → seo-app-cache → audit_run_queue
    shows one entry keyed by a UUID.
32. Uncheck Offline. Within ~1 second a toast appears: "Queued audit started —
    XXXXXXXX". The audit_run_queue entry disappears. Dashboard refreshes via
    FanOut as the run progresses.
33. Offline, click "Run audits on all sites (N)" → N entries land in
    audit_run_queue. Go online → N success toasts pop in sequence; queue empties.
34. Sign out → audit_run_queue is empty for your owner_id (DevTools).
35. Chrome desktop, /dashboard online → after Chrome's install-eligibility check
    (~30s of engagement) the browser fires beforeinstallprompt. The "Install"
    button appears in the AppShell header. Click → native install prompt fires
    → click "Install" → app installs and adds to OS launcher. Refresh; button
    is gone (isStandalone() returns true).
36. Chrome desktop, repeat. Click Install → native prompt → click "Cancel".
    Button stays visible (we do not auto-dismiss on OS cancel — user may want
    to retry). Refresh — button still there.
37. iOS Safari, /dashboard → "Install" button always visible (no native prompt).
    Click → modal shows the 3-step Add to Home Screen instructions. Click
    "Don't show again" → modal closes; button hides for 30 days (localStorage
    key pwa-install-dismissed-at = now).
38. Firefox desktop, /dashboard → no "Install" button (no native API, not iOS
    Safari). AppShell header looks unchanged.
39. Online: click "Run audit". DevTools → Network → /api/audit-run → request
    headers include "idempotency-key: <uuid>". Verify on the DB side:
        PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
          -c "SELECT id, idempotency_key FROM audit_runs ORDER BY started_at DESC LIMIT 1;"
    → the newest row has a non-NULL idempotency_key. New audit proceeds normally.
40. Two-tab queue race smoke: open /dashboard in tabs A + B, signed in as the
    same user. DevTools → Network → "Offline" in both. Click "Run audit" in A
    → toast: "You are offline. Audit will run when you're back online."
    DevTools → Application → IndexedDB → seo-app-cache → audit_run_queue in A
    shows entry with id = X. Copy that entry into B's IDB manually (same store,
    same key). Uncheck Offline in both tabs simultaneously. Within ~1s both
    tabs show "Started 1 queued audit". DB:
        SELECT COUNT(*) FROM audit_runs WHERE idempotency_key = 'X';
    → exactly 1.
41. Malformed header: from /dashboard devtools console:
        fetch("/api/audit-run", { method: "POST",
          headers: { "content-type": "application/json",
                     "idempotency-key": "not-a-uuid" },
          body: JSON.stringify({ siteId: "00000000-0000-0000-0000-000000000000",
                                  requestedUrl: "https://example.com" }) })
          .then(r => r.json()).then(console.log)
    → { ok: false, error: "invalid idempotency key" } and r.status === 400.

## Architecture

- **Auth:** `@supabase/ssr` middleware refreshes the session cookie on every request and gates protected routes. Sign-in / sign-up forms are custom (react-hook-form + zod) using `@supabase/supabase-js`'s browser client.
- **Reads:** All data reads go through `@supabase/supabase-js` (PostgREST). Drizzle types from `@repo/db` are imported as TS types only; the runtime client is Supabase JS.
- **Mutations:** Next.js Server Actions construct an authenticated server-side Supabase client from cookies and `.insert()` directly. RLS auto-enforces. The `audit_runs` insert fires slice 3's pgmq trigger; the runner picks up the job.
- **Realtime:** Client components use `useRealtimeRuns` (dashboard) and `useRealtimeRun` (per-run page) hooks that subscribe to `postgres_changes` on the relevant tables. RLS gates events server-side.

## Design doc

See [`docs/plans/2026-06-04-slice4-dashboard-design.md`](../../docs/plans/2026-06-04-slice4-dashboard-design.md).
