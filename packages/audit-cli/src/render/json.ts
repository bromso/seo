import type { AuditResult } from "@repo/audit-core"

export function renderJson(results: AuditResult[]): string {
  return JSON.stringify(results, null, 2)
}
