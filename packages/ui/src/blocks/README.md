# Blocks

Reusable section patterns composed of components from `../components/`.

A block is content-agnostic (takes props), composable, and meant to be assembled into views by an app.

Examples: hero, feature grid, footer, pricing table.

**Import direction:** blocks may import from `../components/`. They may NOT import from any app's `views/` or pages.

## Conventions

- One block per file: `<block-name>.tsx`
- Named export matching the file (PascalCase)
- All content as props, with sensible defaults for storybook
- `className` prop accepted, merged with `cn()` from `@repo/ui/lib/utils`
- A matching Storybook story under `apps/story/src/stories/blocks/<block-name>.stories.tsx`
