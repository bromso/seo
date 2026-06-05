# Slice 9 — PWA Install Affordance Design

**Status:** Spec — ready for implementation planning.

**Driver:** The app is a PWA (manifest + SW shipped in slices 6-7) but there's no in-app install affordance. Slice 9 adds an Install button in the dashboard header that triggers the native Chromium prompt or shows iOS-specific "Add to Home Screen" instructions, with a 30-day dismissal window for users who decline.

**Out of scope (deferred):**
- Per-run IDB cache (slice 10 candidate).
- Idempotency keys end-to-end (slice 10 candidate).
- SW Background Sync (Chromium-only enhancement to slice 8's queue).
- Trend dedup + 30-day pruning (slice 7 carry-forward).
- Cross-user IDB GC on sign-in (slice 7 carry-forward).
- Replay toast aggregation (slice 8 carry-forward).
- Delete `runAuditAction` (slice 8 carry-forward).
- Analytics, push notifications, manifest tuning.

---

## Goal

When the user visits `/dashboard` on a PWA-installable browser AND the app is not already installed AND they haven't dismissed the prompt in the past 30 days, they see a small **Install** button in the AppShell header. Click triggers the appropriate UX for their browser:

- Chromium (desktop + Android): native install prompt via `BeforeInstallPromptEvent.prompt()`.
- iOS Safari: modal dialog with 3-step "Add to Home Screen" instructions.
- Anywhere else: button doesn't render.

A "Don't show again" action in the iOS dialog (and an implicit dismissal when the native prompt is cancelled in our own UI) writes a 30-day timestamp to `localStorage` so the button stays hidden.

## Non-goals

- Forcing or nagging users to install. The button is small, header-only, single-instance.
- A11y audit beyond what shadcn's `Dialog` primitive provides.
- Detecting install completion on iOS (no API). The button stays visible on iOS until the user explicitly dismisses; refresh-after-install will hide it via `isStandalone()`.
- Cross-tab synchronization of the dismissed flag. Each tab reads `localStorage` on mount; new tabs after dismissal will see the flag.

---

## Architecture

```
AppShell header (existing)
    │
    └── <InstallButton />
            │
            ├── on mount:
            │     ├── if isStandalone() → installed=true; render null
            │     ├── if isDismissed() → render null
            │     ├── listen for "beforeinstallprompt" → setDeferredPrompt(e)
            │     └── listen for "appinstalled" → installed=true (covers another-tab install)
            │
            └── render decision:
                  ├── deferredPrompt → render Button → click: prompt.prompt() + record outcome
                  ├── isIosSafari() → render Button → click: open iOS Dialog (instructions + Don't show)
                  └── else → render null
```

**Why one component, two behaviors:** The header should always look the same regardless of platform. The user clicks Install; either the OS handles it (Chromium) or we explain how to do it (iOS). Two separate components would split the placement logic in two places for no win.

**Platform detection is pure:** `isIosSafari(ua)` accepts a UA string so tests can vary it. `isStandalone()` reads `matchMedia` + `navigator.standalone` (iOS legacy).

---

## File layout

```
apps/app/src/lib/pwa/
├── platform.ts                       isIosSafari(ua?), isStandalone()
├── install-state.ts                  markDismissed(now?), isDismissed(now?), DISMISS_WINDOW_MS
└── index.ts                          barrel

apps/app/src/components/
└── install-button.tsx                NEW client component with internal dialog state

apps/app/src/test/pwa/
├── platform.test.ts                  ~6 tests (UA + matchMedia + iOS legacy)
└── install-state.test.ts             ~4 tests (localStorage + 30-day window)
```

**Modifications:**
- `apps/app/src/components/app-shell.tsx` — import and render `<InstallButton />` in the header, next to `<SignOutButton ownerId={...} />`.

---

## Public API

```ts
// lib/pwa/platform.ts
export function isIosSafari(ua?: string): boolean
export function isStandalone(): boolean

// lib/pwa/install-state.ts
export const DISMISS_WINDOW_MS: number
export function markDismissed(now?: number): void
export function isDismissed(now?: number): boolean

// components/install-button.tsx
export function InstallButton(): JSX.Element | null
```

No props on `InstallButton`. The header doesn't pass anything; the component is self-contained and just renders to the AppShell's flex row.

## Component behavior in detail

```ts
"use client"
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

  // SSR-safe: read browser state only after mount.
  useEffect(() => {
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

  if (installed || dismissed) return null

  // Chromium path
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

  // iOS Safari path
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
              <li>1. Tap the <strong>Share</strong> icon in Safari's toolbar.</li>
              <li>2. Scroll and tap <strong>Add to Home Screen</strong>.</li>
              <li>3. Tap <strong>Add</strong> in the top-right corner.</li>
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

  // Other browsers (no API, not iOS Safari)
  return null
}
```

Notes:
- **Initial render returns nothing** until `useEffect` populates state — this avoids hydration-mismatch warnings from `isStandalone()` checking `window`.
- **`beforeinstallprompt` capture must run on mount**, not lazily; the event fires once and won't re-fire.
- **`appinstalled` event handler** covers the case where the user installs via another tab or the browser's omnibox install icon while this tab is open.
- **Cancellation in the OS prompt does NOT auto-dismiss** for 30 days — only the iOS dialog's "Don't show again" sets the flag explicitly. Rationale: a user might dismiss the OS prompt mid-process and want to try again later.

---

## Platform detection

```ts
// lib/pwa/platform.ts
export function isIosSafari(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  const isiOS = /iPad|iPhone|iPod/.test(ua)
  // Exclude Chrome on iOS (CriOS) and Firefox on iOS (FxiOS) — they can't
  // install PWAs. Only Mobile Safari supports Add to Home Screen.
  const isCriOSorFxiOS = /CriOS|FxiOS/.test(ua)
  return isiOS && !isCriOSorFxiOS
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia("(display-mode: standalone)").matches) return true
  // iOS legacy: Safari sets navigator.standalone when launched from home screen
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}
```

## Dismissal state

```ts
// lib/pwa/install-state.ts
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

---

## Testing strategy

`platform.test.ts` (~6 tests):

```ts
describe("isIosSafari", () => {
  it("returns true for iPhone Mobile Safari")
  it("returns true for iPad Mobile Safari")
  it("returns false for Chrome on iOS (CriOS)")
  it("returns false for Firefox on iOS (FxiOS)")
  it("returns false for Chrome on Android")
  it("returns false for desktop Chrome")
})
```

Real-world UA samples used:
- iPhone Safari 17: `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`
- iPad Safari 17: `Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`
- Chrome iOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1`
- Firefox iOS: `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15`
- Android Chrome: `Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36`
- Desktop Chrome: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`

`isStandalone` is NOT unit-tested (depends on `matchMedia` mocking which is brittle in happy-dom); exercised manually.

`install-state.test.ts` (~4 tests):

```ts
describe("install-state", () => {
  it("isDismissed returns false when key is missing")
  it("isDismissed returns true within the 30-day window")
  it("isDismissed returns false after the 30-day window expires")
  it("markDismissed writes a timestamp that subsequent isDismissed reads")
})
```

Uses happy-dom's `localStorage`. `now` is passed explicitly to make assertions deterministic.

`InstallButton` — **no unit test.** Logic is decision-tree (`if installed || dismissed → null`, etc.) over the two tested modules + browser events. Tests for the events themselves would require mocking `window.dispatchEvent('beforeinstallprompt')` which is not a real DOM API, plus the prompt UX itself can only be exercised in a real browser. Covered by manual smoke.

**Total new tests:** ~10. Slice 8's 121 → slice 9's **~131**.

**Manual smoke (steps 35-38 in `apps/app/README.md`):**

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
    Click → modal shows the 3-step Add to Home Screen instructions.
    Click "Don't show again" → modal closes; button hides for 30 days
    (localStorage key pwa-install-dismissed-at = now).
38. Firefox desktop, /dashboard → no "Install" button (no native API, not iOS
    Safari). AppShell header looks unchanged.
```

---

## Migration & backwards-compat

- **No schema changes.** No DB migrations.
- **No new dependencies.** Uses shadcn `Button` + `Dialog` already in `@repo/ui` (Dialog was added in slice 5 if not earlier — verify during T1; install via `bunx shadcn@latest add dialog -c packages/ui` if missing).
- **No callers change** other than `app-shell.tsx` gaining one component render.
- **SSR safe**: initial render returns `null` until `useEffect` populates state. No hydration mismatch.

---

## Risks

- **`localStorage` quota / private mode** swallows the dismissal write. The button stays visible for that session; user dismisses again on next visit. Acceptable.
- **iOS UA spoofing** (e.g., Chrome with "Request Desktop Site") will mis-classify the platform. Edge case; user can install via Chrome's own UX if available.
- **`appinstalled` event is Chromium-only.** iOS users who install via Add to Home Screen and then revisit `/dashboard` in Safari (not the installed PWA) will still see the Install button. The dismissal flag fixes this once they explicitly dismiss.
- **Engagement gate**: Chromium only fires `beforeinstallprompt` after the user has "engaged" with the site (≥30s, multiple interactions, or repeat visits). First-visit users won't see the button immediately. Acceptable — install prompts on first visit are spammy.
- **Multiple tabs**: each tab maintains its own state. Installing via one tab → other tab's button stays until next mount (when `isStandalone()` flips). The `appinstalled` listener catches this within the same browser process for Chromium.

---

## After slice 9

Slice 10 candidates (consolidated carry-forwards):

- **Per-run IDB cache** — `run_snapshots` store; `useRunDetailCache` hook.
- **Idempotency keys end-to-end** — close the slice-8 two-tab replay race.
- **SW Background Sync (Chromium)** — drain the queue without a tab open.
- **Reliability cleanup bundle**: trend dedup + pruning (slice 7), cross-user IDB GC (slice 7), replay toast aggregation (slice 8), delete `runAuditAction` (slice 8), OfflineBanner + SignOutButton tests (slice 7).
- **Push notifications** for run completion.
