# Slice 19 — SW Offline Fallback Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `/offline` as the Serwist navigation fallback so that users navigating offline to an uncached URL see the existing `/offline` page instead of a generic browser error.

**Architecture:** Add `fallbacks: { entries: [...] }` to the `Serwist` constructor in `apps/app/src/app/sw.ts`. One fallback entry targets navigation requests (`request.destination === "document"`) and serves the precached `/offline` page. The existing `/offline` page is unchanged; we add a single component test verifying it renders.

**Tech Stack:** Serwist 9.2.3 (`fallbacks: FallbacksOptions { entries: FallbackEntry[] }`), Next.js 16 static generation, Vitest + happy-dom + `@testing-library/react`. No new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice19-sw-offline-fallback-design.md`](2026-06-06-slice19-sw-offline-fallback-design.md)

---

## Conventions used throughout

- Working branch: `feat/sw-offline-fallback-slice19` (already created off `main`; spec committed at `55ed5dd`).
- Conventional commits: `feat(app):` / `test(app):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- Slice 18 left **178 tests**. Slice 19 adds **1 net new** → final count **179**.
- Service Worker behavior is verified via build success + the manual smoke test in the spec — not via vitest.

---

## File map

| Action | File | Slice-19 responsibility |
|---|---|---|
| Modify | `apps/app/src/app/sw.ts` | Add `fallbacks: { entries: [{ url: "/offline", matcher }] }` |
| Create | `apps/app/src/test/components/offline-page.test.tsx` | 1 component test for the existing `/offline` page |

---

## Task 1: Wire `/offline` as the Serwist navigation fallback

**Files:**
- Modify: `apps/app/src/app/sw.ts`

No new tests. The risk-1 mitigation in the spec — verifying that Next.js statically generates `/offline` so it lands in `__SW_MANIFEST` — happens in the build step here.

### Step 1: Read the current SW

```bash
cat apps/app/src/app/sw.ts
```

Confirm the slice-17 version with `Serwist` constructor + `runtimeCaching` array + the `sync` event listener at the bottom.

### Step 2: Edit `apps/app/src/app/sw.ts`

Find the `Serwist` constructor call (currently starts at line 15 in the slice-17 version). Insert a new `fallbacks` property as the LAST key inside the constructor options object — directly before the closing `})`. Place it after the existing `runtimeCaching: [ ... ]` block.

Updated constructor invocation (showing only the change context — keep the existing keys unchanged):

```ts
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // …existing strategies — unchanged…
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
})
```

Do NOT modify anything else in `sw.ts` — the `runtimeCaching` strategies, the `sync` event listener, the imports, and the `declare global` block all stay put.

### Step 3: Run typecheck — confirm Serwist's types accept the new key

```bash
bun --filter @repo/app check-types
```

Expected: clean (exit 0). `FallbacksOptions { entries: FallbackEntry[] }` and `FallbackEntry { url: string; matcher: (param) => boolean }` are exported from `serwist@9.2.3` (verified in `node_modules/serwist/dist/Serwist.d.ts`).

### Step 4: Run build — verify Serwist compiles and `/offline` is static

```bash
bun --filter @repo/app build
```

Expected: exit 0, route table includes `○ /offline` (static, prerendered). The `○` glyph means statically generated — that's the condition for `/offline` landing in `__SW_MANIFEST` and being precached by Serwist.

**If `/offline` appears as `ƒ` (dynamic) instead of `○`:** Next.js failed to statically generate it. Update `apps/app/next.config.mjs` — the `@serwist/next` config block needs `additionalPrecacheEntries: [{ url: "/offline", revision: null }]`. Open `apps/app/next.config.mjs`, find the `withSerwistInit({ ... })` call, and add:

```js
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries: [{ url: "/offline", revision: null }],
})
```

Re-run the build. If it still fails, escalate to BLOCKED — this would mean Serwist's plugin shape changed or the page genuinely can't be precached.

### Step 5: Run the full test suite + lint

```bash
bun --filter @repo/app test
bun --filter @repo/app lint
```

Expected: **178 passing** (unchanged), lint clean. The SW file isn't imported by any test, so the fallback addition doesn't affect the count.

### Step 6: Commit

If the standard `fallbacks` key worked (no `next.config.mjs` change needed):

```bash
git add apps/app/src/app/sw.ts
git commit -m "feat(app): SW serves /offline as fallback for failed navigations"
```

If the `additionalPrecacheEntries` fallback was also needed:

```bash
git add apps/app/src/app/sw.ts apps/app/next.config.mjs
git commit -m "feat(app): SW serves /offline as fallback for failed navigations"
```

---

## Task 2: Component test for `/offline` page

**Files:**
- Create: `apps/app/src/test/components/offline-page.test.tsx`

### Step 1: Write the failing test

Create `apps/app/src/test/components/offline-page.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import OfflinePage from "@/app/offline/page"

describe("OfflinePage", () => {
  it("renders the offline headline and a Try Again button", () => {
    render(<OfflinePage />)
    expect(screen.getByText(/you're offline/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy()
  })
})
```

The import path `@/app/offline/page` resolves via the `@/*` tsconfig path alias to `apps/app/src/app/offline/page.tsx` (the existing slice-7-era page).

### Step 2: Run — expect PASS immediately

```bash
cd apps/app && bun run test src/test/components/offline-page.test.tsx
```

Expected: 1 PASS. The `/offline` page already exists and renders the headline + button, so this test should be green on first run.

**This is NOT a TDD anti-pattern violation** — the test is locking down existing behavior we're now relying on (the SW fallback target). It serves as a regression guard: if anyone touches `offline/page.tsx` and removes the button or changes the headline, this test fails before the fallback breaks silently.

If it RED's (unexpected), the most likely cause is a `"use client"` directive issue with vitest's React resolution. Read `offline/page.tsx` and the existing `offline-banner.test.tsx` for reference — they use the same `happy-dom` + `@testing-library/react` setup.

### Step 3: Run the full suite + typecheck

```bash
bun --filter @repo/app test
bun --filter @repo/app check-types
```

Expected: **179 passing** (178 + 1), typecheck clean.

### Step 4: Commit

```bash
git add apps/app/src/test/components/offline-page.test.tsx
git commit -m "test(app): regression-guard OfflinePage renders headline + Try Again button"
```

---

## Task 3: Final DoD sweep

**Files:** none.

### Step 1: Verify the SW config landed

```bash
grep -A 8 "fallbacks:" apps/app/src/app/sw.ts
```

Expected output (whitespace may vary post-Biome):

```ts
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
```

### Step 2: Verify the test file exists and runs

```bash
cd apps/app && bun run test src/test/components/offline-page.test.tsx
```

Expected: 1 PASS.

### Step 3: Confirm final state across the toolchain

```bash
bun --filter @repo/app test
# Expected: 179 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean; route table shows ○ /offline (static)

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)
```

### Step 4: Confirm the build's precache manifest mentions /offline (sanity check)

```bash
grep -o '"/offline"' apps/app/public/sw.js | head -2
```

Expected: at least one match. The Serwist plugin writes `__SW_MANIFEST` into `public/sw.js` as part of the build; `/offline` should be one of the precache URLs.

If no match appears, the page isn't being precached and the fallback won't work at runtime. Stop and investigate `apps/app/next.config.mjs` (the `additionalPrecacheEntries` fallback from T1 Step 4).

### Step 5: No commit

T3 is verify-only. The branch should now contain:
- `55ed5dd docs(app): slice 19 design — SW offline fallback page` (pre-existing)
- 2 implementation commits from T1 / T2.

```bash
git log --oneline main..HEAD
```

---

## Report Format

(For the implementer to fill in after T3.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (179 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | `sw.ts` has `fallbacks: { entries: [...] }` with the documented matcher | ✓ T1 |
  | 6 | `bun build` shows `○ /offline` (static) | ✓ T1 |
  | 7 | `/offline` appears in `apps/app/public/sw.js` precache manifest | ✓ T3 |
  | 8 | `offline-page.test.tsx` exists with the headline + button test | ✓ T2 |
- Total test count
- Commit SHA list (2 implementation commits expected)
- Whether `additionalPrecacheEntries` fallback was needed in `next.config.mjs`
- Slice 19 release note (one line)
- Any carry-forwards for slice 20

---

## After slice 19

Slice 20 candidates:

- **Push notifications on run completion** (multi-slice: 20 = subscribe, 21 = server push).
- **Whoami endpoint** for cleaner SW owner-filtering.
- **Drop unused barrel re-exports.**
- **60s relative-time ticker** for OfflineBanner.
- **Client-side router push** to `/offline` on uncaught fetch errors (if URL/content confusion ever bites).
- **Polish the `/offline` page** — "Cached pages" navigation list, friendly illustration.
