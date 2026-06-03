# Clean

Remove build artifacts and cached files from the monorepo.

## Usage

`/clean`

## Instructions

Run the clean script to remove:
- `.turbo` - Turborepo cache
- `node_modules` - All installed dependencies
- `.next` - Next.js build output

Execute: `bun run clean`

After cleaning completes, remind the user to run `bun install` to reinstall dependencies before running dev or build commands.
