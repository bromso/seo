import { createDbClient, insertAuditRun, schema } from "@repo/db"
import { and, eq } from "drizzle-orm"

export type EnqueueOptions = {
  url: string
  ownerId: string
  siteId?: string
  label?: string
  connectionString: string
}

export async function enqueueOne(opts: EnqueueOptions): Promise<string> {
  const db = createDbClient({
    connectionString: opts.connectionString,
    role: "service_role",
    ssl: false,
  })

  let siteId = opts.siteId
  if (!siteId) {
    const rows = await db
      .select({ id: schema.sites.id })
      .from(schema.sites)
      .where(and(eq(schema.sites.ownerId, opts.ownerId), eq(schema.sites.isCompetitor, false)))
    siteId = rows[0]?.id
    if (!siteId) {
      throw new Error(`no self-site found for owner ${opts.ownerId}; pass --site-id or seed first`)
    }
  }

  const runId = await insertAuditRun(db, {
    siteId,
    requestedUrl: opts.url,
    triggeredBy: "manual",
  })
  return runId
}
