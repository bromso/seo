# Slice 21 — Push Notifications Subscribe Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users opt into web push notifications from the dashboard. Click "Enable notifications" → browser permission prompt → on grant, SW's PushManager creates a subscription → client POSTs to `/api/push-subscribe` → server stores it in a new `push_subscriptions` Supabase table. "Disable" reverses the flow.

**Architecture:** Three coordinated layers. (1) DB: new `push_subscriptions` table + Drizzle schema + 3 RLS policies (read/insert/delete own rows). (2) Client helper: `apps/app/src/lib/push/subscribe.ts` with `isPushSupported`, `getCurrentSubscription`, `subscribeToPush`, `unsubscribeFromPush`, plus a `urlBase64ToUint8Array` converter. (3) UI + endpoint: `<PushNotificationsButton>` in the dashboard header + `/api/push-subscribe` POST/DELETE route. Slice 22 will add the SW `push` event listener and server-side delivery.

**Tech Stack:** Drizzle ORM + Postgres migrations, browser Push API (`PushManager`, `Notification`), Next.js Route Handlers + Zod, Vitest + happy-dom + `@testing-library/react`. No new npm dependencies (slice 22 adds `web-push`).

**Spec:** [`docs/plans/2026-06-06-slice21-push-subscribe-design.md`](2026-06-06-slice21-push-subscribe-design.md)

---

## Conventions used throughout

- Working branch: `feat/push-subscribe-slice21` (already created off `main`; spec committed at `5e20a07`).
- Conventional commits: `feat(db):` / `feat(app):` / `test(app):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- Slice 20 left **179 tests**. Slice 21 adds **9 net new** → final count **188**.
- DB FK target is `public.profiles(id)` (not `auth.users`) — that's the established pattern across `audit_runs`, `audit_results`, `sites` (verified in `packages/db/migrations/0000_init.sql`).
- Test file naming: `*-route.test.ts` for API route tests (matches `audit-run-route.test.ts`).
- API test mocking pattern: `vi.hoisted(() => {...})` + `vi.mock("@/lib/supabase-server", ...)` + `await import("@/app/api/.../route")` inside each test (matches `audit-run-route.test.ts`).

---

## File map

| Action | Path | Slice-21 responsibility |
|---|---|---|
| Create | `packages/db/src/schema/push-subscriptions.ts` | Drizzle table definition |
| Modify | `packages/db/src/schema/index.ts` | Re-export new schema |
| Create | `packages/db/migrations/0006_push_subscriptions.sql` | Table + RLS migration |
| Modify | `packages/db/migrations/meta/_journal.json` | Add entry 6 |
| Create | `apps/app/src/lib/push/subscribe.ts` | Client helper (4 exports) |
| Create | `apps/app/src/test/lib/subscribe.test.ts` | 4 helper tests |
| Create | `apps/app/src/app/api/push-subscribe/route.ts` | POST + DELETE handlers |
| Create | `apps/app/src/test/api/push-subscribe-route.test.ts` | 3 endpoint tests |
| Create | `apps/app/src/components/push-notifications-button.tsx` | Toggle button |
| Create | `apps/app/src/test/components/push-notifications-button.test.tsx` | 2 component tests |
| Modify | `apps/app/src/views/dashboard-view.tsx` | Render button in header |

No `0006_snapshot.json` needed — slices 1-5 didn't write per-migration snapshots (verified by `ls packages/db/migrations/meta/`).

---

## Task 1: DB layer — table + Drizzle schema + RLS

**Files:**
- Create: `packages/db/src/schema/push-subscriptions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0006_push_subscriptions.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

No new tests in this task. DB changes are verified by typecheck + manual migration apply.

### Step 1: Read the existing Drizzle schema patterns

```bash
cat packages/db/src/schema/audit-runs.ts
cat packages/db/src/schema/index.ts
```

Confirm `audit_runs` references `profiles.id` via `() => profiles.id` and `audit_runs_owner_idx` uses `index("audit_runs_owner_idx").on(t.ownerId)`. The index re-export pattern is `export * from "./audit-runs"`.

### Step 2: Create `packages/db/src/schema/push-subscriptions.ts`

```ts
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { profiles } from "./profiles"

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index("push_subscriptions_owner_idx").on(t.ownerId),
  })
)
```

### Step 3: Update `packages/db/src/schema/index.ts`

Replace contents with:

```ts
export * from "./audit-results"
export * from "./audit-runs"
export * from "./enums"
export * from "./profiles"
export * from "./push-subscriptions"
export * from "./sites"
```

Biome may alphabetize — the order is already alphabetical so no diff is expected post-format.

### Step 4: Run typecheck on the DB package

```bash
bun --filter @repo/db check-types
```

Expected: clean (exit 0). The new schema imports `profiles` which is already a known schema.

### Step 5: Create `packages/db/migrations/0006_push_subscriptions.sql`

Follow the slice 11 pattern (hand-written SQL, not drizzle-kit generated, so RLS can live in the same file):

```sql
-- 1. Create push_subscriptions table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- 2. Owner-scoped index
CREATE INDEX IF NOT EXISTS push_subscriptions_owner_idx
  ON public.push_subscriptions (owner_id);
--> statement-breakpoint

-- 3. Enable RLS
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 4. Owner can read own subscriptions
CREATE POLICY "owners read own subscriptions"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = owner_id);
--> statement-breakpoint

-- 5. Owner can insert own subscriptions
CREATE POLICY "owners insert own subscriptions"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = owner_id);
--> statement-breakpoint

-- 6. Owner can delete own subscriptions
CREATE POLICY "owners delete own subscriptions"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = owner_id);
--> statement-breakpoint
```

The FK references `public.profiles(id)` — matches the established pattern across all other tables.

### Step 6: Append the journal entry

Update `packages/db/migrations/meta/_journal.json` to add entry 6. The current `entries` array ends at idx 5 (slice 11's `0005_idempotency_key`). Add a new entry at index 6 with the current timestamp:

```json
{
  "idx": 6,
  "version": "7",
  "when": 1780750000000,
  "tag": "0006_push_subscriptions",
  "breakpoints": true
}
```

Pick a `when` value larger than 1780698880888 (the slice-11 timestamp); using `1780750000000` (≈ 14h later) is fine for ordering — the journal uses this for migration order. Full file should look like:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    // …existing 6 entries (0..5) — leave as-is…
    {
      "idx": 6,
      "version": "7",
      "when": 1780750000000,
      "tag": "0006_push_subscriptions",
      "breakpoints": true
    }
  ]
}
```

### Step 7: Run typecheck + DB build

```bash
bun --filter @repo/db check-types
bun --filter @repo/db build
```

Expected: both clean. The Drizzle schema compiles; the build produces `dist/index.{js,d.ts}` with the new export.

### Step 8: Commit

```bash
git add packages/db/src/schema/push-subscriptions.ts \
        packages/db/src/schema/index.ts \
        packages/db/migrations/0006_push_subscriptions.sql \
        packages/db/migrations/meta/_journal.json
git commit -m "feat(db): add push_subscriptions table + RLS"
```

---

## Task 2: Client subscribe helper + 4 tests

**Files:**
- Create: `apps/app/src/lib/push/subscribe.ts`
- Create: `apps/app/src/test/lib/subscribe.test.ts`

### Step 1: Write the four failing tests

Create `apps/app/src/test/lib/subscribe.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isPushSupported,
  subscribeToPush,
  urlBase64ToUint8Array,
} from "@/lib/push/subscribe"

const VAPID_KEY = "BPaQy0u9ZbW7y0Cik5HG3kSVB-Gz5W2kS5JqsHxNVZi0M3Vu_FsZ40fAB2sSqx1uHvGwOklTcZQI4qY-9MCRWiE"

type FakeSubscription = {
  endpoint: string
  toJSON: () => { keys?: { p256dh?: string; auth?: string } }
  unsubscribe: () => Promise<void>
}

function installFakeServiceWorker(opts: {
  subscription?: FakeSubscription | null
  subscribeImpl?: (init: PushSubscriptionOptionsInit) => Promise<FakeSubscription>
}): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: vi.fn(async () => opts.subscription ?? null),
          subscribe: opts.subscribeImpl ?? vi.fn(),
        },
      }),
    },
  })
}

function uninstallFakeServiceWorker(): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  })
}

function setNotification(permission: NotificationPermission): void {
  // happy-dom doesn't ship Notification — install a minimal shim.
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: {
      permission,
      requestPermission: vi.fn(async () => permission),
    },
  })
}

function clearNotification(): void {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: undefined,
  })
}

beforeEach(() => {
  uninstallFakeServiceWorker()
  clearNotification()
})

afterEach(() => {
  uninstallFakeServiceWorker()
  clearNotification()
  vi.restoreAllMocks()
})

describe("urlBase64ToUint8Array", () => {
  it("converts a known VAPID public key to the expected Uint8Array prefix", () => {
    const out = urlBase64ToUint8Array(VAPID_KEY)
    // VAPID public keys are 65-byte ECDH P-256 keys starting with 0x04
    expect(out.length).toBe(65)
    expect(out[0]).toBe(0x04)
  })
})

describe("isPushSupported", () => {
  it("returns false when serviceWorker is absent", () => {
    expect(isPushSupported()).toBe(false)
  })
})

describe("subscribeToPush", () => {
  it("returns null when Notification permission is denied", async () => {
    installFakeServiceWorker({})
    setNotification("denied")
    const result = await subscribeToPush(VAPID_KEY)
    expect(result).toBeNull()
  })

  it("calls pushManager.subscribe with userVisibleOnly + key and returns payload on grant", async () => {
    const subscribeImpl = vi.fn(async (_init: PushSubscriptionOptionsInit) => ({
      endpoint: "https://push.example.com/abc",
      toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: async () => {},
    }))
    installFakeServiceWorker({ subscribeImpl })
    setNotification("granted")

    const result = await subscribeToPush(VAPID_KEY)
    expect(subscribeImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      })
    )
    expect(result).toEqual({
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "p", auth: "a" },
    })
  })
})
```

The PushManager and Notification globals don't ship in happy-dom; the shims installed per-test cover both.

### Step 2: Run — expect 4 FAIL

```bash
cd apps/app && bun run test src/test/lib/subscribe.test.ts
```

Expected: 4 FAIL — module not found.

### Step 3: Create `apps/app/src/lib/push/subscribe.ts`

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

Note: `isPushSupported` requires both `serviceWorker` AND `PushManager`. For the test "returns false when serviceWorker is absent" to pass, `"serviceWorker" in navigator` must be false. happy-dom's `navigator` doesn't ship serviceWorker by default, and `uninstallFakeServiceWorker()` sets it to `undefined`. `"X" in obj` returns `true` even when `obj[X] === undefined` if the property was explicitly defined. **This may cause the test to fail.** Mitigation: the test uses `Object.defineProperty(..., value: undefined)` which DOES install the property. To make the test work as-is, change the check to `!navigator.serviceWorker`:

If `navigator.serviceWorker === undefined`, the `"in"` check returns true. Change line in `isPushSupported`:

```ts
return Boolean(navigator.serviceWorker) && "PushManager" in window
```

That's a minor adjustment to the spec. Make it.

### Step 4: Run — expect 4 PASS

```bash
cd apps/app && bun run test src/test/lib/subscribe.test.ts
```

Expected: 4 PASS.

If the second test still fails because `navigator.serviceWorker` is `undefined` but `"serviceWorker" in navigator` returns true, double-check the implementation uses `Boolean(navigator.serviceWorker)` per Step 3's note.

### Step 5: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **183 passing** (179 + 4), typecheck clean.

### Step 6: Commit

```bash
git add apps/app/src/lib/push/subscribe.ts apps/app/src/test/lib/subscribe.test.ts
git commit -m "feat(app): add push subscribe helper (subscribe/unsubscribe/feature-detect)"
```

---

## Task 3: `/api/push-subscribe` endpoint + 3 tests

**Files:**
- Create: `apps/app/src/app/api/push-subscribe/route.ts`
- Create: `apps/app/src/test/api/push-subscribe-route.test.ts`

### Step 1: Inspect the existing route test pattern

```bash
cat apps/app/src/test/api/audit-run-route.test.ts | head -40
```

Note the `vi.hoisted(...)` + `vi.mock("@/lib/supabase-server", ...)` + `await import("@/app/api/...")` pattern. We'll mirror it.

### Step 2: Write the three failing tests

Create `apps/app/src/test/api/push-subscribe-route.test.ts`:

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

const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const VALID_ENDPOINT = "https://push.example.com/abc"

beforeEach(() => {
  mockSupabaseClient.auth.getUser.mockReset()
  mockSupabaseClient.from.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makePost(body: unknown): Request {
  return new Request("http://app.localhost:3001/api/push-subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeDelete(body: unknown): Request {
  return new Request("http://app.localhost:3001/api/push-subscribe", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/push-subscribe", () => {
  it("returns 401 when no user", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import("@/app/api/push-subscribe/route")
    const res = await POST(
      makePost({
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 200 and inserts on a valid authenticated POST", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })

    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    const deleteEqSpy = vi.fn().mockResolvedValue({ error: null })
    const deleteSpy = vi.fn().mockReturnValue({ eq: deleteEqSpy })

    mockSupabaseClient.from
      .mockReturnValueOnce({ delete: deleteSpy })
      .mockReturnValueOnce({ insert: insertSpy })

    const { POST } = await import("@/app/api/push-subscribe/route")
    const res = await POST(
      makePost({
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: "p", auth: "a" },
        userAgent: "test/1.0",
      })
    )

    expect(res.status).toBe(200)
    expect(deleteEqSpy).toHaveBeenCalledWith("endpoint", VALID_ENDPOINT)
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: VALID_USER_ID,
        endpoint: VALID_ENDPOINT,
        p256dh: "p",
        auth: "a",
        user_agent: "test/1.0",
      })
    )
  })
})

describe("DELETE /api/push-subscribe", () => {
  it("returns 200 and deletes on a valid authenticated DELETE", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: VALID_USER_ID } },
    })

    const ownerEqSpy = vi.fn().mockResolvedValue({ error: null })
    const endpointEqSpy = vi.fn().mockReturnValue({ eq: ownerEqSpy })
    const deleteSpy = vi.fn().mockReturnValue({ eq: endpointEqSpy })
    mockSupabaseClient.from.mockReturnValue({ delete: deleteSpy })

    const { DELETE } = await import("@/app/api/push-subscribe/route")
    const res = await DELETE(makeDelete({ endpoint: VALID_ENDPOINT }))

    expect(res.status).toBe(200)
    expect(endpointEqSpy).toHaveBeenCalledWith("endpoint", VALID_ENDPOINT)
    expect(ownerEqSpy).toHaveBeenCalledWith("owner_id", VALID_USER_ID)
  })
})
```

### Step 3: Run — expect 3 FAIL

```bash
cd apps/app && bun run test src/test/api/push-subscribe-route.test.ts
```

Expected: 3 FAIL — module not found (`Failed to resolve import "@/app/api/push-subscribe/route"`).

### Step 4: Create `apps/app/src/app/api/push-subscribe/route.ts`

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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  // Idempotent re-subscribe: delete existing row (if any) for this endpoint
  // then insert. RLS scopes the delete to whichever owner held the row.
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
  const {
    data: { user },
  } = await supabase.auth.getUser()
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

### Step 5: Run — expect 3 PASS

```bash
cd apps/app && bun run test src/test/api/push-subscribe-route.test.ts
```

Expected: 3 PASS.

### Step 6: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **186 passing** (183 + 3), typecheck clean.

### Step 7: Commit

```bash
git add apps/app/src/app/api/push-subscribe/route.ts apps/app/src/test/api/push-subscribe-route.test.ts
git commit -m "feat(app): /api/push-subscribe POST + DELETE handlers"
```

---

## Task 4: `<PushNotificationsButton>` component + 2 tests

**Files:**
- Create: `apps/app/src/components/push-notifications-button.tsx`
- Create: `apps/app/src/test/components/push-notifications-button.test.tsx`

### Step 1: Write the two failing tests

Create `apps/app/src/test/components/push-notifications-button.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/push/subscribe", () => ({
  isPushSupported: vi.fn(),
  getCurrentSubscription: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}))

import {
  getCurrentSubscription,
  isPushSupported,
  subscribeToPush,
} from "@/lib/push/subscribe"
import { PushNotificationsButton } from "@/components/push-notifications-button"

const supportedMock = isPushSupported as ReturnType<typeof vi.fn>
const getSubMock = getCurrentSubscription as ReturnType<typeof vi.fn>
const subMock = subscribeToPush as ReturnType<typeof vi.fn>

beforeEach(() => {
  supportedMock.mockReset()
  getSubMock.mockReset()
  subMock.mockReset()
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "BPaQy0u9ZbW7y0Cik5HG3kSVB-Gz5W2kS5JqsHxNVZi0M3Vu_FsZ40fAB2sSqx1uHvGwOklTcZQI4qY-9MCRWiE")
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("PushNotificationsButton", () => {
  it("renders nothing when push isn't supported", async () => {
    supportedMock.mockReturnValue(false)
    const { container } = render(<PushNotificationsButton />)
    // give the mount effect a tick
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector("button")).toBeNull()
  })

  it("subscribes on Enable click, POSTs, and re-renders as Disable", async () => {
    supportedMock.mockReturnValue(true)
    getSubMock.mockResolvedValue(null)
    subMock.mockResolvedValue({
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "p", auth: "a" },
    })

    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchSpy)

    render(<PushNotificationsButton />)
    const user = userEvent.setup()

    const enableBtn = await screen.findByRole("button", { name: /enable notifications/i })
    await user.click(enableBtn)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disable notifications/i })).toBeTruthy()
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/push-subscribe",
      expect.objectContaining({ method: "POST" })
    )
  })
})
```

### Step 2: Run — expect 2 FAIL

```bash
cd apps/app && bun run test src/test/components/push-notifications-button.test.tsx
```

Expected: 2 FAIL — module not found.

### Step 3: Create `apps/app/src/components/push-notifications-button.tsx`

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

### Step 4: Run — expect 2 PASS

```bash
cd apps/app && bun run test src/test/components/push-notifications-button.test.tsx
```

Expected: 2 PASS.

### Step 5: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **188 passing** (186 + 2), typecheck clean.

### Step 6: Commit

```bash
git add apps/app/src/components/push-notifications-button.tsx apps/app/src/test/components/push-notifications-button.test.tsx
git commit -m "feat(app): PushNotificationsButton toggle component"
```

---

## Task 5: Render the button in the dashboard header

**Files:**
- Modify: `apps/app/src/views/dashboard-view.tsx`

No new tests. The integration is structurally trivial — the hook tests in T2 and the component tests in T4 cover the logic.

### Step 1: Read the current view

```bash
cat apps/app/src/views/dashboard-view.tsx
```

Confirm the header block reads:

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-semibold">Dashboard</h1>
  <CompetitorDrawer competitors={competitors} />
</div>
```

### Step 2: Edit the view

In `apps/app/src/views/dashboard-view.tsx`, add the new import at the top alongside the existing component imports:

```tsx
import { PushNotificationsButton } from "@/components/push-notifications-button"
```

Then wrap the existing `<CompetitorDrawer>` in a flex container that includes the button:

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-semibold">Dashboard</h1>
  <div className="flex items-center gap-2">
    <PushNotificationsButton />
    <CompetitorDrawer competitors={competitors} />
  </div>
</div>
```

### Step 3: Run the full suite + typecheck + build + lint

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
bun --filter @repo/app lint
```

Expected: **188 passing** (unchanged from T4), typecheck clean, build clean, lint clean.

### Step 4: Commit

```bash
git add apps/app/src/views/dashboard-view.tsx
git commit -m "feat(app): render PushNotificationsButton in dashboard header"
```

---

## Task 6: Final DoD sweep

**Files:** none.

### Step 1: Confirm call-site integrity

```bash
grep -rn "PushNotificationsButton\|push_subscriptions\|subscribeToPush\|unsubscribeFromPush" apps/app/src packages/db/src
```

Expected hits:
- `apps/app/src/lib/push/subscribe.ts` — definitions.
- `apps/app/src/test/lib/subscribe.test.ts` — helper tests.
- `apps/app/src/app/api/push-subscribe/route.ts` — Supabase table reference (`"push_subscriptions"`).
- `apps/app/src/test/api/push-subscribe-route.test.ts` — endpoint tests.
- `apps/app/src/components/push-notifications-button.tsx` — component using the helpers.
- `apps/app/src/test/components/push-notifications-button.test.tsx` — component tests.
- `apps/app/src/views/dashboard-view.tsx` — view integration.
- `packages/db/src/schema/push-subscriptions.ts` — Drizzle table.
- `packages/db/src/schema/index.ts` — re-export.

If any expected hit is missing, stop and investigate.

### Step 2: Verify migration journal entry

```bash
tail -10 packages/db/migrations/meta/_journal.json
```

Expected: entries array now includes the slice-21 entry with `"tag": "0006_push_subscriptions"`.

### Step 3: Confirm final state across the toolchain

```bash
bun --filter @repo/app test
# Expected: 188 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)

bun --filter @repo/db check-types
# Expected: clean

bun --filter @repo/db build
# Expected: clean
```

### Step 4: Manual smoke verification reminder

After merging to main, the user must:
1. Run `npx web-push generate-vapid-keys`.
2. Add three env vars to `.env.local` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`).
3. Apply migration `0006` via `bun --filter @repo/db migrate` (or equivalent).
4. Test the button per the smoke test in the spec.

Slice 21 ships the foundation but is **unusable end-to-end without the env vars + DB migration**. Document this in the merge commit message.

### Step 5: No commit

T6 is verify-only. The branch should now contain:
- `5e20a07 docs(app): slice 21 design — push notifications subscribe flow` (pre-existing)
- 5 implementation commits from T1 / T2 / T3 / T4 / T5.

```bash
git log --oneline main..HEAD
```

---

## Report Format

(For the implementer to fill in after T6.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (188 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `bun --filter @repo/db check-types` + build clean | … |
  | 6 | Migration `0006_push_subscriptions.sql` exists with table + RLS | ✓ T1 |
  | 7 | Drizzle journal entry idx=6 present | ✓ T1 |
  | 8 | `lib/push/subscribe.ts` exports 4 functions + 1 type | ✓ T2 |
  | 9 | `/api/push-subscribe` route handles POST + DELETE with auth | ✓ T3 |
  | 10 | `PushNotificationsButton` renders in dashboard header | ✓ T5 |
- Total test count
- Commit SHA list (5 implementation commits expected)
- Whether the `isPushSupported` adjustment (`Boolean(navigator.serviceWorker)` vs `"in"`) was needed
- Slice 21 release note (one line)
- Any carry-forwards for slice 22

---

## After slice 21

Slice 22 candidates:

- **Server-push on run completion** via `web-push` Node lib + the SW `push` listener.
- **Periodic cleanup** of stale subscriptions (410 GONE responses).
- A **"test notification" admin button**.
- **Whoami endpoint** for cleaner SW owner-filtering.
- **Polish the `/offline` page**.
- **60s relative-time ticker** for OfflineBanner.
