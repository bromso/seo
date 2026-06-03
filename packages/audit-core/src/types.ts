export type Category = "performance" | "seo" | "best-practices" | "pwa" | "on-page"

export type Severity = "info" | "warn" | "error"

export type IssueOccurrence = {
  selector?: string
  snippet?: string
  url?: string
}

export type Issue = {
  rule: string
  severity: Severity
  title: string
  description: string
  recommendation: string
  count: number
  occurrences: IssueOccurrence[]
  docsUrl?: string
}

export type ErrorCode =
  | "DNS_ERROR"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "TIMEOUT"
  | "ABORTED"
  | "LIGHTHOUSE_CRASH"
  | "LIGHTHOUSE_NO_FCP"
  | "INVALID_HTML"
  | "UNKNOWN"

export type AuditError = {
  code: ErrorCode
  message: string
  retryable: boolean
}

type AuditResultBase = {
  category: Category
  url: string
  requestedUrl: string
  startedAt: string
  durationMs: number
  packageName: string
  packageVersion: string
}

export type AuditResultSuccess = AuditResultBase & {
  status: "success"
  score: number
  issues: Issue[]
  raw: unknown
}

export type AuditResultPartial = AuditResultBase & {
  status: "partial"
  score: number
  issues: Issue[]
  raw: unknown
  partialReasons: string[]
}

export type AuditResultFailure = AuditResultBase & {
  status: "failed"
  error: AuditError
}

export type AuditResult = AuditResultSuccess | AuditResultPartial | AuditResultFailure

export type LogEvent =
  | { kind: "progress"; message: string }
  | { kind: "warn"; message: string }
  | { kind: "debug"; message: string; data?: unknown }

export type AuditOptions = {
  timeoutMs?: number
  logger?: (event: LogEvent) => void
  signal?: AbortSignal
  lighthouseResult?: unknown
  userAgent?: string
  formFactor?: "mobile" | "desktop"
}

export type AuditFn = (url: string, opts?: AuditOptions) => Promise<AuditResult>
