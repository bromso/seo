import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  // tsdown 0.22.x defaults to fixed .mjs/.cjs extensions; force .js for Node ESM
  fixedExtension: false,
})
