# Auth microfrontend split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all auth surfaces from `apps/app` into a new `apps/auth` subdomain microfrontend, introduce a shared `@repo/supabase` package, and wire the two apps via a domain-level session cookie plus a `redirect_to` contract.

**Architecture:** New `@repo/supabase` package owns the `createServerSupabase` / `createBrowserSupabase` / `createMiddlewareSupabase` helpers and reads `AUTH_COOKIE_DOMAIN` (server) / `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` (browser) to set Supabase session cookies on `.brand.com` (or `.localhost` in dev). New `apps/auth` (auth.localhost:3002 / auth.brand.com) takes `/sign-in`, `/sign-up`, the email steps, `/auth/start` Server Action, and `/auth/callback`. `/auth/callback` stashes the `?redirect_to` query param in an HTTP-only `auth.redirect_to` cookie (10-min TTL), validates against an allowlist, and routes new accounts to `${NEXT_PUBLIC_APP_URL}/onboarding`, returning to the validated redirect or `/dashboard`. `apps/app/src/middleware.ts` bounces anonymous users to `${NEXT_PUBLIC_AUTH_URL}/sign-in?redirect_to=<original URL>`. Sign-out stays in apps/app; the shared `.brand.com` cookie invalidates both apps in one shot.

**Tech Stack:** Next.js 16 App Router, Server Actions, Supabase JS (`@supabase/ssr`), React Hook Form + Zod (existing), Sonner (existing), Bun + Turborepo workspace, vitest + happy-dom for tests.

**Spec:** `docs/superpowers/specs/2026-06-06-auth-microfrontend-split-design.md`.

**Conventions the implementer must follow:**
- Always run lint-staged via the commit hook. **Never** use `--no-verify`.
- Commit messages: Conventional Commits. Allowed types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Allowed scopes: `app`, `auth`, `supabase`, `repo`. Subject ≤ 72 chars.
- Bun + Turborepo runners. Filter by package name: `bun --filter @repo/app test`, `bun --filter @repo/auth check-types`, `bun --filter @repo/supabase lint`. Run the full workspace test sweep at the end of each meaningful task: `bun run test`.
- The codebase uses Biome (2-space indent, double quotes, no semicolons except where Biome inserts them, 100-char line). Biome auto-formats on commit; don't fight it.
- All app-local imports use `@/`. Workspace package imports use `@repo/<name>/<subpath>`.
- Cross-app code paths NEVER reach across `apps/*` boundaries. If two apps need the same code, it lives in `packages/*`.

---

## File Structure

**New files (production):**

`packages/supabase/`:
- `package.json` — name `@repo/supabase`, source-style exports map (no build step).
- `tsconfig.json` — extends `@repo/typescript-config/base.json`.
- `biome.json` — extends root.
- `vitest.config.ts` — node environment.
- `src/server.ts` — `createServerSupabase()` with `AUTH_COOKIE_DOMAIN` injection.
- `src/browser.ts` — `createBrowserSupabase()` with `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` injection, memoized.
- `src/middleware.ts` — `createMiddlewareSupabase(req, response)` for use inside `next/server` middlewares.
- `src/test/server.test.ts`, `src/test/browser.test.ts` — the unit tests.

`apps/auth/`:
- `package.json` — name `@repo/auth`, scripts mirror `@repo/app` with port 3002 / hostname auth.localhost.
- `tsconfig.json` — extends `@repo/typescript-config/nextjs.json`.
- `next.config.ts` — Webpack, no Serwist.
- `biome.json` — extends root.
- `postcss.config.mjs` — same as apps/app.
- `vitest.config.ts`.
- `.env.example`.
- `public/favicon.ico` (placeholder), `public/robots.txt` (`User-agent: * \n Disallow: /`).
- `src/app/layout.tsx` — Inter + JetBrains Mono via next/font, dark-by-default, Sonner toaster mount.
- `src/app/globals.css` — imports `@repo/ui/globals.css` and the auth-only surface-metal + token block.
- `src/app/page.tsx` — `redirect("/sign-in")`.
- `src/app/sign-in/page.tsx`, `src/app/sign-in/email/page.tsx` — moved from apps/app, plus `redirect_to` cookie capture on the provider list page.
- `src/app/sign-up/page.tsx`, `src/app/sign-up/email/page.tsx` — moved from apps/app, same cookie capture.
- `src/app/auth/start/actions.ts` — moved; default origin flipped to `http://auth.localhost:3002`.
- `src/app/auth/callback/route.ts` — moved; reads `auth.redirect_to` cookie, validates, redirects to `${NEXT_PUBLIC_APP_URL}/{onboarding,dashboard}` or the validated `redirect_to`.
- `src/components/{auth-shell,auth-provider-button,auth-error-toast,oauth-provider-form,provider-icons,sign-in-email-form,sign-up-email-form}.tsx` — moved.
- `src/lib/schemas.ts` — `SignInSchema`, `SignUpSchema` (extracted from apps/app/src/lib/schemas.ts).
- `src/lib/redirect-to.ts` — `parseAndValidateRedirectTo` helper.
- `src/middleware.ts` — authed user on `/sign-in*` / `/sign-up*` bounces to `${NEXT_PUBLIC_APP_URL}/dashboard`.
- `src/test/` — all the existing auth tests, moved over.

**Modified files (production):**
- `apps/app/src/middleware.ts` — rewritten to bounce anonymous users to `${NEXT_PUBLIC_AUTH_URL}/sign-in?redirect_to=<encoded current URL>`.
- `apps/app/src/lib/schemas.ts` — drops `SignInSchema`, `SignInInput`, `SignUpSchema`, `SignUpInput`.
- `apps/app/src/app/(app)/sign-out/route.ts` — imports `@repo/supabase/server`, redirects to `${NEXT_PUBLIC_AUTH_URL}/sign-in`.
- `apps/app/src/test/middleware-auth-routes.test.ts` — renamed to `middleware.test.ts`, rewritten for the new bounce target.
- `apps/app/.env.example` — gains `NEXT_PUBLIC_AUTH_URL`, `AUTH_COOKIE_DOMAIN`, `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN`.
- `docs/auth-providers.md` — auth.brand.com URLs.
- `README.md` — dev script section gains `bun --filter @repo/auth dev` and the three-subdomain note.

**Deleted files (apps/app):**
- `apps/app/src/lib/supabase-browser.ts`
- `apps/app/src/lib/supabase-server.ts`
- `apps/app/src/app/(auth)/` (entire route group)
- `apps/app/src/components/auth-shell.tsx`
- `apps/app/src/components/auth-provider-button.tsx`
- `apps/app/src/components/auth-error-toast.tsx`
- `apps/app/src/components/oauth-provider-form.tsx`
- `apps/app/src/components/provider-icons.tsx`
- `apps/app/src/components/sign-in-email-form.tsx`
- `apps/app/src/components/sign-up-email-form.tsx`
- `apps/app/src/test/auth/` (entire folder)
- `apps/app/src/test/components/auth-error-toast.test.tsx`
- `apps/app/src/test/components/oauth-provider-form.test.tsx`

---

## Task 1: Create `@repo/supabase` package shell

**Files:**
- Create: `packages/supabase/package.json`
- Create: `packages/supabase/tsconfig.json`
- Create: `packages/supabase/biome.json`
- Create: `packages/supabase/vitest.config.ts`

No source code yet — just a buildable empty workspace package.

- [ ] **Step 1: Create `packages/supabase/package.json`**

```json
{
  "name": "@repo/supabase",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./server": "./src/server.ts",
    "./browser": "./src/browser.ts",
    "./middleware": "./src/middleware.ts"
  },
  "scripts": {
    "lint": "biome check src",
    "check-types": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts"
  },
  "dependencies": {
    "@supabase/ssr": "catalog:",
    "next": "catalog:"
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "happy-dom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create `packages/supabase/tsconfig.json`**

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@repo/supabase/*": ["./src/*"]
    }
  },
  "include": ["src", "vitest.config.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `packages/supabase/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.8/schema.json",
  "extends": ["//"]
}
```

- [ ] **Step 4: Create `packages/supabase/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
  },
})
```

- [ ] **Step 5: Install + verify workspace recognises the package**

```bash
bun install
bun --filter @repo/supabase check-types
```

Expected: both exit 0. `bun install` should report the new workspace and link it.

- [ ] **Step 6: Commit**

```bash
git add packages/supabase
git commit -m "chore(supabase): scaffold @repo/supabase package"
```

---

## Task 2: Implement `@repo/supabase/server`

**Files:**
- Create: `packages/supabase/src/server.ts`
- Create: `packages/supabase/src/test/server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/supabase/src/test/server.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cookieStoreGetAll = vi.fn(() => [])
const cookieStoreSet = vi.fn()
const createServerClientSpy = vi.fn(() => ({ marker: "server-client" }))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: cookieStoreGetAll,
    set: cookieStoreSet,
  })),
}))
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientSpy(...args),
}))

const originalEnv = { ...process.env }
beforeEach(() => {
  cookieStoreGetAll.mockClear()
  cookieStoreSet.mockClear()
  createServerClientSpy.mockClear()
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "http://test.supabase.local"
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon-key"
  delete process.env["AUTH_COOKIE_DOMAIN"]
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe("createServerSupabase", () => {
  it("calls createServerClient with the env URL + anon key and a cookie adapter", async () => {
    const { createServerSupabase } = await import("@repo/supabase/server")
    const client = await createServerSupabase()
    expect(client).toEqual({ marker: "server-client" })
    expect(createServerClientSpy).toHaveBeenCalledWith(
      "http://test.supabase.local",
      "anon-key",
      expect.objectContaining({ cookies: expect.any(Object) })
    )
  })

  it("setAll injects domain from AUTH_COOKIE_DOMAIN when set", async () => {
    process.env["AUTH_COOKIE_DOMAIN"] = ".brand.test"
    const { createServerSupabase } = await import("@repo/supabase/server")
    await createServerSupabase()
    const cookieAdapter = createServerClientSpy.mock.calls[0]![2] as {
      cookies: {
        setAll: (
          c: { name: string; value: string; options: Record<string, unknown> }[]
        ) => void
      }
    }
    cookieAdapter.cookies.setAll([
      { name: "sb-access", value: "v1", options: { httpOnly: true, path: "/" } },
    ])
    expect(cookieStoreSet).toHaveBeenCalledWith("sb-access", "v1", {
      httpOnly: true,
      path: "/",
      domain: ".brand.test",
    })
  })

  it("setAll omits domain when AUTH_COOKIE_DOMAIN is not set", async () => {
    const { createServerSupabase } = await import("@repo/supabase/server")
    await createServerSupabase()
    const cookieAdapter = createServerClientSpy.mock.calls[0]![2] as {
      cookies: {
        setAll: (
          c: { name: string; value: string; options: Record<string, unknown> }[]
        ) => void
      }
    }
    cookieAdapter.cookies.setAll([
      { name: "sb-access", value: "v1", options: { path: "/" } },
    ])
    expect(cookieStoreSet).toHaveBeenCalledWith("sb-access", "v1", { path: "/" })
  })
})
```

- [ ] **Step 2: Run; watch fail**

```bash
bun --filter @repo/supabase test server
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `packages/supabase/src/server.ts`**

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
        getAll: () => cookieStore.getAll(),
        setAll: (
          cookiesToSet: {
            name: string
            value: string
            options: Record<string, unknown>
          }[]
        ) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, {
                ...options,
                ...(process.env["AUTH_COOKIE_DOMAIN"]
                  ? { domain: process.env["AUTH_COOKIE_DOMAIN"] }
                  : {}),
              })
            }
          } catch {
            // RSC context: middleware writes the refresh
          }
        },
      },
    }
  )
}
```

- [ ] **Step 4: Run; watch pass**

```bash
bun --filter @repo/supabase test server
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/supabase/src/server.ts packages/supabase/src/test/server.test.ts
git commit -m "feat(supabase): server client with cookie-domain injection"
```

---

## Task 3: Implement `@repo/supabase/browser`

**Files:**
- Create: `packages/supabase/src/browser.ts`
- Create: `packages/supabase/src/test/browser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/supabase/src/test/browser.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createBrowserClientSpy = vi.fn(() => ({ marker: "browser-client" }))
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => createBrowserClientSpy(...args),
}))

const originalEnv = { ...process.env }
beforeEach(() => {
  createBrowserClientSpy.mockClear()
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "http://test.supabase.local"
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon-key"
  delete process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"]
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe("createBrowserSupabase", () => {
  it("memoizes the client across calls", async () => {
    const { createBrowserSupabase } = await import("@repo/supabase/browser")
    const a = createBrowserSupabase()
    const b = createBrowserSupabase()
    expect(a).toBe(b)
    expect(createBrowserClientSpy).toHaveBeenCalledTimes(1)
  })

  it("passes cookieOptions.domain when NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is set", async () => {
    process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"] = ".brand.test"
    const { createBrowserSupabase } = await import("@repo/supabase/browser")
    createBrowserSupabase()
    expect(createBrowserClientSpy).toHaveBeenCalledWith(
      "http://test.supabase.local",
      "anon-key",
      { cookieOptions: { domain: ".brand.test" } }
    )
  })

  it("omits cookieOptions when env unset", async () => {
    const { createBrowserSupabase } = await import("@repo/supabase/browser")
    createBrowserSupabase()
    expect(createBrowserClientSpy).toHaveBeenCalledWith(
      "http://test.supabase.local",
      "anon-key",
      undefined
    )
  })
})
```

- [ ] **Step 2: Run; watch fail**

```bash
bun --filter @repo/supabase test browser
```

Expected: FAIL.

- [ ] **Step 3: Implement `packages/supabase/src/browser.ts`**

```ts
"use client"
import { createBrowserClient } from "@supabase/ssr"

let cached: ReturnType<typeof createBrowserClient> | undefined

export function createBrowserSupabase() {
  if (cached) return cached
  const domain = process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"]
  cached = createBrowserClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    domain ? { cookieOptions: { domain } } : undefined
  )
  return cached
}
```

- [ ] **Step 4: Run; watch pass**

```bash
bun --filter @repo/supabase test browser
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/supabase/src/browser.ts packages/supabase/src/test/browser.test.ts
git commit -m "feat(supabase): browser client with cookie-domain injection"
```

---

## Task 4: Implement `@repo/supabase/middleware`

**Files:**
- Create: `packages/supabase/src/middleware.ts`

The middleware variant just shares cookie-writing semantics with the server module, no new behaviour to test independently (the apps/app and apps/auth middleware tests exercise the integration). YAGNI on a dedicated test.

- [ ] **Step 1: Implement `packages/supabase/src/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr"
import type { NextRequest, NextResponse } from "next/server"

export function createMiddlewareSupabase(req: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (
          cookiesToSet: {
            name: string
            value: string
            options: Record<string, unknown>
          }[]
        ) => {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, {
              ...options,
              ...(process.env["AUTH_COOKIE_DOMAIN"]
                ? { domain: process.env["AUTH_COOKIE_DOMAIN"] }
                : {}),
            })
          }
        },
      },
    }
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun --filter @repo/supabase check-types
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/supabase/src/middleware.ts
git commit -m "feat(supabase): middleware client with cookie-domain injection"
```

---

## Task 5: Switch apps/app to `@repo/supabase`

**Files:**
- Modify: `apps/app/package.json`
- Modify: every file in `apps/app/src` that imports from `@/lib/supabase-server` or `@/lib/supabase-browser`
- Modify: `apps/app/src/middleware.ts`
- Delete: `apps/app/src/lib/supabase-server.ts`
- Delete: `apps/app/src/lib/supabase-browser.ts`

No behaviour change — pure dependency swap. The full `@repo/app` test suite must stay green.

- [ ] **Step 1: Add the workspace dep**

In `apps/app/package.json`, under `"dependencies"`, add:

```json
"@repo/supabase": "workspace:*",
```

Run `bun install`.

- [ ] **Step 2: Update import sites**

Find every file with the old imports and switch to the new ones:

```bash
grep -rln "@/lib/supabase-server" apps/app/src
grep -rln "@/lib/supabase-browser" apps/app/src
```

For each match: replace `from "@/lib/supabase-server"` with `from "@repo/supabase/server"`. Replace `from "@/lib/supabase-browser"` with `from "@repo/supabase/browser"`.

Also update `apps/app/src/middleware.ts`: it currently calls `createServerClient` directly. Replace its inline client construction with:

```ts
import { createMiddlewareSupabase } from "@repo/supabase/middleware"
// ...
const supabase = createMiddlewareSupabase(req, response)
const { data: { user } } = await supabase.auth.getUser()
```

Drop the now-unused `@supabase/ssr` and `CookieOptions` imports from the middleware file.

- [ ] **Step 3: Delete the orphaned lib files**

```bash
rm apps/app/src/lib/supabase-server.ts apps/app/src/lib/supabase-browser.ts
```

- [ ] **Step 4: Verify**

```bash
bun --filter @repo/app check-types
bun --filter @repo/app test
bun --filter @repo/app build
```

All three exit 0. Test count: 210.

- [ ] **Step 5: Commit**

```bash
git add apps/app
git commit -m "refactor(app): import Supabase clients from @repo/supabase"
```

---

## Task 6: Scaffold `apps/auth` shell

**Files:**
- Create: `apps/auth/package.json`
- Create: `apps/auth/tsconfig.json`
- Create: `apps/auth/next.config.ts`
- Create: `apps/auth/biome.json`
- Create: `apps/auth/postcss.config.mjs`
- Create: `apps/auth/vitest.config.ts`
- Create: `apps/auth/.env.example`
- Create: `apps/auth/public/robots.txt`
- Create: `apps/auth/src/app/layout.tsx`
- Create: `apps/auth/src/app/globals.css`
- Create: `apps/auth/src/app/page.tsx`
- Create: `apps/auth/src/app/sign-in/page.tsx` — temporary "Coming soon" placeholder

The shell must run `bun --filter @repo/auth dev` and serve a stub `/sign-in` so the cross-app contract can be wired up in later tasks. No tests yet beyond a smoke test that the layout renders.

- [ ] **Step 1: Create `apps/auth/package.json`**

```json
{
  "name": "@repo/auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3002 --hostname auth.localhost",
    "build": "next build --webpack",
    "start": "next start --port 3002 --hostname auth.localhost",
    "lint": "biome check src",
    "check-types": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts"
  },
  "dependencies": {
    "@hookform/resolvers": "catalog:",
    "@iconify/react": "catalog:",
    "@repo/supabase": "workspace:*",
    "@repo/ui": "workspace:*",
    "next": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-hook-form": "catalog:",
    "sonner": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "@repo/tokens": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@tailwindcss/postcss": "catalog:",
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "happy-dom": "catalog:",
    "postcss": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

If any `catalog:` reference fails to resolve, copy the corresponding `devDependency` version from `apps/app/package.json` instead.

- [ ] **Step 2: Create `apps/auth/tsconfig.json`**

```json
{
  "extends": "@repo/typescript-config/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/auth/next.config.ts`**

```ts
import type { NextConfig } from "next"

const config: NextConfig = {
  reactStrictMode: true,
}

export default config
```

- [ ] **Step 4: Create `apps/auth/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.8/schema.json",
  "extends": ["//"]
}
```

- [ ] **Step 5: Create `apps/auth/postcss.config.mjs`**

Copy the contents of `apps/app/postcss.config.mjs` verbatim.

- [ ] **Step 6: Create `apps/auth/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    environment: "happy-dom",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

- [ ] **Step 7: Create `apps/auth/.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://app.localhost:3001
NEXT_PUBLIC_AUTH_URL=http://auth.localhost:3002
AUTH_COOKIE_DOMAIN=.localhost
NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.localhost
```

- [ ] **Step 8: Create `apps/auth/public/robots.txt`**

```
User-agent: *
Disallow: /
```

- [ ] **Step 9: Create `apps/auth/src/app/layout.tsx`**

```tsx
import "@/app/globals.css"
import type { Metadata, ReactNode } from "react"
import { Toaster } from "sonner"

export const metadata: Metadata = {
  title: { default: "Sign in", template: "%s · brand auth" },
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <Toaster richColors closeButton position="top-center" />
      </body>
    </html>
  )
}
```

- [ ] **Step 10: Create `apps/auth/src/app/globals.css`**

Copy the entire contents of `apps/app/src/app/globals.css` verbatim. This includes the token block, the `surface-metal` utility, and the dark/light themes. The auth app uses the same design system.

- [ ] **Step 11: Create `apps/auth/src/app/page.tsx`**

```tsx
import { redirect } from "next/navigation"

export default function AuthRootPage() {
  redirect("/sign-in")
}
```

- [ ] **Step 12: Create `apps/auth/src/app/sign-in/page.tsx`** (temporary)

```tsx
export const metadata = { title: "Log in" }

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-base text-ink-primary">
      <p className="text-[14px]">Auth surface scaffolded. Pages move here in the next task.</p>
    </main>
  )
}
```

- [ ] **Step 13: Install + verify**

```bash
bun install
bun --filter @repo/auth check-types
bun --filter @repo/auth build
```

All three exit 0. The build prerenders `/sign-in` as static.

- [ ] **Step 14: Commit**

```bash
git add apps/auth
git commit -m "chore(auth): scaffold @repo/auth shell on auth.localhost:3002"
```

---

## Task 7: Move auth components into apps/auth

**Files:**
- Create (copy): `apps/auth/src/components/auth-shell.tsx`
- Create (copy): `apps/auth/src/components/auth-provider-button.tsx`
- Create (copy): `apps/auth/src/components/auth-error-toast.tsx`
- Create (copy): `apps/auth/src/components/oauth-provider-form.tsx`
- Create (copy): `apps/auth/src/components/provider-icons.tsx`
- Create (copy): `apps/auth/src/components/sign-in-email-form.tsx`
- Create (copy): `apps/auth/src/components/sign-up-email-form.tsx`

This task only copies; it does not delete. apps/app keeps its working copies until Task 13 cleanup. The two copies are temporarily duplicated; tests still run against apps/app's copies via the existing test suite.

- [ ] **Step 1: Copy each component file verbatim**

```bash
cp apps/app/src/components/auth-shell.tsx apps/auth/src/components/auth-shell.tsx
cp apps/app/src/components/auth-provider-button.tsx apps/auth/src/components/auth-provider-button.tsx
cp apps/app/src/components/auth-error-toast.tsx apps/auth/src/components/auth-error-toast.tsx
cp apps/app/src/components/oauth-provider-form.tsx apps/auth/src/components/oauth-provider-form.tsx
cp apps/app/src/components/provider-icons.tsx apps/auth/src/components/provider-icons.tsx
cp apps/app/src/components/sign-in-email-form.tsx apps/auth/src/components/sign-in-email-form.tsx
cp apps/app/src/components/sign-up-email-form.tsx apps/auth/src/components/sign-up-email-form.tsx
```

- [ ] **Step 2: Fix the cross-import in `oauth-provider-form.tsx`**

In `apps/auth/src/components/oauth-provider-form.tsx`, the import path for `startOAuthAction` points at the (still-future) auth-app route. Replace:

```ts
import {
  startOAuthAction,
  type OAuthProvider,
} from "@/app/(auth)/auth/start/actions"
```

with:

```ts
import {
  startOAuthAction,
  type OAuthProvider,
} from "@/app/auth/start/actions"
```

- [ ] **Step 3: Verify the components typecheck against the (still missing) action**

Because `oauth-provider-form.tsx` references a module that hasn't been created yet in apps/auth, `bun --filter @repo/auth check-types` will fail at this exact import. Confirm the error message names the missing module path, which confirms our component is wired to the right location.

```bash
bun --filter @repo/auth check-types 2>&1 | tail -10
```

Expected: an error about `Cannot find module '@/app/auth/start/actions'`. That's correct; Task 9 creates it.

- [ ] **Step 4: Commit**

```bash
git add apps/auth/src/components
git commit -m "chore(auth): copy auth components into @repo/auth"
```

---

## Task 8: Add `redirect-to` helper + schemas + lib files

**Files:**
- Create: `apps/auth/src/lib/redirect-to.ts`
- Create: `apps/auth/src/test/redirect-to.test.ts`
- Create: `apps/auth/src/lib/schemas.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/auth/src/test/redirect-to.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseAndValidateRedirectTo } from "@/lib/redirect-to"

const ALLOWLIST = ["http://app.localhost:3001", "https://app.brand.com"]

describe("parseAndValidateRedirectTo", () => {
  it("returns the URL for an allowlisted origin", () => {
    expect(
      parseAndValidateRedirectTo("http://app.localhost:3001/dashboard", ALLOWLIST)
    ).toBe("http://app.localhost:3001/dashboard")
    expect(
      parseAndValidateRedirectTo("https://app.brand.com/dashboard/runs/abc", ALLOWLIST)
    ).toBe("https://app.brand.com/dashboard/runs/abc")
  })

  it("returns null for foreign origins", () => {
    expect(
      parseAndValidateRedirectTo("https://evil.example/steal", ALLOWLIST)
    ).toBeNull()
    expect(
      parseAndValidateRedirectTo("http://app.localhost:9999/dashboard", ALLOWLIST)
    ).toBeNull()
  })

  it("returns null for malformed input", () => {
    expect(parseAndValidateRedirectTo("not a url", ALLOWLIST)).toBeNull()
    expect(parseAndValidateRedirectTo("javascript:alert(1)", ALLOWLIST)).toBeNull()
  })

  it("returns null for undefined input", () => {
    expect(parseAndValidateRedirectTo(undefined, ALLOWLIST)).toBeNull()
  })
})
```

- [ ] **Step 2: Run; watch fail**

```bash
bun --filter @repo/auth test redirect-to
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `apps/auth/src/lib/redirect-to.ts`**

```ts
export function parseAndValidateRedirectTo(
  raw: string | undefined,
  allowlist: string[]
): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const ok = allowlist.some((origin) => {
    try {
      return new URL(origin).origin === url.origin
    } catch {
      return false
    }
  })
  return ok ? url.toString() : null
}
```

- [ ] **Step 4: Create `apps/auth/src/lib/schemas.ts`**

```ts
import { z } from "zod"

export const SignInSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

export const SignUpSchema = SignInSchema.extend({
  displayName: z.string().min(1).max(80).optional(),
})

export type SignInInput = z.infer<typeof SignInSchema>
export type SignUpInput = z.infer<typeof SignUpSchema>
```

- [ ] **Step 5: Run; watch pass**

```bash
bun --filter @repo/auth test redirect-to
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/auth/src/lib apps/auth/src/test
git commit -m "feat(auth): redirect-to validator + auth schemas"
```

---

## Task 9: Move auth routes into apps/auth

**Files:**
- Create: `apps/auth/src/app/sign-in/page.tsx` (replace placeholder)
- Create: `apps/auth/src/app/sign-in/email/page.tsx`
- Create: `apps/auth/src/app/sign-up/page.tsx`
- Create: `apps/auth/src/app/sign-up/email/page.tsx`
- Create: `apps/auth/src/app/auth/start/actions.ts`
- Create: `apps/auth/src/app/auth/callback/route.ts` (stub here; full handler in Task 11)

apps/app keeps its `(auth)` group running for now. The OAuth start action in apps/auth uses the auth.localhost origin so its callback URL is auth.localhost. The callback handler is a 501 stub at this step (matches the pre-callback behaviour of the original codebase).

- [ ] **Step 1: Copy and overwrite the placeholder sign-in page**

Copy `apps/app/src/app/(auth)/sign-in/page.tsx` to `apps/auth/src/app/sign-in/page.tsx`, **then** modify the file to add `redirect_to` cookie capture. Final contents:

```tsx
import { cookies } from "next/headers"
import Link from "next/link"
import { Suspense } from "react"
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

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const sp = await searchParams
  if (sp.redirect_to) {
    const store = await cookies()
    store.set("auth.redirect_to", sp.redirect_to, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    })
  }

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
      <Suspense fallback={null}>
        <AuthErrorToast />
      </Suspense>
    </AuthShell>
  )
}
```

- [ ] **Step 2: Copy the email step page**

```bash
cp apps/app/src/app/\(auth\)/sign-in/email/page.tsx apps/auth/src/app/sign-in/email/page.tsx
```

No content edits — the imports `@/components/...` resolve in apps/auth too.

- [ ] **Step 3: Create the sign-up provider list with redirect_to capture**

`apps/auth/src/app/sign-up/page.tsx`:

```tsx
import { cookies } from "next/headers"
import Link from "next/link"
import { Suspense } from "react"
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

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const sp = await searchParams
  if (sp.redirect_to) {
    const store = await cookies()
    store.set("auth.redirect_to", sp.redirect_to, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    })
  }

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
      <Suspense fallback={null}>
        <AuthErrorToast />
      </Suspense>
    </AuthShell>
  )
}
```

- [ ] **Step 4: Copy the sign-up email page**

```bash
cp apps/app/src/app/\(auth\)/sign-up/email/page.tsx apps/auth/src/app/sign-up/email/page.tsx
```

No edits.

- [ ] **Step 5: Create the OAuth start action**

`apps/auth/src/app/auth/start/actions.ts`:

```ts
"use server"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createServerSupabase } from "@repo/supabase/server"

export type OAuthProvider = "google" | "azure" | "github"

export async function startOAuthAction(provider: OAuthProvider) {
  const supabase = await createServerSupabase()
  const origin = (await headers()).get("origin") ?? "http://auth.localhost:3002"

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

- [ ] **Step 6: Create the callback stub**

`apps/auth/src/app/auth/callback/route.ts` (temporary stub — full implementation in Task 11):

```ts
import { NextResponse } from "next/server"

export function GET() {
  return new NextResponse("OAuth callback not implemented yet", { status: 501 })
}
```

- [ ] **Step 7: Verify**

```bash
bun --filter @repo/auth check-types
bun --filter @repo/auth build
```

Both exit 0. apps/auth's build prerenders `/`, `/sign-in`, `/sign-in/email`, `/sign-up`, `/sign-up/email` (or marks them dynamic — either is fine).

- [ ] **Step 8: Commit**

```bash
git add apps/auth/src/app
git commit -m "feat(auth): move auth routes into @repo/auth with redirect_to capture"
```

---

## Task 10: Move auth tests into apps/auth

**Files:**
- Create (move): `apps/auth/src/test/components/auth-error-toast.test.tsx`
- Create (move): `apps/auth/src/test/components/oauth-provider-form.test.tsx`
- Create (move): `apps/auth/src/test/auth/email-step-pages.test.tsx`
- Create (move): `apps/auth/src/test/auth/start-oauth.test.ts` (with default-origin assertion bumped)
- Delete the same paths from apps/app/src/test/

The callback test will be added in Task 11 with the new (g)/(h)/(i) cases.

- [ ] **Step 1: Move `auth-error-toast.test.tsx`**

```bash
mkdir -p apps/auth/src/test/components
git mv apps/app/src/test/components/auth-error-toast.test.tsx apps/auth/src/test/components/auth-error-toast.test.tsx
```

No content changes — the `@/components/auth-error-toast` import resolves in apps/auth.

- [ ] **Step 2: Move `oauth-provider-form.test.tsx`**

```bash
git mv apps/app/src/test/components/oauth-provider-form.test.tsx apps/auth/src/test/components/oauth-provider-form.test.tsx
```

Update the `vi.mock` path inside that file. Change:

```ts
vi.mock("@/app/(auth)/auth/start/actions", () => ({
  startOAuthAction: startOAuthActionSpy,
}))
```

to:

```ts
vi.mock("@/app/auth/start/actions", () => ({
  startOAuthAction: startOAuthActionSpy,
}))
```

- [ ] **Step 3: Move `email-step-pages.test.tsx`**

```bash
mkdir -p apps/auth/src/test/auth
git mv apps/app/src/test/auth/email-step-pages.test.tsx apps/auth/src/test/auth/email-step-pages.test.tsx
```

Update the dynamic imports inside the test file:

- `@/app/(auth)/sign-in/email/page` → `@/app/sign-in/email/page`
- `@/app/(auth)/sign-up/email/page` → `@/app/sign-up/email/page`

- [ ] **Step 4: Move `start-oauth.test.ts` with the origin bump**

```bash
git mv apps/app/src/test/auth/start-oauth.test.ts apps/auth/src/test/auth/start-oauth.test.ts
```

Update inside the file:

- All `vi.mock("@/lib/supabase-server", ...)` → `vi.mock("@repo/supabase/server", ...)`.
- All dynamic imports `await import("@/app/(auth)/auth/start/actions")` → `await import("@/app/auth/start/actions")`.
- Update the headers mock to return `auth.localhost:3002` instead of `app.localhost:3001`:

```ts
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "http://auth.localhost:3002" })),
}))
```

- Update the assertion strings: every occurrence of `http://app.localhost:3001/auth/callback` becomes `http://auth.localhost:3002/auth/callback`.

- [ ] **Step 5: Move the existing `callback.test.ts`**

```bash
git mv apps/app/src/test/auth/callback.test.ts apps/auth/src/test/auth/callback.test.ts
```

Update inside:

- `vi.mock("@/lib/supabase-server", ...)` → `vi.mock("@repo/supabase/server", ...)`.
- All dynamic imports `@/app/(auth)/auth/callback/route` → `@/app/auth/callback/route`.

(The new cases (g)/(h)/(i) are added in Task 11 alongside the handler implementation.)

- [ ] **Step 6: Run the apps/auth suite**

```bash
bun --filter @repo/auth test
```

Expected: the email-step, oauth-provider-form, start-oauth, and auth-error-toast tests pass. The callback test still expects 501 from the stub for now — all 6 of its original cases will fail with current handler behaviour. **This is expected for the moment.** Note the failure count.

Run the apps/app suite to confirm it still passes:

```bash
bun --filter @repo/app test
```

apps/app should be at **189 tests** (210 minus the 21 we moved).

- [ ] **Step 7: Commit**

Even though apps/auth's callback test is currently failing, the move itself is correct and we commit the moves separately from the handler work for traceability:

```bash
git add apps/auth/src/test apps/app/src/test
git commit -m "test(auth): move auth tests from @repo/app to @repo/auth"
```

> Implementer note: this commit lands a known-failing test (the callback stub's 6 cases). Task 11 fixes it immediately. Don't merge to main between these two commits.

---

## Task 11: Implement the new `/auth/callback` with redirect_to + extended tests

**Files:**
- Modify: `apps/auth/src/app/auth/callback/route.ts` (replace stub)
- Modify: `apps/auth/src/test/auth/callback.test.ts` (add cases g/h/i)

- [ ] **Step 1: Extend the test with cases g/h/i**

Open `apps/auth/src/test/auth/callback.test.ts`. The existing mocks (`exchangeCodeForSessionSpy`, `sitesSelectSpy`, `vi.mock("@repo/supabase/server", ...)`) stay. Add cookie spies and `NEXT_PUBLIC_APP_URL` env:

Replace the top of the file (everything before the existing `describe`) with:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const exchangeCodeForSessionSpy = vi.fn()
const sitesSelectSpy = vi.fn()
const cookieGetSpy = vi.fn()
const cookieDeleteSpy = vi.fn()

vi.mock("@repo/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionSpy },
    from: () => ({ select: sitesSelectSpy }),
  })),
}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetSpy,
    delete: cookieDeleteSpy,
  })),
}))

const originalEnv = { ...process.env }
beforeEach(() => {
  exchangeCodeForSessionSpy.mockReset()
  sitesSelectSpy.mockReset()
  cookieGetSpy.mockReset()
  cookieDeleteSpy.mockReset()
  process.env["NEXT_PUBLIC_APP_URL"] = "http://app.localhost:3001"
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

async function callGet(url: string) {
  const { GET } = await import("@/app/auth/callback/route")
  return GET(new Request(url))
}
```

Then update every assertion that previously referenced the auth.localhost origin's `Location` header to instead use `http://app.localhost:3001` for success paths (the destinations are app-app URLs now, not auth-app URLs).

The full set of cases the test must cover (replace the existing `describe` block in its entirety):

```ts
describe("/auth/callback GET", () => {
  it("(a) forwards provider error to /sign-in?error=access_denied", async () => {
    const res = await callGet("http://auth.localhost:3002/auth/callback?error=access_denied")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "http://auth.localhost:3002/sign-in?error=access_denied"
    )
  })

  it("(b) redirects to /sign-in?error=missing_code when code is absent", async () => {
    const res = await callGet("http://auth.localhost:3002/auth/callback")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "http://auth.localhost:3002/sign-in?error=missing_code"
    )
  })

  it("(c) forwards exchangeCodeForSession error to /sign-in?error=...", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: { message: "bad code" } })
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "http://auth.localhost:3002/sign-in?error=bad%20code"
    )
  })

  it("(d) success with 0 sites → ${APP_URL}/onboarding", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 0, error: null })
    cookieGetSpy.mockReturnValueOnce(undefined)
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/onboarding")
  })

  it("(e) success with >0 sites and no redirect_to → ${APP_URL}/dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 3, error: null })
    cookieGetSpy.mockReturnValueOnce(undefined)
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })

  it("(f) success with count query error → defaults to ${APP_URL}/dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: null, error: { message: "rls" } })
    cookieGetSpy.mockReturnValueOnce(undefined)
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })

  it("(g) returning user with valid redirect_to → honours the redirect", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 3, error: null })
    cookieGetSpy.mockReturnValueOnce({
      value: "http://app.localhost:3001/dashboard/runs/abc",
    })
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(
      "http://app.localhost:3001/dashboard/runs/abc"
    )
    expect(cookieDeleteSpy).toHaveBeenCalledWith("auth.redirect_to")
  })

  it("(h) foreign-origin redirect_to → falls back to ${APP_URL}/dashboard", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 3, error: null })
    cookieGetSpy.mockReturnValueOnce({ value: "https://evil.example/steal" })
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
  })

  it("(i) new user with valid redirect_to → onboarding still wins", async () => {
    exchangeCodeForSessionSpy.mockResolvedValueOnce({ error: null })
    sitesSelectSpy.mockResolvedValueOnce({ count: 0, error: null })
    cookieGetSpy.mockReturnValueOnce({
      value: "http://app.localhost:3001/dashboard/runs/abc",
    })
    const res = await callGet("http://auth.localhost:3002/auth/callback?code=abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/onboarding")
  })
})
```

- [ ] **Step 2: Run; watch fail**

```bash
bun --filter @repo/auth test callback
```

Expected: all 9 cases fail (handler is a 501 stub).

- [ ] **Step 3: Implement the handler**

Replace `apps/auth/src/app/auth/callback/route.ts` with:

```ts
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { createServerSupabase } from "@repo/supabase/server"
import { parseAndValidateRedirectTo } from "@/lib/redirect-to"

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

  const store = await cookies()
  const rawRedirect = store.get("auth.redirect_to")?.value
  store.delete("auth.redirect_to")

  const APP_URL = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://app.localhost:3001"
  const allowlist = [APP_URL, "http://app.localhost:3001"]
  const validated = parseAndValidateRedirectTo(rawRedirect, allowlist)

  const isNewUser = !countError && (count ?? 0) === 0
  const destination = isNewUser
    ? `${APP_URL}/onboarding`
    : (validated ?? `${APP_URL}/dashboard`)

  return NextResponse.redirect(destination)
}
```

- [ ] **Step 4: Run; watch pass**

```bash
bun --filter @repo/auth test callback
```

Expected: 9/9 pass.

- [ ] **Step 5: Run the full apps/auth suite**

```bash
bun --filter @repo/auth test
```

All apps/auth tests pass (callback 9, email-step 2, oauth-provider-form 2, auth-error-toast 4, start-oauth 4, redirect-to 4 = 25 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/auth/src/app/auth/callback/route.ts apps/auth/src/test/auth/callback.test.ts
git commit -m "feat(auth): /auth/callback honours redirect_to with allowlist"
```

---

## Task 12: apps/auth middleware + cross-app cutover

**Files:**
- Create: `apps/auth/src/middleware.ts`
- Create: `apps/auth/src/test/middleware.test.ts`
- Modify: `apps/app/src/middleware.ts` (cutover)
- Modify (rename): `apps/app/src/test/middleware-auth-routes.test.ts` → `apps/app/src/test/middleware.test.ts`
- Modify: `apps/app/src/app/(app)/sign-out/route.ts`

This is the cutover: after this commit, apps/app's middleware sends anonymous users to auth.brand.com instead of its own `(auth)` group (which still exists but is unreachable). Both `/sign-out` and middleware updates happen here so the user never lands on a dead path.

- [ ] **Step 1: Write the failing apps/auth middleware test**

Create `apps/auth/src/test/middleware.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

const mockUser: { user: null | { id: string } } = { user: null }
vi.mock("@repo/supabase/middleware", () => ({
  createMiddlewareSupabase: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser.user } }) },
  }),
}))

const originalEnv = { ...process.env }
function makeReq(url: string) {
  const req = new Request(url) as Parameters<typeof import("@/middleware").middleware>[0]
  Object.defineProperty(req, "nextUrl", { value: new URL(url) })
  Object.defineProperty(req, "cookies", { value: { getAll: () => [] } })
  return req
}

describe("apps/auth middleware", () => {
  it("anonymous user on /sign-in passes through (200)", async () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "http://app.localhost:3001"
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/sign-in"))
    expect(res.status).toBe(200)
  })

  it("authed user on /sign-in → 307 to ${APP_URL}/dashboard", async () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "http://app.localhost:3001"
    mockUser.user = { id: "u1" }
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/sign-in"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
    process.env = { ...originalEnv }
  })

  it("authed user on /sign-in/email also bounces", async () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "http://app.localhost:3001"
    mockUser.user = { id: "u1" }
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/sign-in/email"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://app.localhost:3001/dashboard")
    process.env = { ...originalEnv }
  })

  it("authed user on /auth/callback does not bounce (callback owns its own logic)", async () => {
    mockUser.user = { id: "u1" }
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://auth.localhost:3002/auth/callback?code=x"))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run; watch fail**

```bash
bun --filter @repo/auth test middleware
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `apps/auth/src/middleware.ts`**

```ts
import { type NextRequest, NextResponse } from "next/server"
import { createMiddlewareSupabase } from "@repo/supabase/middleware"

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req })
  const supabase = createMiddlewareSupabase(req, response)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  const isAuthSurface =
    path === "/sign-in" ||
    path === "/sign-up" ||
    path.startsWith("/sign-in/") ||
    path.startsWith("/sign-up/")

  if (user && isAuthSurface) {
    const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://app.localhost:3001"
    return NextResponse.redirect(new URL("/dashboard", appUrl))
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|robots).*)"],
}
```

- [ ] **Step 4: Run; watch pass**

```bash
bun --filter @repo/auth test middleware
```

Expected: 4/4 pass.

- [ ] **Step 5: Rewrite the apps/app middleware test**

Rename and rewrite. Delete `apps/app/src/test/middleware-auth-routes.test.ts`; create `apps/app/src/test/middleware.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

const mockUser: { user: null | { id: string } } = { user: null }
vi.mock("@repo/supabase/middleware", () => ({
  createMiddlewareSupabase: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser.user } }) },
  }),
}))

function makeReq(url: string) {
  const req = new Request(url) as Parameters<typeof import("@/middleware").middleware>[0]
  Object.defineProperty(req, "nextUrl", { value: new URL(url) })
  Object.defineProperty(req, "cookies", { value: { getAll: () => [] } })
  return req
}

describe("apps/app middleware", () => {
  it("anonymous user on /dashboard → 307 to ${AUTH_URL}/sign-in?redirect_to=…", async () => {
    process.env["NEXT_PUBLIC_AUTH_URL"] = "http://auth.localhost:3002"
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://app.localhost:3001/dashboard"))
    expect(res.status).toBe(307)
    const loc = res.headers.get("location")
    expect(loc).toContain("http://auth.localhost:3002/sign-in")
    expect(loc).toContain(
      `redirect_to=${encodeURIComponent("http://app.localhost:3001/dashboard")}`
    )
  })

  it("authed user on /dashboard passes through", async () => {
    mockUser.user = { id: "u1" }
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://app.localhost:3001/dashboard"))
    expect(res.status).toBe(200)
  })

  it("anonymous user on /sign-out still passes through (POST can fire)", async () => {
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://app.localhost:3001/sign-out"))
    expect(res.status).toBe(200)
  })

  it("anonymous user on / passes through (public root)", async () => {
    mockUser.user = null
    const { middleware } = await import("@/middleware")
    const res = await middleware(makeReq("http://app.localhost:3001/"))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 6: Rewrite `apps/app/src/middleware.ts`**

```ts
import { type NextRequest, NextResponse } from "next/server"
import { createMiddlewareSupabase } from "@repo/supabase/middleware"

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req })
  const supabase = createMiddlewareSupabase(req, response)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  const isPublicRoute =
    path === "/" ||
    path === "/sign-out" ||
    path.startsWith("/_next/") ||
    path.startsWith("/favicon")

  if (!user && !isPublicRoute) {
    const authUrl = process.env["NEXT_PUBLIC_AUTH_URL"] ?? "http://auth.localhost:3002"
    const target = new URL("/sign-in", authUrl)
    target.searchParams.set("redirect_to", req.nextUrl.href)
    return NextResponse.redirect(target)
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|manifest|sw\\.js).*)"],
}
```

- [ ] **Step 7: Update `/sign-out` redirect target**

Modify `apps/app/src/app/(app)/sign-out/route.ts`. After `await supabase.auth.signOut()`, change the redirect target from `/sign-in` (apps/app's old local route) to `${NEXT_PUBLIC_AUTH_URL}/sign-in`. Final file:

```ts
import { NextResponse } from "next/server"
import { createServerSupabase } from "@repo/supabase/server"

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  const authUrl = process.env["NEXT_PUBLIC_AUTH_URL"] ?? "http://auth.localhost:3002"
  return NextResponse.redirect(new URL("/sign-in", authUrl), 303)
}
```

(If the current `sign-out/route.ts` already imports from `@repo/supabase/server` after Task 5, leave that line; only the redirect target changes.)

- [ ] **Step 8: Run both suites**

```bash
bun --filter @repo/auth test
bun --filter @repo/app test
```

Expected: apps/auth 29 tests pass, apps/app 192 tests pass (189 baseline + 4 new middleware cases - 1 removed file count; verify by running).

- [ ] **Step 9: Commit**

```bash
git add apps/auth/src/middleware.ts apps/auth/src/test/middleware.test.ts \
        apps/app/src/middleware.ts apps/app/src/test/middleware.test.ts \
        apps/app/src/test/middleware-auth-routes.test.ts \
        apps/app/src/app/\(app\)/sign-out/route.ts
git commit -m "feat(repo): cut over middleware to apps/auth, sign-out redirects to auth"
```

(`git add` of the deleted `middleware-auth-routes.test.ts` stages the deletion.)

---

## Task 13: Delete the orphaned `(auth)` group + components in apps/app

**Files:**
- Delete: `apps/app/src/app/(auth)/` (entire group)
- Delete: `apps/app/src/components/auth-shell.tsx`
- Delete: `apps/app/src/components/auth-provider-button.tsx`
- Delete: `apps/app/src/components/auth-error-toast.tsx`
- Delete: `apps/app/src/components/oauth-provider-form.tsx`
- Delete: `apps/app/src/components/provider-icons.tsx`
- Delete: `apps/app/src/components/sign-in-email-form.tsx`
- Delete: `apps/app/src/components/sign-up-email-form.tsx`
- Modify: `apps/app/src/lib/schemas.ts` (drop SignInSchema, SignUpSchema, related types)

After this task, apps/app no longer contains any auth code. The only references to the dropped exports are inside the routes/components we're deleting in the same commit.

- [ ] **Step 1: Delete the route group and auth components**

```bash
rm -rf apps/app/src/app/\(auth\)
rm apps/app/src/components/auth-shell.tsx
rm apps/app/src/components/auth-provider-button.tsx
rm apps/app/src/components/auth-error-toast.tsx
rm apps/app/src/components/oauth-provider-form.tsx
rm apps/app/src/components/provider-icons.tsx
rm apps/app/src/components/sign-in-email-form.tsx
rm apps/app/src/components/sign-up-email-form.tsx
```

- [ ] **Step 2: Remove SignIn/SignUp from `apps/app/src/lib/schemas.ts`**

Open `apps/app/src/lib/schemas.ts`. Remove these blocks:

```ts
export const SignInSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

export const SignUpSchema = SignInSchema.extend({
  displayName: z.string().min(1).max(80).optional(),
})
```

And from the bottom `export type` block, remove:

```ts
export type SignInInput = z.infer<typeof SignInSchema>
export type SignUpInput = z.infer<typeof SignUpSchema>
```

Keep the rest of the file (AddSiteSchema, RunAuditSchema, AddCompetitorSchema, UpdateCompetitorSchema, RemoveCompetitorsSchema) untouched.

- [ ] **Step 3: Verify nothing else imports the dropped symbols**

```bash
grep -rn "SignInSchema\|SignInInput\|SignUpSchema\|SignUpInput" apps/app/src
grep -rn "from \"@/components/auth-\|from \"@/components/oauth-provider-form\|from \"@/components/provider-icons\|from \"@/components/sign-in-email-form\|from \"@/components/sign-up-email-form" apps/app/src
```

Both grep commands should return zero matches.

- [ ] **Step 4: Verify**

```bash
bun --filter @repo/app check-types
bun --filter @repo/app test
bun --filter @repo/app build
```

All three exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/app
git commit -m "chore(app): delete auth surfaces moved to @repo/auth"
```

---

## Task 14: Documentation + env updates

**Files:**
- Modify: `apps/app/.env.example`
- Modify: `docs/auth-providers.md`
- Modify: `README.md`

- [ ] **Step 1: Update `apps/app/.env.example`**

Append at the bottom:

```
# Auth (cross-app session + bounce target)
NEXT_PUBLIC_AUTH_URL=http://auth.localhost:3002
AUTH_COOKIE_DOMAIN=.localhost
NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.localhost
```

- [ ] **Step 2: Rewrite the relevant sections of `docs/auth-providers.md`**

Open `docs/auth-providers.md`. Apply these specific edits:

In the "URLs you'll need" table, rename column "App URL" → "Auth URL". The values become:

| Env | Auth URL | OAuth callback (Supabase) |
|---|---|---|
| Local | `http://auth.localhost:3002` | `https://<project>.supabase.co/auth/v1/callback` |
| Production | `https://auth.brand.com` | `https://<project>.supabase.co/auth/v1/callback` |

Replace the Supabase redirect URL bullet list with:

> In Supabase (Authentication → URL Configuration → Redirect URLs), add:
> - `http://auth.localhost:3002/auth/callback`
> - `https://auth.brand.com/auth/callback` (once production exists)
>
> Set Site URL to `https://auth.brand.com`. After sign-in, users land on `https://app.brand.com/{dashboard,onboarding}` — the auth app forwards them there via the validated `redirect_to`.

In the Google section step 3, change "Authorized JavaScript origins" to:
> Authorized JavaScript origins: `http://auth.localhost:3002`, `https://auth.brand.com`.

In the Smoke check section, change step 1 from `http://app.localhost:3001/sign-in` to `http://auth.localhost:3002/sign-in`. Add a step 0:

> 0. Both `bun --filter @repo/auth dev` and `bun --filter @repo/app dev` must be running.

- [ ] **Step 3: Update `README.md` dev script section**

Search README.md for the dev script reference. Replace the section that lists `bun --filter @repo/www dev` and `bun --filter @repo/app dev` to also include `bun --filter @repo/auth dev`. Final block:

```
**Single app:**
- `bun --filter @repo/www dev`  → www.localhost:3000
- `bun --filter @repo/app dev`  → app.localhost:3001
- `bun --filter @repo/auth dev` → auth.localhost:3002 (sign-in / sign-up surface)

**Sub-domain routing in dev:** modern browsers auto-resolve `*.localhost`. No /etc/hosts edits needed. Sessions are shared across `app.localhost` and `auth.localhost` via cookies on `.localhost`.
```

If a README section listing the apps and their production URLs exists, append `apps/auth` to it with `auth.brand.com`.

- [ ] **Step 4: Verify nothing builds against the old text**

```bash
grep -rn "app.localhost.*sign-in\|sign-in?error" docs/auth-providers.md README.md
```

The only matches should be inside the smoke-check examples that reference auth.localhost.

- [ ] **Step 5: Commit**

```bash
git add apps/app/.env.example docs/auth-providers.md README.md
git commit -m "docs(auth): document auth.brand.com URLs and dev script"
```

---

## Task 15: Full gauntlet + visual smoke + merge

The final gate.

- [ ] **Step 1: Run the full workspace gauntlet**

```bash
bun run test
bun run check-types
bun run lint
bun run build
```

All four exit 0. Total test count: ≈ 218 (≈ 192 apps/app + 29 apps/auth + 6 packages/supabase).

- [ ] **Step 2: Visual smoke**

Open two terminal panes:

```bash
bun --filter @repo/app dev
bun --filter @repo/auth dev
```

In a private browser window:

- Visit `http://app.localhost:3001/dashboard` while anonymous → expect a 307 to `http://auth.localhost:3002/sign-in?redirect_to=http%3A%2F%2Fapp.localhost%3A3001%2Fdashboard`.
- The auth provider list renders. Click "Continue with email" → URL becomes `http://auth.localhost:3002/sign-in/email`. Browser back works.
- Visit `http://auth.localhost:3002/sign-in?error=access_denied` → Sonner toast fires, URL param strips.
- Visit `http://auth.localhost:3002/` → 307 to `/sign-in`.
- If a test Supabase project is configured: complete a real Google sign-in. After consent, you land on `http://app.localhost:3001/dashboard` (or `/onboarding` first time). Inspect `document.cookie` on both `app.localhost` and `auth.localhost` — the `sb-…-auth-token` cookies should be visible on both (Domain=.localhost).
- Click Sign out from the dashboard → land on `http://auth.localhost:3002/sign-in`. Refresh the dashboard tab → bounced back to auth. Cross-app sign-out worked.

If `.localhost` subdomain cookies don't propagate in your browser, swap `AUTH_COOKIE_DOMAIN=.localhost` for `AUTH_COOKIE_DOMAIN=.lvh.me` and use `auth.lvh.me:3002` / `app.lvh.me:3001`. The spec calls this out as a known fallback.

- [ ] **Step 3: Final merge**

```bash
git checkout main
git merge --no-ff <feature-branch> -m "Merge <feature-branch>: split auth into @repo/auth microfrontend"
git push origin main
```

---

## Spec coverage map

Every requirement in `2026-06-06-auth-microfrontend-split-design.md` maps to a task:

| Spec section | Task(s) |
|---|---|
| `@repo/supabase` package + cookie-domain config | 1, 2, 3, 4 |
| Migrate apps/app to shared package | 5 |
| apps/auth scaffold (dirs, configs, env, layout, globals, root redirect) | 6 |
| Move auth components | 7 |
| `parseAndValidateRedirectTo` + schemas | 8 |
| Move routes + `redirect_to` cookie capture + OAuth start origin | 9 |
| Move tests | 10 |
| `/auth/callback` with redirect_to + extended (g/h/i) cases | 11 |
| apps/auth middleware + cutover apps/app middleware + sign-out redirect | 12 |
| Delete obsolete `(auth)` group + components + schemas | 13 |
| Docs (provider doc, env.example, README) | 14 |
| Full gauntlet + smoke + merge | 15 |
| Risks: `.localhost` cookie fallback to `.lvh.me` | 15 (smoke step) |
