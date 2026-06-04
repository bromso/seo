import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
  // tsdown 0.22.x defaults to fixed .mjs/.cjs extensions; force .js for Node ESM
  fixedExtension: false,
})
