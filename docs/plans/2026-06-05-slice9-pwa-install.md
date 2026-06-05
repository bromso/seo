# Slice 9 — PWA Install Affordance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Install" button to the dashboard header that triggers the Chromium native install prompt (via `BeforeInstallPromptEvent`) or shows iOS-specific "Add to Home Screen" instructions in a modal. Dismissal persists in `localStorage` for 30 days. Already-installed and non-PWA-capable browsers hide the button entirely.

**Architecture:** Two pure modules (`lib/pwa/platform.ts` for UA + display-mode detection; `lib/pwa/install-state.ts` for 30-day dismissal flag in `localStorage`) compose into one self-contained `<InstallButton />` client component rendered by `AppShell`. The component listens for `beforeinstallprompt` + `appinstalled` events, captures the deferred prompt, and renders one of three paths: Chromium native prompt, iOS instructions dialog, or nothing.

**Tech Stack:** React 19, shadcn/ui `Button` + `Dialog` (already in `@repo/ui`), `BeforeInstallPromptEvent` (Chromium), `navigator.standalone` (iOS legacy), `matchMedia('(display-mode: standalone)')`, `localStorage`, Vitest with happy-dom.

**Spec:** [`docs/plans/2026-06-05-slice9-pwa-install-design.md`](2026-06-05-slice9-pwa-install-design.md)

---

## Conventions used throughout

- Working branch: `feat/pwa-install-slice9` (already created off `main`; spec committed at `3ed1481`).
- Conventional commits: `feat(app):` / `test(app):` / `docs(app):`.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Slice 8's 121 tests must keep passing after every task.
- Tests live at `apps/app/src/test/`.
- Use `bun --filter @repo/app <script>` for per-package operations.
- **`@repo/ui` already exports `Button` and `Dialog`** — verified before plan write.

---

## Task 1: `lib/pwa/platform.ts` + tests

**Files:**
- Create: `apps/app/src/lib/pwa/platform.ts`
- Create: `apps/app/src/test/pwa/platform.test.ts`

Two pure functions: `isIosSafari(ua?)` for UA-based platform detection and `isStandalone()` for installed-as-PWA detection.

### Step 1: Failing test

Create `apps/app/src/test/pwa/platform.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isIosSafari } from "@/lib/pwa/platform"

const UA = {
  iphoneSafari17:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipadSafari17:
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  chromeIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  firefoxIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const

describe("isIosSafari", () => {
  it("returns true for iPhone Mobile Safari", () => {
    expect(isIosSafari(UA.iphoneSafari17)).toBe(true)
  })
  it("returns true for iPad Mobile Safari", () => {
    expect(isIosSafari(UA.ipadSafari17)).toBe(true)
  })
  it("returns false for Chrome on iOS (CriOS)", () => {
    expect(isIosSafari(UA.chromeIOS)).toBe(false)
  })
  it("returns false for Firefox on iOS (FxiOS)", () => {
    expect(isIosSafari(UA.firefoxIOS)).toBe(false)
  })
  it("returns false for Chrome on Android", () => {
    expect(isIosSafari(UA.androidChrome)).toBe(false)
  })
  it("returns false for desktop Chrome", () => {
    expect(isIosSafari(UA.desktopChrome)).toBe(false)
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 6 new failures (module not found).

### Step 3: Implement `apps/app/src/lib/pwa/platform.ts`

```ts
export function isIosSafari(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""
): boolean {
  const isiOS = /iPad|iPhone|iPod/.test(ua)
  // Exclude Chrome on iOS (CriOS) and Firefox on iOS (FxiOS) — they can't
  // install PWAs. Only Mobile Safari supports Add to Home Screen.
  const isCriOSorFxiOS = /CriOS|FxiOS/.test(ua)
  return isiOS && !isCriOSorFxiOS
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia("(display-mode: standalone)").matches) return true
  // iOS legacy: Safari sets navigator.standalone when launched from home screen.
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}
```

Note: `isStandalone()` is NOT unit-tested (depends on `matchMedia` which is awkward to mock cleanly in happy-dom). It's exercised by manual smoke.

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
```

Expected: 6 new tests pass → **127 total** (121 + 6).

### Step 5: Commit

```bash
git add apps/app/src/lib/pwa/platform.ts apps/app/src/test/pwa/platform.test.ts
git commit -m "feat(app): add PWA platform detection (isIosSafari, isStandalone)"
```

---

## Task 2: `lib/pwa/install-state.ts` + tests

**Files:**
- Create: `apps/app/src/lib/pwa/install-state.ts`
- Create: `apps/app/src/test/pwa/install-state.test.ts`

Dismissal flag persisted in `localStorage` with a 30-day expiry window.

### Step 1: Failing test

Create `apps/app/src/test/pwa/install-state.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DISMISS_WINDOW_MS, isDismissed, markDismissed } from "@/lib/pwa/install-state"

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe("install-state", () => {
  it("isDismissed returns false when the key is missing", () => {
    expect(isDismissed()).toBe(false)
  })

  it("isDismissed returns true within the 30-day window", () => {
    const at = 1_700_000_000_000
    markDismissed(at)
    expect(isDismissed(at + DISMISS_WINDOW_MS - 1)).toBe(true)
  })

  it("isDismissed returns false after the 30-day window expires", () => {
    const at = 1_700_000_000_000
    markDismissed(at)
    expect(isDismissed(at + DISMISS_WINDOW_MS + 1)).toBe(false)
  })

  it("markDismissed writes a timestamp that subsequent isDismissed reads", () => {
    const at = 1_700_000_000_000
    markDismissed(at)
    expect(isDismissed(at)).toBe(true)
    expect(isDismissed(at + 1000)).toBe(true)
  })
})
```

### Step 2: Run — expect FAIL

```bash
bun --filter @repo/app test
```

Expected: 4 new failures (module not found).

### Step 3: Implement `apps/app/src/lib/pwa/install-state.ts`

```ts
const KEY = "pwa-install-dismissed-at"
export const DISMISS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export function markDismissed(now: number = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(now))
  } catch {
    // Private mode / quota — silently ignored; the button just stays visible
    // for this session, which is the right fallback.
  }
}

export function isDismissed(now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return now - at < DISMISS_WINDOW_MS
  } catch {
    return false
  }
}
```

### Step 4: Run — expect PASS

```bash
bun --filter @repo/app test
```

Expected: 4 new tests pass → **131 total** (127 + 4).

### Step 5: Commit

```bash
git add apps/app/src/lib/pwa/install-state.ts apps/app/src/test/pwa/install-state.test.ts
git commit -m "feat(app): add PWA dismissal state (30-day localStorage window)"
```

---

## Task 3: `lib/pwa/index.ts` barrel

**Files:**
- Create: `apps/app/src/lib/pwa/index.ts`

### Step 1: Create the barrel

```ts
export {
  DISMISS_WINDOW_MS,
  isDismissed,
  markDismissed,
} from "@/lib/pwa/install-state"
export { isIosSafari, isStandalone } from "@/lib/pwa/platform"
```

### Step 2: Verify

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
```

Both PASS.

### Step 3: Commit

```bash
git add apps/app/src/lib/pwa/index.ts
git commit -m "feat(app): export PWA barrel"
```

---

## Task 4: `InstallButton` component

**Files:**
- Create: `apps/app/src/components/install-button.tsx`

No unit test — the component is a decision tree over the already-tested platform + install-state modules, plus DOM event listeners that require a real browser. Manual smoke covers it.

### Step 1: Verify shadcn primitives exist

```bash
ls packages/ui/src/components/dialog.tsx packages/ui/src/components/button.tsx
```

Both files MUST exist. If `dialog.tsx` is missing, install it first:

```bash
bunx shadcn@latest add dialog -c packages/ui
```

(This was verified before the plan was written; should not be needed.)

### Step 2: Check `Dialog` named exports

```bash
grep "^export" packages/ui/src/components/dialog.tsx
```

Expected exports include: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`. If any are missing under those exact names (shadcn occasionally uses `DialogClose` etc. but the core set is standard), adapt the imports below to match. Do NOT add prop drilling around missing components — replace the layout with shadcn's actual exports.

### Step 3: Create `apps/app/src/components/install-button.tsx`

```tsx
"use client"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { useEffect, useState } from "react"
import { isDismissed, isIosSafari, isStandalone, markDismissed } from "@/lib/pwa"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

export function InstallButton(): JSX.Element | null {
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosDialog, setShowIosDialog] = useState(false)
  const [iosCapable, setIosCapable] = useState(false)
  const [mounted, setMounted] = useState(false)

  // SSR-safe: read browser state only after mount to avoid hydration mismatch.
  useEffect(() => {
    setMounted(true)
    setInstalled(isStandalone())
    setDismissed(isDismissed())
    setIosCapable(isIosSafari())

    const onBefore = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }
    window.addEventListener("beforeinstallprompt", onBefore)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  if (!mounted) return null
  if (installed || dismissed) return null

  // Chromium path: native install prompt is available
  if (deferredPrompt) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await deferredPrompt.prompt()
          const { outcome } = await deferredPrompt.userChoice
          setDeferredPrompt(null)
          if (outcome === "dismissed") {
            markDismissed()
            setDismissed(true)
          }
        }}
      >
        Install
      </Button>
    )
  }

  // iOS Safari path: no native prompt; show instructions dialog
  if (iosCapable) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setShowIosDialog(true)}>
          Install
        </Button>
        <Dialog open={showIosDialog} onOpenChange={setShowIosDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Install this app</DialogTitle>
              <DialogDescription>
                Add SEO Audit to your home screen for a faster, app-like experience.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-2 text-sm">
              <li>
                1. Tap the <strong>Share</strong> icon in Safari's toolbar.
              </li>
              <li>
                2. Scroll and tap <strong>Add to Home Screen</strong>.
              </li>
              <li>
                3. Tap <strong>Add</strong> in the top-right corner.
              </li>
            </ol>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowIosDialog(false)}>
                Close
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  markDismissed()
                  setDismissed(true)
                  setShowIosDialog(false)
                }}
              >
                Don't show again
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  // Other browsers (no API, not iOS Safari) — nothing to render.
  return null
}
```

### Step 4: Verify build + typecheck

```bash
bun --filter @repo/app check-types
bun --filter @repo/app build
bun --filter @repo/app test
```

All PASS. Test count unchanged (131; no new tests for this component).

### Step 5: Commit

```bash
git add apps/app/src/components/install-button.tsx
git commit -m "feat(app): add InstallButton (Chromium prompt + iOS instructions dialog)"
```

---

## Task 5: Wire `InstallButton` into `AppShell`

**Files:**
- Modify: `apps/app/src/components/app-shell.tsx`

Render `<InstallButton />` in the header next to the email + Sign out button.

### Step 1: Read current `AppShell`

```bash
cat apps/app/src/components/app-shell.tsx
```

Confirm structure: header row contains `siteLabel?`, `email`, `<SignOutButton ownerId={ownerId} />`. The InstallButton goes between the email and the sign-out button.

### Step 2: Modify `apps/app/src/components/app-shell.tsx`

Add the import and the render. Full updated file:

```tsx
import Link from "next/link"
import type { ReactNode } from "react"
import { InstallButton } from "@/components/install-button"
import { SignOutButton } from "@/components/sign-out-button"

export function AppShell({
  ownerId,
  email,
  siteLabel,
  children,
}: {
  ownerId: string
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
            <InstallButton />
            <SignOutButton ownerId={ownerId} />
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 py-8">{children}</div>
    </div>
  )
}
```

### Step 3: Verify

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
bun --filter @repo/app build
```

All PASS. Test count still 131.

### Step 4: Commit

```bash
git add apps/app/src/components/app-shell.tsx
git commit -m "feat(app): render InstallButton in AppShell header"
```

---

## Task 6: README smoke checklist + DoD sweep

**Files:**
- Modify: `apps/app/README.md` (append steps 35-38)

### Step 1: Append to `apps/app/README.md`

Find the existing "Manual smoke checklist" section (ending at slice 8's step 34). Add after step 34:

```
35. Chrome desktop, /dashboard online → after Chrome's install-eligibility check
    (~30s of engagement) the browser fires beforeinstallprompt. The "Install"
    button appears in the AppShell header. Click → native install prompt fires
    → click "Install" → app installs and adds to OS launcher. Refresh; button
    is gone (isStandalone() returns true).
36. Chrome desktop, repeat. Click Install → native prompt → click "Cancel".
    Button stays visible (we do not auto-dismiss on OS cancel — user may want
    to retry). Refresh — button still there.
37. iOS Safari, /dashboard → "Install" button always visible (no native prompt).
    Click → modal shows the 3-step Add to Home Screen instructions. Click
    "Don't show again" → modal closes; button hides for 30 days (localStorage
    key pwa-install-dismissed-at = now).
38. Firefox desktop, /dashboard → no "Install" button (no native API, not iOS
    Safari). AppShell header looks unchanged.
```

### Step 2: Full DoD sweep

```bash
# 1. Tests
bun --filter @repo/app test
# Expected: ~131 passing

# 2. Typecheck
bun --filter @repo/app check-types

# 3. Build
bun --filter @repo/app build

# 4. Lint
bun --filter @repo/app lint
```

All clean (any warnings are pre-existing).

### Step 3: Final commit

```bash
git add apps/app/README.md
git commit -m "docs(app): add slice 9 smoke checklist (steps 35-38)"
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
  | 3 | `bun --filter @repo/app test` (~131 tests) | … |
  | 4 | Chromium Install button appears + native prompt works | Deferred to user verification |
  | 5 | Chromium user cancels: button stays | Deferred |
  | 6 | iOS Safari shows instructions dialog | Deferred |
  | 7 | "Don't show again" hides button for 30 days | Deferred |
  | 8 | Firefox / other browsers: no button rendered | Deferred |
- Total test count
- Commit SHA list (6 commits expected)
- Slice 9 release note (one line)
- Any carry-forwards for slice 10

---

## After slice 9

Slice 10 candidates (consolidated carry-forwards):

- **Per-run IDB cache** — `run_snapshots` store; `useRunDetailCache` hook.
- **Idempotency keys end-to-end** — closes the slice-8 two-tab replay race.
- **SW Background Sync (Chromium)** — drain queue without a tab open.
- **Reliability cleanup bundle**: trend dedup + pruning (slice 7), cross-user IDB GC (slice 7), replay toast aggregation (slice 8), delete `runAuditAction` (slice 8), OfflineBanner + SignOutButton tests (slice 7).
- **Push notifications** for run completion.
