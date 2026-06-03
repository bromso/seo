# Boilerplate

A frontend monorepo boilerplate.

[![Next.js](https://img.shields.io/badge/Next.js-15%2F16-black?logo=next.js)](https://nextjs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.4+-f9f1e1?logo=bun)](https://bun.sh/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.5-ef4444?logo=turborepo)](https://turbo.build/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06b6d4?logo=tailwindcss)](https://tailwindcss.com/)

## Features

- Brand asset management and organization
- Brand guidelines documentation
- Compliance monitoring and review workflows
- Multi-organization support
- Real-time collaboration

## Quick Start

```bash
# Clone the repository
git clone https://github.com/bromso/boilerplate.git
cd boilerplate

# Install dependencies
bun install

# Start development servers
bun dev
```

This starts all applications:
- **Dashboard** - http://localhost:3001
- **Marketing** - http://localhost:3000
- **Documentation** - http://localhost:3003
- **Legal** - http://localhost:3002

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 15 / 16 |
| **Runtime** | Bun |
| **Monorepo** | Turborepo |
| **UI Components** | shadcn/ui + Radix UI |
| **Styling** | Tailwind CSS v4 |
| **State** | Apollo Client (local-only) |
| **Auth** | Better Auth + Drizzle ORM |
| **Linting** | Biome |
| **Animation** | Motion (formerly know as Framer Motion) |

## Project Structure

```
boilerplate/
├── apps/
│   ├── app/      # Main dashboard (Next.js 15)
│   ├── www/      # Marketing site (Next.js 15)
│   ├── docs/     # Documentation (Fumadocs + Next.js 16)
│   ├── legal/    # Legal docs (Fumadocs + Next.js 16)
│   └── story/    # Storybook
├── packages/
│   ├── ui/                   # Shared shadcn/ui components
│   └── typescript-config/    # Shared TS configuration
└── docker/                   # Development containers
```

## Development

```bash
# Run a specific app
bun --filter @repo/app dev     # Dashboard only
bun --filter @repo/www dev     # Marketing only

# Build all apps
bun run build

# Lint and format
bun run lint
bun run format
```

## Committing Changes

This project enforces commit conventions using Git hooks.

```bash
# Interactive commit (recommended)
bun run commit

# Standard commit (auto-validated)
git commit -m "feat: :sparkles: add new feature"
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit message format and Git hooks details.

## Documentation

For detailed documentation, visit the [docs site](http://localhost:3003) when running locally, or see:

- [Getting Started](./apps/docs/content/docs/getting-started/)
- [Architecture](./apps/docs/content/docs/architecture/)
- [Contributing](./CONTRIBUTING.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to contribute to this project.

## Security

See [SECURITY.md](./SECURITY.md) for reporting security vulnerabilities.

## License

This project is proprietary software. See [LICENSE](./LICENSE) for details.

---

Built by [Jonas Bröms](https://github.com/bromso)
