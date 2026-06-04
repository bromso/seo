import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema/index"

export type DbClientOptions = {
  connectionString: string
  role?: "service_role" | "authenticated" | "anon"
  max?: number
  ssl?: "require" | "prefer" | false
}

export function createDbClient(opts: DbClientOptions) {
  const client = postgres(opts.connectionString, {
    max: opts.max ?? 10,
    ssl: opts.ssl ?? "prefer",
    prepare: false,
  })
  return drizzle(client, { schema })
}

export type Db = ReturnType<typeof createDbClient>
