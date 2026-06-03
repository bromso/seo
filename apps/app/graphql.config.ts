import type { IGraphQLConfig } from "graphql-config"

const config: IGraphQLConfig = {
  schema: "./src/data/schema/typeDefs.ts",
  documents: ["./src/**/*.{ts,tsx}"],
  extensions: {
    languageService: {
      cacheSchemaFileForLookup: true,
    },
  },
}

export default config
