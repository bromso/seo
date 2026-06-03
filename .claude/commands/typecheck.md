Run TypeScript type checking across all apps in the monorepo.

## Instructions

1. Run `bun turbo check-types` to check types across all apps
2. If turbo task not available, check each app individually:
   - `bun --filter @repo/www exec tsc --noEmit`
   - `bun --filter @repo/app exec tsc --noEmit`
   - `bun --filter @repo/legal types:check`
   - `bun --filter @repo/docs types:check`
3. Report any type errors found with file locations

## Common Type Issues
- Missing imports from @repo/ui
- Incorrect GraphQL type definitions
- React component prop mismatches
- Environment variable types

## Quick Fixes
- Add missing type imports
- Update type definitions in schema
- Use `as const` for literal types
- Check tsconfig.json paths configuration
