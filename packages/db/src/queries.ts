import type { Category } from "@repo/audit-core"
import { eq, sql } from "drizzle-orm"
import type { Db } from "./client"
import { auditResults, auditRuns } from "./schema/index"
import type { AuditRun } from "./types"

export async function getAuditRun(db: Db, runId: string): Promise<AuditRun | undefined> {
  const rows = await db.select().from(auditRuns).where(eq(auditRuns.id, runId))
  return rows[0]
}

/**
 * Update audit_runs.status to 'running' if currently 'queued' or already 'running'.
 * Returns the number of rows updated (0 if the row doesn't exist or is terminal).
 */
export async function markAuditRunRunning(db: Db, runId: string): Promise<number> {
  const result = await db
    .update(auditRuns)
    .set({ status: sql`'running'::run_status` })
    .where(sql`${auditRuns.id} = ${runId} AND ${auditRuns.status} IN ('queued','running')`)
  return (result as unknown as { count: number }).count ?? 0
}

export async function getCompletedCategoriesForRun(db: Db, runId: string): Promise<Set<Category>> {
  const rows = await db
    .select({ category: auditResults.category })
    .from(auditResults)
    .where(eq(auditResults.runId, runId))
  return new Set(rows.map((r) => r.category as Category))
}
