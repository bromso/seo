import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const connectionString =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

const client = postgres(connectionString, { max: 1 })
const db = drizzle(client)

await migrate(db, { migrationsFolder: "./migrations" })
await client.end()
console.log("migrations applied")
