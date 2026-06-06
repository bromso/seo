# Auth: URL-driven steps + OAuth providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the email step at `/sign-in` and `/sign-up` URL-addressable, and wire Google / Microsoft / GitHub through Supabase OAuth end to end. Apple and passkey remain UI-only.

**Architecture:** Sub-routes (`/sign-in/email`, `/sign-up/email`) replace the local `useState("providers"|"email")` toggle. Each real provider button becomes a `<form action={startOAuthAction.bind(null, provider)}>` server-action form. `/auth/callback` exchanges the OAuth `code` for a session and routes new accounts (no `sites` rows) to `/onboarding`, returning to `/dashboard`. Errors from the action or callback redirect to `/sign-in?error=<code>` where a tiny client component fires a Sonner toast and strips the param.

**Tech Stack:** Next.js 16 App Router, Server Actions, Supabase JS (`@supabase/ssr`), React Hook Form + Zod (existing), Sonner (existing), vitest + happy-dom + @testing-library/react for tests.

**Spec:** `docs/superpowers/specs/2026-06-06-auth-oauth-routing-design.md`.

**Conventions the implementer must follow:**
- Always run lint-staged via the commit hook. **Never** use `--no-verify`.
- Commit messages: Conventional Commits (`feat(app):`, `fix(app):`, `refactor(app):`, `test(app):`, `docs(auth):`, `chore(app):`). Subject ≤ 72 chars, body wrapped at 72.
- Bun + Turborepo runners: `bun --filter @repo/app test`, `bun --filter @repo/app check-types`, `bun --filter @repo/app lint`, `bun --filter @repo/app build`.
- Run tests after every implementation step. Keep tests green between commits.
- The codebase uses Biome (2-space indent, double quotes, no semicolons except where Biome inserts them on `as`/`type` collisions, 100-char line). Biome auto-formats on commit; don't fight it.
- All imports use `@/` for app-local paths and `@repo/ui/...` for shared UI.
- Use the `Skill` tool to invoke `superpowers:test-driven-development` for the discipline reminders if you drift.

---

## File Structure

**New files (production):**
- `apps/app/src/components/sign-in-email-form.tsx` — extracted client form (email + password + Supabase password sign-in).
- `apps/app/src/components/sign-up-email-form.tsx` — extracted client form (display name + email + password + Supabase sign-up).
- `apps/app/src/components/auth-error-toast.tsx` — client `useEffect` reads `?error=`, fires toast, replaces URL.
- `apps/app/src/components/oauth-provider-form.tsx` — server component, wraps `<AuthProviderButton type="submit">` in a `<form action>` bound to a provider.
- `apps/app/src/app/(auth)/auth/start/actions.ts` — `"use server"` module exporting `startOAuthAction(provider)`.
- `apps/app/src/app/(auth)/sign-in/email/page.tsx` — renders `AuthShell` + `<SignInEmailForm>` + footer link.
- `apps/app/src/app/(auth)/sign-up/email/page.tsx` — renders `AuthShell` + `<SignUpEmailForm>` + footer link.

**Modified files (production):**
- `apps/app/src/middleware.ts` — widen `isAuthRoute` to cover `/sign-in/*` and `/sign-up/*`.
- `apps/app/src/components/provider-icons.tsx` — add `GitHubMark`.
- `apps/app/src/app/(auth)/sign-in/page.tsx` — render the provider list inline; email button becomes `<Link>`; OAuth buttons become `<OAuthProviderForm>`; mount `<AuthErrorToast>`.
- `apps/app/src/app/(auth)/sign-up/page.tsx` — same structure as sign-in.
- `apps/app/src/app/(auth)/auth/callback/route.ts` — replace 501 stub with the full callback.

**Deleted files:**
- `apps/app/src/views/sign-in-view.tsx`
- `apps/app/src/views/sign-up-view.tsx`

**New files (tests):**
- `apps/app/src/test/middleware-auth-routes.test.ts`
- `apps/app/src/test/components/auth-error-toast.test.tsx`
- `apps/app/src/test/components/oauth-provider-form.test.tsx`
- `apps/app/src/test/auth/start-oauth.test.ts`
- `apps/app/src/test/auth/callback.test.ts`
- `apps/app/src/test/auth/email-step-pages.test.tsx`

**New files (docs):**
- `docs/auth-providers.md` — provider registration reference.

---

## Task 1: Widen middleware so sub-routes don't bounce to /sign-in

**Files:**
- Modify: `apps/app/src/middleware.ts`
- Test: `apps/app/src/test/middleware-auth-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/test/middleware-auth-routes.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}))

describe("middleware auth route classification", () => {
  it("treats /sign-in/email as a public auth route (no redirect for anonymous user)", async () => {
    const { middleware } = await import("@/middleware")
    const req = new Request("http://app.localhost:3001/sign-in/email") as Parameters<
      typeof middleware
    >[0]
    // NextRequest exposes nextUrl; happy-path: provide a minimal shim
    Object.defineProperty(req, "nextUrl", {
      value: new URL("http://app.localhost:3001/sign-in/email"),
    })
    Object.defineProperty(req, "cookies", {
      value: { getAll: () => [] },
    })

    const res = await middleware(req)
    // A pass-through (no redirect) returns status 200, redirect returns 307.
    expect(res.status).toBe(200)
  })

  it("treats /sign-up/email the same", async () => {
    const { middleware } = await import("@/middleware")
    const req = new Request("http://app.localhost:3001/sign-up/email") as Parameters<
      typeof middleware
    >[0]
    Object.defineProperty(req, "nextUrl", {
      value: new URL("http://app.localhost:3001/sign-up/email"),
    })
    Object.defineProperty(req, "cookies", {
      value: { getAll: () => [] },
    })

    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it("still redirects /dashboard for anonymous users", async () => {
    const { middleware } = await import("@/middleware")
    const req = new Request("http://app.localhost:3001/dashboard") as Parameters<
      typeof middleware
    >[0]
    Object.defineProperty(req, "nextUrl", {
      value: new URL("http://app.localhost:3001/dashboard"),
    })
    Object.defineProperty(req, "cookies", {
      value: { getAll: () => [] },
    })

    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/sign-in")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/app test middleware-auth-routes`
Expected: FAIL — the first two cases redirect because `path === "/sign-in"` doesn't match `/sign-in/email`.

- [ ] **Step 3: Widen the `isAuthRoute` check**

Edit `apps/app/src/middleware.ts`. Replace the `isAuthRoute` line:

```ts
const isAuthRoute =
  path === "/sign-in" ||
  path === "/sign-up" ||
  path.startsWith("/sign-in/") ||
  path.startsWith("/sign-up/") ||
  path.startsWith("/auth/")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --filter @repo/app test middleware-auth-routes`
Expected: PASS all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/middleware.ts apps/app/src/test/middleware-auth-routes.test.ts
git commit -m "feat(app): allow auth sub-routes through middleware"
```

---

## Task 2: Add GitHubMark icon

**Files:**
- Modify: `apps/app/src/components/provider-icons.tsx`

No test — icon components are pure SVG with no behavior to verify.

- [ ] **Step 1: Add the GitHubMark export**

Append to `apps/app/src/components/provider-icons.tsx`:

```tsx
export function GitHubMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      role="img"
    >
      <title>GitHub</title>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.26 3.34.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 015.79 0c2.21-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.12 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.26 5.68.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.79.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  )
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `bun --filter @repo/app check-types`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/provider-icons.tsx
git commit -m "feat(app): add GitHubMark provider icon"
```

---

## Task 3: Extract `<SignInEmailForm>` from sign-in-view

**Files:**
- Create: `apps/app/src/components/sign-in-email-form.tsx`
- Delete (later, in Task 7): `apps/app/src/views/sign-in-view.tsx`

This is a pure refactor — no behavior change, no tests yet (existing email flow has no automated tests).

- [ ] **Step 1: Create the new component**

Create `apps/app/src/components/sign-in-email-form.tsx`:

```tsx
"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { ArrowLeftMark } from "@/components/provider-icons"
import { type SignInInput, SignInSchema } from "@/lib/schemas"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function SignInEmailForm() {
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Link
        href="/sign-in"
        className="self-start inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary transition-colors duration-75"
      >
        <ArrowLeftMark size={12} />
        Login options
      </Link>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-[13px] text-ink-secondary">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="h-11 text-[14.5px]"
          {...form.register("email")}
        />
        {form.formState.errors.email ? (
          <p className="text-[12px] text-status-failure">
            {form.formState.errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-[13px] text-ink-secondary">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          className="h-11 text-[14.5px]"
          {...form.register("password")}
        />
        {form.formState.errors.password ? (
          <p className="text-[12px] text-status-failure">
            {form.formState.errors.password.message}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="h-11 w-full bg-brand-accent text-brand-accent-ink hover:brightness-105 disabled:opacity-60"
      >
        {form.formState.isSubmitting ? "Signing in…" : "Continue"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `bun --filter @repo/app check-types`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/sign-in-email-form.tsx
git commit -m "refactor(app): extract SignInEmailForm component"
```

---

## Task 4: Extract `<SignUpEmailForm>` from sign-up-view

**Files:**
- Create: `apps/app/src/components/sign-up-email-form.tsx`
- Delete (later, in Task 8): `apps/app/src/views/sign-up-view.tsx`

- [ ] **Step 1: Create the new component**

Create `apps/app/src/components/sign-up-email-form.tsx`:

```tsx
"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { ArrowLeftMark } from "@/components/provider-icons"
import { type SignUpInput, SignUpSchema } from "@/lib/schemas"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function SignUpEmailForm() {
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Link
        href="/sign-up"
        className="self-start inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary transition-colors duration-75"
      >
        <ArrowLeftMark size={12} />
        Sign-up options
      </Link>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName" className="text-[13px] text-ink-secondary">
          Display name <span className="text-ink-tertiary">(optional)</span>
        </Label>
        <Input
          id="displayName"
          type="text"
          autoComplete="name"
          placeholder="Jane Smith"
          className="h-11 text-[14.5px]"
          {...form.register("displayName")}
        />
        {form.formState.errors.displayName ? (
          <p className="text-[12px] text-status-failure">
            {form.formState.errors.displayName.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-[13px] text-ink-secondary">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="h-11 text-[14.5px]"
          {...form.register("email")}
        />
        {form.formState.errors.email ? (
          <p className="text-[12px] text-status-failure">
            {form.formState.errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-[13px] text-ink-secondary">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          className="h-11 text-[14.5px]"
          {...form.register("password")}
        />
        {form.formState.errors.password ? (
          <p className="text-[12px] text-status-failure">
            {form.formState.errors.password.message}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="h-11 w-full bg-brand-accent text-brand-accent-ink hover:brightness-105 disabled:opacity-60"
      >
        {form.formState.isSubmitting ? "Creating account…" : "Create account"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `bun --filter @repo/app check-types`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/sign-up-email-form.tsx
git commit -m "refactor(app): extract SignUpEmailForm component"
```

---

## Task 5: Add `/sign-in/email` and `/sign-up/email` routes

**Files:**
- Create: `apps/app/src/app/(auth)/sign-in/email/page.tsx`
- Create: `apps/app/src/app/(auth)/sign-up/email/page.tsx`
- Test: `apps/app/src/test/auth/email-step-pages.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/test/auth/email-step-pages.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/lib/supabase-browser", () => ({
  createBrowserSupabase: () => ({ auth: { signInWithPassword: vi.fn(), signUp: vi.fn() } }),
}))

afterEach(() => {
  cleanup()
})

describe("/sign-in/email page", () => {
  it("renders the email + password form and a back link to /sign-in", async () => {
    const { default: Page } = await import("@/app/(auth)/sign-in/email/page")
    render(Page())
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByLabelText(/password/i)).toBeDefined()
    const back = screen.getByRole("link", { name: /login options/i })
    expect(back.getAttribute("href")).toBe("/sign-in")
  })
})

describe("/sign-up/email page", () => {
  it("renders display name + email + password and a back link to /sign-up", async () => {
    const { default: Page } = await import("@/app/(auth)/sign-up/email/page")
    render(Page())
    expect(screen.getByLabelText(/display name/i)).toBeDefined()
    expect(screen.getByLabelText(/^email/i)).toBeDefined()
    expect(screen.getByLabelText(/password/i)).toBeDefined()
    const back = screen.getByRole("link", { name: /sign-up options/i })
    expect(back.getAttribute("href")).toBe("/sign-up")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/app test email-step-pages`
Expected: FAIL — pages don't exist yet.

- [ ] **Step 3: Create the sign-in/email page**

Create `apps/app/src/app/(auth)/sign-in/email/page.tsx`:

```tsx
import Link from "next/link"
import { AuthShell } from "@/components/auth-shell"
import { SignInEmailForm } from "@/components/sign-in-email-form"

export const metadata = { title: "Log in" }

export default function SignInEmailPage() {
  return (
    <AuthShell
      title="Log in"
      footer={
        <>
          Don't have an account?{" "}
          <Link
            href="/sign-up"
            className="text-ink-primary underline decoration-border-strong underline-offset-4 hover:decoration-ink-primary"
          >
            Sign up
          </Link>
        </>
      }
    >
      <SignInEmailForm />
    </AuthShell>
  )
}
```

- [ ] **Step 4: Create the sign-up/email page**

Create `apps/app/src/app/(auth)/sign-up/email/page.tsx`:

```tsx
import Link from "next/link"
import { AuthShell } from "@/components/auth-shell"
import { SignUpEmailForm } from "@/components/sign-up-email-form"

export const metadata = { title: "Sign up" }

export default function SignUpEmailPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start auditing in under a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="text-ink-primary underline decoration-border-strong underline-offset-4 hover:decoration-ink-primary"
          >
            Log in
          </Link>
        </>
      }
    >
      <SignUpEmailForm />
    </AuthShell>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun --filter @repo/app test email-step-pages`
Expected: PASS both cases.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/app/\(auth\)/sign-in/email apps/app/src/app/\(auth\)/sign-up/email apps/app/src/test/auth/email-step-pages.test.tsx
git commit -m "feat(app): add /sign-in/email and /sign-up/email routes"
```

---

## Task 6: Build `<AuthErrorToast>` component

**Files:**
- Create: `apps/app/src/components/auth-error-toast.tsx`
- Test: `apps/app/src/test/components/auth-error-toast.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/test/components/auth-error-toast.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const replaceSpy = vi.fn()
const toastErrorSpy = vi.fn()
let currentSearch = ""

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceSpy }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}))
vi.mock("sonner", () => ({ toast: { error: toastErrorSpy } }))

beforeEach(() => {
  replaceSpy.mockClear()
  toastErrorSpy.mockClear()
  currentSearch = ""
})
afterEach(() => cleanup())

describe("AuthErrorToast", () => {
  it("renders null", async () => {
    const { AuthErrorToast } = await import("@/components/auth-error-toast")
    const { container } = render(<AuthErrorToast />)
    expect(container.innerHTML).toBe("")
  })

  it("fires the mapped toast and strips the param when ?error=access_denied", async () => {
    currentSearch = "error=access_denied"
    const { AuthErrorToast } = await import("@/components/auth-error-toast")
    render(<AuthErrorToast />)
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith("Sign-in cancelled."))
    expect(replaceSpy).toHaveBeenCalledWith("?")
  })

  it("falls back to a generic message for unknown codes", async () => {
    currentSearch = "error=mystery_failure"
    const { AuthErrorToast } = await import("@/components/auth-error-toast")
    render(<AuthErrorToast />)
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith("Sign-in failed. Try again."))
  })

  it("does not fire when there is no error param", async () => {
    currentSearch = ""
    const { AuthErrorToast } = await import("@/components/auth-error-toast")
    render(<AuthErrorToast />)
    // Wait one tick to let useEffect run
    await waitFor(() => expect(replaceSpy).not.toHaveBeenCalled())
    expect(toastErrorSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/app test auth-error-toast`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/app/src/components/auth-error-toast.tsx`:

```tsx
"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { toast } from "sonner"

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in cancelled.",
  missing_code: "Sign-in didn't complete. Try again.",
  oauth_unavailable: "That provider isn't available right now.",
}

export function AuthErrorToast() {
  const router = useRouter()
  const params = useSearchParams()
  const error = params.get("error")

  useEffect(() => {
    if (!error) return
    toast.error(ERROR_MESSAGES[error] ?? "Sign-in failed. Try again.")
    const next = new URLSearchParams(params)
    next.delete("error")
    router.replace(`?${next.toString()}`)
  }, [error, params, router])

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --filter @repo/app test auth-error-toast`
Expected: PASS all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/auth-error-toast.tsx apps/app/src/test/components/auth-error-toast.test.tsx
git commit -m "feat(app): add AuthErrorToast surface"
```

---

## Task 7: Extend `<AuthProviderButton>` with `href`, then refactor `/sign-in/page.tsx`

The email row needs to navigate (`/sign-in/email`) but the surrounding provider rows are buttons. Wrapping a `<button>` in a `<Link>` renders `<a><button></button></a>` — invalid nested-interactive HTML and a React dev warning. Fix: teach `AuthProviderButton` to render a `<Link>` when given an `href`, falling back to `<button>` otherwise.

After this task `sign-in-view.tsx` is no longer used; delete it.

**Files:**
- Modify: `apps/app/src/components/auth-provider-button.tsx`
- Modify: `apps/app/src/app/(auth)/sign-in/page.tsx`
- Delete: `apps/app/src/views/sign-in-view.tsx`

No new tests — the existing `email-step-pages.test.tsx` already covers the email page; the provider list is mostly markup. The `href`-variant rendering is exercised indirectly by the visual smoke in Task 15. Adding a unit test for it would be net-noise.

- [ ] **Step 1: Extend `<AuthProviderButton>` with optional `href`**

Replace `apps/app/src/components/auth-provider-button.tsx` with:

```tsx
"use client"
import { cn } from "@repo/ui/lib/utils"
import Link from "next/link"
import type { ReactNode } from "react"

type Props = {
  label: string
  icon: ReactNode
  onClick?: () => void
  /** When provided, renders a Next `<Link>` instead of a `<button>`. */
  href?: string
  /** "primary" gets brand-accent fill; "metal" gets the subtle surface-metal style. */
  tone?: "primary" | "metal"
  disabled?: boolean
  className?: string
  type?: "button" | "submit"
}

/**
 * Single-row auth provider button. 44px tall, icon on the left, label
 * optically centered (the icon's width is reserved on the right via a
 * spacer so the label sits in the visual middle). Renders a `<Link>`
 * when `href` is present, otherwise a `<button>`.
 */
export function AuthProviderButton({
  label,
  icon,
  onClick,
  href,
  tone = "metal",
  disabled,
  className,
  type = "button",
}: Props) {
  const base =
    "group relative inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg px-4 text-[14.5px] font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-60"
  const tonal =
    tone === "primary"
      ? "bg-brand-accent text-brand-accent-ink hover:brightness-105"
      : "surface-metal surface-metal-interactive text-ink-primary"

  const inner = (
    <>
      <span className="absolute left-4 inline-flex shrink-0 items-center">{icon}</span>
      <span className="text-pretty">{label}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={cn(base, tonal, className)}>
        {inner}
      </Link>
    )
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(base, tonal, className)}
    >
      {inner}
    </button>
  )
}
```

- [ ] **Step 2: Replace the sign-in page**

Rewrite `apps/app/src/app/(auth)/sign-in/page.tsx`:

```tsx
import Link from "next/link"
import { AuthErrorToast } from "@/components/auth-error-toast"
import { AuthProviderButton } from "@/components/auth-provider-button"
import { AuthShell } from "@/components/auth-shell"
import {
  AppleMark,
  GitHubMark,
  GoogleMark,
  MailMark,
  MicrosoftMark,
  PasskeyMark,
} from "@/components/provider-icons"

export const metadata = { title: "Log in" }

export default function SignInPage() {
  return (
    <AuthShell
      title="Log in"
      footer={
        <>
          Don't have an account?{" "}
          <Link
            href="/sign-up"
            className="text-ink-primary underline decoration-border-strong underline-offset-4 hover:decoration-ink-primary"
          >
            Sign up
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {/* OAuth provider forms get added in Task 11. Placeholders preserve layout. */}
        <AuthProviderButton tone="primary" label="Continue with Google" icon={<GoogleMark />} />
        <AuthProviderButton label="Continue with Apple" icon={<AppleMark />} />
        <AuthProviderButton label="Continue with Microsoft" icon={<MicrosoftMark />} />
        <AuthProviderButton label="Continue with GitHub" icon={<GitHubMark />} />

        <div className="my-1 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-ink-tertiary">
          <span className="h-px flex-1 bg-border-subtle" />
          or
          <span className="h-px flex-1 bg-border-subtle" />
        </div>

        <AuthProviderButton
          href="/sign-in/email"
          label="Continue with email"
          icon={<MailMark />}
        />
        <AuthProviderButton label="Sign in with a passkey" icon={<PasskeyMark />} />
      </div>
      <AuthErrorToast />
    </AuthShell>
  )
}
```

- [ ] **Step 3: Delete the obsolete view file**

```bash
rm apps/app/src/views/sign-in-view.tsx
```

- [ ] **Step 4: Verify typecheck + tests**

Run: `bun --filter @repo/app check-types && bun --filter @repo/app test`
Expected: typecheck exit 0; tests all green.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/auth-provider-button.tsx apps/app/src/app/\(auth\)/sign-in/page.tsx apps/app/src/views/sign-in-view.tsx
git commit -m "refactor(app): inline sign-in provider list, drop sign-in-view"
```

---

## Task 8: Refactor `/sign-up/page.tsx` symmetrically

**Files:**
- Modify: `apps/app/src/app/(auth)/sign-up/page.tsx`
- Delete: `apps/app/src/views/sign-up-view.tsx`

- [ ] **Step 1: Replace the sign-up page**

Rewrite `apps/app/src/app/(auth)/sign-up/page.tsx`:

```tsx
import Link from "next/link"
import { AuthErrorToast } from "@/components/auth-error-toast"
import { AuthProviderButton } from "@/components/auth-provider-button"
import { AuthShell } from "@/components/auth-shell"
import {
  AppleMark,
  GitHubMark,
  GoogleMark,
  MailMark,
  MicrosoftMark,
} from "@/components/provider-icons"

export const metadata = { title: "Sign up" }

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start auditing in under a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="text-ink-primary underline decoration-border-strong underline-offset-4 hover:decoration-ink-primary"
          >
            Log in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {/* OAuth provider forms get added in Task 12. Placeholders preserve layout. */}
        <AuthProviderButton tone="primary" label="Sign up with Google" icon={<GoogleMark />} />
        <AuthProviderButton label="Sign up with Apple" icon={<AppleMark />} />
        <AuthProviderButton label="Sign up with Microsoft" icon={<MicrosoftMark />} />
        <AuthProviderButton label="Sign up with GitHub" icon={<GitHubMark />} />

        <div className="my-1 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-ink-tertiary">
          <span className="h-px flex-1 bg-border-subtle" />
          or
          <span className="h-px flex-1 bg-border-subtle" />
        </div>

        <AuthProviderButton
          href="/sign-up/email"
          label="Sign up with email"
          icon={<MailMark />}
        />
      </div>
      <AuthErrorToast />
    </AuthShell>
  )
}
```

- [ ] **Step 2: Delete the obsolete view file**

```bash
rm apps/app/src/views/sign-up-view.tsx
```

- [ ] **Step 3: Verify typecheck + tests**

Run: `bun --filter @repo/app check-types && bun --filter @repo/app test`
Expected: typecheck exit 0; tests all green.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/app/\(auth\)/sign-up/page.tsx apps/app/src/views/sign-up-view.tsx
git commit -m "refactor(app): inline sign-up provider list, drop sign-up-view"
```

---

## Task 9: `startOAuthAction` server action

**Files:**
- Create: `apps/app/src/app/(auth)/auth/start/actions.ts`
- Test: `apps/app/src/test/auth/start-oauth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/test/auth/start-oauth.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const signInWithOAuthSpy = vi.fn()
const redirectSpy = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`)
})

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { signInWithOAuth: signInWithOAuthSpy },
  })),
}))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "http://app.localhost:3001" })),
}))
vi.mock("next/navigation", () => ({
  redirect: redirectSpy,
}))

beforeEach(() => {
  signInWithOAuthSpy.mockReset()
  redirectSpy.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe("startOAuthAction", () => {
  it("calls signInWithOAuth with the right provider and a redirectTo derived from the Origin", async () => {
    signInWithOAuthSpy.mockResolvedValueOnce({ data: { url: "https://google.com/oauth?x=1" } })
    const { startOAuthAction } = await import("@/app/(auth)/auth/start/actions")

    await expect(startOAuthAction("google")).rejects.toThrow(
      "__REDIRECT__:https://google.com/oauth?x=1"
    )
    expect(signInWithOAuthSpy).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://app.localhost:3001/auth/callback", scopes: undefined },
    })
  })

  it("passes GitHub scopes when provider is github", async () => {
    signInWithOAuthSpy.mockResolvedValueOnce({ data: { url: "https://github.com/oauth" } })
    const { startOAuthAction } = await import("@/app/(auth)/auth/start/actions")

    await expect(startOAuthAction("github")).rejects.toThrow("__REDIRECT__:")
    expect(signInWithOAuthSpy).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: "http://app.localhost:3001/auth/callback",
        scopes: "read:user user:email",
      },
    })
  })

  it("redirects to /sign-in?error=... when the SDK returns an error", async () => {
    signInWithOAuthSpy.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    const { startOAuthAction } = await import("@/app/(auth)/auth/start/actions")

    await expect(startOAuthAction("azure")).rejects.toThrow("__REDIRECT__:/sign-in?error=boom")
  })

  it("redirects to /sign-in?error=oauth_unavailable when data.url is missing without an error", async () => {
    signInWithOAuthSpy.mockResolvedValueOnce({ data: { url: null } })
    const { startOAuthAction } = await import("@/app/(auth)/auth/start/actions")

    await expect(startOAuthAction("azure")).rejects.toThrow(
      "__REDIRECT__:/sign-in?error=oauth_unavailable"
    )
  })
})
```

> Why throw inside the `redirect` mock? `next/navigation`'s `redirect` throws a special error to short-circuit React rendering. Mocking it to throw lets us assert the URL via the thrown message without rendering anything.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/app test start-oauth`
Expected: FAIL — action does not exist.

- [ ] **Step 3: Implement the action**

Create `apps/app/src/app/(auth)/auth/start/actions.ts`:

```ts
"use server"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createServerSupabase } from "@/lib/supabase-server"

export type OAuthProvider = "google" | "azure" | "github"

export async function startOAuthAction(provider: OAuthProvider) {
  const supabase = await createServerSupabase()
  const origin = (await headers()).get("origin") ?? "http://app.localhost:3001"

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: provider === "github" ? "read:user user:email" : undefined,
    },
  })

  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}`)
  }
  if (!data?.url) {
    redirect("/sign-in?error=oauth_unavailable")
  }
  redirect(data.url)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --filter @repo/app test start-oauth`
Expected: PASS all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(auth\)/auth/start apps/app/src/test/auth/start-oauth.test.ts
git commit -m "feat(app): startOAuthAction server action"
```

---

## Task 10: `<OAuthProviderForm>` server component

**Files:**
- Create: `apps/app/src/components/oauth-provider-form.tsx`
- Test: `apps/app/src/test/components/oauth-provider-form.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/test/components/oauth-provider-form.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Mock the server action module so the bound action is a stable, identifiable fn.
const startOAuthActionSpy = vi.fn()
vi.mock("@/app/(auth)/auth/start/actions", () => ({
  startOAuthAction: startOAuthActionSpy,
}))

afterEach(() => cleanup())

describe("OAuthProviderForm", () => {
  it("renders a form whose button submits with the right provider label", async () => {
    const { OAuthProviderForm } = await import("@/components/oauth-provider-form")
    render(
      <OAuthProviderForm provider="google" label="Continue with Google" icon={<span data-icon />} />
    )
    const button = screen.getByRole("button", { name: /continue with google/i })
    expect(button.getAttribute("type")).toBe("submit")
    const form = button.closest("form")
    expect(form).not.toBeNull()
  })

  it("forwards tone='primary' to the underlying button", async () => {
    const { OAuthProviderForm } = await import("@/components/oauth-provider-form")
    render(
      <OAuthProviderForm
        provider="github"
        label="Continue with GitHub"
        icon={<span />}
        tone="primary"
      />
    )
    const button = screen.getByRole("button", { name: /continue with github/i })
    // primary tone applies bg-brand-accent class
    expect(button.className).toMatch(/bg-brand-accent/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/app test oauth-provider-form`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/app/src/components/oauth-provider-form.tsx`:

```tsx
import type { ReactNode } from "react"
import {
  startOAuthAction,
  type OAuthProvider,
} from "@/app/(auth)/auth/start/actions"
import { AuthProviderButton } from "@/components/auth-provider-button"

type Props = {
  provider: OAuthProvider
  label: string
  icon: ReactNode
  tone?: "primary" | "metal"
}

export function OAuthProviderForm({ provider, label, icon, tone }: Props) {
  const action = startOAuthAction.bind(null, provider)
  return (
    <form action={action}>
      <AuthProviderButton type="submit" tone={tone} label={label} icon={icon} />
    </form>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --filter @repo/app test oauth-provider-form`
Expected: PASS both cases.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/oauth-provider-form.tsx apps/app/src/test/components/oauth-provider-form.test.tsx
git commit -m "feat(app): OAuthProviderForm wraps provider button in a form"
```

---

## Task 11: Wire OAuth provider forms into `/sign-in`

**Files:**
- Modify: `apps/app/src/app/(auth)/sign-in/page.tsx`

No new test — the wiring is markup and the underlying form is covered by `oauth-provider-form.test.tsx`.

- [ ] **Step 1: Replace the OAuth button placeholders with `<OAuthProviderForm>`**

Rewrite `apps/app/src/app/(auth)/sign-in/page.tsx`:

```tsx
import Link from "next/link"
import { AuthErrorToast } from "@/components/auth-error-toast"
import { AuthProviderButton } from "@/components/auth-provider-button"
import { AuthShell } from "@/components/auth-shell"
import { OAuthProviderForm } from "@/components/oauth-provider-form"
import {
  AppleMark,
  GitHubMark,
  GoogleMark,
  MailMark,
  MicrosoftMark,
  PasskeyMark,
} from "@/components/provider-icons"

export const metadata = { title: "Log in" }

export default function SignInPage() {
  return (
    <AuthShell
      title="Log in"
      footer={
        <>
          Don't have an account?{" "}
          <Link
            href="/sign-up"
            className="text-ink-primary underline decoration-border-strong underline-offset-4 hover:decoration-ink-primary"
          >
            Sign up
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <OAuthProviderForm
          provider="google"
          tone="primary"
          label="Continue with Google"
          icon={<GoogleMark />}
        />
        <AuthProviderButton label="Continue with Apple" icon={<AppleMark />} />
        <OAuthProviderForm
          provider="azure"
          label="Continue with Microsoft"
          icon={<MicrosoftMark />}
        />
        <OAuthProviderForm
          provider="github"
          label="Continue with GitHub"
          icon={<GitHubMark />}
        />

        <div className="my-1 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-ink-tertiary">
          <span className="h-px flex-1 bg-border-subtle" />
          or
          <span className="h-px flex-1 bg-border-subtle" />
        </div>

        <AuthProviderButton
          href="/sign-in/email"
          label="Continue with email"
          icon={<MailMark />}
        />
        <AuthProviderButton label="Sign in with a passkey" icon={<PasskeyMark />} />
      </div>
      <AuthErrorToast />
    </AuthShell>
  )
}
```

- [ ] **Step 2: Verify typecheck + tests**

Run: `bun --filter @repo/app check-types && bun --filter @repo/app test`
Expected: both green.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/app/\(auth\)/sign-in/page.tsx
git commit -m "feat(app): wire Google/Microsoft/GitHub on /sign-in"
```

---

## Task 12: Wire OAuth provider forms into `/sign-up`

**Files:**
- Modify: `apps/app/src/app/(auth)/sign-up/page.tsx`

- [ ] **Step 1: Replace the OAuth button placeholders with `<OAuthProviderForm>`**

Rewrite `apps/app/src/app/(auth)/sign-up/page.tsx`:

```tsx
import Link from "next/link"
import { AuthErrorToast } from "@/components/auth-error-toast"
import { AuthProviderButton } from "@/components/auth-provider-button"
import { AuthShell } from "@/components/auth-shell"
import { OAuthProviderForm } from "@/components/oauth-provider-form"
import {
  AppleMark,
  GitHubMark,
  GoogleMark,
  MailMark,
  MicrosoftMark,
} from "@/components/provider-icons"

export const metadata = { title: "Sign up" }

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start auditing in under a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="text-ink-primary underline decoration-border-strong underline-offset-4 hover:decoration-ink-primary"
          >
            Log in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <OAuthProviderForm
          provider="google"
          tone="primary"
          label="Sign up with Google"
          icon={<GoogleMark />}
        />
        <AuthProviderButton label="Sign up with Apple" icon={<AppleMark />} />
        <OAuthProviderForm
          provider="azure"
          label="Sign up with Microsoft"
          icon={<MicrosoftMark />}
        />
        <OAuthProviderForm
          provider="github"
          label="Sign up with GitHub"
          icon={<GitHubMark />}
        />

        <div className="my-1 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-ink-tertiary">
          <span className="h-px flex-1 bg-border-subtle" />
          or
          <span className="h-px flex-1 bg-border-subtle" />
        </div>

        <AuthProviderButton
          href="/sign-up/email"
          label="Sign up with email"
          icon={<MailMark />}
        />
      </div>
      <AuthErrorToast />
    </AuthShell>
  )
}
```

- [ ] **Step 2: Verify typecheck + tests**

Run: `bun --filter @repo/app check-types && bun --filter @repo/app test`
Expected: both green.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/app/\(auth\)/sign-up/page.tsx
git commit -m "feat(app): wire Google/Microsoft/GitHub on /sign-up"
```

---

## Task 13: `/auth/callback` GET — exchange code, route by `sites` count

**Files:**
- Modify: `apps/app/src/app/(auth)/auth/callback/route.ts`
- Test: `apps/app/src/test/auth/callback.test.ts`

- [ ] **Step 1: Write the failing test (six cases)**

Create `apps/app/src/test/auth/callback.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const exchangeCodeForSessionSpy = vi.fn()
const sitesSelectSpy = vi.fn()

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionSpy },
    from: () => ({ select: sitesSelectSpy }),
  })),
}))

beforeEach(() => {
  exchangeCodeForSessionSpy.mockReset()
  sitesSelectSpy.mockReset()
})
afterEach(() => vi.restoreAllMocks())

async function callGet(url: string) {
  const { GET } = await import("@/app/(auth)/auth/callback/route")
  return GET(new Request(url))
}

describe("/auth/callback GET", () => {
  it("(a) forwards provider error to /sign-in?error=access_denied", async () => {
    const res = await callGet("http://app.localhost:3001/auth/callback?error=access_denied")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/sign-in?error=access_denied")
  })

  it("(b) redirects to /sign-in?error=missing_code when code is absent", async () => {
    const res = await callGet("http://app.localhost:3001/auth/callback")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/sign-in?error=missing_code")
  })

  it("(c) forwards exchangeCodeForSession error to /sign-in?error=...", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: { message: "bad code" } })
    const res = await callGet("http://app.localhost:3001/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "http://app.localhost:3001/sign-in?error=bad%20code"
    )
  })

  it("(d) success with 0 sites → /onboarding", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 0, error: null })
    const res = await callGet("http://app.localhost:3001/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/onboarding")
  })

  it("(e) success with >0 sites → /dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 3, error: null })
    const res = await callGet("http://app.localhost:3001/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })

  it("(f) success with count query error → defaults to /dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: null, error: { message: "rls" } })
    const res = await callGet("http://app.localhost:3001/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/app test auth/callback`
Expected: FAIL — current `route.ts` returns a 501.

- [ ] **Step 3: Implement the handler**

Replace `apps/app/src/app/(auth)/auth/callback/route.ts` with:

```ts
import { NextResponse } from "next/server"
import { createServerSupabase } from "@/lib/supabase-server"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const errorParam = url.searchParams.get("error")

  if (errorParam) {
    return NextResponse.redirect(new URL(`/sign-in?error=${errorParam}`, url))
  }
  if (!code) {
    return NextResponse.redirect(new URL("/sign-in?error=missing_code", url))
  }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, url)
    )
  }

  const { count, error: countError } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })

  // Default to /dashboard on count-query failure so the user isn't stuck.
  const destination = !countError && (count ?? 0) === 0 ? "/onboarding" : "/dashboard"
  return NextResponse.redirect(new URL(destination, url))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --filter @repo/app test auth/callback`
Expected: PASS all 6 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(auth\)/auth/callback/route.ts apps/app/src/test/auth/callback.test.ts
git commit -m "feat(app): /auth/callback exchanges code, routes by sites count"
```

---

## Task 14: Provider setup docs

**Files:**
- Create: `docs/auth-providers.md`

No tests — pure documentation.

- [ ] **Step 1: Write the doc**

Create `docs/auth-providers.md`:

```markdown
# Auth provider setup

How to register Google, Microsoft, and GitHub OAuth apps and wire them
into the Supabase project. Apple is intentionally deferred.

## URLs you'll need

| Env | App URL | OAuth callback (Supabase) |
|---|---|---|
| Local | `http://app.localhost:3001` | `https://<project>.supabase.co/auth/v1/callback` |
| Production | `https://app.brand.com` | `https://<project>.supabase.co/auth/v1/callback` |

In Supabase (Authentication → URL Configuration → Redirect URLs), add:

- `http://app.localhost:3001/auth/callback`
- `https://app.brand.com/auth/callback` (once production exists)

Set Site URL to the production app URL.

## Google

1. https://console.cloud.google.com → APIs & Services → Credentials.
2. **Create credentials** → **OAuth client ID** → **Web application**.
3. Authorized JavaScript origins: `http://app.localhost:3001`, `https://app.brand.com`.
4. Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`.
5. Copy the **Client ID** and **Client secret**.
6. In Supabase (Authentication → Providers → Google), paste both, toggle **Enabled**.

## Microsoft (Azure AD / Entra)

1. https://portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name it (anything human-readable). Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI: **Web** → `https://<project>.supabase.co/auth/v1/callback`.
4. Register. Copy the **Application (client) ID** from the overview page.
5. **Certificates & secrets** → **New client secret** → copy the value (only shown once).
6. In Supabase (Authentication → Providers → Azure), paste both into Application ID + Client Secret, toggle **Enabled**.

## GitHub

1. https://github.com/settings/applications/new (or your org's developer settings).
2. Application name + homepage URL (the app URL).
3. Authorization callback URL: `https://<project>.supabase.co/auth/v1/callback`.
4. Register. Generate a **client secret** on the next page.
5. In Supabase (Authentication → Providers → GitHub), paste **Client ID** + **Client Secret**, toggle **Enabled**.

## Smoke check

After enabling each provider:

1. Open `http://app.localhost:3001/sign-in` in a private window.
2. Click the provider button. The consent screen should appear.
3. After consent, you should land on `/onboarding` (first sign-in) or `/dashboard` (returning).
4. Cancel at the provider → you should land back on `/sign-in` with a Sonner toast saying "Sign-in cancelled."

If you see a "redirect_uri_mismatch" error, the callback URL at the provider doesn't exactly match the one Supabase sends; copy it from Supabase Authentication → Providers and paste it verbatim.
```

- [ ] **Step 2: Commit**

```bash
git add docs/auth-providers.md
git commit -m "docs(auth): provider setup reference (Google, Microsoft, GitHub)"
```

---

## Task 15: Final integration — full gauntlet + manual smoke

This task isn't a code task; it's the gate before shipping.

- [ ] **Step 1: Run the full gauntlet**

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app lint
bun --filter @repo/app build
```

Expected: all four exit 0. If lint warns (not errors), that's fine; if it errors, fix before continuing.

- [ ] **Step 2: Visual smoke (dev server, dark mode)**

```bash
bun --filter @repo/app dev
```

Open `http://app.localhost:3001/sign-in` in a browser. Verify:

- [ ] Provider list view renders all five rows (Google primary; Apple, Microsoft, GitHub metallic; email link; passkey).
- [ ] Clicking "Continue with email" changes the URL to `/sign-in/email`.
- [ ] Browser back button returns to `/sign-in`.
- [ ] "← Login options" link returns to `/sign-in`.
- [ ] `/sign-up` and `/sign-up/email` mirror the structure.
- [ ] `http://app.localhost:3001/sign-in?error=access_denied` fires a Sonner toast and strips the param.

OAuth roundtrips require the Supabase dashboard configuration from `docs/auth-providers.md`; do those after provider creds are set.

- [ ] **Step 3: Final merge**

If on a feature branch:

```bash
git checkout main
git merge --no-ff <feature-branch> -m "Merge <feature-branch>: URL-driven auth steps + Google/Microsoft/GitHub OAuth"
git push origin main
```

---

## Spec coverage map

Every requirement in `2026-06-06-auth-oauth-routing-design.md` maps to a task above:

| Spec section | Task(s) |
|---|---|
| Routes & file structure (sub-routes) | 5, 7, 8 |
| Component refactor | 3, 4, 6, 10 |
| Middleware widening | 1 |
| GitHub icon | 2 |
| `startOAuthAction` server action | 9 |
| `<OAuthProviderForm>` wiring | 10, 11, 12 |
| `/auth/callback` handler | 13 |
| Error UX (`<AuthErrorToast>`, error map, URL stripping) | 6, 7, 8 (mount) |
| Provider dashboard setup docs | 14 |
| Automated tests (start, callback, toast, form, email step pages, middleware) | 1, 5, 6, 9, 10, 13 |
| Manual smoke checklist | 15 |
| Risks: defaults-to-dashboard on count error | 13 (case f) |
