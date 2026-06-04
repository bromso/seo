import type { RunStatus } from "@/lib/format"

export type SiteRow = {
  id: string
  owner_id: string
  url: string
  normalized_url: string
  label: string | null
  is_competitor: boolean
  created_at: string
}

export type AuditRunRow = {
  id: string
  site_id: string
  owner_id: string
  status: RunStatus
  requested_url: string
  final_url: string | null
  started_at: string
  finished_at: string | null
  triggered_by: string
}

export type AuditResultRow = {
  id: string
  run_id: string
  owner_id: string
  category: "performance" | "seo" | "best-practices" | "pwa" | "on-page"
  status: "success" | "partial" | "failed"
  score: number | null
  issues: unknown
  raw: unknown
  partial_reasons: string[] | null
  error_code: string | null
  error_message: string | null
  error_retryable: boolean | null
  package_name: string
  package_version: string
  duration_ms: number
  started_at: string
}
