# Slice 20 — Drop Unused Barrel Re-exports (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/drop-barrels-slice20`
**Carry-forward from:** Slice 19 (offline UX complete); accumulated dead-code barrels across 19 slices.

---

## Goal

Delete dead-code barrel files. `@/lib/offline/index.ts` and `@/lib/realtime/index.ts` have **zero consumers** across the entire app (verified by grep). `@/lib/pwa/index.ts` has exactly one consumer (`install-button.tsx`) which gets switched to per-file imports for consistency. Net result: no `@/lib/<x>` barrel anywhere — all imports go straight to the source module.

---

## Non-Goals

- No symbol renames or removals — only the re-export layer goes.
- No new tests, no test changes.
- No new dependencies.
- No DB migration, no SW changes.
- No reorganization of the modules themselves (per-file structure stays put).
- No conversion to "default export per module" or similar pattern shifts.

---

## Architecture

Delete the 3 `index.ts` barrel files. Switch the single consumer (`install-button.tsx`) from one barrel import to two per-file imports. That's the entire scope.

---

## Verified consumer count

Run from project root:

```bash
grep -rn '@/lib/offline"\|@/lib/realtime"\|@/lib/pwa"' apps/app 2>/dev/null | grep -v node_modules
```

Result (as of 2026-06-06):

```
apps/app/src/components/install-button.tsx:13:import { isDismissed, isIosSafari, isStandalone, markDismissed } from "@/lib/pwa"
```

Exactly one match. The other two barrels are pure dead weight.

---

## Files

| Action | File | Why |
|---|---|---|
| Delete | `apps/app/src/lib/offline/index.ts` | 0 consumers (entire app + tests + SW) |
| Delete | `apps/app/src/lib/realtime/index.ts` | 0 consumers |
| Delete | `apps/app/src/lib/pwa/index.ts` | 1 consumer; switch to per-file imports |
| Modify | `apps/app/src/components/install-button.tsx` | Change line 13: 1 barrel import → 2 per-file imports |

---

## The single import change

Current line 13 of `apps/app/src/components/install-button.tsx`:

```tsx
import { isDismissed, isIosSafari, isStandalone, markDismissed } from "@/lib/pwa"
```

Becomes:

```tsx
import { isDismissed, markDismissed } from "@/lib/pwa/install-state"
import { isIosSafari, isStandalone } from "@/lib/pwa/platform"
```

Biome's `organize-imports` rule will alphabetize/group on commit. Either form is fine — the diff is functional equivalence.

---

## Symbol-by-symbol verification

| Symbol | Defined in | Re-exported by barrel? | Used after slice 20? |
|---|---|---|---|
| `isDismissed`, `markDismissed`, `DISMISS_WINDOW_MS` | `lib/pwa/install-state.ts` | Yes (barrel deleted) | Yes — `install-button.tsx` uses 2; `DISMISS_WINDOW_MS` is referenced internally by `install-state.ts` line 18 |
| `isIosSafari`, `isStandalone` | `lib/pwa/platform.ts` | Yes (barrel deleted) | Yes — `install-button.tsx` uses both |
| Everything in `lib/offline/index.ts` (`enqueueAuditRun`, `openOfflineDB`, `useDashboardCache`, etc.) | per-module files | Yes (barrel deleted) | Yes — every direct consumer already imports from the per-file path (`audit-queue.ts`, `db.ts`, `use-dashboard-cache.ts`, …) |
| Everything in `lib/realtime/index.ts` (`FanOut`, `useFanOut`, `fromSupabasePayload`, `shouldDeliverToRun`, …) | per-module files | Yes (barrel deleted) | Yes — every direct consumer uses per-file imports |

No exported symbol is being removed. Only the barrel re-export layer is removed.

---

## Tests delta: **178 → 179 (UNCHANGED at +0)**

No new tests, no test deletions. The existing `install-state.test.ts` and `platform.test.ts` already import from the per-file paths (verified — they don't go through the barrel).

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | SW build fails because Serwist resolves something through `@/lib/offline` | low | `apps/app/src/app/sw.ts` imports use `@/lib/offline/db` and `@/lib/offline/replay-audit-queue` — verified. No barrel usage. T2's build check confirms. |
| 2 | A test file or config references a barrel that grep missed | very low | Single-shot grep is exhaustive across `apps/app/`. No exclusions, no wildcards that could mask matches. |
| 3 | Some IDE auto-import setting prefers barrel paths post-deletion | n/a | We control imports via Biome's organize-imports + DoD grep verification. If a future contributor's IDE auto-imports via a deleted barrel, the build fails loudly. |
| 4 | Storybook (`apps/story`) imports from `apps/app/src` barrels | very low | Storybook is `packages/ui` components only; doesn't import from `apps/app`. Verified via the original grep scope (`apps/app`). |
| 5 | Other apps (`apps/www`, `apps/runner`) import from `apps/app/src` barrels | very low | App workspaces don't cross-import. Each is its own Next.js project. |

---

## Smoke test

None needed. Build + lint + typecheck + 179-test pass is sufficient — the barrels never had functional behavior, only re-exports.

---

## Definition of Done

- [ ] 3 `index.ts` files deleted from `apps/app/src/lib/{offline,realtime,pwa}/`
- [ ] `install-button.tsx` uses 2 per-file imports
- [ ] `bun --filter @repo/app test` → 179 passing (unchanged)
- [ ] `bun --filter @repo/app check-types` → clean
- [ ] `bun --filter @repo/app build` → clean
- [ ] `bun --filter @repo/app lint` → clean (warnings may be pre-existing)
- [ ] `grep -r '@/lib/offline"\|@/lib/realtime"\|@/lib/pwa"' apps/app/src` → **no matches**

---

## Slice 21 candidates (carry-forward)

- **Push notifications subscribe flow** (multi-slice: 21 = subscribe, 22 = server push).
- **Whoami endpoint** for cleaner SW owner-filtering.
- **Polish the `/offline` page** — cached-pages list, friendly illustration.
- **60s relative-time ticker** for OfflineBanner.
- **Client-side router push** to `/offline` on uncaught RSC errors.
