# Slice 20 — Drop Unused Barrel Re-exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the three dead-code `index.ts` barrels under `apps/app/src/lib/{offline,realtime,pwa}/` and switch the single barrel consumer (`install-button.tsx`) to per-file imports.

**Architecture:** Pure cleanup. Two of the three barrels have zero consumers (verified by grep across `apps/app`); the third has exactly one consumer using 4 of 5 re-exports. Delete all three barrels and update the one consumer's import line.

**Tech Stack:** None — this is a delete/rename slice. Biome auto-formatter handles import ordering on commit. No new dependencies, no DB changes, no SW changes.

**Spec:** [`docs/plans/2026-06-06-slice20-drop-barrels-design.md`](2026-06-06-slice20-drop-barrels-design.md)

---

## Conventions used throughout

- Working branch: `feat/drop-barrels-slice20` (already created off `main`; spec committed at `b5017da`).
- Conventional commits: `refactor(app):` / `chore(app):`.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.**
- Slice 19 left **179 tests**. Slice 20 adds **0 net new** → final count stays at **179**.

---

## File map

| Action | File | Slice-20 responsibility |
|---|---|---|
| Delete | `apps/app/src/lib/offline/index.ts` | 0 external consumers; dead weight |
| Delete | `apps/app/src/lib/realtime/index.ts` | 0 external consumers; dead weight |
| Delete | `apps/app/src/lib/pwa/index.ts` | 1 consumer being migrated in T2 |
| Modify | `apps/app/src/components/install-button.tsx` | Replace 1 barrel import with 2 per-file imports |

---

## Task 1: Delete the two zero-consumer barrels

**Files:**
- Delete: `apps/app/src/lib/offline/index.ts`
- Delete: `apps/app/src/lib/realtime/index.ts`

These two have zero consumers across the entire `apps/app` tree. Deleting them must not break anything because nothing imports from them.

### Step 1: Pre-flight verification

```bash
grep -rn '@/lib/offline"\|@/lib/realtime"' apps/app 2>/dev/null | grep -v node_modules
```

Expected: **no matches**. If any match appears, stop and investigate — the barrel has a consumer that wasn't detected during design.

### Step 2: Delete both barrel files

```bash
rm apps/app/src/lib/offline/index.ts apps/app/src/lib/realtime/index.ts
```

### Step 3: Run typecheck + tests

```bash
bun --filter @repo/app check-types
bun --filter @repo/app test
```

Expected: both clean. Test count remains **179**. Typecheck passes because no source file imports from the deleted barrels.

### Step 4: Run build

```bash
bun --filter @repo/app build
```

Expected: clean. The Serwist SW build path (`sw.ts`) uses per-file imports (`@/lib/offline/db`, `@/lib/offline/replay-audit-queue`) — verified during slice 17. No barrel usage.

### Step 5: Commit

```bash
git add apps/app/src/lib/offline/index.ts apps/app/src/lib/realtime/index.ts
git commit -m "refactor(app): drop unused @/lib/offline and @/lib/realtime barrels"
```

The `git add <deleted-file>` syntax stages a deletion. Verify the commit by:

```bash
git show --stat HEAD
```

Expected: two files removed.

---

## Task 2: Migrate `install-button.tsx` to per-file imports

**Files:**
- Modify: `apps/app/src/components/install-button.tsx`

### Step 1: Read the current import

```bash
sed -n '13p' apps/app/src/components/install-button.tsx
```

Expected output:

```ts
import { isDismissed, isIosSafari, isStandalone, markDismissed } from "@/lib/pwa"
```

### Step 2: Replace line 13

Open `apps/app/src/components/install-button.tsx` and replace that single line with two per-file imports:

```ts
import { isDismissed, markDismissed } from "@/lib/pwa/install-state"
import { isIosSafari, isStandalone } from "@/lib/pwa/platform"
```

No other lines in the file change. Biome's `organize-imports` rule will alphabetize/group them at commit time — that's fine.

### Step 3: Run typecheck + tests

```bash
bun --filter @repo/app check-types
bun --filter @repo/app test
```

Expected: both clean, **179 passing** unchanged. The four symbols (`isDismissed`, `markDismissed`, `isIosSafari`, `isStandalone`) are defined in `install-state.ts` and `platform.ts` respectively; per-file imports resolve correctly.

### Step 4: Commit

```bash
git add apps/app/src/components/install-button.tsx
git commit -m "refactor(app): install-button imports from @/lib/pwa per-file modules"
```

---

## Task 3: Delete the `@/lib/pwa` barrel

**Files:**
- Delete: `apps/app/src/lib/pwa/index.ts`

After T2, the pwa barrel has zero consumers. Now it can be deleted safely.

### Step 1: Verify zero consumers remain

```bash
grep -rn '@/lib/pwa"' apps/app 2>/dev/null | grep -v node_modules
```

Expected: **no matches**. If `install-button.tsx` still shows up, T2 wasn't fully committed — go back and complete T2 first.

### Step 2: Delete the barrel file

```bash
rm apps/app/src/lib/pwa/index.ts
```

### Step 3: Run typecheck + tests + build + lint

```bash
bun --filter @repo/app check-types
bun --filter @repo/app test
bun --filter @repo/app build
bun --filter @repo/app lint
```

Expected: all clean, **179 passing**, lint warnings only pre-existing.

### Step 4: Commit

```bash
git add apps/app/src/lib/pwa/index.ts
git commit -m "refactor(app): drop unused @/lib/pwa barrel"
```

Verify with:

```bash
git show --stat HEAD
```

Expected: one file removed (deletion).

---

## Task 4: Final DoD sweep

**Files:** none.

### Step 1: Confirm all three barrels are gone

```bash
ls apps/app/src/lib/offline/index.ts apps/app/src/lib/realtime/index.ts apps/app/src/lib/pwa/index.ts 2>&1
```

Expected output: three `No such file or directory` errors.

### Step 2: Confirm no surviving barrel imports

```bash
grep -rn '@/lib/offline"\|@/lib/realtime"\|@/lib/pwa"' apps/app/src 2>/dev/null
```

Expected: **no matches** — strict ending `"` after the barrel path (vs. `"@/lib/offline/db"` which is a per-file import and is allowed).

### Step 3: Final state across the toolchain

```bash
bun --filter @repo/app test
# Expected: 179 passing

bun --filter @repo/app check-types
# Expected: clean

bun --filter @repo/app build
# Expected: clean (SW build picks up per-file imports cleanly)

bun --filter @repo/app lint
# Expected: clean (warnings may be pre-existing)
```

### Step 4: No commit

T4 is verify-only. The branch should now contain:
- `b5017da docs(app): slice 20 design — drop unused barrel re-exports` (pre-existing)
- 3 implementation commits from T1 / T2 / T3.

```bash
git log --oneline main..HEAD
```

---

## Report Format

(For the implementer to fill in after T4.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `bun --filter @repo/app build` clean | … |
  | 2 | `bun --filter @repo/app check-types` clean | … |
  | 3 | `bun --filter @repo/app test` (179 tests) | … |
  | 4 | `bun --filter @repo/app lint` clean | … |
  | 5 | 3 barrel files deleted | ✓ T1 + T3 |
  | 6 | `install-button.tsx` uses per-file imports | ✓ T2 |
  | 7 | No surviving `@/lib/{offline,realtime,pwa}"` imports in `apps/app/src` | ✓ T4 |
- Total test count
- Commit SHA list (3 implementation commits expected)
- Slice 20 release note (one line)
- Any carry-forwards for slice 21

---

## After slice 20

Slice 21 candidates:

- **Push notifications subscribe flow** (multi-slice: 21 = subscribe, 22 = server push).
- **Whoami endpoint** for cleaner SW owner-filtering.
- **Polish the `/offline` page** — cached-pages list, friendly illustration.
- **60s relative-time ticker** for OfflineBanner.
- **Client-side router push** to `/offline` on uncaught RSC errors.
