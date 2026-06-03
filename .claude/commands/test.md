# Test Runner

Run tests for the monorepo.

## Arguments
- `$ARGUMENTS` - Optional test type: `unit`, `story`, or `e2e`

## Instructions

Based on the argument provided, run the appropriate test command:

1. **No argument or `unit`**: Run unit tests
   ```bash
   bun test
   ```

2. **`story`**: Run Storybook component tests
   ```bash
   bun --filter @repo/story test
   ```

3. **`e2e`**: Run Playwright E2E tests
   ```bash
   bunx playwright test
   ```

Report the test results clearly, including:
- Number of tests passed/failed
- Any error messages for failed tests
- Suggestions for fixing failures if applicable
