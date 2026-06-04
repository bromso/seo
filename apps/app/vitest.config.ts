import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/test/**/*.test.ts", "src/test/**/*.test.tsx"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
})
