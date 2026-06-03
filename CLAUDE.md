# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Development (all apps):**
```bash
bun dev              # Start all apps in parallel via Turborepo
```

**Development (single app):**
```bash
bun --filter @repo/www dev    # Marketing site on www.localhost:3000
bun --filter @repo/app dev    # App shell on app.localhost:3001
bun --filter @repo/story dev  # Storybook on localhost:6006
```

**Build & Lint:**
```bash
bun run build         # Build all apps
bun run lint          # Lint all apps (Biome)
bun run format        # Format all files (Biome)
bun run lint:fix      # Auto-fix lint issues
```

**Single app build/lint:**
```bash
bun --filter @repo/app build
bun --filter @repo/app lint
```

## Architecture

**Monorepo Structure:**
- **Turborepo** for build orchestration
- **Bun workspaces** for package management
- **Biome** for linting/formatting (not ESLint/Prettier)

**Apps:**
- `apps/www` — Marketing site shell (Next.js 16; dev: www.localhost:3000 → prod: www.brand.com)
- `apps/app` — Application shell (Next.js 16; dev: app.localhost:3001 → prod: app.brand.com)
- `apps/story` — Storybook for `packages/ui` (localhost:6006; internal tool, not subdomain-routed)

> Future subdomain apps follow the same pattern: `apps/auth` (auth.brand.com), `apps/docs` (docs.brand.com), etc.

**Packages:**
- `packages/ui` — Shared shadcn/ui components and reusable section blocks
- `packages/tokens` — Design tokens
- `packages/typescript-config` — Shared TypeScript configuration

## Frontend Architecture

This is a **frontend-only boilerplate**. Backend, data layer, and authentication are intentionally deferred — re-introduce them fresh when product needs surface (potentially as separate apps like `apps/auth`).

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

**Imports:**
```tsx
import { Button } from "@repo/ui/components/button"
import { Hero } from "@repo/ui/blocks/hero"
import { cn } from "@repo/ui/lib/utils"
```

**Adding shadcn components — always to `packages/ui`:**
```bash
bunx shadcn@latest add <component> -c packages/ui
```

Never add shadcn components directly to apps.

**Animations (motion.dev):**
Available in `apps/app`, `apps/www`, and `packages/ui`:
```tsx
import { motion, AnimatePresence } from "motion/react"
```

## Microfrontend Architecture

Each production app deploys to its own subdomain. Per-origin ServiceWorker means each app is independently installable as a PWA.

- **Dev URLs:** `*.localhost` (modern browsers auto-resolve; no `/etc/hosts` edits)
- **Shared client state across apps:** when needed, persist via cookies on the parent domain. Cross-origin SharedWorker is NOT viable (browser scopes prohibit).

**Adding a new subdomain app:**

1. Scaffold under `apps/<name>/` (Next.js project)
2. Set its dev script to `next dev --port <unique-port> --hostname <name>.localhost`
3. Use `catalog:` for shared deps (next, react, motion, etc.)
4. Add Serwist setup if PWA features are wanted (see `apps/www/next.config.ts` for the pattern)
5. Configure Vercel project for `<name>.brand.com`

## Dependency Versioning (Bun catalog)

Shared dep versions live in the root `package.json` `catalog` field. Apps reference them via `"<dep>": "catalog:"`. Single source of truth for `next`, `react`, `motion`, `react-hook-form`, `@serwist/next`, `@iconify/react`, `zod`, etc.

To bump a shared dep:
1. Edit the version in root `package.json` `catalog`
2. Run `bun install`
3. Test affected apps
4. Add a changeset if user-visible

## Code Style

- Biome handles all formatting and linting
- Double quotes for strings
- No semicolons (ASI)
- 2-space indentation
- 100 character line width

## File Naming Conventions

- Components: PascalCase (`UserProfile.tsx`)
- Blocks: kebab-case (`hero.tsx`, `feature-grid.tsx`) with PascalCase exports
- Views: kebab-case (`home-view.tsx`) with PascalCase exports (`HomeView`)
- Utilities: camelCase (`formatDate.ts`)
- Pages: lowercase-with-hyphens (`user-settings/page.tsx`)
- Types: PascalCase with `.types.ts` suffix when separated

## Common Tasks

### Adding a New Block (shared section pattern)
1. Create `packages/ui/src/blocks/<name>.tsx` — content-agnostic, take props, use `cn()` for `className` merge
2. Add a Storybook story at `apps/story/src/stories/blocks/<name>.stories.tsx`
3. Block must NOT import from any view or page

### Adding a New View (app-specific composition)
1. Create `apps/<app>/src/views/<route>-view.tsx`
2. Compose blocks (`@repo/ui/blocks/*`) and components (`@repo/ui/components/*`)
3. Named export `<Route>View` (PascalCase)

### Adding a New Page
1. Create `apps/<app>/src/app/<route>/page.tsx` — thin wrapper that renders a view
2. Add the corresponding view in `apps/<app>/src/views/`

### Form Patterns
React Hook Form + Zod aren't pre-installed in every workspace anymore — install them where you need them, then:
```tsx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
```

### Adding a Backend / Data Layer / Auth
None ship by default. When needed, prefer fresh wiring (e.g. a dedicated `apps/auth` app or a real API behind `/api/*`) over re-introducing the previous Apollo/Supabase setup.

## Troubleshooting

### Build Failures
1. Check TypeScript errors: `bun turbo check-types`
2. Check lint errors: `bun run lint`
3. Clear cache: `rm -rf .turbo && bun run build`

### Module Resolution Issues
1. Ensure `@repo/ui` exports the component (check `packages/ui/package.json` `exports`)
2. Restart dev server after package changes

## Slash Commands

The following custom commands are available:
- `/dev [app]` — Start development server (all, www, app)
- `/lint-fix` — Run Biome lint and format with auto-fix
- `/add-component <name>` — Add a shadcn/ui component to packages/ui
- `/typecheck` — Run TypeScript checks across all apps
