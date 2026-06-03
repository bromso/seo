Start the development server for a specific app or all apps.

## Usage
`/dev [app-name]`

## Arguments
- **No argument**: Start all apps in parallel via Turborepo
- **www**: Start marketing site on port 3000
- **app**: Start dashboard application on port 3001
- **legal**: Start legal documentation on port 3002
- **docs**: Start product documentation on port 3003

## Instructions
Based on the argument provided by the user:

1. If no argument or "all":
   - Run `bun dev`

2. If "www":
   - Run `bun --filter @repo/www dev`

3. If "app":
   - Run `bun --filter @repo/app dev`

4. If "legal":
   - Run `bun --filter @repo/legal dev`

5. If "docs":
   - Run `bun --filter @repo/docs dev`

Run the command in the background so the user can continue working.
