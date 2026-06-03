---
name: add-mdx-page
description: MUST USE for ANY request to add a marketing, content, landing, pricing, about, features, team, or blog page to apps/www (the Symbiora marketing site). Creates an MDX-powered page wired to the @next/mdx setup. Trigger phrases - "add a pricing page to the marketing site", "create an about page in apps/www", "build a features landing page", "add a /blog/SLUG post", "marketing page about our team", "new content page", "MDX page", "landing page", "blog post". Skip for dashboard pages (apps/app, use add-dashboard-route), shared UI components (use add-ui-component), or API routes (use nextjs-route-handlers).
---

# Add MDX Page (apps/www)

Create an MDX page in the marketing site. apps/www is wired with `@next/mdx` and `@mdx-js/react`.

## File Layout

For a route `/SLUG`:

- Either: `apps/www/src/app/SLUG/page.mdx` (file-based MDX, simplest)
- Or: `apps/www/src/app/SLUG/page.tsx` that imports content from `apps/www/src/content/SLUG.mdx`

Prefer the first form unless the page needs significant TSX scaffolding.

## Workflow

### 1. Create the page

For `/about`:

File: `apps/www/src/app/about/page.mdx`

```mdx
export const metadata = {
  title: "About — Symbiora",
  description: "Our mission and team.",
}

# About Symbiora

We build software that…

<Feature title="Mission">
  Solving X for Y.
</Feature>

## Team

- Jonas Bröms — Founder
- …
```

### 2. Custom MDX components

If you need custom components inside MDX (`<Feature>`, `<CallToAction>`, etc.):

File: `apps/www/mdx-components.tsx` (root of `apps/www/src/`)

```tsx
import type { MDXComponents } from "mdx/types"
import { Card } from "@repo/ui/components/card"

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    Feature: ({ title, children }) => (
      <Card className="p-4">
        <h3 className="font-semibold">{title}</h3>
        <div>{children}</div>
      </Card>
    ),
    h1: ({ children }) => <h1 className="text-4xl font-bold">{children}</h1>,
  }
}
```

If `mdx-components.tsx` already exists, extend it rather than overwriting.

### 3. Verify

```bash
bun --filter @repo/www dev    # visit http://localhost:3000/SLUG
bun typecheck
bun lint
```

### 4. SEO

Always export `metadata` from the MDX file with `title` and `description`. Next 16's metadata API picks it up automatically.

## When NOT to use this skill

- Dashboard pages — use `add-dashboard-route` (apps/app, not apps/www)
- Highly interactive pages with lots of state — use a `.tsx` page instead of `.mdx`
- API routes — use `nextjs-route-handlers`

## Cross-references

- For shared content components: see `add-ui-component` skill
- For animations on the page: see `fixing-motion-performance` skill
