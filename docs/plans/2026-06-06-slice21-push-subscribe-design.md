# Slice 21 — Push Notifications Subscribe Flow (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/push-subscribe-slice21`
**Carry-forward from:** Slice 20 (barrel cleanup done); push notifications is the biggest remaining PWA feature.

---

## Goal

Let users opt into web push notifications from the dashboard. Click "Enable notifications" → browser permission prompt → on grant, the SW's PushManager creates a subscription → client POSTs to `/api/push-subscribe` → server stores it in a new `push_subscriptions` Supabase table (RLS: owner only). Click "Disable" reverses the flow (browser unsubscribe + `DELETE /api/push-subscribe`).

Slice 22 wires actual server-sent push events on run completion. Slice 21 is foundation only — no `push` event listener yet.

---

## Non-Goals (slice 22+)

- SW `push` event listener.
- Server-side push delivery via `web-push` Node lib.
- "Test notification" admin button.
- Per-event filtering preferences ("notify on completion only").
- Pagination for multi-device subscriptions.
- Cleanup of expired endpoints (410 GONE handling).
- No new pages (button lives in existing dashboard header).
- No `/settings` page.

---

## Architecture

Three coordinated changes:

1. **DB**: new `push_subscriptions` table + Drizzle schema + RLS policies (owner reads/inserts/deletes own rows).
2. **Client helper**: new `apps/app/src/lib/push/subscribe.ts` exports `isPushSupported`, `getCurrentSubscription`, `subscribeToPush`, `unsubscribeFromPush`, and a `urlBase64ToUint8Array` helper. All wrap browser `navigator.serviceWorker.ready.pushManager` and `Notification` APIs with feature detection.
3. **UI**: new `<PushNotificationsButton>` component rendered in the dashboard header next to `<CompetitorDrawer>`. Toggles between "Enable notifications" and "Disable notifications" based on `pushManager.getSubscription()` state.

A new `/api/push-subscribe` route handles `POST` (idempotent upsert by endpoint) and `DELETE` (owner-scoped delete by endpoint).

---

## Setup & env vars

User runs this one-time locally before slice 21 can subscribe:

```bash
npx web-push generate-vapid-keys
```

Produces a public/private keypair. Three env vars land in `.env.local`:

```dotenv
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<base64url public key>
VAPID_PRIVATE_KEY=<base64url private key>   # slice 22 uses this
VAPID_EMAIL=mailto:you@example.com           # slice 22 uses this
```

**Slice 21 only reads `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.** The other two are documented but unused until slice 22.

**Local dev**: push works on `http://localhost` per the spec; HTTPS only required for non-localhost. No HTTPS proxy needed for dev.

---

## DB migration

New migration: `packages/db/migrations/0006_push_subscriptions.sql`

```sql
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_owner_idx
  ON public.push_subscriptions (owner_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners read own subscriptions"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "owners insert own subscriptions"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "owners delete own subscriptions"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = owner_id);
```

**Schema choices:**
- `endpoint` is UNIQUE: dedupes re-subscribes from the same browser. The endpoint URL contains the push service identifier — re-subscribing produces the same endpoint until the service revokes the keys.
- `p256dh` + `auth` are the encryption keys the server needs to construct an encrypted push payload (slice 22). Both base64url-encoded strings.
- `user_agent` is optional metadata for debugging ("which browser is this subscription from?").
- No UPDATE policy — re-subscribe is DELETE + INSERT inside the endpoint handler (Section 4).
- ON DELETE CASCADE: account deletion (`auth.users` deletion) cascades through.

Drizzle schema in `packages/db/src/schema/push-subscriptions.ts` mirrors this. Journal entry `"version": "7"` matches the existing journal pattern (verified across slices 5-11).

---

## Client-side subscribe helper

New file: `apps/app/src/lib/push/subscribe.ts`

```ts
"use client"

export type PushSubscriptionPayload = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Convert a base64url-encoded VAPID public key to the Uint8Array
 *  that PushManager.subscribe requires. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(normalized)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf
}

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false
  return "serviceWorker" in navigator && "PushManager" in window
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return await reg.pushManager.getSubscription()
}

export async function subscribeToPush(
  vapidPublicKey: string
): Promise<PushSubscriptionPayload | null> {
  if (!isPushSupported()) return null
  if (typeof Notification === "undefined") return null

  let permission = Notification.permission
  if (permission === "default") {
    permission = await Notification.requestPermission()
  }
  if (permission !== "granted") return null

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return toPayload(existing)

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  })
  return toPayload(subscription)
}

export async function unsubscribeFromPush(): Promise<string | null> {
  if (!isPushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return endpoint
}

function toPayload(sub: PushSubscription): PushSubscriptionPayload {
  const json = sub.toJSON()
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
  }
}
```

Three things worth flagging:
- `userVisibleOnly: true` is required by spec — every push event must produce a user-visible notification. (Slice 22's `push` handler will obey.)
- `subscribeToPush` returns `null` instead of throwing on unsupported / denied paths so the calling component renders gracefully.
- `unsubscribeFromPush` returns the endpoint so the caller can pass it to `DELETE /api/push-subscribe`.

---

## `/api/push-subscribe` endpoint

New file: `apps/app/src/app/api/push-subscribe/route.ts`

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { createServerSupabase } from "@/lib/supabase-server"

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional(),
})

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

export async function POST(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = SubscribeSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  // Idempotent re-subscribe: delete existing row (if any) for this endpoint
  // then insert. Avoids touching other owners' rows because of RLS.
  await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint)

  const { error } = await supabase.from("push_subscriptions").insert({
    owner_id: user.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    user_agent: parsed.data.userAgent ?? null,
  })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = UnsubscribeSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint)
    .eq("owner_id", user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
```

Three things:
- POST is **idempotent**: deletes any existing row for this endpoint then inserts. Re-subscribe with the same endpoint produces the same row's content. Handles cross-user reuse on shared browsers (RLS scopes the delete to whoever owns the row).
- DELETE is owner-scoped (`.eq("owner_id", user.id)`) so a stale endpoint from a previous owner can't be deleted by the current one.
- Both methods require auth — anonymous requests get 401.

---

## `<PushNotificationsButton>` component

New file: `apps/app/src/components/push-notifications-button.tsx`

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  getCurrentSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/subscribe"

export function PushNotificationsButton() {
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!isPushSupported()) return
    setSupported(true)
    void getCurrentSubscription().then((sub) => setSubscribed(sub !== null))
  }, [])

  if (!supported) return null

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        start(async () => {
          if (subscribed) {
            const endpoint = await unsubscribeFromPush()
            if (!endpoint) {
              toast.error("Already unsubscribed")
              setSubscribed(false)
              return
            }
            const res = await fetch("/api/push-subscribe", {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ endpoint }),
            })
            if (!res.ok) {
              toast.error("Failed to unsubscribe")
              return
            }
            toast.success("Notifications disabled")
            setSubscribed(false)
            return
          }

          const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
          if (!key) {
            toast.error("Push notifications not configured")
            return
          }
          const payload = await subscribeToPush(key)
          if (!payload) {
            toast.error("Notification permission denied")
            return
          }
          const res = await fetch("/api/push-subscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              endpoint: payload.endpoint,
              keys: payload.keys,
              userAgent: navigator.userAgent,
            }),
          })
          if (!res.ok) {
            toast.error("Failed to enable notifications")
            return
          }
          toast.success("Notifications enabled")
          setSubscribed(true)
        })
      }}
    >
      {pending ? "…" : subscribed ? "Disable notifications" : "Enable notifications"}
    </Button>
  )
}
```

Integration: in `apps/app/src/views/dashboard-view.tsx`, the button mounts inside the existing flex header next to `CompetitorDrawer`:

```tsx
<div className="flex items-center gap-2">
  <PushNotificationsButton />
  <CompetitorDrawer competitors={competitors} />
</div>
```

Three notes:
- Feature detection via `isPushSupported()` — button is hidden entirely on unsupported browsers (Safari < 16, Firefox without SW support enabled, etc.).
- `useTransition` blocks double-clicks (same pattern as `SiteScoreCard` from slice 13).
- The button only updates local state; if the user clears site data via DevTools, the next mount detects no subscription and shows "Enable" again.

---

## Testing strategy

Tests delta: **179 → 188 (+9 net new)**.

### `subscribe.test.ts` (new, +4)

```ts
// happy-dom + fake navigator.serviceWorker / Notification / PushManager
- urlBase64ToUint8Array converts a known VAPID public key correctly
- isPushSupported returns false when serviceWorker is absent
- subscribeToPush returns null when Notification permission is denied
- subscribeToPush calls pushManager.subscribe(userVisibleOnly: true, key) and returns payload on grant
```

Helper tested in isolation: fake `navigator.serviceWorker.ready` returning a stubbed `PushManager`. No real SW required.

### `push-subscribe.test.ts` (new, +3)

```ts
- POST without auth → 401
- POST with valid payload → 200, inserts a row via mocked Supabase client
- DELETE with valid payload → 200, deletes a row via mocked Supabase client
```

Reuses the slice-8/11 `/api/audit-run` test pattern: mock `createServerSupabase` via `vi.mock("@/lib/supabase-server")`, assert insert/delete calls.

### `push-notifications-button.test.tsx` (new, +2)

```ts
- Renders nothing when push isn't supported
- "Enable notifications" click → subscribes + POSTs + shows "Disable notifications"
```

Same harness as slice 13's `SiteScoreCard` test: stub `fetch`, mock the push helper module so we don't need real PushManager in happy-dom.

### SW change

None. (Slice 22 adds the `push` listener.)

### Final test count

**179 → 188** (+9 net new).

---

## Files

| Action | Path | Why |
|---|---|---|
| Create | `packages/db/migrations/0006_push_subscriptions.sql` | DB table + RLS |
| Create | `packages/db/migrations/meta/0006_snapshot.json` | Drizzle snapshot |
| Modify | `packages/db/migrations/meta/_journal.json` | Add entry 6 |
| Create | `packages/db/src/schema/push-subscriptions.ts` | Drizzle schema |
| Modify | `packages/db/src/schema/index.ts` | Re-export new schema |
| Create | `apps/app/src/lib/push/subscribe.ts` | Client subscribe helper |
| Create | `apps/app/src/app/api/push-subscribe/route.ts` | POST + DELETE endpoint |
| Create | `apps/app/src/components/push-notifications-button.tsx` | Toggle button |
| Modify | `apps/app/src/views/dashboard-view.tsx` | Render the button in header |
| Create | `apps/app/src/test/lib/subscribe.test.ts` | 4 helper tests |
| Create | `apps/app/src/test/api/push-subscribe.test.ts` | 3 endpoint tests |
| Create | `apps/app/src/test/components/push-notifications-button.test.tsx` | 2 component tests |

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | User hasn't run `web-push generate-vapid-keys` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is undefined | medium | Button click handler checks `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY` and shows a toast "Push notifications not configured" instead of crashing. |
| 2 | Safari 16 quirks with `userVisibleOnly` | low | Feature detection covers older Safari; iOS Safari 16.4+ supports web push via PWA installation. Documented in the spec smoke test. |
| 3 | Drizzle journal entry collides | low | Verify current max entry is `5` (slice 11 migration `0005`), add `6`. |
| 4 | The endpoint UNIQUE constraint conflicts with idempotent re-subscribe | low | POST handler explicitly DELETE-then-INSERT to dodge the constraint. |
| 5 | UI button placement collides with mobile-narrow dashboard layout | low | Same `flex items-center gap-2` pattern as the existing CompetitorDrawer; wraps fine on narrow viewports. |
| 6 | RSC test (route.test.ts) needs `await req.json()` on a mocked Request | low | Use `new Request("...", { method, body: JSON.stringify(...) })` — same pattern as `apps/app/src/test/api/audit-run.test.ts` (verify the test file exists and reuses its scaffolding). |

---

## Smoke test (manual, post-implementation)

1. Generate VAPID keys: `npx web-push generate-vapid-keys`. Copy to `.env.local`.
2. `bun --filter @repo/db push` (or equivalent) to apply migration `0006`.
3. `bun dev` → sign in → open `/dashboard`.
4. "Enable notifications" button visible in header next to CompetitorDrawer.
5. Click → browser permission prompt → grant.
6. Toast "Notifications enabled" → button text changes to "Disable notifications".
7. DevTools → Application → Service Workers → confirm `pushManager.getSubscription()` returns a value (or query Supabase: `select * from push_subscriptions` shows the row).
8. Click "Disable notifications" → toast "Notifications disabled" → button reverts.
9. Re-enable to test the idempotent POST path.
10. Open `chrome://settings/content/notifications` and revoke. Reload `/dashboard`. Button should show "Enable" again (subscription disappears when permission is revoked).

---

## Definition of Done

- [ ] `bun --filter @repo/app test` → **188 passing**
- [ ] `bun --filter @repo/app check-types` → clean
- [ ] `bun --filter @repo/app build` → clean
- [ ] `bun --filter @repo/app lint` → clean
- [ ] DB migration `0006` applied locally (verified by `bun --filter @repo/db push` or `bun --filter @repo/db migrate`)
- [ ] `push_subscriptions` table visible in Supabase Studio with RLS on
- [ ] Subscribe button toggles state correctly under happy-dom mock
- [ ] Endpoint enforces auth (401 without session)
- [ ] No SW changes (slice 22 territory)

---

## Slice 22 candidates (carry-forward)

- **Server-push on `audit_runs.status = "completed"`** via `web-push` Node lib + the SW `push` listener
- **Periodic cleanup** of stale subscriptions (410 GONE responses)
- A **"test notification" admin button**
- **Whoami endpoint** for cleaner SW owner-filtering
- **Polish the `/offline` page**
- **60s relative-time ticker** for OfflineBanner
