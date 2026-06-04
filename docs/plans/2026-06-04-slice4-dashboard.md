# Slice 4 — Dashboard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first user-facing surface — a Next.js 16 App Router dashboard with Supabase Auth, onboarding, audit triggering, and Realtime progress (per slice 3's `postgres_changes` publication). After this slice, a user can sign up, add a site, trigger an audit, and watch the 5 category scores stream in as the slice 3 runner processes the job.

**Architecture:** `@supabase/ssr` for session refresh in a middleware; `@supabase/supabase-js` for all DB reads + RLS-enforced mutations through PostgREST; Server Actions for write mutations; per-page Realtime subscriptions in client components via a custom hook. Drizzle stays runner-only. Server-side validation with Zod via `@hookform/resolvers` on the client and `safeParse` in actions.

**Tech Stack:** Next.js 16 App Router, Shadcn/UI (`@repo/ui`), `@supabase/ssr`, `@supabase/supabase-js`, react-hook-form + zod, motion, Sonner (already wired in layout).

**Spec:** [`docs/plans/2026-06-04-slice4-dashboard-design.md`](2026-06-04-slice4-dashboard-design.md)

---

## Conventions used throughout

- Working branch: `feat/dashboard-slice4` (already created off slice 3).
- Conventional commits with `feat(app):` / `chore(app):` / `test(app):` / `docs(app):` scope.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- `bun --filter @repo/app <script>` for per-package scripts.
- Slice 1, 2, 3 packages are all built on this branch's ancestor.
- The existing `apps/app/src/app/layout.tsx`, `providers.tsx`, `components/web-vitals.tsx`, and `views/home-view.tsx` stay untouched **except** `app/page.tsx` (replaced in T6) and any new components added in subsequent tasks.
- Tests use vitest (Node environment) for pure helpers and mocked Server Actions. No component tests / no Playwright in slice 4.
- Server Action files use the `"use server"` directive at the top.
- "use client" components live in `views/` and `components/`. Pages in `app/` are server components by default.
- Imports inside `apps/app` use the `@/*` alias (configured in the existing tsconfig).
- All Supabase clients use the legacy JWT keys from `bunx supabase status -o env` (the `ANON_KEY` and `SERVICE_ROLE_KEY` fields). The new `sb_publishable_*` / `sb_secret_*` opaque keys ALSO work but the `NEXT_PUBLIC_SUPABASE_ANON_KEY` env var name expects the JWT one for clarity.

---

## Task 1: Root catalog + apps/app dependency setup

**Files:**
- Modify: `package.json` (root) — add `@supabase/ssr` to catalog
- Modify: `apps/app/package.json` — add `@supabase/ssr`, `@supabase/supabase-js`, `@repo/db` to dependencies; add `vitest` to devDependencies; add `test` script
- Modify: `apps/app/.env.example` — was `(none)`; create with the new env vars
- Create: `apps/app/vitest.config.ts`

- [ ] **Step 1: Add `@supabase/ssr` to root catalog**

Edit `/Users/jonasbroms/Sites/seo/package.json`. In the `catalog` block, add (sorted alphabetically with existing entries):

```json
"@supabase/ssr": "^0.5.2"
```

`@supabase/supabase-js` is already in catalog at `^2.47.0` (from slice 2).

- [ ] **Step 2: Update `apps/app/package.json`**

Add to `dependencies` (sort alphabetically alongside existing entries):

```json
"@repo/db": "workspace:*",
"@supabase/ssr": "catalog:",
"@supabase/supabase-js": "catalog:",
```

Add to `devDependencies`:

```json
"vitest": "^4.0.15",
```

Add to `scripts`:

```json
"test": "vitest run",
"check-types": "tsc --noEmit"
```

Preserve all existing fields. The existing `dev` script (`next dev --port 3001 --hostname app.localhost`) is unchanged.

- [ ] **Step 3: Create `apps/app/.env.example`**

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# App
NEXT_PUBLIC_APP_URL=http://app.localhost:3001
```

- [ ] **Step 4: Create `apps/app/vitest.config.ts`**

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

- [ ] **Step 5: Install**

```bash
bun install
```

Expect lockfile update; no errors.

- [ ] **Step 6: Verify build + typecheck still pass**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock apps/app/package.json apps/app/.env.example apps/app/vitest.config.ts
git commit -m "chore(app): add @supabase/ssr and vitest setup for slice 4"
```

---

## Task 2: `lib/format.ts` with TDD

**Files:**
- Create: `apps/app/src/test/format.test.ts`
- Create: `apps/app/src/lib/format.ts`

Pure helpers for the dashboard UI: score-to-color thresholds, relative-time formatting, status-badge variant mapping.

- [ ] **Step 1: Write the failing test**

`apps/app/src/test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  formatScore,
  formatRelativeTime,
  statusBadgeVariant,
  scoreColorClass,
} from "@/lib/format"

describe("formatScore", () => {
  it("returns '—' when score is null", () => {
    expect(formatScore(null)).toBe("—")
  })

  it("rounds to integer", () => {
    expect(formatScore(87.4)).toBe("87")
    expect(formatScore(87.6)).toBe("88")
  })

  it("clamps to 0..100", () => {
    expect(formatScore(150)).toBe("100")
    expect(formatScore(-10)).toBe("0")
  })
})

describe("scoreColorClass", () => {
  it("returns green for >= 90", () => {
    expect(scoreColorClass(95)).toBe("text-green-600")
    expect(scoreColorClass(90)).toBe("text-green-600")
  })

  it("returns yellow for 50..89", () => {
    expect(scoreColorClass(89)).toBe("text-yellow-600")
    expect(scoreColorClass(50)).toBe("text-yellow-600")
  })

  it("returns red for < 50", () => {
    expect(scoreColorClass(49)).toBe("text-red-600")
    expect(scoreColorClass(0)).toBe("text-red-600")
  })

  it("returns muted for null", () => {
    expect(scoreColorClass(null)).toBe("text-muted-foreground")
  })
})

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-05T12:00:00.000Z")

  it("formats seconds ago", () => {
    const t = new Date(now.getTime() - 30_000)
    expect(formatRelativeTime(t, now)).toBe("30s ago")
  })

  it("formats minutes ago", () => {
    const t = new Date(now.getTime() - 5 * 60_000)
    expect(formatRelativeTime(t, now)).toBe("5m ago")
  })

  it("formats hours ago", () => {
    const t = new Date(now.getTime() - 3 * 3600_000)
    expect(formatRelativeTime(t, now)).toBe("3h ago")
  })

  it("formats days ago", () => {
    const t = new Date(now.getTime() - 2 * 86400_000)
    expect(formatRelativeTime(t, now)).toBe("2d ago")
  })

  it("uses 'just now' for < 10 seconds", () => {
    const t = new Date(now.getTime() - 5_000)
    expect(formatRelativeTime(t, now)).toBe("just now")
  })

  it("accepts ISO strings", () => {
    expect(formatRelativeTime("2026-06-05T11:55:00.000Z", now)).toBe("5m ago")
  })
})

describe("statusBadgeVariant", () => {
  it("maps each run status to a Shadcn badge variant", () => {
    expect(statusBadgeVariant("queued")).toBe("secondary")
    expect(statusBadgeVariant("running")).toBe("default")
    expect(statusBadgeVariant("completed")).toBe("default")
    expect(statusBadgeVariant("partial")).toBe("outline")
    expect(statusBadgeVariant("failed")).toBe("destructive")
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: FAIL — `format` module not found.

- [ ] **Step 3: Implement `src/lib/format.ts`**

```ts
export type RunStatus = "queued" | "running" | "completed" | "partial" | "failed"

export function formatScore(score: number | null): string {
  if (score === null) return "—"
  const clamped = Math.max(0, Math.min(100, score))
  return String(Math.round(clamped))
}

export function scoreColorClass(score: number | null): string {
  if (score === null) return "text-muted-foreground"
  if (score >= 90) return "text-green-600"
  if (score >= 50) return "text-yellow-600"
  return "text-red-600"
}

export function formatRelativeTime(input: Date | string, now: Date = new Date()): string {
  const t = typeof input === "string" ? new Date(input) : input
  const diffSec = Math.floor((now.getTime() - t.getTime()) / 1000)
  if (diffSec < 10) return "just now"
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

export type BadgeVariant = "default" | "secondary" | "outline" | "destructive"

export function statusBadgeVariant(status: RunStatus): BadgeVariant {
  switch (status) {
    case "queued":
      return "secondary"
    case "running":
      return "default"
    case "completed":
      return "default"
    case "partial":
      return "outline"
    case "failed":
      return "destructive"
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: all format tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/format.ts apps/app/src/test/format.test.ts
git commit -m "feat(app): add format helpers with TDD coverage"
```

---

## Task 3: `lib/schemas.ts` with TDD

**Files:**
- Create: `apps/app/src/test/schemas.test.ts`
- Create: `apps/app/src/lib/schemas.ts`

Zod schemas reused by client forms (via `@hookform/resolvers/zod`) and Server Actions (via `safeParse`).

- [ ] **Step 1: Write the failing test**

`apps/app/src/test/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  SignInSchema,
  SignUpSchema,
  AddSiteSchema,
  RunAuditSchema,
} from "@/lib/schemas"

describe("SignInSchema", () => {
  it("accepts a valid email + password", () => {
    expect(
      SignInSchema.parse({ email: "alice@example.com", password: "supersecret" }),
    ).toEqual({ email: "alice@example.com", password: "supersecret" })
  })

  it("rejects a password shorter than 8 chars", () => {
    expect(() =>
      SignInSchema.parse({ email: "a@b.test", password: "short" }),
    ).toThrow()
  })

  it("rejects a non-email string", () => {
    expect(() =>
      SignInSchema.parse({ email: "not-an-email", password: "supersecret" }),
    ).toThrow()
  })
})

describe("SignUpSchema", () => {
  it("accepts an optional displayName", () => {
    const ok = SignUpSchema.parse({
      email: "a@b.test",
      password: "supersecret",
      displayName: "Alice",
    })
    expect(ok.displayName).toBe("Alice")
  })

  it("accepts no displayName", () => {
    expect(() =>
      SignUpSchema.parse({ email: "a@b.test", password: "supersecret" }),
    ).not.toThrow()
  })

  it("rejects a displayName longer than 80 chars", () => {
    expect(() =>
      SignUpSchema.parse({
        email: "a@b.test",
        password: "supersecret",
        displayName: "a".repeat(81),
      }),
    ).toThrow()
  })
})

describe("AddSiteSchema", () => {
  it("accepts a valid URL", () => {
    expect(AddSiteSchema.parse({ url: "https://example.com" })).toEqual({
      url: "https://example.com",
    })
  })

  it("rejects a non-URL string", () => {
    expect(() => AddSiteSchema.parse({ url: "not a url" })).toThrow()
  })

  it("accepts an optional label", () => {
    const ok = AddSiteSchema.parse({
      url: "https://example.com",
      label: "My site",
    })
    expect(ok.label).toBe("My site")
  })
})

describe("RunAuditSchema", () => {
  it("accepts uuid siteId and url", () => {
    expect(
      RunAuditSchema.parse({
        siteId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        requestedUrl: "https://example.com",
      }),
    ).toEqual({
      siteId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      requestedUrl: "https://example.com",
    })
  })

  it("rejects a non-uuid siteId", () => {
    expect(() =>
      RunAuditSchema.parse({
        siteId: "not-a-uuid",
        requestedUrl: "https://example.com",
      }),
    ).toThrow()
  })
})
```

Note: the `siteId` test uses a real v4-shaped UUID (`f47ac10b-…`) — slice 3 T6 verified that zod 4's `z.uuid()` is strict about v4 bits and rejects nil-derived sentinels. Use real-shaped UUIDs in fixtures.

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: FAIL — schemas not exported.

- [ ] **Step 3: Implement `src/lib/schemas.ts`**

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

export type SignInInput = z.infer<typeof SignInSchema>
export type SignUpInput = z.infer<typeof SignUpSchema>
export type AddSiteInput = z.infer<typeof AddSiteSchema>
export type RunAuditInput = z.infer<typeof RunAuditSchema>
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: format tests + schemas tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/schemas.ts apps/app/src/test/schemas.test.ts
git commit -m "feat(app): add Zod schemas for auth + site + audit inputs"
```

---

## Task 4: Supabase client factories

**Files:**
- Create: `apps/app/src/lib/supabase-server.ts`
- Create: `apps/app/src/lib/supabase-browser.ts`

No unit tests — these are thin wrappers exercised by every action/page/middleware. Build + typecheck is the gate.

- [ ] **Step 1: Create `src/lib/supabase-server.ts`**

```ts
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
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
            // RSC contexts can't set cookies; middleware handles the refresh.
          }
        },
      },
    },
  )
}
```

- [ ] **Step 2: Create `src/lib/supabase-browser.ts`**

```ts
"use client"
import { createBrowserClient } from "@supabase/ssr"

let cached: ReturnType<typeof createBrowserClient> | undefined

export function createBrowserSupabase() {
  if (!cached) {
    cached = createBrowserClient(
      process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
      process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    )
  }
  return cached
}
```

- [ ] **Step 3: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

If the build fails with "NEXT_PUBLIC_SUPABASE_URL undefined", that's fine — the env vars haven't been set yet (only `.env.example` exists, not `.env.local`). Next.js's build step doesn't require runtime env vars; it only requires the code to compile. If a runtime read happens during static page generation, set the env vars in `.env.local` for now (copy from `.env.example`).

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/lib/supabase-server.ts apps/app/src/lib/supabase-browser.ts
git commit -m "feat(app): add Supabase server + browser client factories"
```

---

## Task 5: `middleware.ts`

**Files:**
- Create: `apps/app/src/middleware.ts`

Session refresh + protected-route gate. No unit tests — exercised by the manual smoke checklist in T17.

- [ ] **Step 1: Create `src/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies) => {
          for (const c of cookies) {
            response.cookies.set(c.name, c.value, c.options)
          }
        },
      },
    },
  )

  // Refresh the session cookie if expired
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  const isAuthRoute =
    path === "/sign-in" ||
    path === "/sign-up" ||
    path.startsWith("/auth/")
  const isPublicRoute =
    path === "/" ||
    path.startsWith("/_next/") ||
    path.startsWith("/favicon")

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

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/middleware.ts
git commit -m "feat(app): add middleware for session refresh + protected-route gate"
```

---

## Task 6: Replace `app/page.tsx` with auth-state redirect

**Files:**
- Modify: `apps/app/src/app/page.tsx`

The existing page renders a `<Hero>` block from `@repo/ui`. Replace it with an auth-aware redirect.

- [ ] **Step 1: Replace `src/app/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { createServerSupabase } from "@/lib/supabase-server"

export default async function RootPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  redirect(user ? "/dashboard" : "/sign-in")
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS. The build emits a warning that the route is dynamic (uses cookies); that's expected and correct.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/app/page.tsx
git commit -m "feat(app): replace Hero placeholder with auth-state redirect on /"
```

---

## Task 7: Sign-in page + view

**Files:**
- Create: `apps/app/src/app/(auth)/sign-in/page.tsx`
- Create: `apps/app/src/components/auth-card.tsx`
- Create: `apps/app/src/views/sign-in-view.tsx`

- [ ] **Step 1: Create the shared `auth-card.tsx`**

`apps/app/src/components/auth-card.tsx`:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card"
import type { ReactNode } from "react"

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  )
}
```

If `@repo/ui/components/card` doesn't already exist, this will fail at import time. Run:

```bash
bunx shadcn@latest add card -c packages/ui
```

…to install the Shadcn `Card` primitives into the shared UI package. (The same pattern applies to any Shadcn primitives not yet installed; the plan calls them out per-task.) `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` should all come from the same install.

- [ ] **Step 2: Create `src/views/sign-in-view.tsx`**

```tsx
"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { SignInSchema, type SignInInput } from "@/lib/schemas"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function SignInView() {
  const form = useForm<SignInInput>({ resolver: zodResolver(SignInSchema) })
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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email ? (
          <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...form.register("password")}
        />
        {form.formState.errors.password ? (
          <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
        ) : null}
      </div>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link href="/sign-up" className="underline">
          Sign up
        </Link>
      </p>
    </form>
  )
}
```

If `Input`/`Label` aren't yet installed in `@repo/ui`, add them:

```bash
bunx shadcn@latest add input label -c packages/ui
```

- [ ] **Step 3: Create the page wrapper**

`apps/app/src/app/(auth)/sign-in/page.tsx`:

```tsx
import { AuthCard } from "@/components/auth-card"
import { SignInView } from "@/views/sign-in-view"

export const metadata = { title: "Sign in" }

export default function SignInPage() {
  return (
    <AuthCard title="Sign in" description="Welcome back. Sign in to continue.">
      <SignInView />
    </AuthCard>
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
git add apps/app/src/app/\(auth\)/sign-in apps/app/src/views/sign-in-view.tsx apps/app/src/components/auth-card.tsx
# include @repo/ui changes if any shadcn primitives were added
git add packages/ui 2>/dev/null
git commit -m "feat(app): add sign-in page with RHF + zod + Supabase Auth"
```

---

## Task 8: Sign-up page + view

**Files:**
- Create: `apps/app/src/app/(auth)/sign-up/page.tsx`
- Create: `apps/app/src/views/sign-up-view.tsx`

- [ ] **Step 1: Create `src/views/sign-up-view.tsx`**

```tsx
"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { SignUpSchema, type SignUpInput } from "@/lib/schemas"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function SignUpView() {
  const form = useForm<SignUpInput>({ resolver: zodResolver(SignUpSchema) })
  const router = useRouter()

  const onSubmit = form.handleSubmit(async (data) => {
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: data.displayName ? { display_name: data.displayName } : undefined,
      },
    })
    if (error) {
      form.setError("email", { message: error.message })
      return
    }
    toast.success("Account created")
    router.push("/onboarding")
    router.refresh()
  })

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name (optional)</Label>
        <Input id="displayName" type="text" autoComplete="name" {...form.register("displayName")} />
        {form.formState.errors.displayName ? (
          <p className="text-sm text-destructive">{form.formState.errors.displayName.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email ? (
          <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...form.register("password")}
        />
        {form.formState.errors.password ? (
          <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
        ) : null}
      </div>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Creating account…" : "Sign up"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}
```

- [ ] **Step 2: Create the page wrapper**

`apps/app/src/app/(auth)/sign-up/page.tsx`:

```tsx
import { AuthCard } from "@/components/auth-card"
import { SignUpView } from "@/views/sign-up-view"

export const metadata = { title: "Sign up" }

export default function SignUpPage() {
  return (
    <AuthCard title="Sign up" description="Create your account to get started.">
      <SignUpView />
    </AuthCard>
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
git add apps/app/src/app/\(auth\)/sign-up apps/app/src/views/sign-up-view.tsx
git commit -m "feat(app): add sign-up page with RHF + zod + Supabase Auth"
```

---

## Task 9: Auth callback stub + sign-out route

**Files:**
- Create: `apps/app/src/app/(auth)/auth/callback/route.ts`
- Create: `apps/app/src/app/(app)/sign-out/route.ts`
- Create: `apps/app/src/components/sign-out-button.tsx`

- [ ] **Step 1: `src/app/(auth)/auth/callback/route.ts`**

OAuth callback stub. Slice 5 or 6 will fill this in.

```ts
import { NextResponse } from "next/server"

export function GET() {
  return new NextResponse("OAuth callback not implemented yet", { status: 501 })
}
```

- [ ] **Step 2: `src/app/(app)/sign-out/route.ts`**

```ts
import { NextResponse } from "next/server"
import { createServerSupabase } from "@/lib/supabase-server"

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://app.localhost:3001"
  return NextResponse.redirect(new URL("/sign-in", appUrl))
}
```

- [ ] **Step 3: `src/components/sign-out-button.tsx`**

```tsx
"use client"
import { Button } from "@repo/ui/components/button"

export function SignOutButton() {
  return (
    <form action="/sign-out" method="POST">
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  )
}
```

(No `'use client'` is strictly required for a form that POSTs server-side; the `<Button>` is a client component which forces it. Keep the directive.)

- [ ] **Step 4: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(auth\)/auth apps/app/src/app/\(app\)/sign-out apps/app/src/components/sign-out-button.tsx
git commit -m "feat(app): add OAuth callback stub + sign-out route + SignOutButton"
```

---

## Task 10: `(app)/layout.tsx` + `AppShell`

**Files:**
- Create: `apps/app/src/app/(app)/layout.tsx`
- Create: `apps/app/src/components/app-shell.tsx`

Shared layout for authenticated routes. Reads user + self-site once and passes both as props to the chrome.

- [ ] **Step 1: Create `src/components/app-shell.tsx`**

```tsx
import type { ReactNode } from "react"
import Link from "next/link"
import { SignOutButton } from "@/components/sign-out-button"

export function AppShell({
  email,
  siteLabel,
  children,
}: {
  email: string
  siteLabel: string | null
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm font-medium">
            SEO Audit
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {siteLabel ? <span className="text-muted-foreground">{siteLabel}</span> : null}
            <span className="text-muted-foreground">{email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 py-8">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/app/(app)/layout.tsx`**

```tsx
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { AppShell } from "@/components/app-shell"
import { createServerSupabase } from "@/lib/supabase-server"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: site } = await supabase
    .from("sites")
    .select("label")
    .eq("owner_id", user.id)
    .eq("is_competitor", false)
    .maybeSingle()

  return (
    <AppShell email={user.email ?? ""} siteLabel={site?.label ?? null}>
      {children}
    </AppShell>
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
git add apps/app/src/app/\(app\)/layout.tsx apps/app/src/components/app-shell.tsx
git commit -m "feat(app): add authenticated route group layout + AppShell chrome"
```

---

## Task 11: Onboarding page + view + `addSiteAction` (TDD on the action)

**Files:**
- Create: `apps/app/src/app/(app)/onboarding/actions.ts`
- Create: `apps/app/src/app/(app)/onboarding/page.tsx`
- Create: `apps/app/src/views/onboarding-view.tsx`
- Create: `apps/app/src/test/actions/add-site-action.test.ts`

The Server Action is TDD'd with a mocked Supabase client. The page + view are added without unit tests (browser smoke in T17 validates them).

- [ ] **Step 1: Failing test**

`apps/app/src/test/actions/add-site-action.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// We use vi.hoisted to construct mocks that the module-under-test's imports
// will resolve before evaluation.
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
vi.mock("next/navigation", () => ({ redirect: vi.fn((p: string) => { throw new Error(`__REDIRECT__${p}`) }) }))

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("addSiteAction", () => {
  it("returns ok:false when input is invalid", async () => {
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    const result = await addSiteAction({ url: "not a url" })
    expect(result).toMatchObject({ ok: false })
  })

  it("returns ok:false when user is missing", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    const result = await addSiteAction({ url: "https://example.com" })
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns ok:false when DB insert fails", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: "duplicate" } }),
    })
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    const result = await addSiteAction({ url: "https://example.com" })
    expect(result).toEqual({ ok: false, error: "duplicate" })
  })

  it("redirects to /dashboard on success (throws the redirect sentinel)", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    await expect(
      addSiteAction({ url: "https://example.com", label: "My site" }),
    ).rejects.toThrow("__REDIRECT__/dashboard")
  })

  it("normalizes the URL before insert", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    mockSupabaseClient.from.mockReturnValue({ insert: insertSpy })
    const { addSiteAction } = await import("@/app/(app)/onboarding/actions")
    try {
      await addSiteAction({ url: "https://Example.COM/?utm_source=x" })
    } catch {
      // expected redirect throw
    }
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: VALID_USER_ID,
        url: "https://Example.COM/?utm_source=x",
        normalized_url: "https://example.com/",
        is_competitor: false,
      }),
    )
  })
})
```

The redirect-as-throw pattern is how Next.js's `redirect()` works in Server Actions: it throws a special sentinel that the framework intercepts. In tests, mocking `redirect` to throw a string-encoded error is the canonical way to assert "the action navigated".

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: FAIL — `addSiteAction` not exported.

- [ ] **Step 3: Implement `src/app/(app)/onboarding/actions.ts`**

```ts
"use server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { canonicalUrl } from "@repo/db"
import { AddSiteSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

export type AddSiteResult = { ok: false; error: string }

export async function addSiteAction(input: unknown): Promise<AddSiteResult> {
  const parsed = AddSiteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message }
  }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "unauthorized" }

  const normalized = canonicalUrl(parsed.data.url)
  const { error } = await supabase.from("sites").insert({
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

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: 5 addSite tests pass + prior tests pass.

- [ ] **Step 5: Create `src/views/onboarding-view.tsx`**

```tsx
"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { addSiteAction } from "@/app/(app)/onboarding/actions"
import { AddSiteSchema, type AddSiteInput } from "@/lib/schemas"

export function OnboardingView() {
  const form = useForm<AddSiteInput>({ resolver: zodResolver(AddSiteSchema) })
  const [pending, setPending] = useState(false)

  const onSubmit = form.handleSubmit(async (data) => {
    setPending(true)
    // addSiteAction redirects on success — that navigation handles the success branch
    const result = await addSiteAction(data)
    // Only reached when the action returned an error (no redirect)
    setPending(false)
    toast.error(result.error)
  })

  return (
    <main className="container mx-auto max-w-md py-12">
      <h1 className="mb-2 text-2xl font-semibold">Add your site</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Enter the URL of the site you want to track. You can add competitors later.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="url">Site URL</Label>
          <Input id="url" type="url" placeholder="https://example.com" {...form.register("url")} />
          {form.formState.errors.url ? (
            <p className="text-sm text-destructive">{form.formState.errors.url.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="label">Label (optional)</Label>
          <Input id="label" type="text" placeholder="My site" {...form.register("label")} />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Adding…" : "Add site"}
        </Button>
      </form>
    </main>
  )
}
```

Note: `OnboardingView` is rendered OUTSIDE the `(app)` layout because the layout's site-fetch would need to handle `null` more carefully. Slice 4 keeps it simple: `/onboarding/page.tsx` is in the `(app)` group, so it gets the shell — but the shell shows an empty `siteLabel` since the user has no site yet (that's why we passed `siteLabel: string | null`). Re-read T10 to confirm this works for the null case.

- [ ] **Step 6: Create `src/app/(app)/onboarding/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { OnboardingView } from "@/views/onboarding-view"
import { createServerSupabase } from "@/lib/supabase-server"

export const metadata = { title: "Onboarding" }

export default async function OnboardingPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
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

- [ ] **Step 7: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/app/\(app\)/onboarding apps/app/src/views/onboarding-view.tsx apps/app/src/test/actions/add-site-action.test.ts
git commit -m "feat(app): add onboarding page + addSiteAction with TDD"
```

---

## Task 12: Bridge types + Dashboard page (RSC) + `useRealtimeRuns` hook + dashboard-view

**Files:**
- Create: `apps/app/src/lib/db-types.ts`
- Create: `apps/app/src/hooks/use-realtime-runs.ts`
- Create: `apps/app/src/views/dashboard-view.tsx`
- Create: `apps/app/src/app/(app)/dashboard/page.tsx`

**Why a bridge file:** Drizzle's inferred row types from `@repo/db` use camelCase (`startedAt`, `requestedUrl`) but the data returned by `supabase.from(...).select(...)` (PostgREST) is snake_case (`started_at`, `requested_url`). The dashboard runtime uses Supabase JS, so we define snake_case row types here and use them consistently in every page/view/hook/component.

- [ ] **Step 1: Create `src/lib/db-types.ts`**

```ts
import type { RunStatus } from "@/lib/format"

export type SiteRow = {
  id: string
  owner_id: string
  url: string
  normalized_url: string
  label: string | null
  is_competitor: boolean
  created_at: string
}

export type AuditRunRow = {
  id: string
  site_id: string
  owner_id: string
  status: RunStatus
  requested_url: string
  final_url: string | null
  started_at: string
  finished_at: string | null
  triggered_by: string
}

export type AuditResultRow = {
  id: string
  run_id: string
  owner_id: string
  category: "performance" | "seo" | "best-practices" | "pwa" | "on-page"
  status: "success" | "partial" | "failed"
  score: number | null
  issues: unknown
  raw: unknown
  partial_reasons: string[] | null
  error_code: string | null
  error_message: string | null
  error_retryable: boolean | null
  package_name: string
  package_version: string
  duration_ms: number
  started_at: string
}
```

- [ ] **Step 2: Create `src/hooks/use-realtime-runs.ts`**

```ts
"use client"
import { useEffect, useState } from "react"
import { createBrowserSupabase } from "@/lib/supabase-browser"
import type { AuditRunRow } from "@/lib/db-types"

export function useRealtimeRuns(
  siteId: string,
  initial: AuditRunRow[],
): AuditRunRow[] {
  const [runs, setRuns] = useState(initial)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`runs-for-site:${siteId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_runs",
          filter: `site_id=eq.${siteId}`,
        },
        (payload) => {
          setRuns((prev) => [payload.new as AuditRunRow, ...prev].slice(0, 20))
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "audit_runs",
          filter: `site_id=eq.${siteId}`,
        },
        (payload) => {
          const updated = payload.new as AuditRunRow
          setRuns((prev) =>
            prev.map((r) => (r.id === updated.id ? updated : r)),
          )
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [siteId])

  return runs
}
```

- [ ] **Step 3: Create `src/views/dashboard-view.tsx`** (stub — calls components added in T13/T14)

```tsx
"use client"
import { RunAuditButton } from "@/components/run-audit-button"
import { RunListTable } from "@/components/run-list-table"
import { SiteSummaryCard } from "@/components/site-summary-card"
import type { AuditRunRow, SiteRow } from "@/lib/db-types"
import { useRealtimeRuns } from "@/hooks/use-realtime-runs"

export function DashboardView({
  site,
  initialRuns,
}: {
  site: SiteRow
  initialRuns: AuditRunRow[]
}) {
  const runs = useRealtimeRuns(site.id, initialRuns)
  return (
    <div className="space-y-6">
      <SiteSummaryCard site={site} />
      <RunAuditButton siteId={site.id} url={site.url} />
      <RunListTable runs={runs} />
    </div>
  )
}
```

This file imports `RunAuditButton`, `RunListTable`, `SiteSummaryCard` — those land in T13 and T14. At this point the file won't compile until those exist; the next steps add them. **Do NOT build at this point.**

- [ ] **Step 4: Create `src/app/(app)/dashboard/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { DashboardView } from "@/views/dashboard-view"
import type { AuditRunRow, SiteRow } from "@/lib/db-types"
import { createServerSupabase } from "@/lib/supabase-server"

export const metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: site } = await supabase
    .from("sites")
    .select(
      "id,owner_id,url,normalized_url,label,is_competitor,created_at",
    )
    .eq("owner_id", user.id)
    .eq("is_competitor", false)
    .maybeSingle<SiteRow>()

  if (!site) redirect("/onboarding")

  const { data: runs } = await supabase
    .from("audit_runs")
    .select(
      "id,site_id,owner_id,status,requested_url,final_url,started_at,finished_at,triggered_by",
    )
    .eq("site_id", site.id)
    .order("started_at", { ascending: false })
    .limit(20)
    .returns<AuditRunRow[]>()

  return <DashboardView site={site} initialRuns={runs ?? []} />
}
```

- [ ] **Step 5: Commit (without building — T13 finishes the compile)**

```bash
git add apps/app/src/lib/db-types.ts apps/app/src/hooks/use-realtime-runs.ts apps/app/src/views/dashboard-view.tsx apps/app/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(app): add db-types bridge + dashboard page + Realtime hook + view (components in T13)"
```

(Husky pre-commit lints staged files but doesn't run the build, so this commit goes through. The build would fail at this point due to the missing component imports; T13 closes the gap.)

---

## Task 13: Dashboard components (`SiteSummaryCard`, `RunListTable`, `RunStatusBadge`)

**Files:**
- Create: `apps/app/src/components/site-summary-card.tsx`
- Create: `apps/app/src/components/run-list-table.tsx`
- Create: `apps/app/src/components/run-status-badge.tsx`

After this task, the build compiles cleanly.

- [ ] **Step 1: Add the Shadcn primitives if not already present**

```bash
bunx shadcn@latest add badge table -c packages/ui
```

This installs `Badge` and `Table` (plus `TableHeader`, `TableRow`, `TableCell`, `TableBody`, `TableHead`) into `packages/ui/src/components/`.

- [ ] **Step 2: Create `src/components/run-status-badge.tsx`**

```tsx
import { Badge } from "@repo/ui/components/badge"
import { statusBadgeVariant, type RunStatus } from "@/lib/format"

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
}
```

- [ ] **Step 3: Create `src/components/site-summary-card.tsx`**

```tsx
import type { Site } from "@repo/db"
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"

export function SiteSummaryCard({ site }: { site: Site }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{site.label ?? site.url}</CardTitle>
      </CardHeader>
      <CardContent>
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground underline"
        >
          {site.url}
        </a>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Create `src/components/run-list-table.tsx`**

```tsx
"use client"
import Link from "next/link"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table"
import { formatRelativeTime } from "@/lib/format"
import type { AuditRunRow } from "@/lib/db-types"
import { RunStatusBadge } from "@/components/run-status-badge"

export function RunListTable({ runs }: { runs: AuditRunRow[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No runs yet. Click "Run new audit" to start.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>URL</TableHead>
          <TableHead className="text-right">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>{formatRelativeTime(run.started_at)}</TableCell>
            <TableCell>
              <RunStatusBadge status={run.status} />
            </TableCell>
            <TableCell className="max-w-xs truncate text-sm">
              {run.requested_url}
            </TableCell>
            <TableCell className="text-right">
              <Link
                href={`/dashboard/runs/${run.id}`}
                className="text-sm underline"
              >
                Open
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

`AuditRunRow` from `@/lib/db-types` (created in T12) is the snake_case bridge type aligned with what PostgREST returns. `RunStatusBadge` accepts the row's `status` directly because `AuditRunRow.status` is typed as the same `RunStatus` union from `@/lib/format`.

Update `src/components/site-summary-card.tsx` to use `SiteRow` from `@/lib/db-types` as well:

```tsx
import type { SiteRow } from "@/lib/db-types"

export function SiteSummaryCard({ site }: { site: SiteRow }) {
  // body unchanged from step 3
}
```

- [ ] **Step 5: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/site-summary-card.tsx apps/app/src/components/run-list-table.tsx apps/app/src/components/run-status-badge.tsx packages/ui 2>/dev/null
git commit -m "feat(app): add dashboard components (SiteSummaryCard, RunListTable, RunStatusBadge)"
```

---

## Task 14: `runAuditAction` + `RunAuditButton` (TDD on the action)

**Files:**
- Create: `apps/app/src/test/actions/run-audit-action.test.ts`
- Create: `apps/app/src/app/(app)/dashboard/actions.ts`
- Create: `apps/app/src/components/run-audit-button.tsx`

- [ ] **Step 1: Failing test**

`apps/app/src/test/actions/run-audit-action.test.ts`:

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
const VALID_RUN_ID = "b1f2e3d4-c5b6-4a78-9012-3456789abcde"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe("runAuditAction", () => {
  it("rejects invalid input", async () => {
    const { runAuditAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAction({
      siteId: "not-a-uuid",
      requestedUrl: "https://example.com",
    })
    expect(result.ok).toBe(false)
  })

  it("returns unauthorized when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { runAuditAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAction({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns error on DB failure", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "fk" } }),
        }),
      }),
    })
    const { runAuditAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAction({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ ok: false, error: "fk" })
  })

  it("returns ok with the new runId on success", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })
    mockSupabaseClient.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: VALID_RUN_ID },
            error: null,
          }),
        }),
      }),
    })
    const { runAuditAction } = await import("@/app/(app)/dashboard/actions")
    const result = await runAuditAction({
      siteId: VALID_SITE_ID,
      requestedUrl: "https://example.com",
    })
    expect(result).toEqual({ ok: true, runId: VALID_RUN_ID })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/app test
```

Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement `src/app/(app)/dashboard/actions.ts`**

```ts
"use server"
import { revalidatePath } from "next/cache"
import { RunAuditSchema } from "@/lib/schemas"
import { createServerSupabase } from "@/lib/supabase-server"

export type RunAuditResult =
  | { ok: true; runId: string }
  | { ok: false; error: string }

export async function runAuditAction(input: unknown): Promise<RunAuditResult> {
  const parsed = RunAuditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
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
  return { ok: true, runId: data.id as string }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/app test
```

Expected: all action tests + prior tests pass.

- [ ] **Step 5: Create `src/components/run-audit-button.tsx`**

```tsx
"use client"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@repo/ui/components/button"
import { runAuditAction } from "@/app/(app)/dashboard/actions"

export function RunAuditButton({
  siteId,
  url,
}: {
  siteId: string
  url: string
}) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <Button
      disabled={pending}
      onClick={() => {
        start(async () => {
          const result = await runAuditAction({ siteId, requestedUrl: url })
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          toast.success(`Audit queued — ${result.runId.slice(0, 8)}`)
          router.push(`/dashboard/runs/${result.runId}`)
        })
      }}
    >
      {pending ? "Queueing…" : "Run new audit"}
    </Button>
  )
}
```

- [ ] **Step 6: Build + typecheck**

```bash
bun --filter @repo/app build
bun --filter @repo/app check-types
```

Both PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/app/\(app\)/dashboard/actions.ts apps/app/src/components/run-audit-button.tsx apps/app/src/test/actions/run-audit-action.test.ts
git commit -m "feat(app): add runAuditAction + RunAuditButton with TDD"
```

---

## Task 15: Run detail page + `useRealtimeRun` hook + run-detail-view

**Files:**
- Create: `apps/app/src/hooks/use-realtime-run.ts`
- Create: `apps/app/src/views/run-detail-view.tsx`
- Create: `apps/app/src/app/(app)/dashboard/runs/[runId]/page.tsx`

- [ ] **Step 1: Create `src/hooks/use-realtime-run.ts`**

```ts
"use client"
import { useEffect, useState } from "react"
import { createBrowserSupabase } from "@/lib/supabase-browser"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"

export function useRealtimeRun(
  runId: string,
  initialRun: AuditRunRow,
  initialResults: AuditResultRow[],
): { run: AuditRunRow; results: AuditResultRow[] } {
  const [run, setRun] = useState(initialRun)
  const [results, setResults] = useState(initialResults)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`run:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "audit_runs",
          filter: `id=eq.${runId}`,
        },
        (payload) => setRun(payload.new as AuditRunRow),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_results",
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          setResults((prev) => [...prev, payload.new as AuditResultRow])
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [runId])

  return { run, results }
}
```

The `AuditRunRow` + `AuditResultRow` bridge types come from `@/lib/db-types` (created in T12).

- [ ] **Step 2: Create `src/views/run-detail-view.tsx`** (stub — full implementation in T16)

```tsx
"use client"
import Link from "next/link"
import { CategoryScoreCard } from "@/components/category-score-card"
import { IssueList } from "@/components/issue-list"
import { RunStatusBadge } from "@/components/run-status-badge"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { useRealtimeRun } from "@/hooks/use-realtime-run"
import { formatRelativeTime } from "@/lib/format"

const ALL_CATEGORIES = [
  "performance",
  "seo",
  "best-practices",
  "pwa",
  "on-page",
] as const

export function RunDetailView({
  initialRun,
  initialResults,
}: {
  initialRun: AuditRunRow
  initialResults: AuditResultRow[]
}) {
  const { run, results } = useRealtimeRun(initialRun.id, initialRun, initialResults)
  const byCategory = Object.fromEntries(results.map((r) => [r.category, r]))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-muted-foreground underline">
            ← Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Run {run.id.slice(0, 8)}</h1>
          <p className="text-sm text-muted-foreground">
            {run.requested_url} · started {formatRelativeTime(run.started_at)}
          </p>
        </div>
        <RunStatusBadge status={run.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {ALL_CATEGORIES.map((c) => (
          <CategoryScoreCard key={c} category={c} result={byCategory[c]} runId={run.id} />
        ))}
      </div>

      {results
        .filter((r) => r.status !== "failed" && Array.isArray(r.issues) && (r.issues as unknown[]).length > 0)
        .map((r) => (
          <IssueList key={r.id} category={r.category} issues={r.issues as unknown[]} />
        ))}
    </div>
  )
}
```

The file imports `CategoryScoreCard` and `IssueList` — those land in T16. The build will fail until T16.

- [ ] **Step 3: Create `src/app/(app)/dashboard/runs/[runId]/page.tsx`**

```tsx
import { notFound } from "next/navigation"
import { RunDetailView } from "@/views/run-detail-view"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { createServerSupabase } from "@/lib/supabase-server"

export const metadata = { title: "Run details" }

export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  const supabase = await createServerSupabase()

  const { data: run } = await supabase
    .from("audit_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle<AuditRunRow>()
  if (!run) notFound()

  const { data: results } = await supabase
    .from("audit_results")
    .select("*")
    .eq("run_id", runId)
    .order("category")
    .returns<AuditResultRow[]>()

  return <RunDetailView initialRun={run} initialResults={results ?? []} />
}
```

- [ ] **Step 4: Commit (without building — T16 closes the gap)**

```bash
git add apps/app/src/hooks/use-realtime-run.ts apps/app/src/views/run-detail-view.tsx apps/app/src/app/\(app\)/dashboard/runs
git commit -m "feat(app): add run-detail page + Realtime hook + view (components in T16)"
```

---

## Task 16: Run detail components (`CategoryScoreCard`, `IssueList`)

**Files:**
- Create: `apps/app/src/components/category-score-card.tsx`
- Create: `apps/app/src/components/issue-list.tsx`

After this task, the build compiles cleanly.

- [ ] **Step 1: Create `src/components/category-score-card.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import { RunStatusBadge } from "@/components/run-status-badge"
import type { AuditResultRow } from "@/lib/db-types"
import { formatScore, scoreColorClass } from "@/lib/format"

export function CategoryScoreCard({
  category,
  result,
}: {
  category: string
  result: AuditResultRow | undefined
  runId: string
}) {
  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base capitalize">{category}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">waiting…</p>
        </CardContent>
      </Card>
    )
  }
  const issuesCount =
    Array.isArray(result.issues) ? (result.issues as unknown[]).length : 0
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <CardTitle className="text-base capitalize">{category}</CardTitle>
        <RunStatusBadge status={result.status === "success" ? "completed" : result.status} />
      </CardHeader>
      <CardContent className="space-y-2">
        <div className={`text-3xl font-semibold ${scoreColorClass(result.score)}`}>
          {formatScore(result.score)}
        </div>
        {result.status === "failed" && result.error_message ? (
          <p className="text-sm text-destructive">{result.error_message}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {issuesCount} {issuesCount === 1 ? "issue" : "issues"}
          </p>
        )}
        {result.partial_reasons && result.partial_reasons.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {result.partial_reasons.join("; ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
```

The `RunStatusBadge` takes a `RunStatus` (with values from `audit_runs`), but here we pass `result.status` which is `"success" | "partial" | "failed"` (from `audit_results`). Map `success` → `completed` so the badge variant works as expected.

- [ ] **Step 2: Create `src/components/issue-list.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import { Badge } from "@repo/ui/components/badge"

type Issue = {
  rule: string
  severity: "info" | "warn" | "error"
  title: string
  description: string
  recommendation: string
  count: number
}

export function IssueList({
  category,
  issues,
}: {
  category: string
  issues: unknown[]
}) {
  const typed = issues as Issue[]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base capitalize">
          Issues for {category} ({typed.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {typed.map((issue) => (
          <div key={issue.rule} className="space-y-1">
            <div className="flex items-center gap-2">
              <code className="text-sm">{issue.rule}</code>
              <Badge
                variant={
                  issue.severity === "error"
                    ? "destructive"
                    : issue.severity === "warn"
                      ? "outline"
                      : "secondary"
                }
              >
                {issue.severity}
              </Badge>
              {issue.count > 1 ? (
                <span className="text-xs text-muted-foreground">×{issue.count}</span>
              ) : null}
            </div>
            <p className="text-sm font-medium">{issue.title}</p>
            <p className="text-sm text-muted-foreground">{issue.description}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Fix:</span> {issue.recommendation}
            </p>
          </div>
        ))}
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
git add apps/app/src/components/category-score-card.tsx apps/app/src/components/issue-list.tsx
git commit -m "feat(app): add CategoryScoreCard + IssueList for run detail view"
```

---

## Task 17: README + DoD validation

**Files:**
- Create: `apps/app/README.md`

- [ ] **Step 1: Create `apps/app/README.md`**

Save this content as the README:

```markdown
# @repo/app

The single-site dashboard. Next.js 16 App Router. Authenticates via Supabase, lets the user add their site, trigger audits, and watch results stream in via Realtime.

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

## Architecture

- **Auth:** `@supabase/ssr` middleware refreshes the session cookie on every request and gates protected routes. Sign-in / sign-up forms are custom (react-hook-form + zod) using `@supabase/supabase-js`'s browser client.
- **Reads:** All data reads go through `@supabase/supabase-js` (PostgREST). Drizzle types (`Site`, `AuditRun`, `AuditResultRow`) are reused for casting but the runtime client is Supabase JS.
- **Mutations:** Next.js Server Actions construct an authenticated server-side Supabase client from cookies and `.insert()` directly. RLS auto-enforces. The `audit_runs` insert fires slice 3's pgmq trigger; the runner picks up the job.
- **Realtime:** Client components use `useRealtimeRuns` (dashboard) and `useRealtimeRun` (per-run page) hooks that subscribe to `postgres_changes` on the relevant tables. RLS gates events server-side.

## Design doc

See [`docs/plans/2026-06-04-slice4-dashboard-design.md`](../../docs/plans/2026-06-04-slice4-dashboard-design.md).
```

- [ ] **Step 2: Full DoD sweep**

Run each command and verify:

```bash
# 1. Build + typecheck
bun --filter @repo/app build
bun --filter @repo/app check-types

# 2. Unit tests
bun --filter @repo/app test
# Expected: ~15 tests pass (format + schemas + addSiteAction + runAuditAction)

# 3. Boot the dev server (manually)
bun --filter @repo/app dev
# Visit http://app.localhost:3001 — should redirect to /sign-in

# 4. Manual smoke checklist (from README, steps 5-11)
#    — requires a running Supabase + runner
```

Document each result.

- [ ] **Step 3: Commit**

```bash
git add apps/app/README.md
git commit -m "docs(app): README with dev loop, scripts, and smoke checklist"
```

## Report Format

(For the implementer to fill in after T17.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | ... |
  | 2 | `bun --filter @repo/app check-types` clean | ... |
  | 3 | `bun --filter @repo/app test` — ~15 tests | ... |
  | 4 | Dev server boots on `app.localhost:3001` | ... |
  | 5 | Middleware redirects unauthed `/dashboard` to `/sign-in` | ... |
  | 6 | Middleware redirects authed `/sign-in` to `/dashboard` | ... |
  | 7 | Sign-up → /onboarding | ... |
  | 8 | Onboarding → /dashboard | ... |
  | 9 | "Run new audit" → /dashboard/runs/[id] | ... |
  | 10 | Realtime fills in 5 category cards | ... |
  | 11 | `<SignOutButton>` redirects to /sign-in | ... |
- Total test count
- Commit SHA list
- One-line slice 4 release note

---

## After slice 4

Slice 5 (multi-site + competitor view) extends what this ships:
- Allow `is_competitor=true` rows alongside the single self-site (the partial unique index already permits this).
- Add a sub-page or modal for competitor management (add/remove).
- Add a radar chart (`recharts` already in catalog) plotting the user's site + competitors across the 5 categories.
- Add a trends view across multiple runs over time per category.

The Server Action + Realtime + Supabase-JS patterns built in this slice are the foundation slice 5 extends without significant refactor.
