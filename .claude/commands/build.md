# Build

Build production bundles for a specific app or all apps.

## Usage
`/build [app-name]`

## Arguments
- **No argument**: Build all apps in parallel via Turborepo
- **www**: Build marketing site
- **app**: Build dashboard application
- **story**: Build Storybook static site

## Instructions

Based on the argument provided by the user:

1. If no argument or "all":
   - Run `bun run build`

2. If "www":
   - Run `bun build:www`

3. If "app":
   - Run `bun build:app`

4. If "story":
   - Run `bun --filter @repo/story build`

After the build completes, report the result to the user. If the build fails, help diagnose the issue.
