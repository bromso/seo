import { Hero } from "@repo/ui/blocks/hero"

export function HomeView() {
  return (
    <main>
      <Hero
        eyebrow="App shell"
        title="Welcome to the application"
        description="This is a clean shell. Add real routes under apps/app/src/app/ as the product takes shape."
      />
    </main>
  )
}
