---
name: repo-conventions
description: MUST USE before answering ANY question about THIS repo (frontend monorepo boilerplate, a Bun + Turborepo monorepo). Read this FIRST whenever the user mentions "this repo", "this monorepo", "this codebase", "the dashboard app", "the marketing app", or asks "where should I put", "where is", "where are", "how do I run", "what's the X command", "should I add a changeset", or about file locations, dev servers, lint, build, commits, or package layout. Trigger examples — "where should I put a new shared button component", "where do blocks go", "where do views go", "how do I run the marketing site dev server", "what's the lint command in this repo", "should I add a changeset for this refactor", "how do I make a conventional commit". Read this BEFORE shadcn, biome-linting, commit, or turborepo skills, because only this skill knows this repo's specific paths and scripts.
---

# Frontend Monorepo Boilerplate Conventions

Quick reference for working in this repo.

## Layout

```
apps/
├── app/      # Application shell (Next 16, port 3001 — app.localhost)
├── www/      # Marketing shell (Next 16, port 3000 — www.localhost)
└── story/    # Storybook for packages/ui (port 6006)
packages/
├── ui/                  # Shared shadcn/ui + Radix + Base UI components AND blocks
├── tokens/              # Design tokens
└── typescript-config/   # Shared tsconfig
```

## Frontend-Only Architecture

Five layers, one-way import direction:

```
tokens → components → blocks → views → pages
```

- **tokens** (`packages/tokens/`): design tokens
- **components** (`packages/ui/src/components/`): low-level primitives (Button, Card, Input)
- **blocks** (`packages/ui/src/blocks/`): reusable section patterns (Hero, FeatureGrid, Footer) — content-agnostic, take props
- **views** (`apps/<app>/src/views/`): page-level compositions specific to one app
- **pages** (`apps/<app>/src/app/.../page.tsx`): thin wrappers — import a view, render it

A block may import components but NOT views or pages. A view may import blocks/components but is never imported by them.

**Backend / data layer / auth are intentionally deferred.** The boilerplate ships frontend-only; add a real data layer or auth (potentially as `apps/auth`, `apps/api`) when product needs surface.

## Where Things Go

| New thing | Goes in |
|---|---|
| UI primitive used by 2+ apps | `packages/ui/src/components/` |
| Block (shared section pattern) | `packages/ui/src/blocks/` |
| View (page-level composition) | `apps/<app>/src/views/` |
| App-specific layout component | `apps/<app>/src/components/` |
| Marketing page | `apps/www/src/app/<route>/page.tsx` (renders a view) |
| App page | `apps/app/src/app/<route>/page.tsx` (renders a view) |
| Storybook story | `apps/story/src/stories/<component>.stories.tsx` |

**Never** add shadcn components directly to an app — always to `packages/ui`:

```bash
bunx --bun shadcn@latest add <component> -c packages/ui
```

## Commands

Always Bun, never npm/pnpm/yarn.

```bash
# Dev (one app)
bun --filter @repo/app dev    # :3001
bun --filter @repo/www dev    # :3000
bun --filter @repo/story dev  # Storybook :6006

# Dev (everything)
bun dev

# Validate before committing / before claiming done
bun validate    # = format + lint + check + build

# Single steps
bun typecheck
bun lint
bun lint:fix
bun format:fix
bun run build
```

## Linting & Formatting

- **Biome** (not ESLint, not Prettier)
- Config: `biome.json` at root
- Rules: double quotes, no semicolons (ASI), 2-space indent, 100-char width
- A pre-commit hook runs `biome check --write` on edited files via Husky + lint-staged
- An EditHook runs `biome check --write` after every Edit/Write tool call

## Commits

- Conventional Commits enforced by commitlint
- Use `bun commit` for an interactive commitizen prompt, OR write conventional commit messages by hand:
  - `feat(scope): summary`
  - `fix(scope): summary`
  - `refactor(scope): summary`
  - `chore(scope): summary`
  - `docs(scope): summary`
- Husky's commit-msg hook validates the format

## Changesets

Use changesets when shipping a user-facing change to a versioned package:

```bash
bun changeset            # create a changeset entry
bun changeset:version    # bump versions (CI usually runs this)
```

Skip changesets for internal-only refactors and tooling changes.

## Code Style

- Components: PascalCase (`UserProfile.tsx`)
- Blocks: kebab-case (`hero.tsx`, `feature-grid.tsx`) with PascalCase exports
- Views: kebab-case (`home-view.tsx`) with PascalCase exports (`HomeView`)
- Utilities: camelCase (`formatDate.ts`)
- Pages: lowercase-with-hyphens (`user-settings/page.tsx`)
- Type-only files: `*.types.ts` when separated
