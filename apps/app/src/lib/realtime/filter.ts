import type { Envelope } from "@/lib/realtime/envelope"

export function shouldDeliverToScores(e: Envelope): boolean {
  return e.table === "audit_results"
}

export function shouldDeliverToRuns(e: Envelope, siteId: string): boolean {
  return e.table === "audit_runs" && e.row.site_id === siteId
}

export function shouldDeliverToRun(e: Envelope, runId: string): boolean {
  if (e.table === "audit_runs") return e.event === "UPDATE" && e.row.id === runId
  if (e.table === "audit_results") return e.row.run_id === runId
  return false
}
