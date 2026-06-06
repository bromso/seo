# Auth microfrontend split — Design

**Status:** Approved, ready for plan.
**Date:** 2026-06-06.
**Scope:** Move all auth surfaces from `apps/app` into a new `apps/auth` (auth.brand.com), introduce a shared `@repo/supabase` package, and wire the two apps together via domain-level cookies and a `redirect_to` contract.

## Goal

Two things:

1. **Carve out auth as its own subdomain microfrontend.** `apps/auth` owns `/sign-in`, `/sign-up`, the email steps, `/auth/start` Server Action, and `/auth/callback`. Sign-out and onboarding stay in `apps/app`. The visual design from the recent passes (`AuthShell`, provider buttons, error toast, OAuth wiring) ports over unchanged.
2. **Establish the microfrontend pattern** so future apps (`apps/docs`, `apps/billing`, ...) follow the same template: own subdomain, shared session via cookies on `.brand.com`, shared client helpers in `@repo/supabase`.

## Non-goals

- Extracting auth UI into a shared `@repo/auth-ui` package. Only one app consumes it; premature abstraction.
- Apple sign-in or passkey backend wiring (still deferred).
- Cross-app deep-link history (`redirect_to`) for new users — onboarding wins.
- Account-linking UX (Supabase defaults stand).
- Token-handoff or PostMessage auth strategies. Rejected in favour of domain-level cookies.

## Architecture overview

```
apps/
├── app/                     (existing, app.brand.com:3001 dev)
├── auth/                    (NEW, auth.brand.com:3002 dev)
├── runner/                  (existing, audit daemon)
├── story/                   (existing)
└── www/                     (existing)
packages/
├── supabase/                (NEW, shared client + cookie domain)
├── ui/                      (existing)
├── db/                      (existing)
├── tokens/
├── typescript-config/
└── audit-* / runner-core / lighthouse-runner
```

The two apps share state through Supabase session cookies set with `Domain=.brand.com` (and `Domain=.localhost` in dev). The auth app issues the cookie on successful sign-in; the app reads it on every middleware call.

## `@repo/supabase` package surface

Two thin wrappers around `@supabase/ssr` plus a middleware variant. The only meaningful addition over the current `apps/app/src/lib/supabase-*.ts` files is opt-in cookie-domain support via env vars.

```ts
// packages/supabase/src/server.ts
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
        setAll: (cookiesToSet) => {
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
            /* RSC context: middleware writes the refresh */
          }
        },
      },
    },
  )
}

// packages/supabase/src/browser.ts
import { createBrowserClient } from "@supabase/ssr"

let cached: ReturnType<typeof createBrowserClient> | undefined
export function createBrowserSupabase() {
  if (cached) return cached
  cached = createBrowserClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookieOptions: process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"]
        ? { domain: process.env["NEXT_PUBLIC_AUTH_COOKIE_DOMAIN"] }
        : undefined,
    },
  )
  return cached
}

// packages/supabase/src/middleware.ts
import { type CookieOptions, createServerClient } from "@supabase/ssr"
import type { NextRequest, NextResponse } from "next/server"
export function createMiddlewareSupabase(req: NextRequest, response: NextResponse) {
  return createServerClient(URL, KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookies) => {
        for (const c of cookies) {
          response.cookies.set(c.name, c.value, {
            ...c.options,
            ...(process.env["AUTH_COOKIE_DOMAIN"]
              ? { domain: process.env["AUTH_COOKIE_DOMAIN"] }
              : {}),
          })
        }
      },
    },
  })
}
```

Exports map: `@repo/supabase/server`, `@repo/supabase/browser`, `@repo/supabase/middleware`. Both apps depend on `@repo/supabase` as a workspace package.

## `apps/auth` scaffold

```
apps/auth/
├── package.json              # name: @repo/auth, dev: --port 3002 --hostname auth.localhost
├── tsconfig.json             # extends @repo/typescript-config/nextjs.json
├── next.config.ts            # no Serwist (auth is one-shot)
├── biome.json                # extends root
├── postcss.config.mjs
├── .env.example
├── public/                   # favicon, robots (Disallow: /)
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── globals.css
    │   ├── page.tsx          # 307 to /sign-in
    │   ├── sign-in/page.tsx
    │   ├── sign-in/email/page.tsx
    │   ├── sign-up/page.tsx
    │   ├── sign-up/email/page.tsx
    │   └── auth/
    │       ├── start/actions.ts
    │       └── callback/route.ts
    ├── components/           # AuthShell, AuthProviderButton, AuthErrorToast,
    │                        # OAuthProviderForm, provider-icons,
    │                        # sign-in-email-form, sign-up-email-form
    ├── lib/
    │   ├── schemas.ts        # SignInSchema, SignUpSchema
    │   └── redirect-to.ts    # parseAndValidateRedirectTo
    ├── middleware.ts
    └── test/
```

`apps/auth/package.json` mirrors `apps/app`'s shape (vitest, happy-dom, biome, typescript devDeps; next/react/react-dom/sonner/zod via `catalog:`). Adds `@repo/supabase` and `@repo/ui` workspace deps.

`apps/auth/.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://app.localhost:3001
NEXT_PUBLIC_AUTH_URL=http://auth.localhost:3002
AUTH_COOKIE_DOMAIN=.localhost
NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.localhost
```

A root `app/page.tsx` redirects to `/sign-in` so `auth.brand.com` doesn't 404. No PWA / ServiceWorker (one-shot surface).

## File migration map

### Routes (`apps/app/src/app/(auth)/...` → `apps/auth/src/app/...`)

| From | To | Changes |
|---|---|---|
| `(auth)/sign-in/page.tsx` | `sign-in/page.tsx` | Plus capture `?redirect_to=` into `auth.redirect_to` cookie (10 min TTL) |
| `(auth)/sign-in/email/page.tsx` | `sign-in/email/page.tsx` | None |
| `(auth)/sign-up/page.tsx` | `sign-up/page.tsx` | Plus capture `?redirect_to=` cookie |
| `(auth)/sign-up/email/page.tsx` | `sign-up/email/page.tsx` | None |
| `(auth)/auth/start/actions.ts` | `auth/start/actions.ts` | Origin fallback flips to `http://auth.localhost:3002` |
| `(auth)/auth/callback/route.ts` | `auth/callback/route.ts` | Reads `auth.redirect_to` cookie; validates against allowlist; routes new users to `${NEXT_PUBLIC_APP_URL}/onboarding`, returning to `redirect_to` or `${NEXT_PUBLIC_APP_URL}/dashboard` |

### Components (`apps/app/src/components/*` → `apps/auth/src/components/*`)

`auth-shell.tsx`, `auth-provider-button.tsx`, `auth-error-toast.tsx`, `oauth-provider-form.tsx`, `provider-icons.tsx`, `sign-in-email-form.tsx`, `sign-up-email-form.tsx`. Only `oauth-provider-form.tsx` has an import path change (`@/app/auth/start/actions`). The rest move verbatim.

### Library code

| File | Action |
|---|---|
| `apps/app/src/lib/supabase-browser.ts` | Delete; both apps import from `@repo/supabase/browser` |
| `apps/app/src/lib/supabase-server.ts` | Delete; both apps import from `@repo/supabase/server` |
| `apps/app/src/lib/schemas.ts` | Remove `SignInSchema`, `SignInInput`, `SignUpSchema`, `SignUpInput`. Keep the rest (sites, audits, competitors). |
| `apps/auth/src/lib/schemas.ts` (NEW) | Just `SignInSchema` and `SignUpSchema` |
| `apps/auth/src/lib/redirect-to.ts` (NEW) | `parseAndValidateRedirectTo(raw, allowlist) → string \| null` |

### Tests

| File | Action |
|---|---|
| `apps/app/src/test/auth/start-oauth.test.ts` | Move; default-origin assertion → `http://auth.localhost:3002` |
| `apps/app/src/test/auth/callback.test.ts` | Move; add cases (g)/(h)/(i) for `redirect_to` honour, allowlist rejection, and onboarding-wins |
| `apps/app/src/test/auth/email-step-pages.test.tsx` | Move; import paths flip |
| `apps/app/src/test/components/auth-error-toast.test.tsx` | Move |
| `apps/app/src/test/components/oauth-provider-form.test.tsx` | Move |
| `apps/app/src/test/middleware-auth-routes.test.ts` | Rename to `middleware.test.ts`; rewrite cases for the new bounce target |
| `apps/auth/src/test/middleware.test.ts` (NEW) | Authed user on `/sign-in*` / `/sign-up*` → 307 to `${NEXT_PUBLIC_APP_URL}/dashboard`; anon passes through |
| `apps/auth/src/test/redirect-to.test.ts` (NEW) | Allowlist validation: app origin OK, foreign rejected, malformed rejected, undefined rejected |
| `packages/supabase/src/test/server.test.ts` (NEW) | `setAll` injects `domain: AUTH_COOKIE_DOMAIN` when env var is set; omits when unset |
| `packages/supabase/src/test/browser.test.ts` (NEW) | Memoizes; passes `cookieOptions.domain` when env var set |

### Deleted from apps/app

`(auth)/` route group, all seven auth components, both supabase lib files, the moved tests.

### Stays in apps/app

`(app)/dashboard/**`, `(app)/onboarding/page.tsx`, `(app)/sign-out/route.ts`, `middleware.ts` (rewritten — see next section).

## Cross-app redirect contract

The full flow:

```
anon hits app.brand.com/dashboard
  → apps/app middleware: no session
  → 307 to ${NEXT_PUBLIC_AUTH_URL}/sign-in?redirect_to=<encoded original URL>

apps/auth sign-in page (server component) reads ?redirect_to=, writes it into
  an HTTP-only, 10-min, lax, secure-in-prod cookie named `auth.redirect_to`.

user clicks Continue with Google
  → /auth/start Server Action calls signInWithOAuth({
      redirectTo: `${origin}/auth/callback`,
    })
  → Supabase → Google consent → Supabase project → 307 to auth.brand.com/auth/callback?code=...

apps/auth callback:
  → exchangeCodeForSession → session cookie set with Domain=.brand.com
  → reads auth.redirect_to cookie, deletes it
  → validates against allowlist [NEXT_PUBLIC_APP_URL, "http://app.localhost:3001"]
  → count sites rows:
      - 0 (new user): 307 to `${NEXT_PUBLIC_APP_URL}/onboarding` (redirect_to ignored)
      - >0: 307 to validated redirect_to ?? `${NEXT_PUBLIC_APP_URL}/dashboard`
      - count query errors: defaults to `/dashboard` per the v1 callback's existing fallback

now the user is on app.brand.com/<dest>
  → apps/app middleware reads the .brand.com cookie → session present → renders
```

### apps/app middleware (rewritten)

```ts
if (!user && !isPublicRoute) {
  const target = new URL(`${process.env.NEXT_PUBLIC_AUTH_URL}/sign-in`)
  target.searchParams.set("redirect_to", req.nextUrl.href)
  return NextResponse.redirect(target)
}
```

`isPublicRoute` keeps `/`, `/_next/*`, `/favicon*`, `/manifest*`, `/sw.js`, **and** `/sign-out` (so the sign-out POST itself doesn't get bounced before it can clear the session). The previous `isAuthRoute` branch disappears entirely; apps/app no longer serves `/sign-in` or `/sign-up`.

### apps/auth middleware

```ts
const isAuthSurface =
  path === "/sign-in" || path === "/sign-up" ||
  path.startsWith("/sign-in/") || path.startsWith("/sign-up/")

if (user && isAuthSurface) {
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`)
}
```

Everything else under apps/auth is implicitly public.

### parseAndValidateRedirectTo

```ts
export function parseAndValidateRedirectTo(
  raw: string | undefined,
  allowlist: string[],
): string | null {
  if (!raw) return null
  let url: URL
  try { url = new URL(raw) } catch { return null }
  const ok = allowlist.some((origin) => {
    try { return new URL(origin).origin === url.origin } catch { return false }
  })
  return ok ? url.toString() : null
}
```

### Edge cases covered by the design

- New user with `redirect_to` set: onboarding wins.
- `redirect_to` pointing at a foreign origin: silently dropped, user lands on `/dashboard`.
- `redirect_to` malformed: same.
- User cancels at the OAuth provider: handled by the existing `?error=access_denied` toast.

## Sign-out and session lifecycle

Sign-out lives at `apps/app/src/app/(app)/sign-out/route.ts`. The shared `.brand.com` cookie means `supabase.auth.signOut()` invalidates the session for both apps in one shot.

```ts
import { createServerSupabase } from "@repo/supabase/server"
import { NextResponse } from "next/server"

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_AUTH_URL}/sign-in`, 303)
}
```

Two changes from today: the import path flips to `@repo/supabase/server`, and the post-sign-out redirect targets `${NEXT_PUBLIC_AUTH_URL}/sign-in` instead of an app-local `/sign-in` (which no longer exists). 303 keeps POST → GET clean.

The existing `<SignOutButton>` client component is unchanged — it still clears offline caches client-side, then submits to `/sign-out`. Any post-POST `router.push` it might have had goes away; the route handler's `Location` header is authoritative.

Token refresh: both apps' middlewares call `getUser()`, which refreshes the session when the access token is near expiry. With the cookie on `.brand.com`, either middleware can refresh; last writer wins. No contention worth worrying about for a single user.

`/sign-out` is POST-only; GET → 405. Middleware allows `/sign-out` through even for anonymous users (otherwise the bounce kicks in before sign-out can land).

## Provider docs and Supabase dashboard

Provider-side OAuth registration at Google / Microsoft / GitHub is **unchanged**: the redirect URI is still the Supabase project's `/auth/v1/callback`. Supabase forwards from there to our `auth.brand.com/auth/callback`.

**Supabase dashboard changes:**

| Setting | Path | Before | After |
|---|---|---|---|
| Site URL | Authentication → URL Configuration | `https://app.brand.com` | `https://auth.brand.com` |
| Redirect URLs allowlist | same screen | `http://app.localhost:3001/auth/callback`, `https://app.brand.com/auth/callback` | adds `http://auth.localhost:3002/auth/callback`, `https://auth.brand.com/auth/callback` (old entries can stay during transition, removed after cutover) |
| Google "Authorized JavaScript origins" | Google Cloud Console | `http://app.localhost:3001`, `https://app.brand.com` | add `http://auth.localhost:3002`, `https://auth.brand.com` |

`docs/auth-providers.md` updates:

| Section | Edit |
|---|---|
| "URLs you'll need" table | App URL column → Auth URL; values become `http://auth.localhost:3002` / `https://auth.brand.com`. Brief note: "After sign-in, users land on `https://app.brand.com/{dashboard,onboarding}`." |
| "In Supabase…" bullet list | Replace with the four URLs during transition; collapse to auth-only after cutover. Site URL → `https://auth.brand.com`. |
| Google step 3 | Authorized JavaScript origins gain the auth subdomain. |
| Smoke check | Open `http://auth.localhost:3002/sign-in` instead of `app.localhost:3001/sign-in`. Post-consent landing references the app domain explicitly. |

`apps/app/.env.example` gains:
```
NEXT_PUBLIC_AUTH_URL=http://auth.localhost:3002
AUTH_COOKIE_DOMAIN=.localhost
NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.localhost
```

Root `README.md`'s dev-script section adds the `bun --filter @repo/auth dev` line and notes the three subdomain URLs (`www.localhost:3000`, `app.localhost:3001`, `auth.localhost:3002`).

## Testing strategy

| Layer | Test | File |
|---|---|---|
| `@repo/supabase/server` | `setAll` injects `domain` from env when set; omits when unset. | `packages/supabase/src/test/server.test.ts` |
| `@repo/supabase/browser` | Memoizes client; passes `cookieOptions.domain` when env set. | `packages/supabase/src/test/browser.test.ts` |
| `parseAndValidateRedirectTo` | Allowlist OK; foreign rejected; malformed rejected; undefined rejected. | `apps/auth/src/test/redirect-to.test.ts` |
| `apps/auth` middleware | Authed user on `/sign-in*` / `/sign-up*` → 307 to `${NEXT_PUBLIC_APP_URL}/dashboard`; anon passes; other paths pass. | `apps/auth/src/test/middleware.test.ts` |
| `apps/auth /auth/callback` GET | Existing cases (a–f), plus (g) `redirect_to` cookie honoured for returning user, (h) foreign origin → dashboard, (i) onboarding wins for new user. | `apps/auth/src/test/auth/callback.test.ts` |
| `apps/auth /auth/start` action | Existing 4 cases; bump default origin to `http://auth.localhost:3002`. | `apps/auth/src/test/auth/start-oauth.test.ts` |
| `apps/auth` component + email-step tests | Move as-is. | `apps/auth/src/test/...` |
| `apps/app` middleware | Anon on `/dashboard` → 307 to `${NEXT_PUBLIC_AUTH_URL}/sign-in?redirect_to=<original URL>`. Authed passes. `/sign-out` passes even when anon. | `apps/app/src/test/middleware.test.ts` (renamed from `middleware-auth-routes.test.ts`) |

Manual smoke (post-implementation, both dev servers running):

1. `http://app.localhost:3001/dashboard` while anon → land on `http://auth.localhost:3002/sign-in?redirect_to=http://app.localhost:3001/dashboard`.
2. Sign in via Google → land on `http://app.localhost:3001/dashboard` (or `/onboarding` first time).
3. Visit `http://auth.localhost:3002/sign-in` while signed in → 307 to `http://app.localhost:3001/dashboard`.
4. Click Sign out from the dashboard → land on `http://auth.localhost:3002/sign-in`. Refresh the dashboard tab → bounced back to auth.
5. `http://auth.localhost:3002/sign-in?error=access_denied` → toast fires, param stripped.

## Migration order

| Step | Why it's first |
|---|---|
| 1. Add `packages/supabase`; migrate apps/app to import from it (no behaviour change). | Establishes the shared dep before either app needs it. apps/app builds and ships green. |
| 2. Scaffold empty `apps/auth` (root → /sign-in placeholder; layout; tooling). | Verifies workspace picks up the new app; dev script works on 3002; lint/typecheck/test wire up. |
| 3. Move auth components from apps/app to apps/auth/src/components. | Pure code move. apps/app keeps the components as a temporary re-export so it still builds. |
| 4. Move auth routes from apps/app/(auth) to apps/auth/app. | apps/app's `(auth)` group temporarily proxies (server components that 307 to auth.localhost) so the contract works before middleware is rewritten. |
| 5. Add `redirect_to` cookie capture on /sign-in and /sign-up; add the helper + tests. | Foundational for the contract. |
| 6. Wire the new `/auth/callback` (cookie consumption + allowlist). | Both ends of the redirect now exist. |
| 7. Rewrite apps/app middleware to point at `${NEXT_PUBLIC_AUTH_URL}/sign-in?redirect_to=`. | The thin proxies from step 4 become unused; delete them. |
| 8. Delete `apps/app/(auth)` group + moved components + tests + schema entries + supabase libs. | Final cleanup. |
| 9. Update `docs/auth-providers.md`, both `.env.example` files, and the root `README.md` dev-script section. | Docs land last so they describe the final state. |

The plan turns each step into 1–3 TDD tasks. Estimating ~12–14 tasks total.

**Anti-risks the order takes care of:**
- Step 4's proxies keep the system green between commits even before middleware knows about auth.brand.com.
- Step 1 lands the shared-package change with identical behaviour to the current lib files, so any cookie-domain bugs surface separately from the move.

## Risks and mitigations

- **`.localhost` subdomain cookies don't propagate** in some browsers. Mitigation: spec defaults to `auth.localhost`; if the post-implementation smoke fails the cross-app sign-out check, fall back to `auth.lvh.me` (DNS-resolves to 127.0.0.1; same cookie story applies). Documented in `docs/auth-providers.md`.
- **OAuth `redirect_to` lost across the OAuth roundtrip.** Stored in an HTTP-only cookie before the OAuth start so it survives. Cookie has a 10-min TTL and is deleted by the callback on first read.
- **Open-redirect via `redirect_to`.** `parseAndValidateRedirectTo` validates against an allowlist of explicit origins; foreign and malformed inputs fall back to `/dashboard`.
- **Token refresh races.** Both middlewares can refresh the same session; last writer wins. No actual contention for a single user.
- **Static prerender of auth pages fails** due to `useSearchParams` in `<AuthErrorToast>`. Already mitigated in the source pages (Suspense boundary added in a prior commit); the move preserves it.

## Out of scope (deferred)

- Apple OAuth and passkey backend wiring.
- Account-linking UX (Supabase defaults stand).
- `redirect_to` enforcement across non-app subdomains.
- A future `apps/docs` or `apps/billing` template — covered by the pattern this work establishes, not by code here.
