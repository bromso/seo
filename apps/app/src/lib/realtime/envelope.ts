import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"

export type Envelope =
  | { table: "audit_runs"; event: "INSERT" | "UPDATE"; row: AuditRunRow }
  | { table: "audit_results"; event: "INSERT"; row: AuditResultRow }

export type SupabasePayloadShape = {
  table: string
  eventType: string
  new: unknown
}

export function fromSupabasePayload(p: SupabasePayloadShape): Envelope | null {
  if (p.table === "audit_runs") {
    if (p.eventType === "INSERT" || p.eventType === "UPDATE") {
      return { table: "audit_runs", event: p.eventType, row: p.new as AuditRunRow }
    }
    return null
  }
  if (p.table === "audit_results") {
    if (p.eventType === "INSERT") {
      return { table: "audit_results", event: "INSERT", row: p.new as AuditResultRow }
    }
    return null
  }
  return null
}
