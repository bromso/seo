# Auth provider setup

How to register Google, Microsoft, and GitHub OAuth apps and wire them
into the Supabase project. Apple is intentionally deferred.

## Local dev: zero env setup

`@repo/supabase` falls back to the Supabase CLI's deterministic local
defaults (`http://127.0.0.1:54321` + the well-known anon JWT) when
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset
and `NODE_ENV !== "production"`. Cloning the repo and running
`supabase start && bun dev` is enough — no `.env.local` required.

In production, both env vars are required and the package throws if
either is missing.

## Why dev uses `*.lvh.me` instead of `*.localhost`

Chrome (and other Public Suffix List-respecting browsers) treat
`.localhost` as a public suffix. That means cookies set with
`Domain=.localhost` are **silently rejected** — the browser drops them.
We need cross-app session cookies that survive a redirect from
`auth.lvh.me:3002` back to `app.lvh.me:3001`, so `.localhost` does not
work for this microfrontend split.

`lvh.me` is a public DNS name whose A records all point at `127.0.0.1`.
It is **not** on the PSL, so `Domain=.lvh.me` cookies are accepted and
propagate across subdomains. No `/etc/hosts` edits required; the DNS
lookup just works.

Dev URLs:
- `http://app.lvh.me:3001` (apps/app)
- `http://auth.lvh.me:3002` (apps/auth)

If you ever see "the session cookie won't persist across apps" in dev,
double-check that you're using `lvh.me` and not reverted to `localhost`.

## URLs you'll need

| Env | Auth URL | OAuth callback (Supabase) |
|---|---|---|
| Local | `http://auth.lvh.me:3002` | `https://<project>.supabase.co/auth/v1/callback` |
| Production | `https://auth.brand.com` | `https://<project>.supabase.co/auth/v1/callback` |

In Supabase (Authentication → URL Configuration → Redirect URLs), add:

- `http://auth.lvh.me:3002/auth/callback`
- `https://auth.brand.com/auth/callback` (once production exists)

Set Site URL to `https://auth.brand.com`. After sign-in, users land on `https://app.brand.com/{dashboard,onboarding}` — the auth app forwards them there via the validated `redirect_to`.

## Google

1. https://console.cloud.google.com → APIs & Services → Credentials.
2. **Create credentials** → **OAuth client ID** → **Web application**.
3. Authorized JavaScript origins: `http://auth.lvh.me:3002`, `https://auth.brand.com`.
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

0. Both `bun --filter @repo/auth dev` and `bun --filter @repo/app dev` must be running.
1. Open `http://auth.lvh.me:3002/sign-in` in a private window.
2. Click the provider button. The consent screen should appear.
3. After consent, you should land on `/onboarding` (first sign-in) or `/dashboard` (returning).
4. Cancel at the provider → you should land back on `/sign-in` with a Sonner toast saying "Sign-in cancelled."

If you see a "redirect_uri_mismatch" error, the callback URL at the provider doesn't exactly match the one Supabase sends; copy it from Supabase Authentication → Providers and paste it verbatim.
