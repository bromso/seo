import { createDbClient } from "@repo/db"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { sql } from "drizzle-orm"

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]

if (!SERVICE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required. Run `bunx supabase status -o env` and copy it into packages/runner-core/.env.local"
  )
}

const auth = createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

export async function createTestUser(suffix: string): Promise<{
  id: string
  email: string
}> {
  const email = `runner-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const created = await auth.auth.admin.createUser({
    email,
    password: "supersecret123!",
    email_confirm: true,
  })
  if (created.error || !created.data.user) {
    throw new Error(`createTestUser failed: ${created.error?.message}`)
  }
  return { id: created.data.user.id, email }
}

export async function deleteTestUser(id: string): Promise<void> {
  await auth.auth.admin.deleteUser(id)
}

export function createServiceDb() {
  const db = createDbClient({
    connectionString: DB_URL,
    role: "service_role",
    ssl: false,
  })
  return { db, close: async () => {} }
}

export async function truncateUserData(): Promise<void> {
  const { db } = createServiceDb()
  await db.execute(sql`
    TRUNCATE public.audit_results, public.audit_runs, public.sites, public.profiles
    RESTART IDENTITY CASCADE
  `)
}

export async function purgeQueue(queueName = "audit_runs"): Promise<void> {
  const { db } = createServiceDb()
  await db.execute(sql`SELECT pgmq.purge_queue(${queueName})`)
}
