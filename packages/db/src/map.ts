import { type AuditResult, AuditResultSchema } from "@repo/audit-core"
import type { NewAuditResultRow } from "./types.js"

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
      issues: parsed.issues,
      raw: parsed.raw as NewAuditResultRow["raw"],
    }
  }
  if (parsed.status === "partial") {
    return {
      ...base,
      score: parsed.score,
      issues: parsed.issues,
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
