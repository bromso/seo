import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "../src/schema/index"

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]
if (!SERVICE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required. Run `bunx supabase status` and copy it into packages/db/.env.local"
  )
}

const auth = createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

export async function createTestUser(suffix: string): Promise<{
  id: string
  email: string
  jwt: string
}> {
  const email = `test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = "supersecret123!"

  const created = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (created.error || !created.data.user) {
    throw new Error(`createTestUser failed: ${created.error?.message}`)
  }

  const signedIn = await auth.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) {
    throw new Error(`signInWithPassword failed: ${signedIn.error?.message}`)
  }

  return {
    id: created.data.user.id,
    email,
    jwt: signedIn.data.session.access_token,
  }
}

export async function deleteTestUser(id: string): Promise<void> {
  await auth.auth.admin.deleteUser(id)
}

export function createServiceDb() {
  const client = postgres(DB_URL, { max: 1, prepare: false })
  const db = drizzle(client, { schema })
  return { db, close: async () => client.end() }
}

/**
 * Returns a Drizzle-backed test client that runs each query inside a
 * transaction with role=authenticated and the user's JWT sub claim set,
 * so RLS policies see auth.uid() === claims.sub.
 *
 * Implementation: uses drizzle's own db.transaction() so that the inner
 * drizzle `tx` object is constructed correctly (drizzle creates a
 * PostgresJsSession wrapping the transaction-scoped client internally,
 * bypassing the `options.parsers` initialisation path that breaks when
 * drizzle() is called directly on a postgres-js sub-client).
 */
export function createUserDb(jwt: string) {
  const client = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} })
  const claims = parseJwtSub(jwt)
  const db = drizzle(client, { schema })

  return {
    close: async () => client.end(),
    /**
     * Run `fn` inside a transaction with role='authenticated' and
     * request.jwt.claim.sub set to the user's id.
     */
    asUser: async <T>(
      fn: (tx: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>
    ): Promise<T> => {
      return db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL role TO authenticated"))
        await tx.execute(sql`SELECT set_config('request.jwt.claim.sub', ${claims.sub}, true)`)
        await tx.execute(
          sql.raw("SELECT set_config('request.jwt.claim.role', 'authenticated', true)")
        )
        return fn(tx as unknown as ReturnType<typeof drizzle<typeof schema>>)
      })
    },
  }
}

function parseJwtSub(jwt: string): { sub: string } {
  const payload = jwt.split(".")[1]
  if (!payload) throw new Error("invalid JWT")
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  if (typeof decoded.sub !== "string") {
    throw new Error("JWT has no sub claim")
  }
  return { sub: decoded.sub }
}

export async function truncateUserData(): Promise<void> {
  const { db, close } = createServiceDb()
  try {
    await db.execute(
      // delete in reverse-dependency order; CASCADE handles the rest
      "TRUNCATE public.audit_results, public.audit_runs, public.sites, public.profiles RESTART IDENTITY CASCADE"
    )
  } finally {
    await close()
  }
}
