export type LighthouseCategory = {
  id: string
  title: string
  score: number | null
  auditRefs: Array<{ id: string; weight: number; group?: string }>
}

export type LighthouseAudit = {
  id: string
  title: string
  description: string
  score: number | null
  scoreDisplayMode:
    | "binary"
    | "numeric"
    | "metricSavings"
    | "informative"
    | "manual"
    | "notApplicable"
    | "error"
  displayValue?: string
  details?: { items?: Array<Record<string, unknown>> }
}

export type RawLighthouseResult = {
  requestedUrl: string
  finalUrl: string
  fetchTime: string
  lighthouseVersion: string
  categories: {
    performance: LighthouseCategory
    seo: LighthouseCategory
    "best-practices": LighthouseCategory
    pwa?: LighthouseCategory
  }
  audits: Record<string, LighthouseAudit>
  runtimeError?: { code: string; message: string }
}

export type LighthouseRunOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  formFactor?: "mobile" | "desktop"
  logger?: (event: import("@repo/audit-core").LogEvent) => void
}
