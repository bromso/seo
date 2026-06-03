import { Hero } from "@repo/ui/blocks/hero"

export function HomeView() {
  return (
    <main>
      <Hero
        eyebrow="Frontend boilerplate"
        title="Build faster with this monorepo template"
        description="Tokens, components, blocks, views, pages — wired up with Next.js, Bun, Turborepo, and Biome."
      />
    </main>
  )
}
