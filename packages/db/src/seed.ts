#!/usr/bin/env tsx
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
try {
  const envFile = readFileSync(resolve(here, "..", ".env.local"), "utf8")
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "")
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // .env.local missing — fall back to process.env (e.g. in CI)
}

import { createClient } from "@supabase/supabase-js"
import { sql } from "drizzle-orm"
import { createDbClient } from "./client"
import { auditResults, auditRuns, profiles, sites } from "./schema/index"

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]
if (!SERVICE_KEY) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is required. Copy it from `bunx supabase status -o env` into packages/db/.env.local."
  )
  process.exit(2)
}

const auth = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

const TEST_EMAIL = "demo@example.test"
const TEST_PASSWORD = "demo-password-123!"

async function main() {
  // 1. Ensure the demo user exists
  let userId: string
  const existing = await auth.auth.admin.listUsers()
  const found = existing.data?.users.find((u) => u.email === TEST_EMAIL)
  if (found) {
    userId = found.id
    console.log(`Demo user already exists: ${userId}`)
  } else {
    const created = await auth.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    if (created.error || !created.data.user) {
      throw new Error(`createUser failed: ${created.error?.message}`)
    }
    userId = created.data.user.id
    console.log(`Demo user created: ${userId}`)
  }

  // 2. Use service-role DB to seed data
  const db = createDbClient({
    connectionString: DB_URL,
    role: "service_role",
    ssl: false,
  })

  // The handle_new_user trigger should have created the profile; if not, insert it.
  await db.insert(profiles).values({ id: userId }).onConflictDoNothing()

  // Self site
  const [selfSite] = await db
    .insert(sites)
    .values({
      ownerId: userId,
      url: "https://example.com",
      normalizedUrl: "https://example.com/",
      label: "My site",
      isCompetitor: false,
    })
    .onConflictDoNothing()
    .returning({ id: sites.id })

  // Competitor sites
  await db
    .insert(sites)
    .values([
      {
        ownerId: userId,
        url: "https://competitor-a.test",
        normalizedUrl: "https://competitor-a.test/",
        label: "Competitor A",
        isCompetitor: true,
      },
      {
        ownerId: userId,
        url: "https://competitor-b.test",
        normalizedUrl: "https://competitor-b.test/",
        label: "Competitor B",
        isCompetitor: true,
      },
    ])
    .onConflictDoNothing()

  if (selfSite) {
    // Sample completed run
    const [run] = await db
      .insert(auditRuns)
      .values({
        siteId: selfSite.id,
        ownerId: userId,
        requestedUrl: "https://example.com",
        triggeredBy: "manual",
      })
      .returning({ id: auditRuns.id })

    if (run) {
      const cats: Array<{
        c: "performance" | "seo" | "best-practices" | "pwa" | "on-page"
        s: number
        status?: "success" | "partial"
      }> = [
        { c: "performance", s: 95 },
        { c: "seo", s: 88 },
        { c: "best-practices", s: 92 },
        { c: "pwa", s: 0, status: "partial" },
        { c: "on-page", s: 78 },
      ]
      for (const { c, s, status = "success" } of cats) {
        await db.insert(auditResults).values({
          runId: run.id,
          ownerId: userId,
          category: sql.raw(`'${c}'::category`) as never,
          status: sql.raw(`'${status}'::result_status`) as never,
          score: s,
          issues: [],
          raw: { sample: true },
          partialReasons: status === "partial" ? ["pwa-category-not-emitted-by-lighthouse"] : null,
          packageName: `@repo/audit-${c}`,
          packageVersion: "0.0.0",
          durationMs: 1500,
          startedAt: new Date(),
        })
      }
      console.log(`Seeded one completed run for site ${selfSite.id}`)
    }
  }

  console.log(`Done. Sign in to Studio at http://127.0.0.1:54323`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
