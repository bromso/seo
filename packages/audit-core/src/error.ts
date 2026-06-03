import type { ErrorCode } from "./types.js"

export const ErrorCodes = {
  DNS_ERROR: "DNS_ERROR",
  HTTP_4XX: "HTTP_4XX",
  HTTP_5XX: "HTTP_5XX",
  TIMEOUT: "TIMEOUT",
  ABORTED: "ABORTED",
  LIGHTHOUSE_CRASH: "LIGHTHOUSE_CRASH",
  LIGHTHOUSE_NO_FCP: "LIGHTHOUSE_NO_FCP",
  INVALID_HTML: "INVALID_HTML",
  UNKNOWN: "UNKNOWN",
} as const satisfies Record<ErrorCode, ErrorCode>

const RETRYABLE_BY_DEFAULT: Record<ErrorCode, boolean> = {
  DNS_ERROR: true,
  HTTP_4XX: false,
  HTTP_5XX: true,
  TIMEOUT: true,
  ABORTED: false,
  LIGHTHOUSE_CRASH: true,
  LIGHTHOUSE_NO_FCP: true,
  INVALID_HTML: false,
  UNKNOWN: true,
}

export type AuditFailureInput = {
  code: ErrorCode
  message: string
  retryable?: boolean
  cause?: unknown
}

export class AuditFailure extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean

  constructor(input: AuditFailureInput) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = "AuditFailure"
    this.code = input.code
    this.retryable = input.retryable ?? RETRYABLE_BY_DEFAULT[input.code]
  }
}
