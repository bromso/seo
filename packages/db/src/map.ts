import { type AuditResult, AuditResultSchema, type Issue } from "@repo/audit-core"
import { sql } from "drizzle-orm"
import type { Db } from "./client"
import { auditResults, auditRuns } from "./schema/index"
import type { NewAuditResultRow } from "./types"

export function auditResultToInsert(
  result: AuditResult,
  runId: string,
  ownerId: string
): NewAuditResultRow {
  const parsed = AuditResultSchema.parse(result)

  const base = {
    runId,
    ownerId,
    category: parsed.category,
    status: parsed.status,
    packageName: parsed.packageName,
    packageVersion: parsed.packageVersion,
    durationMs: parsed.durationMs,
    startedAt: new Date(parsed.startedAt),
  } satisfies Partial<NewAuditResultRow>

  if (parsed.status === "success") {
    return {
      ...base,
      score: parsed.score,
      issues: parsed.issues as Issue[],
      raw: parsed.raw as NewAuditResultRow["raw"],
    }
  }
  if (parsed.status === "partial") {
    return {
      ...base,
      score: parsed.score,
      issues: parsed.issues as Issue[],
      raw: parsed.raw as NewAuditResultRow["raw"],
      partialReasons: parsed.partialReasons,
    }
  }
  return {
    ...base,
    errorCode: parsed.error.code,
    errorMessage: parsed.error.message,
    errorRetryable: parsed.error.retryable,
  }
}

export async function insertAuditResult(
  db: Db,
  result: AuditResult,
  runId: string,
  ownerId: string
): Promise<string> {
  const row = auditResultToInsert(result, runId, ownerId)
  const [inserted] = await db.insert(auditResults).values(row).returning({ id: auditResults.id })
  if (!inserted) {
    throw new Error("audit_results insert returned no row")
  }
  return inserted.id
}

export async function insertAuditRun(
  db: Db,
  input: {
    siteId: string
    requestedUrl: string
    triggeredBy?: "manual" | "scheduled"
  }
): Promise<string> {
  const [inserted] = await db
    .insert(auditRuns)
    .values({
      siteId: input.siteId,
      ownerId: sql`NULL`,
      requestedUrl: input.requestedUrl,
      triggeredBy: input.triggeredBy ?? "manual",
    })
    .returning({ id: auditRuns.id })
  if (!inserted) {
    throw new Error("audit_runs insert returned no row")
  }
  return inserted.id
}
