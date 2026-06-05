import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["integration/**/*.integration.test.ts"],
    environment: "node",
    setupFiles: ["./integration/load-env.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
})
