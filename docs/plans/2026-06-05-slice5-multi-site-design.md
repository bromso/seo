# Slice 5 — Multi-site / Competitor View Design

**Status:** approved
**Date:** 2026-06-05
**Predecessors:**
- [`2026-06-04-audit-packages-slice1-design.md`](2026-06-04-audit-packages-slice1-design.md)
- [`2026-06-04-slice2-data-layer-design.md`](2026-06-04-slice2-data-layer-design.md)
- [`2026-06-04-slice3-runner-design.md`](2026-06-04-slice3-runner-design.md)
- [`2026-06-04-slice4-dashboard-design.md`](2026-06-04-slice4-dashboard-design.md)
**Scope:** Expand slice 4's single-site dashboard to the brief's headline feature — user's site plus up to 5 competitors, radar chart comparison, per-category trend lines over time, and a "Run all" action.

## Goal

After this slice, the dashboard supports the platform's core value proposition: a user adds up to 5 competitor URLs, clicks "Run all", and within ~60 seconds sees a radar comparison + 30-day trend lines for all 6 sites. RLS continues to isolate every user's data; Realtime continues to stream progress as runs complete.

A successful slice 5 is:

```
bunx supabase start
bun --filter @repo/db migrate          # includes new 0004_views.sql
bun --filter @repo/runner dev          # in another terminal
bun --filter @repo/app dev             # in a third terminal
# Open http://app.localhost:3001
# Sign in → onboarded → /dashboard:
#   - Open "Manage competitors" drawer → add up to 5 URLs
#   - Click "Run audits on all sites" → toast: "Queued N audits"
#   - Watch the radar populate as runs complete
#   - Switch to "Trends" tab → 5 line charts populate per category
```

## Architecture decisions summary

| # | Decision | Choice |
|---|---|---|
| 1 | Where do new surfaces live? | All on `/dashboard`. Tabs: Overview \| Trends. Drawer: Manage competitors. No new top-level routes. |
| 2 | "Run all" semantics | Single Server Action enqueues N inserts sequentially. Per-site Run button stays for cherry-picking. |
| 3 | Data shape for radar + trends | New migration `0004_views.sql` adds three SQL views (`latest_run_per_site`, `latest_scores_per_site`, `score_trends`) with `security_invoker = true`. Dashboard queries them via PostgREST. |
| 4 | Trends chart layout | 5 small charts in a 2-column grid (1 col mobile), one per category. 30-day window. Shared site legend. |
| 5 | Competitor limit | `MAX_COMPETITORS = 5` enforced in `addCompetitorAction` (counts existing `is_competitor=true` rows) AND in the drawer UI. |
| 6 | Testing scope | Unit tests for reshaping helpers + schemas; Server Action tests with mocked Supabase client. No component tests, no Playwright. Manual smoke checklist updated. |
| 7 | Realtime update strategy | New `useRealtimeScores` triggers `router.refresh()` on any `audit_results` INSERT for the owner; reseeds the RSC data. The slice 4 `useRealtimeRuns` stays unchanged but the new dashboard view no longer mounts it. |
| 8 | Cascade behavior on competitor removal | Relies on slice 2's `ON DELETE CASCADE` (audit_runs → audit_results both cascade from sites). No app-level cleanup. |

## Out of scope for slice 5 (explicit)

PWA install / Service Worker / SharedWorker fan-out (slice 6 — currently each browser tab subscribes independently; SharedWorker dedupes connections), OAuth / email confirmation flow (still only stub callback), password reset / magic links, profile editing UI, billing, additional audit categories (slice 7), scheduled re-audits (slice 8), per-domain rate-limiting refinements in the runner (still single-threaded by design), exporting comparison data to CSV/PDF, custom date-range pickers for the Trends tab (fixed 30-day window), the `middleware.ts` → `proxy.ts` rename (deferred to a polish PR).

## Package layout changes

### `apps/app/src/`

```
app/(app)/dashboard/
  page.tsx                                   # MODIFY: query the new views; pass to new view
  actions.ts                                 # MODIFY: add runAuditAllAction, addCompetitorAction, removeCompetitorAction
views/
  dashboard-view.tsx                         # MODIFY: replace SiteSummaryCard + RunListTable with Tabs
  dashboard-overview-tab.tsx                 # NEW: radar + site cards + "Run all"
  dashboard-trends-tab.tsx                   # NEW: 5 line charts
  competitor-drawer-view.tsx                 # NEW: Sheet content for add/remove competitors
components/
  radar-chart-card.tsx                       # NEW: recharts RadarChart wrapped in Card
  category-trend-chart.tsx                   # NEW: one recharts LineChart for a single category
  site-score-card.tsx                        # NEW: per-site mini card with 5 scores + per-site "Run" button
  competitor-drawer.tsx                      # NEW: Shadcn Sheet wrapper
  run-all-button.tsx                         # NEW: triggers runAuditAllAction
hooks/
  use-realtime-runs.ts                       # UNCHANGED (slice 4) — kept for future per-site run lists
  use-realtime-scores.ts                     # NEW: router.refresh on audit_results INSERT for owner
lib/
  db-types.ts                                # MODIFY: add LatestScoreRow + ScoreTrendRow
  schemas.ts                                 # MODIFY: add AddCompetitorSchema
  constants.ts                               # NEW: MAX_COMPETITORS, TRENDS_WINDOW_DAYS, CATEGORIES
  radar-data.ts                              # NEW: latestScoresToRadarData(rows): RadarDatum[]
  trend-data.ts                              # NEW: scoreTrendsToChartData(rows, category): ChartDatum[]
test/
  schemas.test.ts                            # MODIFY: extend with AddCompetitorSchema cases
  radar-data.test.ts                         # NEW
  trend-data.test.ts                         # NEW
  actions/
    add-competitor-action.test.ts            # NEW
    remove-competitor-action.test.ts         # NEW
    run-audit-all-action.test.ts             # NEW
```

### `packages/db/`

```
migrations/
  0004_views.sql                              # NEW: 3 views
  meta/_journal.json                          # MODIFY: append idx:4
```

### Dependency direction

Unchanged from slice 4. The dashboard still reads through `@supabase/supabase-js`; `@repo/db` exposes types-only for the new views; Drizzle stays runner-only.

### Catalog additions

None new. `recharts` is already in catalog. `@repo/ui` may need `sheet` added via `bunx shadcn@latest add sheet -c packages/ui` if not already present.

## `packages/db/migrations/0004_views.sql`

```sql
-- 1. Latest completed/partial run per site (one row per site, or zero if no terminal runs yet)
CREATE OR REPLACE VIEW public.latest_run_per_site
WITH (security_invoker = true) AS
SELECT DISTINCT ON (site_id)
  site_id,
  id AS run_id,
  status,
  started_at,
  finished_at,
  owner_id
FROM public.audit_runs
WHERE status IN ('completed', 'partial')
ORDER BY site_id, started_at DESC;
--> statement-breakpoint

-- 2. Latest 5 category scores per site, joined to site metadata
CREATE OR REPLACE VIEW public.latest_scores_per_site
WITH (security_invoker = true) AS
SELECT
  s.id           AS site_id,
  s.owner_id,
  s.url,
  s.label,
  s.is_competitor,
  lr.run_id,
  lr.status      AS run_status,
  lr.started_at  AS run_started_at,
  ar.category,
  ar.status      AS result_status,
  ar.score
FROM public.sites s
LEFT JOIN public.latest_run_per_site lr ON lr.site_id = s.id
LEFT JOIN public.audit_results ar      ON ar.run_id  = lr.run_id;
--> statement-breakpoint

-- 3. Score time series per (site, category)
CREATE OR REPLACE VIEW public.score_trends
WITH (security_invoker = true) AS
SELECT
  s.id           AS site_id,
  s.owner_id,
  s.label,
  s.is_competitor,
  ar.category,
  ar.score,
  ar.started_at  AS measured_at
FROM public.sites s
JOIN public.audit_runs r        ON r.site_id  = s.id
JOIN public.audit_results ar    ON ar.run_id  = r.id
WHERE r.status IN ('completed', 'partial')
  AND ar.status IN ('success', 'partial')
  AND ar.score IS NOT NULL;
```

**Notes:**
- `security_invoker = true` makes all three views run with the caller's RLS context — no separate policies needed.
- `LEFT JOIN`s in `latest_scores_per_site` keep sites with no terminal runs visible (rendered as "waiting" cards).
- `score_trends` filters at the view level for clean data; the dashboard adds a `measured_at >= now() - interval '30 days'` filter per-query.

### Journal entry

```json
{
  "idx": 4,
  "version": "7",
  "when": <Date.now() — strictly > 0003's `when`>,
  "tag": "0004_views",
  "breakpoints": true
}
```

## `apps/app/src/lib/` additions

### `constants.ts` (NEW)

```ts
export const MAX_COMPETITORS = 5
export const TRENDS_WINDOW_DAYS = 30
export const CATEGORIES = [
  "performance",
  "seo",
  "best-practices",
  "pwa",
  "on-page",
] as const
export type Category = (typeof CATEGORIES)[number]
```

### `db-types.ts` additions

```ts
import type { Category } from "@/lib/constants"

export type LatestScoreRow = {
  site_id: string
  owner_id: string
  url: string
  label: string | null
  is_competitor: boolean
  run_id: string | null
  run_status: RunStatus | null
  run_started_at: string | null
  category: Category | null
  result_status: "success" | "partial" | "failed" | null
  score: number | null
}

export type ScoreTrendRow = {
  site_id: string
  owner_id: string
  label: string | null
  is_competitor: boolean
  category: Category
  score: number
  measured_at: string
}
```

### `schemas.ts` additions

```ts
export const AddCompetitorSchema = z.object({
  url: z.url(),
  label: z.string().max(80).optional(),
})
export type AddCompetitorInput = z.infer<typeof AddCompetitorSchema>
```

### `radar-data.ts` (NEW)

```ts
import type { LatestScoreRow } from "@/lib/db-types"
import { CATEGORIES, type Category } from "@/lib/constants"

export type RadarDatum = {
  category: Category
  [siteLabel: string]: number | string | null
}

/**
 * Reshape `latest_scores_per_site` rows into recharts RadarChart data.
 * One element per category; each contains a score keyed by site label.
 * Sites with no run yet contribute null (rendered as missing).
 */
export function latestScoresToRadarData(rows: LatestScoreRow[]): {
  data: RadarDatum[]
  siteLabels: { label: string; isCompetitor: boolean }[]
}
```

### `trend-data.ts` (NEW)

```ts
import type { ScoreTrendRow } from "@/lib/db-types"
import type { Category } from "@/lib/constants"

export type TrendDatum = {
  measuredAt: string                       // ISO date
  [siteLabel: string]: number | string
}

/**
 * Filter ScoreTrendRow[] to one category, group by site, sort by measured_at,
 * and reshape into recharts LineChart data.
 */
export function scoreTrendsToChartData(
  rows: ScoreTrendRow[],
  category: Category,
): {
  data: TrendDatum[]
  siteLabels: string[]
}
```

Both helpers are pure functions — fully unit-testable without DB or React.

## Server Actions (in `app/(app)/dashboard/actions.ts`)

`runAuditAction` from slice 4 stays. Three new actions:

### `addCompetitorAction`

```ts
export type AddCompetitorResult =
  | { ok: true; siteId: string }
  | { ok: false; error: string }

export async function addCompetitorAction(input: unknown): Promise<AddCompetitorResult> {
  const parsed = AddCompetitorSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const { count, error: countError } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .eq("is_competitor", true)
  if (countError) return { ok: false, error: countError.message }
  if ((count ?? 0) >= MAX_COMPETITORS) {
    return { ok: false, error: `competitor limit reached (${MAX_COMPETITORS})` }
  }

  const normalized = canonicalUrl(parsed.data.url)
  const { data, error } = await supabase
    .from("sites")
    .insert({
      owner_id: user.id,
      url: parsed.data.url,
      normalized_url: normalized,
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      is_competitor: true,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: error.message }
  revalidatePath("/dashboard")
  return { ok: true, siteId: data.id as string }
}
```

### `removeCompetitorAction`

```ts
export type RemoveCompetitorResult = { ok: true } | { ok: false; error: string }

export async function removeCompetitorAction(siteId: unknown): Promise<RemoveCompetitorResult> {
  const parsed = z.uuid().safeParse(siteId)
  if (!parsed.success) return { ok: false, error: "invalid site id" }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const { error } = await supabase
    .from("sites")
    .delete()
    .eq("id", parsed.data)
    .eq("is_competitor", true)   // never let this delete the self-site
  if (error) return { ok: false, error: error.message }
  revalidatePath("/dashboard")
  return { ok: true }
}
```

### `runAuditAllAction`

```ts
export type RunAuditAllResult =
  | { ok: true; runIds: string[] }
  | { ok: false; error: string }

export async function runAuditAllAction(): Promise<RunAuditAllResult> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const { data: sites, error } = await supabase
    .from("sites")
    .select("id, url")
    .eq("owner_id", user.id)
  if (error) return { ok: false, error: error.message }
  if (!sites || sites.length === 0) return { ok: false, error: "no sites" }

  const runIds: string[] = []
  for (const site of sites) {
    const { data, error: insertErr } = await supabase
      .from("audit_runs")
      .insert({
        site_id: site.id,
        owner_id: user.id,
        requested_url: site.url,
        triggered_by: "manual",
      })
      .select("id")
      .single()
    if (insertErr) {
      return { ok: false, error: `${insertErr.message} (after ${runIds.length} succeeded)` }
    }
    runIds.push(data.id as string)
  }

  revalidatePath("/dashboard")
  return { ok: true, runIds }
}
```

## Dashboard page (RSC) changes

`app/(app)/dashboard/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { DashboardView } from "@/views/dashboard-view"
import type {
  LatestScoreRow,
  ScoreTrendRow,
  SiteRow,
} from "@/lib/db-types"
import { TRENDS_WINDOW_DAYS } from "@/lib/constants"
import { createServerSupabase } from "@/lib/supabase-server"

export const metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  // Sites (need the self + competitors)
  const { data: sites } = await supabase
    .from("sites")
    .select("id,owner_id,url,normalized_url,label,is_competitor,created_at")
    .eq("owner_id", user.id)
    .returns<SiteRow[]>()
  const selfSite = sites?.find((s) => !s.is_competitor)
  if (!selfSite) redirect("/onboarding")

  // Latest scores per site (radar + Overview cards)
  const { data: latestScores } = await supabase
    .from("latest_scores_per_site")
    .select("*")
    .returns<LatestScoreRow[]>()

  // Trends — last 30 days
  const cutoff = new Date(Date.now() - TRENDS_WINDOW_DAYS * 86400_000).toISOString()
  const { data: trends } = await supabase
    .from("score_trends")
    .select("*")
    .gte("measured_at", cutoff)
    .returns<ScoreTrendRow[]>()

  return (
    <DashboardView
      ownerId={user.id}
      sites={sites ?? []}
      latestScores={latestScores ?? []}
      trends={trends ?? []}
    />
  )
}
```

## `dashboard-view.tsx` (Tabs container)

```tsx
"use client"
import type {
  LatestScoreRow,
  ScoreTrendRow,
  SiteRow,
} from "@/lib/db-types"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs"
import { useRealtimeScores } from "@/hooks/use-realtime-scores"
import { CompetitorDrawer } from "@/components/competitor-drawer"
import { DashboardOverviewTab } from "@/views/dashboard-overview-tab"
import { DashboardTrendsTab } from "@/views/dashboard-trends-tab"

export function DashboardView({
  ownerId,
  sites,
  latestScores,
  trends,
}: {
  ownerId: string
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}) {
  useRealtimeScores(ownerId)
  const competitors = sites.filter((s) => s.is_competitor)
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <CompetitorDrawer competitors={competitors} />
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <DashboardOverviewTab sites={sites} latestScores={latestScores} />
        </TabsContent>
        <TabsContent value="trends">
          <DashboardTrendsTab trends={trends} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

`tabs` from `@repo/ui` may need to be added: `bunx shadcn@latest add tabs -c packages/ui`.

## Overview tab

```
[Overview] Trends                          [Manage competitors (3/5)]

┌─ Latest comparison ────────────────────────────────────────────┐
│                                                                │
│            performance                  Legend:                │
│              .                            ▌ My site            │
│   on-page  ·     ·  seo                  ▌ Competitor A        │
│           ·       ·                       ▌ Competitor B        │
│   pwa    ·         ·  best-practices                            │
│                                                                │
└────────────────────────────────────────────────────────────────┘

  [Run audits on all sites]

┌─ Site cards (grid) ────────────────────────────────────────────┐
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                  │
│ │ My site    │ │ Compt A    │ │ Compt B    │                  │
│ │ perf  87  │ │ perf  92 ▲5│ │ perf  78 ▼9│                  │
│ │ seo   90  │ │ seo   85 ▼5│ │ seo   88 ▼2│                  │
│ │ bp    93  │ │ bp    87 ▼6│ │ bp    81 ▼12│                 │
│ │ pwa  ⋯    │ │ pwa  ⋯    │ │ pwa  ⋯    │  (partial)         │
│ │ onp   78  │ │ onp   72 ▼6│ │ onp   65 ▼13│                 │
│ │ [Run]     │ │ [Run]     │ │ [Run]     │                    │
│ └────────────┘ └────────────┘ └────────────┘                  │
└────────────────────────────────────────────────────────────────┘
```

- `<RadarChartCard>`: recharts `RadarChart` with one `Radar` per site label. Axes follow `CATEGORIES` order.
- `<RunAllButton>`: triggers `runAuditAllAction`; toast on success; the radar updates via Realtime.
- `<SiteScoreCard>`: stacked list of 5 scores. Competitor cards show delta badges (▲/▼ N) vs the self-site's latest score for the same category.

## Trends tab

```
[Overview] [Trends]                        [Manage competitors]

Legend (shared): ▌ My site   ▌ Competitor A   ▌ Competitor B

┌─ Performance (last 30 days) ─┐  ┌─ SEO (last 30 days) ─────┐
│ 95─       ────────           │  │ 92─ ─────────            │
│ 80─────────────────          │  │ 80─────────────────      │
│ 65─                          │  │ 65─                      │
│   Jun 1 ────────── Jul 1    │  │   Jun 1 ────────── Jul 1│
└──────────────────────────────┘  └──────────────────────────┘
┌─ Best Practices ─────────────┐  ┌─ PWA ────────────────────┐
│ ...                          │  │ ...                      │
└──────────────────────────────┘  └──────────────────────────┘
┌─ On-page ────────────────────┐
│ ...                          │
└──────────────────────────────┘
```

- `<CategoryTrendChart>`: one recharts `LineChart` per category. One `<Line>` per unique site label.
- X axis: `measured_at` formatted `MMM d`.
- Y axis: fixed 0–100.
- Empty state ("no data yet") when zero points exist for a category.

## Competitor drawer

```tsx
"use client"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@repo/ui/components/sheet"
import { Button } from "@repo/ui/components/button"
import type { SiteRow } from "@/lib/db-types"
import { CompetitorDrawerView } from "@/views/competitor-drawer-view"

export function CompetitorDrawer({ competitors }: { competitors: SiteRow[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Manage competitors ({competitors.length}/5)</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Competitors</SheetTitle>
        </SheetHeader>
        <CompetitorDrawerView competitors={competitors} />
      </SheetContent>
    </Sheet>
  )
}
```

`competitor-drawer-view.tsx` is a client form: lists existing competitors with per-row remove button (calls `removeCompetitorAction`), plus a URL + label form (calls `addCompetitorAction`). The form hides when `competitors.length >= MAX_COMPETITORS` and shows "Limit reached (5 of 5)".

## Realtime

### `useRealtimeRuns` — unchanged from slice 4

The slice 4 hook stays as-is (filtered by `site_id`). The slice 5 dashboard view does NOT mount it — `useRealtimeScores` (below) covers the dashboard's needs. The hook may be reused later if a per-site run-list surface is added; it's not dead code, just not directly imported by the new `dashboard-view.tsx`.

**Note on slice 4's run history surface:** Slice 4 rendered a `<RunListTable>` of the last 20 runs at the bottom of `/dashboard`. Slice 5 replaces that surface with the radar + per-site score cards + trends tab — the comparison view IS the dashboard now. The per-run detail page at `/dashboard/runs/[runId]` is still reachable by direct URL (and from each `<SiteScoreCard>`'s "Latest run" link). A future polish PR can add a per-site run history sub-page if users miss the flat run list; for slice 5 the simpler comparison view ships first.

### `useRealtimeScores` (NEW)

```ts
"use client"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function useRealtimeScores(ownerId: string): void {
  const router = useRouter()
  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`scores:${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_results",
          filter: `owner_id=eq.${ownerId}`,
        },
        () => router.refresh(),
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [ownerId, router])
}
```

`router.refresh()` re-runs the RSC at `/dashboard/page.tsx`, which re-queries the views. The radar + trends + site cards all reseed. Per-result granular updates (no full refetch) is a future optimization; for slice 5 the full-refresh approach is simple and correct.

## Testing strategy

| Layer | Tool | Approach |
|---|---|---|
| Unit — `lib/constants.ts` | `vitest` | 1 smoke test (`MAX_COMPETITORS === 5`, `CATEGORIES.length === 5`). |
| Unit — `lib/schemas.ts` | `vitest` | Extend with `AddCompetitorSchema` round-trip (valid + invalid). |
| Unit — `lib/radar-data.ts` | `vitest` | ~4 cases: 1 self + 2 competitors → correct shape, site with NULL scores → row exists with null scores, empty input → 5 empty axis entries, sites missing some categories. |
| Unit — `lib/trend-data.ts` | `vitest` | ~3 cases: rows sorted by date and grouped by site label, missing dates leave gaps (no interpolation), filtering by category. |
| Server Action — `addCompetitorAction` | `vitest` | Mocked Supabase. ~6 cases: invalid input, no user, at-limit (count returns 5), DB error, happy path, URL normalization. |
| Server Action — `removeCompetitorAction` | `vitest` | ~4 cases: invalid uuid, no user, DB error, happy path. |
| Server Action — `runAuditAllAction` | `vitest` | ~4 cases: no user, no sites, partial failure (returns the partial count), happy path returns N runIds. |
| Manual smoke checklist | README | Steps 13-19 added to slice 4's checklist. |

Expected total: ~15 new tests on top of slice 4's 34 → ~49 tests in `apps/app`.

## Manual smoke checklist additions (`apps/app/README.md`)

Append after slice 4's step 12:

```
13. Open "Manage competitors" drawer → add a competitor URL
14. Drawer shows it in the list; close drawer
15. Click "Run audits on all sites" → toast: "Queued N audits"
16. Watch the radar populate as runs complete (~10s/run, N runs = ~10N seconds)
17. Switch to "Trends" tab → 5 line charts populate per category
18. Open the drawer, delete a competitor → it disappears from the radar
    and trends within a second (Realtime cascade)
19. Try to add a 6th competitor → form shows "Limit reached (5 of 5)"
```

## Definition of done

- `apps/app` builds + typechecks.
- `@repo/db` migration 0004 applies cleanly; the 3 views exist in psql; querying them as an authenticated user returns only own data (RLS via `security_invoker`).
- Unit + Server Action tests pass (~49 total in `apps/app`).
- `bun --filter @repo/app dev` boots and renders the new tabs.
- Radar populates with mock/seeded data and updates via Realtime.
- Trends tab renders 5 charts and updates via Realtime.
- "Run all" enqueues N audit_runs; the runner processes them serially; each completion triggers a dashboard refresh.
- Adding a 6th competitor is rejected by both UI and Server Action.
- Removing a competitor cascades to its audit_runs + audit_results and is reflected in the charts within a second.
- README updated with steps 13-19.

## After slice 5

Slice 6 (PWA + Service Worker + SharedWorker) is the natural follow-up. It will:
- Add Serwist Service Worker for offline shell + cached last-known scores.
- Add a SharedWorker that opens ONE Supabase Realtime connection per origin and fans it out to all open tabs (deduplicating subscriptions).
- Add the install prompt for the PWA.

The dashboard's Server Actions, RSC queries, and Realtime subscriptions built in this slice are the foundation slice 6 wraps without significant refactor.
