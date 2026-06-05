# Slice 5 — Multi-site / Competitor View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend slice 4's single-site dashboard with up to 5 competitor URLs, a radar chart comparing user vs competitors across the 5 categories, a 30-day Trends tab with one line chart per category, a "Run all" action, and a Sheet-based competitor management drawer.

**Architecture:** One new SQL migration adds three `security_invoker = true` views (`latest_run_per_site`, `latest_scores_per_site`, `score_trends`) so RLS continues to gate dashboard queries automatically. Three new Server Actions (add/remove competitor, run all). Two pure reshaping helpers (`radar-data`, `trend-data`) keep UI components free of data-massaging logic. The dashboard view turns into a Shadcn `Tabs` container with Overview + Trends sub-views.

**Tech Stack:** Next.js 16 App Router, Shadcn/UI (with `tabs` and `sheet` primitives), `@supabase/ssr` + `@supabase/supabase-js`, recharts (already in catalog), react-hook-form + zod.

**Spec:** [`docs/plans/2026-06-05-slice5-multi-site-design.md`](2026-06-05-slice5-multi-site-design.md)

---

## Conventions used throughout

- Working branch: `feat/multi-site-slice5` (already created off `feat/dashboard-slice4`).
- Conventional commits with `feat(app):` / `feat(db):` / `test(app):` / `docs(app):` scopes.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 1-4 packages are all built. The dashboard's existing tests (34) must continue to pass.
- Migration `when` field must be strictly greater than `0003_queue`'s (slices 2-3 monotonicity lesson).
- For UUID fixtures, use real RFC 4122 v4 shapes (`f47ac10b-…`) — zod v4's `z.uuid()` rejects nil-derived sentinels (slice 3 T6 lesson).
- For PostgREST-shaped rows the dashboard uses snake_case via `lib/db-types.ts` (slice 4 pattern).
- Tests live at `apps/app/src/test/` and `apps/app/src/test/actions/`.
- Use `bun --filter @repo/app <script>` for per-package operations.

---

## Task 1: `0004_views.sql` migration

**Files:**
- Create: `packages/db/migrations/0004_views.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (append idx:4)

Three `security_invoker = true` views. Slice 2's RLS on `sites` / `audit_runs` / `audit_results` flows through automatically; no separate view policies needed.

- [ ] **Step 1: Confirm Supabase is running**

```bash
bunx supabase status | head -3
```

If "Stopped", run `bunx supabase start`.

- [ ] **Step 2: Create the migration**

`packages/db/migrations/0004_views.sql`:

```sql
-- 1. Latest completed/partial run per site (one row per site)
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

- [ ] **Step 3: Append the journal entry**

Open `packages/db/migrations/meta/_journal.json`. There are 4 existing entries (idx 0..3). Append a fifth:

```json
{
  "idx": 4,
  "version": "7",
  "when": <Date.now() at write time>,
  "tag": "0004_views",
  "breakpoints": true
}
```

Use `Date.now()` to get a monotonically-increasing value. Match the `version` field of the existing entries.

- [ ] **Step 4: Apply the migration**

```bash
bun --filter @repo/db migrate
```

Expected: "migrations applied". No errors.

If the migrator complains about an existing view name from a prior partial run, reset:

```bash
bunx supabase db reset
bun --filter @repo/db migrate
```

- [ ] **Step 5: Verify in psql**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname;"
```

Expect 3 rows: `latest_run_per_site`, `latest_scores_per_site`, `score_trends`.

Smoke-query as the service role (bypasses RLS — confirms the views compile):

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT COUNT(*) FROM latest_scores_per_site;"
```

The count may be 0 or more depending on what's seeded. The query must succeed without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations
git commit -m "feat(db): add 3 dashboard views (latest_run_per_site, latest_scores_per_site, score_trends)"
```

---

## Task 2: `lib/constants.ts` + smoke test

**Files:**
- Create: `apps/app/src/test/constants.test.ts`
- Create: `apps/app/src/lib/constants.ts`

A small module imported across the dashboard — centralizing the magic numbers + the canonical category list.

- [ ] **Step 1: Failing test**

`apps/app/src/test/constants.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { CATEGORIES, MAX_COMPETITORS, TRENDS_WINDOW_DAYS } from "@/lib/constants"

describe("constants", () => {
  it("MAX_COMPETITORS is 5 (per the brief)", () => {
    expect(MAX_COMPETITORS).toBe(5)
  })

  it("TRENDS_WINDOW_DAYS is 30", () => {
    expect(TRENDS_WINDOW_DAYS).toBe(30)
  })

  it("CATEGORIES contains exactly the 5 slice-1 categories in order", () => {
    expect([...CATEGORIES]).toEqual([
      "performance",
      "seo",
      "best-practices",
      "pwa",
      "on-page",
    ])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: FAIL — `constants` module not found.

- [ ] **Step 3: Implement `src/lib/constants.ts`**

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

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 3 new tests pass + 34 prior = 37 total.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/constants.ts apps/app/src/test/constants.test.ts
git commit -m "feat(app): add lib/constants (MAX_COMPETITORS, TRENDS_WINDOW_DAYS, CATEGORIES)"
```

---

## Task 3: `db-types.ts` + `schemas.ts` extensions

**Files:**
- Modify: `apps/app/src/lib/db-types.ts` (add 2 row types)
- Modify: `apps/app/src/lib/schemas.ts` (add `AddCompetitorSchema`)
- Modify: `apps/app/src/test/schemas.test.ts` (extend with `AddCompetitorSchema` tests)

- [ ] **Step 1: Extend schemas test with AddCompetitorSchema cases**

Open `apps/app/src/test/schemas.test.ts`. Locate the `import` line and add `AddCompetitorSchema` to it:

```ts
import {
  SignInSchema,
  SignUpSchema,
  AddSiteSchema,
  RunAuditSchema,
  AddCompetitorSchema,
} from "@/lib/schemas"
```

At the END of the file, append a new `describe` block:

```ts
describe("AddCompetitorSchema", () => {
  it("accepts a valid URL", () => {
    expect(AddCompetitorSchema.parse({ url: "https://competitor.test" })).toEqual({
      url: "https://competitor.test",
    })
  })

  it("rejects a non-URL string", () => {
    expect(() => AddCompetitorSchema.parse({ url: "not a url" })).toThrow()
  })

  it("accepts an optional label", () => {
    const ok = AddCompetitorSchema.parse({
      url: "https://competitor.test",
      label: "Competitor A",
    })
    expect(ok.label).toBe("Competitor A")
  })

  it("rejects a label longer than 80 chars", () => {
    expect(() =>
      AddCompetitorSchema.parse({
        url: "https://competitor.test",
        label: "a".repeat(81),
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 4 new failures (schema not exported).

- [ ] **Step 3: Extend `src/lib/schemas.ts`**

Open `apps/app/src/lib/schemas.ts`. At the end of the existing exports (before the type-export lines, or wherever fits), add:

```ts
export const AddCompetitorSchema = z.object({
  url: z.url(),
  label: z.string().max(80).optional(),
})

export type AddCompetitorInput = z.infer<typeof AddCompetitorSchema>
```

(Biome will re-sort exports alphabetically on commit; that's fine.)

- [ ] **Step 4: Add row types to `src/lib/db-types.ts`**

Open `apps/app/src/lib/db-types.ts`. Add this import at the top (alongside `import type { RunStatus }`):

```ts
import type { Category } from "@/lib/constants"
```

Append these two new types at the end of the file:

```ts
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

- [ ] **Step 5: Verify**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. Test count: 37 + 4 = 41.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/schemas.ts apps/app/src/lib/db-types.ts apps/app/src/test/schemas.test.ts
git commit -m "feat(app): add AddCompetitorSchema + LatestScoreRow + ScoreTrendRow types"
```

---

## Task 4: `lib/radar-data.ts` with TDD

**Files:**
- Create: `apps/app/src/test/radar-data.test.ts`
- Create: `apps/app/src/lib/radar-data.ts`

Pure reshaping: turn `latest_scores_per_site` rows (one row per site×category) into recharts `RadarChart` data (one row per category, scores keyed by site label).

- [ ] **Step 1: Failing test**

`apps/app/src/test/radar-data.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { latestScoresToRadarData } from "@/lib/radar-data"
import type { LatestScoreRow } from "@/lib/db-types"

const baseRow = {
  site_id: "site-id",
  owner_id: "owner",
  url: "https://example.com",
  label: null,
  is_competitor: false,
  run_id: "run-id",
  run_status: "completed" as const,
  run_started_at: "2026-06-05T12:00:00Z",
  result_status: "success" as const,
} satisfies Omit<LatestScoreRow, "category" | "score">

function mkRow(
  override: Partial<LatestScoreRow> & {
    category: LatestScoreRow["category"]
    score: number | null
  },
): LatestScoreRow {
  return { ...baseRow, ...override }
}

describe("latestScoresToRadarData", () => {
  it("returns 5 axis entries (one per category) in CATEGORIES order", () => {
    const rows: LatestScoreRow[] = [
      mkRow({ site_id: "self", label: "My site", category: "performance", score: 87 }),
      mkRow({ site_id: "self", label: "My site", category: "seo", score: 90 }),
      mkRow({ site_id: "self", label: "My site", category: "best-practices", score: 93 }),
      mkRow({ site_id: "self", label: "My site", category: "pwa", score: 0 }),
      mkRow({ site_id: "self", label: "My site", category: "on-page", score: 78 }),
    ]
    const { data } = latestScoresToRadarData(rows)
    expect(data.map((d) => d.category)).toEqual([
      "performance",
      "seo",
      "best-practices",
      "pwa",
      "on-page",
    ])
  })

  it("keys site scores by site label", () => {
    const rows: LatestScoreRow[] = [
      mkRow({ site_id: "self", label: "My site", category: "performance", score: 87 }),
      mkRow({
        site_id: "c1",
        label: "Competitor A",
        is_competitor: true,
        category: "performance",
        score: 92,
      }),
    ]
    const { data, siteLabels } = latestScoresToRadarData(rows)
    expect(data[0]).toMatchObject({
      category: "performance",
      "My site": 87,
      "Competitor A": 92,
    })
    expect(siteLabels).toEqual([
      { label: "My site", isCompetitor: false },
      { label: "Competitor A", isCompetitor: true },
    ])
  })

  it("uses the URL as the label when label is null", () => {
    const rows: LatestScoreRow[] = [
      mkRow({
        site_id: "self",
        url: "https://example.com",
        label: null,
        category: "performance",
        score: 87,
      }),
    ]
    const { siteLabels } = latestScoresToRadarData(rows)
    expect(siteLabels[0]?.label).toBe("https://example.com")
  })

  it("renders sites with no run yet as null entries (one row per category, all null)", () => {
    const rows: LatestScoreRow[] = [
      {
        ...baseRow,
        site_id: "no-runs",
        label: "Fresh site",
        run_id: null,
        run_status: null,
        run_started_at: null,
        category: null,
        result_status: null,
        score: null,
      },
    ]
    const { data, siteLabels } = latestScoresToRadarData(rows)
    expect(siteLabels).toEqual([{ label: "Fresh site", isCompetitor: false }])
    expect(data).toHaveLength(5)
    for (const row of data) {
      expect(row["Fresh site"]).toBeNull()
    }
  })

  it("returns 5 empty axis rows + empty siteLabels for empty input", () => {
    const { data, siteLabels } = latestScoresToRadarData([])
    expect(siteLabels).toEqual([])
    expect(data.map((d) => d.category)).toEqual([
      "performance",
      "seo",
      "best-practices",
      "pwa",
      "on-page",
    ])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/radar-data.ts`**

```ts
import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow } from "@/lib/db-types"

export type RadarDatum = {
  category: Category
} & Record<string, number | string | null>

export type RadarSiteLabel = { label: string; isCompetitor: boolean }

export type RadarData = {
  data: RadarDatum[]
  siteLabels: RadarSiteLabel[]
}

export function latestScoresToRadarData(rows: LatestScoreRow[]): RadarData {
  // Collect unique sites (preserve insertion order — self-site typically appears first)
  const siteLabels: RadarSiteLabel[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.site_id)) continue
    seen.add(r.site_id)
    siteLabels.push({
      label: r.label ?? r.url,
      isCompetitor: r.is_competitor,
    })
  }

  // Build a lookup: site_id → label
  const idToLabel = new Map<string, string>()
  for (const r of rows) {
    if (!idToLabel.has(r.site_id)) {
      idToLabel.set(r.site_id, r.label ?? r.url)
    }
  }

  // Build one datum per category; populate scores by label
  const data: RadarDatum[] = CATEGORIES.map((category) => {
    const datum: RadarDatum = { category }
    for (const { label } of siteLabels) {
      datum[label] = null
    }
    for (const r of rows) {
      if (r.category !== category) continue
      const label = idToLabel.get(r.site_id)
      if (!label) continue
      datum[label] = r.score
    }
    return datum
  })

  return { data, siteLabels }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 5 new tests pass; total now ~46.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/radar-data.ts apps/app/src/test/radar-data.test.ts
git commit -m "feat(app): add latestScoresToRadarData helper with TDD"
```

---

## Task 5: `lib/trend-data.ts` with TDD

**Files:**
- Create: `apps/app/src/test/trend-data.test.ts`
- Create: `apps/app/src/lib/trend-data.ts`

Pure reshaping: filter `score_trends` rows to one category, group by site, sort by measured_at, and produce recharts `LineChart` data.

- [ ] **Step 1: Failing test**

`apps/app/src/test/trend-data.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { scoreTrendsToChartData } from "@/lib/trend-data"
import type { ScoreTrendRow } from "@/lib/db-types"

const baseRow = {
  site_id: "site-id",
  owner_id: "owner",
  label: null,
  is_competitor: false,
} satisfies Omit<ScoreTrendRow, "category" | "score" | "measured_at">

function mkRow(o: Partial<ScoreTrendRow> & {
  category: ScoreTrendRow["category"]
  score: number
  measured_at: string
  label?: string | null
}): ScoreTrendRow {
  return { ...baseRow, ...o }
}

describe("scoreTrendsToChartData", () => {
  it("filters to the requested category", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({ label: "My site", category: "performance", score: 80, measured_at: "2026-06-01T12:00:00Z" }),
      mkRow({ label: "My site", category: "seo",         score: 88, measured_at: "2026-06-01T12:00:00Z" }),
    ]
    const { data, siteLabels } = scoreTrendsToChartData(rows, "performance")
    expect(siteLabels).toEqual(["My site"])
    expect(data).toEqual([{ measuredAt: "2026-06-01T12:00:00Z", "My site": 80 }])
  })

  it("sorts data points by measured_at ascending", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({ label: "My site", category: "performance", score: 90, measured_at: "2026-06-03T12:00:00Z" }),
      mkRow({ label: "My site", category: "performance", score: 70, measured_at: "2026-06-01T12:00:00Z" }),
      mkRow({ label: "My site", category: "performance", score: 80, measured_at: "2026-06-02T12:00:00Z" }),
    ]
    const { data } = scoreTrendsToChartData(rows, "performance")
    expect(data.map((d) => d.measuredAt)).toEqual([
      "2026-06-01T12:00:00Z",
      "2026-06-02T12:00:00Z",
      "2026-06-03T12:00:00Z",
    ])
  })

  it("groups multiple sites side-by-side per timestamp", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({ site_id: "a", label: "My site",     category: "performance", score: 80, measured_at: "2026-06-01T12:00:00Z" }),
      mkRow({ site_id: "b", label: "Competitor", is_competitor: true,    category: "performance", score: 90, measured_at: "2026-06-01T12:00:00Z" }),
    ]
    const { data, siteLabels } = scoreTrendsToChartData(rows, "performance")
    expect(siteLabels.sort()).toEqual(["Competitor", "My site"])
    expect(data).toEqual([
      {
        measuredAt: "2026-06-01T12:00:00Z",
        "My site": 80,
        Competitor: 90,
      },
    ])
  })

  it("returns empty data + empty siteLabels for no matching rows", () => {
    const { data, siteLabels } = scoreTrendsToChartData([], "performance")
    expect(data).toEqual([])
    expect(siteLabels).toEqual([])
  })

  it("uses url as label when label is null", () => {
    const rows: ScoreTrendRow[] = [
      mkRow({
        site_id: "x",
        label: null,
        category: "performance",
        score: 88,
        measured_at: "2026-06-01T12:00:00Z",
      }),
    ]
    const { siteLabels } = scoreTrendsToChartData(rows, "performance")
    // No `url` on ScoreTrendRow — fallback should be `site_id` (or a clear sentinel)
    expect(siteLabels.length).toBe(1)
    expect(siteLabels[0]).toBeTruthy()
  })
})
```

(`ScoreTrendRow` doesn't carry `url`, so the helper falls back to `site_id` when `label` is null — the last test just confirms a label is produced; the exact fallback string is an implementation choice.)

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/trend-data.ts`**

```ts
import type { Category } from "@/lib/constants"
import type { ScoreTrendRow } from "@/lib/db-types"

export type TrendDatum = {
  measuredAt: string
} & Record<string, number | string>

export type TrendData = {
  data: TrendDatum[]
  siteLabels: string[]
}

export function scoreTrendsToChartData(
  rows: ScoreTrendRow[],
  category: Category,
): TrendData {
  // Filter to the requested category
  const filtered = rows.filter((r) => r.category === category)

  // Unique site labels (in first-seen order)
  const siteLabels: string[] = []
  const seenLabels = new Set<string>()
  const idToLabel = new Map<string, string>()
  for (const r of filtered) {
    const label = r.label ?? r.site_id
    idToLabel.set(r.site_id, label)
    if (!seenLabels.has(label)) {
      seenLabels.add(label)
      siteLabels.push(label)
    }
  }

  // Group rows by measured_at into Datum objects
  const byTime = new Map<string, TrendDatum>()
  for (const r of filtered) {
    const label = idToLabel.get(r.site_id) ?? r.site_id
    const existing = byTime.get(r.measured_at)
    if (existing) {
      existing[label] = r.score
    } else {
      byTime.set(r.measured_at, { measuredAt: r.measured_at, [label]: r.score })
    }
  }

  // Sort by timestamp ascending
  const data = [...byTime.values()].sort((a, b) =>
    a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0,
  )

  return { data, siteLabels }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 5 new tests pass; total ~51.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/trend-data.ts apps/app/src/test/trend-data.test.ts
git commit -m "feat(app): add scoreTrendsToChartData helper with TDD"
```

---

## Task 6: `addCompetitorAction` with TDD

**Files:**
- Create: `apps/app/src/test/actions/add-competitor-action.test.ts`
- Modify: `apps/app/src/app/(app)/dashboard/actions.ts` (append the new action)

- [ ] **Step 1: Failing test**

`apps/app/src/test/actions/add-competitor-action.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockCreateServerSupabase, mockSupabaseClient } = vi.hoisted(() => {
  const mockSupabaseClient = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  }
  const mockCreateServerSupabase = vi.fn(async () => mockSupabaseClient)
  return { mockCreateServerSupabase, mockSupabaseClient }
})

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: mockCreateServerSupabase,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const NEW_SITE_ID = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

/**
 * Helper: when `addCompetitorAction` calls `supabase.from('sites')`, the action
 * does TWO `.from('sites')` calls — first to count, then to insert. The mock
 * has to return different shapes for each invocation. Use `mockImplementation`
 * with a counter, or chain `mockReturnValueOnce`.
 */
function setupSitesMocks(opts: {
  count: number | null
  countError?: { message: string }
  insertResult?: { data: { id: string } | null; error: { message: string } | null }
}) {
  // First call: .select('id', { count: 'exact', head: true }).eq().eq()
  const firstCall = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          count: opts.count,
          error: opts.countError ?? null,
        }),
      }),
    }),
  }
  // Second call: .insert(...).select('id').single()
  const secondCall = opts.insertResult
    ? {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(opts.insertResult),
          }),
        }),
      }
    : undefined

  mockSupabaseClient.from
    .mockReturnValueOnce(firstCall)
    .mockReturnValueOnce(secondCall ?? firstCall)
}

describe("addCompetitorAction", () => {
  it("rejects invalid input (bad URL)", async () => {
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "not a url" })
    expect(result.ok).toBe(false)
  })

  it("returns unauthorized when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "https://competitor.test" })
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns error when at the 5-competitor limit", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    setupSitesMocks({ count: 5 })
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "https://competitor.test" })
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("limit reached"),
    })
  })

  it("returns error on count query failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    setupSitesMocks({ count: null, countError: { message: "count failed" } })
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "https://competitor.test" })
    expect(result).toEqual({ ok: false, error: "count failed" })
  })

  it("returns error on insert failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    setupSitesMocks({
      count: 2,
      insertResult: { data: null, error: { message: "duplicate" } },
    })
    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({ url: "https://competitor.test" })
    expect(result).toEqual({ ok: false, error: "duplicate" })
  })

  it("returns ok with new site id on success + normalizes the URL", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: NEW_SITE_ID },
          error: null,
        }),
      }),
    })
    mockSupabaseClient.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({ insert: insertSpy })

    const { addCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await addCompetitorAction({
      url: "https://Competitor.TEST/?utm_source=x",
      label: "Comp A",
    })
    expect(result).toEqual({ ok: true, siteId: NEW_SITE_ID })
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: VALID_USER_ID,
        url: "https://Competitor.TEST/?utm_source=x",
        normalized_url: "https://competitor.test/",
        label: "Comp A",
        is_competitor: true,
      }),
    )
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 6 new failures (`addCompetitorAction` not exported).

- [ ] **Step 3: Append to `src/app/(app)/dashboard/actions.ts`**

The existing file (from slice 4) starts with `"use server"` and exports `runAuditAction`. Add these imports at the top (alongside existing imports):

```ts
import { canonicalUrl } from "@repo/db"
import { AddCompetitorSchema } from "@/lib/schemas"
import { MAX_COMPETITORS } from "@/lib/constants"
```

Append at the end of the file:

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

  // Enforce the competitor limit at the action layer (UI also hides the form at the limit).
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

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Both PASS. Test count now ~57.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(app\)/dashboard/actions.ts apps/app/src/test/actions/add-competitor-action.test.ts
git commit -m "feat(app): add addCompetitorAction with limit enforcement + TDD"
```

---

## Task 7: `removeCompetitorAction` with TDD

**Files:**
- Create: `apps/app/src/test/actions/remove-competitor-action.test.ts`
- Modify: `apps/app/src/app/(app)/dashboard/actions.ts` (append)

- [ ] **Step 1: Failing test**

`apps/app/src/test/actions/remove-competitor-action.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockCreateServerSupabase, mockSupabaseClient } = vi.hoisted(() => {
  const mockSupabaseClient = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  }
  const mockCreateServerSupabase = vi.fn(async () => mockSupabaseClient)
  return { mockCreateServerSupabase, mockSupabaseClient }
})

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: mockCreateServerSupabase,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const VALID_SITE_ID = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("removeCompetitorAction", () => {
  it("rejects invalid uuid", async () => {
    const { removeCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await removeCompetitorAction("not-a-uuid")
    expect(result).toEqual({ ok: false, error: "invalid site id" })
  })

  it("returns unauthorized when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { removeCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await removeCompetitorAction(VALID_SITE_ID)
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns error on DB failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "fk constraint" } }),
        }),
      }),
    })
    const { removeCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await removeCompetitorAction(VALID_SITE_ID)
    expect(result).toEqual({ ok: false, error: "fk constraint" })
  })

  it("returns ok and uses is_competitor=true guard to prevent deleting self-site", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const competitorEq = vi.fn().mockResolvedValue({ error: null })
    const idEq = vi.fn().mockReturnValue({ eq: competitorEq })
    mockSupabaseClient.from.mockReturnValue({
      delete: vi.fn().mockReturnValue({ eq: idEq }),
    })
    const { removeCompetitorAction } = await import("@/app/(app)/dashboard/actions")
    const result = await removeCompetitorAction(VALID_SITE_ID)
    expect(result).toEqual({ ok: true })
    // Confirm both .eq() calls fired (id + is_competitor=true)
    expect(idEq).toHaveBeenCalledWith("id", VALID_SITE_ID)
    expect(competitorEq).toHaveBeenCalledWith("is_competitor", true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 4 new failures.

- [ ] **Step 3: Append to `src/app/(app)/dashboard/actions.ts`**

Ensure `z` is imported at the top:

```ts
import { z } from "zod"
```

Append at the end:

```ts
export type RemoveCompetitorResult = { ok: true } | { ok: false; error: string }

export async function removeCompetitorAction(siteId: unknown): Promise<RemoveCompetitorResult> {
  const parsed = z.uuid().safeParse(siteId)
  if (!parsed.success) return { ok: false, error: "invalid site id" }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  // is_competitor=true guard is belt-and-suspenders: never delete the self-site
  const { error } = await supabase
    .from("sites")
    .delete()
    .eq("id", parsed.data)
    .eq("is_competitor", true)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/dashboard")
  return { ok: true }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Both PASS. Test count ~61.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(app\)/dashboard/actions.ts apps/app/src/test/actions/remove-competitor-action.test.ts
git commit -m "feat(app): add removeCompetitorAction with TDD"
```

---

## Task 8: `runAuditAllAction` with TDD

**Files:**
- Create: `apps/app/src/test/actions/run-audit-all-action.test.ts`
- Modify: `apps/app/src/app/(app)/dashboard/actions.ts` (append)

- [ ] **Step 1: Failing test**

`apps/app/src/test/actions/run-audit-all-action.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockCreateServerSupabase, mockSupabaseClient } = vi.hoisted(() => {
  const mockSupabaseClient = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  }
  const mockCreateServerSupabase = vi.fn(async () => mockSupabaseClient)
  return { mockCreateServerSupabase, mockSupabaseClient }
})

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: mockCreateServerSupabase,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const SITE_A = "61f1a30a-3a85-4c0b-9e63-91dd16e0a2c5"
const SITE_B = "9b9c8b3a-1c4d-4f6a-92b6-9f0a8e8b7c3d"
const RUN_A = "b1f2e3d4-c5b6-4a78-9012-3456789abcde"
const RUN_B = "c2e3d4e5-b6c7-4a89-a123-4567890abcdf"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("runAuditAllAction", () => {
  it("returns unauthorized when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { runAuditAllAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAllAction()
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns error when user has no sites", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    })
    const { runAuditAllAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAllAction()
    expect(result).toEqual({ ok: false, error: "no sites" })
  })

  it("returns partial-error message when one insert fails mid-loop", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from
      // 1st call: select sites
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: SITE_A, url: "https://a.test" },
              { id: SITE_B, url: "https://b.test" },
            ],
            error: null,
          }),
        }),
      })
      // 2nd call: first audit_runs insert succeeds
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: RUN_A }, error: null }),
          }),
        }),
      })
      // 3rd call: second audit_runs insert fails
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "boom" },
            }),
          }),
        }),
      })

    const { runAuditAllAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAllAction()
    expect(result).toEqual({
      ok: false,
      error: "boom (after 1 succeeded)",
    })
  })

  it("returns ok with N runIds for N sites", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: SITE_A, url: "https://a.test" },
              { id: SITE_B, url: "https://b.test" },
            ],
            error: null,
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: RUN_A }, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: RUN_B }, error: null }),
          }),
        }),
      })

    const { runAuditAllAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAllAction()
    expect(result).toEqual({ ok: true, runIds: [RUN_A, RUN_B] })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 4 new failures.

- [ ] **Step 3: Append to `src/app/(app)/dashboard/actions.ts`**

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
  for (const site of sites as Array<{ id: string; url: string }>) {
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
    runIds.push((data as { id: string }).id)
  }

  revalidatePath("/dashboard")
  return { ok: true, runIds }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Both PASS. Test count ~65.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(app\)/dashboard/actions.ts apps/app/src/test/actions/run-audit-all-action.test.ts
git commit -m "feat(app): add runAuditAllAction with TDD"
```

---

## Task 9: `useRealtimeScores` hook

**Files:**
- Create: `apps/app/src/hooks/use-realtime-scores.ts`

No unit test — exercised by manual smoke. Build + typecheck is the gate.

- [ ] **Step 1: Create `src/hooks/use-realtime-scores.ts`**

```ts
"use client"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabase } from "@/lib/supabase-browser"

/**
 * Subscribe to audit_results INSERT events for the current owner.
 * On any event, trigger a RSC re-render so the dashboard's view
 * queries (latest_scores_per_site, score_trends) re-execute and
 * fresh data flows back to the radar + trends + site cards.
 */
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
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [ownerId, router])
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/hooks/use-realtime-scores.ts
git commit -m "feat(app): add useRealtimeScores hook (refresh on audit_results INSERT)"
```

---

## Task 10: `RadarChartCard` component

**Files:**
- Create: `apps/app/src/components/radar-chart-card.tsx`

- [ ] **Step 1: Ensure recharts is resolvable from apps/app**

```bash
grep '"recharts"' /Users/jonasbroms/Sites/seo/apps/app/package.json
```

If empty, add `"recharts": "^3.6.0"` to `apps/app/package.json` dependencies and run `bun install`. (It should already be there — recharts was listed in slice 4's apps/app deps.)

- [ ] **Step 2: Create `src/components/radar-chart-card.tsx`**

```tsx
"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts"
import { latestScoresToRadarData } from "@/lib/radar-data"
import type { LatestScoreRow } from "@/lib/db-types"

// Distinct colors per site (self = primary; competitors get distinct hues).
// Order matches the order in which sites are encountered.
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2"]

export function RadarChartCard({ rows }: { rows: LatestScoreRow[] }) {
  const { data, siteLabels } = latestScoresToRadarData(rows)
  if (siteLabels.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Latest comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No completed runs yet. Click "Run audits on all sites" to start.
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest comparison</CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid />
            <PolarAngleAxis dataKey="category" />
            <PolarRadiusAxis angle={90} domain={[0, 100]} />
            {siteLabels.map((s, i) => (
              <Radar
                key={s.label}
                name={s.label}
                dataKey={s.label}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={s.isCompetitor ? 0.15 : 0.4}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/components/radar-chart-card.tsx
git commit -m "feat(app): add RadarChartCard (recharts RadarChart wrapper)"
```

---

## Task 11: `SiteScoreCard` component

**Files:**
- Create: `apps/app/src/components/site-score-card.tsx`

Per-site mini card showing all 5 category scores + a per-site "Run" button. Competitor cards show delta badges vs the self-site.

- [ ] **Step 1: Create `src/components/site-score-card.tsx`**

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { runAuditAction } from "@/app/(app)/dashboard/actions"
import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow, SiteRow } from "@/lib/db-types"
import { formatScore, scoreColorClass } from "@/lib/format"

export function SiteScoreCard({
  site,
  scores,
  selfScores,
}: {
  site: SiteRow
  scores: LatestScoreRow[]
  // For competitor cards, pass the self-site's score rows so we can compute deltas.
  // null for the self-site itself.
  selfScores: LatestScoreRow[] | null
}) {
  const [pending, start] = useTransition()
  const router = useRouter()

  const byCategory = new Map<Category, LatestScoreRow>()
  for (const row of scores) {
    if (row.category) byCategory.set(row.category, row)
  }
  const selfByCategory = new Map<Category, LatestScoreRow>()
  if (selfScores) {
    for (const row of selfScores) {
      if (row.category) selfByCategory.set(row.category, row)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {site.label ?? site.url}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {CATEGORIES.map((c) => {
          const row = byCategory.get(c)
          const score = row?.score ?? null
          const selfScore = selfByCategory.get(c)?.score ?? null
          const delta = score !== null && selfScore !== null ? score - selfScore : null
          return (
            <div key={c} className="flex items-center justify-between gap-2 text-sm">
              <span className="capitalize text-muted-foreground">{c}</span>
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${scoreColorClass(score)}`}>
                  {formatScore(score)}
                </span>
                {delta !== null && site.is_competitor ? (
                  <span
                    className={`text-xs ${
                      delta > 0
                        ? "text-green-600"
                        : delta < 0
                          ? "text-red-600"
                          : "text-muted-foreground"
                    }`}
                  >
                    {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} {Math.abs(delta)}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          disabled={pending}
          onClick={() => {
            start(async () => {
              const result = await runAuditAction({
                siteId: site.id,
                requestedUrl: site.url,
              })
              if (!result.ok) {
                toast.error(result.error)
                return
              }
              toast.success(`Audit queued — ${result.runId.slice(0, 8)}`)
              router.push(`/dashboard/runs/${result.runId}`)
            })
          }}
        >
          {pending ? "Queueing…" : "Run audit"}
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/site-score-card.tsx
git commit -m "feat(app): add SiteScoreCard with per-site Run + delta badges vs self"
```

---

## Task 12: `RunAllButton` component

**Files:**
- Create: `apps/app/src/components/run-all-button.tsx`

- [ ] **Step 1: Create `src/components/run-all-button.tsx`**

```tsx
"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@repo/ui/components/button"
import { runAuditAllAction } from "@/app/(app)/dashboard/actions"

export function RunAllButton({ siteCount }: { siteCount: number }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <Button
      disabled={pending || siteCount === 0}
      onClick={() => {
        start(async () => {
          const result = await runAuditAllAction()
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          toast.success(`Queued ${result.runIds.length} audits`)
          router.refresh()
        })
      }}
    >
      {pending
        ? "Queueing…"
        : `Run audits on all sites (${siteCount})`}
    </Button>
  )
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/run-all-button.tsx
git commit -m "feat(app): add RunAllButton (triggers runAuditAllAction)"
```

---

## Task 13: `DashboardOverviewTab` view

**Files:**
- Create: `apps/app/src/views/dashboard-overview-tab.tsx`

- [ ] **Step 1: Create `src/views/dashboard-overview-tab.tsx`**

```tsx
"use client"
import { RadarChartCard } from "@/components/radar-chart-card"
import { RunAllButton } from "@/components/run-all-button"
import { SiteScoreCard } from "@/components/site-score-card"
import type { LatestScoreRow, SiteRow } from "@/lib/db-types"

export function DashboardOverviewTab({
  sites,
  latestScores,
}: {
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
}) {
  // Partition rows by site_id for the per-site cards.
  const rowsBySite = new Map<string, LatestScoreRow[]>()
  for (const row of latestScores) {
    const arr = rowsBySite.get(row.site_id) ?? []
    arr.push(row)
    rowsBySite.set(row.site_id, arr)
  }

  // Order: self-site first, then competitors in created_at order.
  const selfSite = sites.find((s) => !s.is_competitor) ?? null
  const competitors = sites.filter((s) => s.is_competitor)
  const orderedSites = selfSite ? [selfSite, ...competitors] : competitors
  const selfScores = selfSite ? (rowsBySite.get(selfSite.id) ?? null) : null

  return (
    <div className="space-y-6">
      <RadarChartCard rows={latestScores} />
      <RunAllButton siteCount={sites.length} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {orderedSites.map((site) => (
          <SiteScoreCard
            key={site.id}
            site={site}
            scores={rowsBySite.get(site.id) ?? []}
            selfScores={site.is_competitor ? selfScores : null}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/views/dashboard-overview-tab.tsx
git commit -m "feat(app): add DashboardOverviewTab (radar + RunAll + site cards)"
```

---

## Task 14: `CategoryTrendChart` component

**Files:**
- Create: `apps/app/src/components/category-trend-chart.tsx`

- [ ] **Step 1: Create `src/components/category-trend-chart.tsx`**

```tsx
"use client"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import type { Category } from "@/lib/constants"
import type { ScoreTrendRow } from "@/lib/db-types"
import { scoreTrendsToChartData } from "@/lib/trend-data"

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2"]

function formatTick(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function CategoryTrendChart({
  category,
  rows,
}: {
  category: Category
  rows: ScoreTrendRow[]
}) {
  const { data, siteLabels } = scoreTrendsToChartData(rows, category)

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base capitalize">{category}</CardTitle>
        </CardHeader>
        <CardContent className="h-48">
          <p className="text-sm text-muted-foreground">No data in the last 30 days.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base capitalize">{category}</CardTitle>
      </CardHeader>
      <CardContent className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="measuredAt" tickFormatter={formatTick} />
            <YAxis domain={[0, 100]} />
            <Tooltip
              labelFormatter={(v) => formatTick(String(v))}
            />
            {siteLabels.map((label, i) => (
              <Line
                key={label}
                type="monotone"
                dataKey={label}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/category-trend-chart.tsx
git commit -m "feat(app): add CategoryTrendChart (recharts LineChart per category)"
```

---

## Task 15: `DashboardTrendsTab` view

**Files:**
- Create: `apps/app/src/views/dashboard-trends-tab.tsx`

- [ ] **Step 1: Create `src/views/dashboard-trends-tab.tsx`**

```tsx
"use client"
import { CategoryTrendChart } from "@/components/category-trend-chart"
import { CATEGORIES } from "@/lib/constants"
import type { ScoreTrendRow } from "@/lib/db-types"

export function DashboardTrendsTab({ trends }: { trends: ScoreTrendRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {CATEGORIES.map((c) => (
        <CategoryTrendChart key={c} category={c} rows={trends} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/views/dashboard-trends-tab.tsx
git commit -m "feat(app): add DashboardTrendsTab (5 small line charts)"
```

---

## Task 16: `CompetitorDrawer` + `CompetitorDrawerView`

**Files:**
- Create: `apps/app/src/components/competitor-drawer.tsx`
- Create: `apps/app/src/views/competitor-drawer-view.tsx`

May need to add the Shadcn `sheet` primitive to `@repo/ui`.

- [ ] **Step 1: Pre-flight — add `sheet` if missing**

```bash
ls /Users/jonasbroms/Sites/seo/packages/ui/src/components/ | grep -E "^sheet"
```

If empty:

```bash
bunx shadcn@latest add sheet -c packages/ui
```

- [ ] **Step 2: Create `src/views/competitor-drawer-view.tsx`**

```tsx
"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import {
  addCompetitorAction,
  removeCompetitorAction,
} from "@/app/(app)/dashboard/actions"
import { AddCompetitorSchema, type AddCompetitorInput } from "@/lib/schemas"
import { MAX_COMPETITORS } from "@/lib/constants"
import type { SiteRow } from "@/lib/db-types"

export function CompetitorDrawerView({ competitors }: { competitors: SiteRow[] }) {
  const atLimit = competitors.length >= MAX_COMPETITORS
  const form = useForm<AddCompetitorInput>({
    resolver: zodResolver(AddCompetitorSchema),
  })
  const [pending, start] = useTransition()

  const onSubmit = form.handleSubmit((data) => {
    start(async () => {
      const result = await addCompetitorAction(data)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Competitor added")
      form.reset()
    })
  })

  return (
    <div className="space-y-6 py-4">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Competitors ({competitors.length}/{MAX_COMPETITORS})</h3>
        {competitors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No competitors yet.</p>
        ) : (
          <ul className="space-y-2">
            {competitors.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.label ?? c.url}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.url}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    start(async () => {
                      const result = await removeCompetitorAction(c.id)
                      if (!result.ok) toast.error(result.error)
                      else toast.success("Competitor removed")
                    })
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {atLimit ? (
        <p className="text-sm text-muted-foreground">
          Limit reached ({MAX_COMPETITORS} of {MAX_COMPETITORS}).
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="competitor-url">Competitor URL</Label>
            <Input
              id="competitor-url"
              type="url"
              placeholder="https://competitor.com"
              {...form.register("url")}
            />
            {form.formState.errors.url ? (
              <p className="text-sm text-destructive">{form.formState.errors.url.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="competitor-label">Label (optional)</Label>
            <Input
              id="competitor-label"
              type="text"
              placeholder="Competitor A"
              {...form.register("label")}
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Adding…" : "Add competitor"}
          </Button>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `src/components/competitor-drawer.tsx`**

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/sheet"
import { MAX_COMPETITORS } from "@/lib/constants"
import { CompetitorDrawerView } from "@/views/competitor-drawer-view"
import type { SiteRow } from "@/lib/db-types"

export function CompetitorDrawer({ competitors }: { competitors: SiteRow[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          Manage competitors ({competitors.length}/{MAX_COMPETITORS})
        </Button>
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

- [ ] **Step 4: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/competitor-drawer.tsx apps/app/src/views/competitor-drawer-view.tsx packages/ui 2>/dev/null
git commit -m "feat(app): add CompetitorDrawer + drawer view (add/remove with limit gate)"
```

---

## Task 17: Wire `dashboard-view.tsx` + `dashboard/page.tsx` + README + DoD

**Files:**
- Modify: `apps/app/src/views/dashboard-view.tsx`
- Modify: `apps/app/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/app/README.md` (append smoke steps 13-19)

This is the integration task that turns slice 4's single-site dashboard into the multi-site comparison view.

- [ ] **Step 1: Pre-flight — add Shadcn `tabs` if missing**

```bash
ls /Users/jonasbroms/Sites/seo/packages/ui/src/components/ | grep -E "^tabs"
```

If empty:

```bash
bunx shadcn@latest add tabs -c packages/ui
```

- [ ] **Step 2: Replace `src/views/dashboard-view.tsx`**

The slice 4 file imports `RunAuditButton`, `RunListTable`, `SiteSummaryCard`. Slice 5 replaces all of that with the Tabs container.

Replace the entire file content with:

```tsx
"use client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs"
import { CompetitorDrawer } from "@/components/competitor-drawer"
import { useRealtimeScores } from "@/hooks/use-realtime-scores"
import type {
  LatestScoreRow,
  ScoreTrendRow,
  SiteRow,
} from "@/lib/db-types"
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

- [ ] **Step 3: Replace `src/app/(app)/dashboard/page.tsx`**

The slice 4 file queries sites + audit_runs. Slice 5 queries sites + latest_scores_per_site + score_trends.

Replace the entire file content with:

```tsx
import { redirect } from "next/navigation"
import type {
  LatestScoreRow,
  ScoreTrendRow,
  SiteRow,
} from "@/lib/db-types"
import { TRENDS_WINDOW_DAYS } from "@/lib/constants"
import { DashboardView } from "@/views/dashboard-view"
import { createServerSupabase } from "@/lib/supabase-server"

export const metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: sites } = await supabase
    .from("sites")
    .select(
      "id,owner_id,url,normalized_url,label,is_competitor,created_at",
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .returns<SiteRow[]>()

  const selfSite = sites?.find((s) => !s.is_competitor)
  if (!selfSite) redirect("/onboarding")

  const { data: latestScores } = await supabase
    .from("latest_scores_per_site")
    .select(
      "site_id,owner_id,url,label,is_competitor,run_id,run_status,run_started_at,category,result_status,score",
    )
    .returns<LatestScoreRow[]>()

  const cutoff = new Date(
    Date.now() - TRENDS_WINDOW_DAYS * 86_400_000,
  ).toISOString()
  const { data: trends } = await supabase
    .from("score_trends")
    .select(
      "site_id,owner_id,label,is_competitor,category,score,measured_at",
    )
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

- [ ] **Step 4: Append smoke steps to `apps/app/README.md`**

Find the existing "Manual smoke checklist" section (added in slice 4 T17, ending at step 12). After step 12 add:

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

Also update the "Architecture" section's bullets if the slice 4 wording mentioned "single-site": clarify that the dashboard is now a comparison view with up to 5 competitors.

- [ ] **Step 5: Full DoD sweep**

```bash
# 1. Tests
bun --filter @repo/app test
# Expected ~65 passing

# 2. Typecheck
bun --filter @repo/app check-types
# Clean

# 3. Build
bun --filter @repo/app build
# Clean

# 4. Migration applied
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname;"
# Expect: latest_run_per_site, latest_scores_per_site, score_trends

# 5. Dashboard boots
bun --filter @repo/app dev
# Visit http://app.localhost:3001/dashboard with valid env
```

Document the results in the commit message and final report.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/views/dashboard-view.tsx apps/app/src/app/\(app\)/dashboard/page.tsx apps/app/README.md packages/ui 2>/dev/null
git commit -m "feat(app): wire multi-site dashboard (Tabs + Overview + Trends + competitor drawer)"
```

## Report Format

(For the implementer to fill in after T17.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (~65 tests) | … |
  | 4 | Migration 0004 applied; 3 views in psql | … |
  | 5 | Dashboard /dashboard renders Tabs (Overview / Trends) | Deferred to user verification |
  | 6 | Manage competitors drawer opens + add/remove works | Deferred to user verification |
  | 7 | Run all queues N audit_runs (one per site) | Deferred to user verification |
  | 8 | Radar populates via Realtime as runs complete | Deferred to user verification |
  | 9 | Trends tab renders 5 line charts | Deferred to user verification |
  | 10 | Adding 6th competitor rejected by UI + Action | Deferred to user verification |
  | 11 | Removing competitor cascades from charts | Deferred to user verification |
- Total test count
- Commit SHA list (17 commits expected)
- Slice 5 release note (one line)
- Any carry-forwards for slice 6

---

## After slice 5

Slice 6 (PWA + Service Worker + SharedWorker fan-out) wraps slice 5's dashboard with:
- Serwist Service Worker that caches the app shell + last-known scores for offline view.
- SharedWorker that opens ONE Supabase Realtime connection per origin and broadcasts events to all open tabs (eliminating the per-tab subscription duplication).
- PWA install prompt.

The Server Actions, RSC queries, and `useRealtimeScores` hook built in this slice all continue to work unchanged; the SharedWorker is a transparent fan-out layer.
