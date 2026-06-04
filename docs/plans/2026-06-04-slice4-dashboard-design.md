# Slice 4 — Dashboard MVP Design

**Status:** approved
**Date:** 2026-06-04
**Predecessors:**
- [`2026-06-04-audit-packages-slice1-design.md`](2026-06-04-audit-packages-slice1-design.md)
- [`2026-06-04-slice2-data-layer-design.md`](2026-06-04-slice2-data-layer-design.md)
- [`2026-06-04-slice3-runner-design.md`](2026-06-04-slice3-runner-design.md)
**Scope:** First user-facing surface. Single-site authenticated dashboard with Supabase Auth, audit history list, per-run drill-down with live Realtime updates from slice 3's runner.

## Goal

After this slice, a user can sign up on `app.localhost:3001`, onboard their site, click "Run audit", and watch the 5 category scores populate progressively as the slice 3 runner processes the job in the background. The dashboard exercises slice 2's RLS (everything goes through `@supabase/supabase-js`'s authenticated path) and slice 3's Realtime publication (`postgres_changes` on `audit_runs` + `audit_results`).

A successful slice 4 is the manual smoke loop:

```
bunx supabase start
bun --filter @repo/db migrate
bun --filter @repo/runner dev    # in another terminal
bun --filter @repo/app dev       # in a third terminal
# Open http://app.localhost:3001
# Sign up → onboarding → trigger audit → watch results stream in
```

## Architecture decisions summary

| # | Decision | Choice |
|---|---|---|
| 1 | Auth library | `@supabase/ssr` + custom forms built with existing react-hook-form + zod (`@hookform/resolvers` already in catalog). No `@supabase/auth-ui-react` (deprecated). |
| 2 | Page structure | 7 routes (full structure): /, /sign-in, /sign-up, /auth/callback (stub), /onboarding, /dashboard, /dashboard/runs/[runId], /sign-out. |
| 3 | Mutation pattern | Next.js Server Actions. Each action constructs an authenticated server-side Supabase client from cookies. |
| 4 | DB client | `@supabase/supabase-js` only. All reads + mutations go through PostgREST; RLS auto-enforces. Drizzle stays runner-only. Reuse `@repo/db`'s row types via `.returns<T>()` casts. |
| 5 | Realtime mechanism | `postgres_changes` (already enabled by slice 3's migration). Per-page subscriptions in client components via `useEffect`. No SharedWorker (slice 6). |
| 6 | Testing scope | Vitest unit tests for pure helpers + Server Actions with mocked Supabase clients. No component tests (deferred). No Playwright (deferred). Manual smoke checklist in README. |

## Out of scope for slice 4 (explicit)

Multi-site / competitor comparison (slice 5), radar chart (slice 5), trend lines across runs (slice 5), PWA install / Service Worker / SharedWorker (slice 6), OAuth login (only stub callback route), email confirmation flow (works locally with confirmations disabled), password reset / magic links, profile editing UI, billing, theme customization beyond the existing ThemeProvider, component tests, Playwright/E2E, marketing site changes.

## Package layout

Building on the existing `apps/app` (Next.js 16 App Router shell with Shadcn/UI, motion, recharts, RHF, zod, web-vitals). Adding Supabase auth + 5 feature routes + 2 lib modules + 2 Realtime hooks.

```
apps/app/
  .env.example                           # MODIFY: add NEXT_PUBLIC_SUPABASE_*
  README.md                              # NEW: dev loop + smoke checklist
  vitest.config.ts                       # NEW: Node-env unit tests
  src/
    middleware.ts                        # NEW: @supabase/ssr session refresh + protected-route gate
    lib/
      supabase-server.ts                 # NEW: createServerSupabase() — cookie-based
      supabase-browser.ts                # NEW: createBrowserSupabase() — singleton
      schemas.ts                         # NEW: SignInSchema, SignUpSchema, AddSiteSchema, RunAuditSchema
      format.ts                          # NEW: formatScore, formatRelativeTime, statusBadge helpers
    app/
      page.tsx                           # MODIFY: redirect by auth state
      (auth)/                            # NEW: route group, no chrome
        sign-in/page.tsx
        sign-up/page.tsx
        auth/callback/route.ts           # stub: returns "not implemented" 501
      (app)/                             # NEW: authenticated route group
        layout.tsx                       # AppShell with sidebar + user menu
        onboarding/
          page.tsx
          actions.ts                     # addSiteAction
        dashboard/
          page.tsx
          actions.ts                     # runAuditAction
          runs/
            [runId]/page.tsx
        sign-out/route.ts                # POST: signOut + redirect
    views/
      sign-in-view.tsx
      sign-up-view.tsx
      onboarding-view.tsx
      dashboard-view.tsx
      run-detail-view.tsx
    components/
      app-shell.tsx                      # layout chrome for (app) group
      auth-card.tsx                      # Shadcn Card wrapper for auth pages
      site-summary-card.tsx
      run-status-badge.tsx               # queued/running/completed/partial/failed pill
      run-list-table.tsx
      category-score-card.tsx
      issue-list.tsx
      run-audit-button.tsx
      sign-out-button.tsx
    hooks/
      use-realtime-runs.ts               # subscribes to audit_runs for current site
      use-realtime-run.ts                # subscribes to audit_results for one runId
    test/
      schemas.test.ts
      format.test.ts
      actions/
        run-audit-action.test.ts
        add-site-action.test.ts
```

### Dependency direction (one-way)

```
components/*  ←  views/*  ←  app/**/page.tsx
hooks/*       ←  views/*
lib/*         ←  everything
@repo/db (types only)  ←  app/**, lib/, views/
@supabase/supabase-js  ←  lib/, hooks/, actions/
```

`@repo/db` is imported for TS types only (`Site`, `AuditRun`, `AuditResultRow`, plus the pure `canonicalUrl` helper) — Drizzle's runtime never runs in the dashboard.

### Scripts

- `bun --filter @repo/app dev` — `next dev --port 3001 --hostname app.localhost`
- `bun --filter @repo/app build` — `next build --webpack`
- `bun --filter @repo/app start` — production server
- `bun --filter @repo/app test` — vitest run (new — to be added in T2)

### Catalog additions (root `package.json`)

- `@supabase/ssr` (NEW; complements existing `@supabase/supabase-js`)

## Auth flow and clients

### `lib/supabase-server.ts`

```ts
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // RSC contexts can't set cookies; middleware handles refresh.
          }
        },
      },
    },
  )
}
```

### `lib/supabase-browser.ts`

```ts
import { createBrowserClient } from "@supabase/ssr"

let cached: ReturnType<typeof createBrowserClient> | undefined

export function createBrowserSupabase() {
  if (!cached) {
    cached = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return cached
}
```

Two env vars (both `NEXT_PUBLIC_*` because the browser client needs them):
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase REST + Auth URL (local: `http://127.0.0.1:54321`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon JWT (safe to expose; RLS enforces authorization)

**Slice 3's runner gets `SUPABASE_SERVICE_ROLE_KEY` server-side only. The dashboard NEVER touches the service-role key.**

### `middleware.ts`

```ts
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies) => {
          for (const c of cookies) response.cookies.set(c.name, c.value, c.options)
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  const isAuthRoute = path === "/sign-in" || path === "/sign-up" || path.startsWith("/auth/")
  const isPublicRoute = path === "/" || path.startsWith("/_next/") || path.startsWith("/favicon")

  if (!user && !isAuthRoute && !isPublicRoute) {
    return NextResponse.redirect(new URL("/sign-in", req.url))
  }
  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|manifest|sw\\.js).*)"],
}
```

### `app/page.tsx`

```tsx
import { createServerSupabase } from "@/lib/supabase-server"
import { redirect } from "next/navigation"

export default async function RootPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  redirect(user ? "/dashboard" : "/sign-in")
}
```

### Sign-in / sign-up forms

`lib/schemas.ts`:

```ts
import { z } from "zod"

export const SignInSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

export const SignUpSchema = SignInSchema.extend({
  displayName: z.string().min(1).max(80).optional(),
})

export const AddSiteSchema = z.object({
  url: z.url(),
  label: z.string().max(80).optional(),
})

export const RunAuditSchema = z.object({
  siteId: z.uuid(),
  requestedUrl: z.url(),
})
```

`views/sign-in-view.tsx` (client form):

```tsx
"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createBrowserSupabase } from "@/lib/supabase-browser"
import { SignInSchema } from "@/lib/schemas"

export function SignInView() {
  const form = useForm({ resolver: zodResolver(SignInSchema) })
  const router = useRouter()

  const onSubmit = form.handleSubmit(async (data) => {
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithPassword(data)
    if (error) {
      form.setError("password", { message: error.message })
      return
    }
    toast.success("Signed in")
    router.push("/dashboard")
    router.refresh()
  })

  // ...form JSX with Shadcn Input, Label, Button
}
```

`sign-up-view.tsx` mirrors this with `supabase.auth.signUp({ email, password, options: { data: { display_name } } })`. Slice 2's `handle_new_user` trigger reads `display_name` from `raw_user_meta_data` and inserts the profile row automatically.

**Email confirmation in local dev:** Supabase CLI's `[auth.email].enable_confirmations` defaults to `false` in `supabase/config.toml`. Confirm before shipping; for production this becomes a real-email flow which is out of scope.

### Sign-out

`app/(app)/sign-out/route.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase-server"
import { NextResponse } from "next/server"

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  return NextResponse.redirect(
    new URL("/sign-in", process.env.NEXT_PUBLIC_APP_URL ?? "http://app.localhost:3001"),
  )
}
```

`<SignOutButton>` is a tiny client form that POSTs to `/sign-out` — no JavaScript required.

## Onboarding

`app/(app)/onboarding/page.tsx`:

```tsx
import { createServerSupabase } from "@/lib/supabase-server"
import { redirect } from "next/navigation"
import { OnboardingView } from "@/views/onboarding-view"

export default async function OnboardingPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: site } = await supabase
    .from("sites")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_competitor", false)
    .maybeSingle()
  if (site) redirect("/dashboard")

  return <OnboardingView />
}
```

`app/(app)/onboarding/actions.ts`:

```ts
"use server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { AddSiteSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"
import { canonicalUrl } from "@repo/db"

export async function addSiteAction(input: unknown):
  Promise<{ ok: false; error: string }> {
  const parsed = AddSiteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const normalized = canonicalUrl(parsed.data.url)
  const { error } = await supabase
    .from("sites")
    .insert({
      owner_id: user.id,
      url: parsed.data.url,
      normalized_url: normalized,
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      is_competitor: false,
    })

  if (error) return { ok: false, error: error.message }

  revalidatePath("/dashboard", "layout")
  redirect("/dashboard")
}
```

`canonicalUrl` from `@repo/db` is a pure function — fine to import without dragging in the Drizzle runtime.

## Dashboard

### `/dashboard` — main page (RSC)

```tsx
import { createServerSupabase } from "@/lib/supabase-server"
import { redirect } from "next/navigation"
import { DashboardView } from "@/views/dashboard-view"
import type { AuditRun, Site } from "@repo/db"

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: site } = await supabase
    .from("sites")
    .select("id,url,label,created_at")
    .eq("owner_id", user.id)
    .eq("is_competitor", false)
    .maybeSingle()
    .returns<Site>()

  if (!site) redirect("/onboarding")

  const { data: runs } = await supabase
    .from("audit_runs")
    .select("id,status,started_at,finished_at,requested_url,site_id,owner_id,triggered_by,final_url")
    .eq("site_id", site.id)
    .order("started_at", { ascending: false })
    .limit(20)
    .returns<AuditRun[]>()

  return <DashboardView site={site} initialRuns={runs ?? []} />
}
```

### `dashboard-view.tsx`

```tsx
"use client"
import type { AuditRun, Site } from "@repo/db"
import { useRealtimeRuns } from "@/hooks/use-realtime-runs"
import { SiteSummaryCard } from "@/components/site-summary-card"
import { RunListTable } from "@/components/run-list-table"
import { RunAuditButton } from "@/components/run-audit-button"

export function DashboardView({ site, initialRuns }: { site: Site; initialRuns: AuditRun[] }) {
  const runs = useRealtimeRuns(site.id, initialRuns)
  return (
    <div className="space-y-6">
      <SiteSummaryCard site={site} />
      <RunAuditButton siteId={site.id} url={site.url} />
      <RunListTable runs={runs} siteId={site.id} />
    </div>
  )
}
```

### `runAuditAction`

`app/(app)/dashboard/actions.ts`:

```ts
"use server"
import { revalidatePath } from "next/cache"
import { RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

export async function runAuditAction(input: unknown):
  Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const parsed = RunAuditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const { data, error } = await supabase
    .from("audit_runs")
    .insert({
      site_id: parsed.data.siteId,
      owner_id: user.id,
      requested_url: parsed.data.requestedUrl,
      triggered_by: "manual",
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: error.message }

  revalidatePath("/dashboard")
  return { ok: true, runId: data.id }
}
```

The insert triggers slice 3's `audit_runs_enqueue` trigger which pushes a job to pgmq. The runner daemon (slice 3) picks it up within seconds. The user is navigated to `/dashboard/runs/<runId>` where Realtime fills in the category scores progressively.

## Per-run drill-down

### `/dashboard/runs/[runId]` — RSC

```tsx
import { createServerSupabase } from "@/lib/supabase-server"
import { notFound } from "next/navigation"
import { RunDetailView } from "@/views/run-detail-view"
import type { AuditResultRow, AuditRun } from "@repo/db"

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = await createServerSupabase()

  const { data: run } = await supabase
    .from("audit_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle()
    .returns<AuditRun>()
  if (!run) notFound()

  const { data: results } = await supabase
    .from("audit_results")
    .select("*")
    .eq("run_id", runId)
    .order("category")
    .returns<AuditResultRow[]>()

  return <RunDetailView run={run} initialResults={results ?? []} />
}
```

RLS automatically gates: if a user tries to load someone else's runId, the `.maybeSingle()` returns null and we `notFound()`.

### Layout sketch

```
┌────────────────────────────────────────────────────────────────┐
│  ← Back to dashboard                                          │
│                                                                │
│  Run #abc-123                                  status: running │
│  https://example.com   started 2 min ago                      │
│                                                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │ performance  │ │ seo          │ │ best-practs  │          │
│  │      87      │ │      92      │ │              │          │
│  │  ✓ success   │ │  ✓ success   │ │   waiting…   │          │
│  │  2 issues    │ │  0 issues    │ │              │          │
│  └──────────────┘ └──────────────┘ └──────────────┘          │
│  ┌──────────────┐ ┌──────────────┐                            │
│  │ pwa          │ │ on-page      │                            │
│  │              │ │              │                            │
│  │   waiting…   │ │   waiting…   │                            │
│  └──────────────┘ └──────────────┘                            │
│                                                                │
│  ▸ Issues for performance (2)                                 │
│    perf/lcp        — Largest Contentful Paint is slow         │
│    perf/cls        — Cumulative Layout Shift                  │
└────────────────────────────────────────────────────────────────┘
```

5 `CategoryScoreCard`s in a responsive grid (1 col mobile, 2 tablet, 3 desktop). Each card shows category, score (or a spinner when not yet present), status badge, and an issue count with an expandable list. The Realtime hook inserts each result as it lands; motion's `AnimatePresence` smooths the transition.

### Realtime hooks

`hooks/use-realtime-runs.ts`:

```ts
"use client"
import { useEffect, useState } from "react"
import type { AuditRun } from "@repo/db"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function useRealtimeRuns(siteId: string, initial: AuditRun[]): AuditRun[] {
  const [runs, setRuns] = useState(initial)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`runs-for-site:${siteId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_runs", filter: `site_id=eq.${siteId}` },
        (payload) => setRuns((prev) => [payload.new as AuditRun, ...prev].slice(0, 20)),
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "audit_runs", filter: `site_id=eq.${siteId}` },
        (payload) => setRuns((prev) =>
          prev.map((r) => r.id === (payload.new as AuditRun).id ? payload.new as AuditRun : r),
        ),
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [siteId])

  return runs
}
```

`hooks/use-realtime-run.ts`:

```ts
"use client"
import { useEffect, useState } from "react"
import type { AuditResultRow, AuditRun } from "@repo/db"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function useRealtimeRun(
  runId: string,
  initialRun: AuditRun,
  initialResults: AuditResultRow[],
): { run: AuditRun; results: AuditResultRow[] } {
  const [run, setRun] = useState(initialRun)
  const [results, setResults] = useState(initialResults)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`run:${runId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "audit_runs", filter: `id=eq.${runId}` },
        (payload) => setRun(payload.new as AuditRun),
      )
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_results", filter: `run_id=eq.${runId}` },
        (payload) => setResults((prev) => [...prev, payload.new as AuditResultRow]),
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [runId])

  return { run, results }
}
```

Subscriptions are RLS-gated automatically by Supabase Realtime — clients only receive events for rows they can SELECT.

## `<RunAuditButton>` — the trigger

```tsx
"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@repo/ui/components/button"
import { toast } from "sonner"
import { runAuditAction } from "@/app/(app)/dashboard/actions"

export function RunAuditButton({ siteId, url }: { siteId: string; url: string }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <Button
      disabled={pending}
      onClick={() => start(async () => {
        const result = await runAuditAction({ siteId, requestedUrl: url })
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success(`Audit queued — ${result.runId.slice(0, 8)}`)
        router.push(`/dashboard/runs/${result.runId}`)
      })}
    >
      {pending ? "Queueing…" : "Run new audit"}
    </Button>
  )
}
```

## Env vars

`apps/app/.env.example`:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# App
NEXT_PUBLIC_APP_URL=http://app.localhost:3001
```

Each developer copies the example to `.env.local` and fills the anon key from `bunx supabase status -o env`.

## Testing strategy

| Layer | Tool | Approach |
|---|---|---|
| Unit — `lib/format.ts` | `vitest` | Pure helpers: score color thresholds, relative-time formatting, status-badge variants. ~10 fixture cases. |
| Unit — `lib/schemas.ts` | `vitest` | Round-trip each Zod schema (valid + 1-2 invalid inputs each). |
| Server Action — `runAuditAction` | `vitest` | Mock `createServerSupabase` to return a fake client with controllable `.from().insert()` outcomes. Cover: missing user (unauthorized), invalid input, DB error, happy path returns `runId`. |
| Server Action — `addSiteAction` | `vitest` | Same shape: ownership check, canonical-url normalization, unique-constraint collision (slice 2's partial unique index) returns the error string. |
| Manual smoke checklist | README | Step-by-step the engineer runs once before shipping. |

`apps/app/vitest.config.ts` (new):

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    include: ["src/test/**/*.test.ts", "src/test/**/*.test.tsx"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
})
```

Expected total: ~15 tests.

## Manual smoke checklist (in `apps/app/README.md`)

```
1.  bunx supabase start             # ensure Supabase stack running
2.  bun --filter @repo/db migrate   # migrations through 0003
3.  bun --filter @repo/runner dev   # in a separate terminal
4.  bun --filter @repo/app dev      # in a third terminal
5.  Open http://app.localhost:3001
6.  / redirects to /sign-in
7.  Sign up with a fresh email; redirected to /onboarding
8.  Enter https://example.com as URL; redirected to /dashboard
9.  Click "Run new audit"; redirected to /dashboard/runs/<runId>
10. Watch the 5 category cards populate as the runner processes
    (typically completes in ~10 seconds)
11. Back to /dashboard; the run appears at the top of the history
12. Sign out; / redirects to /sign-in
```

## Definition of done

- `apps/app` builds (`bun --filter @repo/app build`) and typechecks.
- Vitest unit tests pass (~15 tests: helpers + Zod schemas + 2 Server Actions).
- `bun --filter @repo/app dev` boots on `app.localhost:3001`.
- Middleware enforces the auth/protected-route split (unauthed users on `/dashboard` redirect to `/sign-in`; authed users on `/sign-in` redirect to `/dashboard`).
- The manual smoke checklist runs end-to-end against a fresh local Supabase + slice 3 runner stack.
- The dashboard renders Realtime updates progressively as the runner processes a job.
- `<SignOutButton>` clears the session and redirects to `/sign-in`.
- README documents env vars, the dev loop, the smoke checklist, and a short architecture summary.

## After slice 4

Slice 5 (multi-site + competitor view) is the natural next step. It will:
- Extend `sites` to allow `is_competitor=true` rows (the partial unique index from slice 2 already permits this).
- Add a sub-page for competitor management (add/remove competitors).
- Introduce the radar chart (`recharts` already in catalog) plotting the user's site + competitors across the 5 categories.
- Add a trends view across multiple runs over time per site per category.

The Server Action + Realtime + `@supabase/supabase-js` patterns built in this slice are the foundation slice 5 extends without significant refactor.
