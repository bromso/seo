# Auth: URL-driven steps + OAuth providers — Design

**Status:** Approved, ready for plan.
**Date:** 2026-06-06.
**Scope:** `apps/app` only. Marketing site (`apps/www`) is unaffected.

## Goal

Two changes to the auth surface, no design churn:

1. **URL-driven email step.** Pressing "Continue with email" navigates to a real URL (`/sign-in/email`, `/sign-up/email`) instead of toggling local state, so the back button works and the URLs are bookmarkable.
2. **Working OAuth.** Wire Google, Microsoft, and GitHub through to Supabase, so a user can sign in or create an account with those providers end to end. Apple deferred (Apple Developer membership + JWT-rotating client secret aren't worth blocking on for v1).

The visual design from the previous pass (`AuthShell`, `AuthProviderButton`, provider marks, two-step flow) is preserved unchanged.

## Non-goals

- Apple sign-in. Re-evaluate once an Apple Developer account is in place.
- Passkey backend wiring. Button stays visual-only.
- Account linking. If a user signs in with Google using an email that already has a password account, Supabase's default behavior applies (same identity attached to the existing user iff the email is verified; otherwise the OAuth attempt fails with a recognizable error and we forward it to the toast surface). Active linking UX is a follow-up.
- A `profiles` table or "onboarding completed" flag. The presence of any row in `sites` is the proxy for "this user has finished onboarding."

## Routes and file structure

```
apps/app/src/app/(auth)/
├── sign-in/
│   ├── page.tsx           ← provider list
│   └── email/
│       └── page.tsx       ← email + password form
├── sign-up/
│   ├── page.tsx           ← provider list
│   └── email/
│       └── page.tsx       ← display name + email + password form
└── auth/
    ├── start/
    │   └── actions.ts     ← startOAuthAction(provider)
    └── callback/
        └── route.ts       ← code → session → /onboarding or /dashboard
```

### Component refactor

The current `SignInView` / `SignUpView` files are removed; their responsibilities split:

- **`<SignInProviderList>` / `<SignUpProviderList>`** — server components. Render the provider button rows and the `<Link href=".../email">` for the email step.
- **`<SignInEmailForm>` / `<SignUpEmailForm>`** — client components, the existing react-hook-form code unchanged. Mounted by `sign-in/email/page.tsx` and `sign-up/email/page.tsx`.
- **`<OAuthProviderForm provider="…" label="…" icon={<…/>} tone="…">`** — server component, wraps `<AuthProviderButton type="submit">` in a `<form action={startOAuthAction.bind(null, provider)}>`. One file, reused for all three providers across both pages.
- **`<AuthErrorToast>`** — client component, mounted in both provider list pages, watches `?error=` and fires a Sonner toast.

The existing `<AuthShell>`, `<AuthProviderButton>`, and `<provider-icons>` files stay as they are. `AuthProviderButton` already accepts `type="submit"`, so no API change.

A new `GitHubMark` is added to `provider-icons.tsx` (single-path silhouette, monochrome, picks up the surrounding ink color like Apple does).

### Middleware

`apps/app/src/middleware.ts` already classifies `/sign-in`, `/sign-up`, and anything under `/auth/*` as public auth routes. The new `/sign-in/email` and `/sign-up/email` paths fall under the existing `path === "/sign-in"` / `"/sign-up"` checks — those need to widen to `startsWith` so the sub-routes don't bounce unauthenticated users:

```ts
const isAuthRoute =
  path === "/sign-in" ||
  path === "/sign-up" ||
  path.startsWith("/sign-in/") ||
  path.startsWith("/sign-up/") ||
  path.startsWith("/auth/")
```

The "logged-in user on auth route → bounce to /dashboard" branch keeps working for the new sub-routes via the same check.

## Server Action: startOAuthAction

```ts
// apps/app/src/app/(auth)/auth/start/actions.ts
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

  if (error || !data?.url) {
    redirect(`/sign-in?error=${encodeURIComponent(error?.message ?? "oauth_unavailable")}`)
  }
  redirect(data.url)
}
```

Bound to a provider value via `startOAuthAction.bind(null, "google")` inside `<OAuthProviderForm>`. Provider value is locked server-side; the client can't tamper with it.

Reads the request `Origin` header to construct the callback URL so dev (`app.localhost:3001`), Vercel previews, and production (`app.brand.com`) all work from one code path with no per-environment env var.

Supabase server client handles the PKCE verifier cookie; Server Action context provides the cookie writer.

## Callback handler

```ts
// apps/app/src/app/(auth)/auth/callback/route.ts
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

  const { count } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
  const destination = (count ?? 0) === 0 ? "/onboarding" : "/dashboard"
  return NextResponse.redirect(new URL(destination, url))
}
```

Replaces the existing 501 stub.

`sites` is the onboarding proxy: zero rows means the user has never finished the "add your first site" step, so route them through `/onboarding`. Any rows means returning user, route to `/dashboard`. RLS keeps the count scoped to the now-authenticated user automatically.

Provider-side errors (user cancels, scope denied) arrive as `?error=access_denied&error_description=…` and get forwarded to the toast surface.

## Error UX

Pattern: callback or action redirects to `/sign-in?error=<code>` (or `/sign-up?error=...` from sign-up start). The provider list page mounts `<AuthErrorToast>`, which:

1. Reads `?error=` once on mount.
2. Looks up a friendly message from a small map; falls back to "Sign-in failed. Try again."
3. Fires `toast.error(...)`.
4. `router.replace`s the URL without the `error` param so refresh doesn't re-toast.

Initial known codes:

| Code | Message |
|---|---|
| `access_denied` | "Sign-in cancelled." |
| `missing_code` | "Sign-in didn't complete. Try again." |
| `oauth_unavailable` | "That provider isn't available right now." |
| anything else | "Sign-in failed. Try again." |

## Provider button wiring

The provider list page renders one `<OAuthProviderForm>` per real provider, a visual-only button for Apple and passkey, and a `<Link>` for the email step. Identical for sign-in and sign-up except for the label copy ("Continue with…" vs "Sign up with…") and the destination link (`/sign-in/email` vs `/sign-up/email`).

```tsx
// sign-in/page.tsx (excerpt)
<OAuthProviderForm provider="google" tone="primary" label="Continue with Google" icon={<GoogleMark />} />
<OAuthProviderForm provider="azure"  label="Continue with Microsoft" icon={<MicrosoftMark />} />
<OAuthProviderForm provider="github" label="Continue with GitHub" icon={<GitHubMark />} />
<AuthProviderButton label="Continue with Apple" icon={<AppleMark />} onClick={comingSoon("Apple")} />
<div className="… or divider …">or</div>
<Link href="/sign-in/email"><AuthProviderButton type="button" label="Continue with email" icon={<MailMark />} /></Link>
<AuthProviderButton label="Sign in with a passkey" icon={<PasskeyMark />} onClick={comingSoon("Passkey")} />
<AuthErrorToast />
```

## Environment and Supabase dashboard setup

| Provider | Register at | Paste into Supabase |
|---|---|---|
| Google | console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web) | Client ID + Client Secret |
| Microsoft | portal.azure.com → Entra ID → App registrations → New registration (Web, multi-tenant) | Application (client) ID + Client Secret |
| GitHub | github.com/settings/developers → OAuth Apps → New OAuth App | Client ID + Client Secret |

Redirect URL registered at the **provider**: the Supabase project callback (`https://<project>.supabase.co/auth/v1/callback`). Redirect URL registered in **Supabase** (Authentication → URL Configuration → Redirect URLs):

- `http://app.localhost:3001/auth/callback`
- `https://app.brand.com/auth/callback` (once production exists)

Site URL in Supabase: `https://app.brand.com` for production, fine to leave as `http://app.localhost:3001` for local-only.

No new env vars on the app side. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` continue to be the only auth-relevant env values.

A `docs/auth-providers.md` ships with the implementation as a one-time provider-registration reference (URLs, screenshots-as-text steps, what to paste where). This is a documentation deliverable in the plan, not just an aside.

## Testing strategy

### Automated (vitest + happy-dom)

| Test | Asserts | File |
|---|---|---|
| `startOAuthAction` | Calls `signInWithOAuth` with the given provider and a `redirectTo` derived from the `Origin` header. Forwards `data.url` to `redirect()` on success. Redirects to `/sign-in?error=…` on error. | `src/test/auth/start-oauth.test.ts` |
| `/auth/callback` GET | (a) `?error=access_denied` → redirects to `/sign-in?error=access_denied`. (b) missing `code` → redirects to `/sign-in?error=missing_code`. (c) `exchangeCodeForSession` failure → forwards error message. (d) success + `sites count === 0` → `/onboarding`. (e) success + `sites count > 0` → `/dashboard`. (f) success + `sites count` query errors → defaults to `/dashboard`. | `src/test/auth/callback.test.ts` |
| `<AuthErrorToast>` | Renders null. On mount with `?error=access_denied`, fires `toast.error` with "Sign-in cancelled." then `router.replace`s without the param. No-op without the param. Unknown error code falls back to generic message. | `src/test/components/auth-error-toast.test.tsx` |
| `<OAuthProviderForm>` | Renders a `<form>` with `action` bound to the right provider. Submitting the form (jsdom click on the button) fires the bound action. | `src/test/components/oauth-provider-form.test.tsx` |
| Email step routing | `/sign-in/email` renders the email form. The "← Login options" link points to `/sign-in`. Same for sign-up. | `src/test/auth/email-step.test.tsx` |

Supabase is mocked via `vi.mock("@/lib/supabase-server")` for the action and route tests. No live provider roundtrip in CI.

### Manual smoke (per environment, post-deploy)

1. Each real provider button on `/sign-in` opens the provider consent screen.
2. After consent, lands on `/onboarding` for a brand-new account.
3. After consent, lands on `/dashboard` for an account that already has sites.
4. Cancelling at the provider lands back on `/sign-in` with the right toast.
5. `/sign-in/email` is reachable directly via URL and via the "Continue with email" button.
6. Browser back from `/sign-in/email` lands on the provider list.
7. Same flow for `/sign-up` and `/sign-up/email`.

## Risks and mitigations

- **PKCE verifier cookie lost across the OAuth roundtrip.** Mitigation: Server Action sets the cookie via the Supabase server client cookie adapter, same machinery middleware uses. Verified by step (1) of the smoke checklist.
- **Origin header missing or wrong behind a proxy.** Mitigation: fallback to `http://app.localhost:3001`. If production needs a different fallback we add an env var then.
- **Toast fires on every refresh after an error.** Mitigation: `<AuthErrorToast>` strips the param via `router.replace` on mount, so a refresh sees a clean URL.
- **`sites count` query fails on the callback.** Mitigation: catch the count error and default to `/dashboard` (least-surprising landing). Test (d)/(e) covers the happy path; an extra (f) covers the failure-defaults-to-dashboard branch.

## Out of scope (deferred)

- Apple sign-in (provider setup blocked on Apple Developer account).
- Passkey backend (separate feature; UI is a placeholder).
- Active account-linking UX (rely on Supabase defaults for v1).
- Profile / "onboarding completed" flag refactor.
- `redirect_to` query-param honoring for deep links (note in code so it's an easy follow-up).
