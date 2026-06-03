import { AuditFailure } from "@repo/audit-core"

export function mapLhrRuntimeError(rt: { code: string; message: string }): AuditFailure {
  switch (rt.code) {
    case "NO_FCP":
      return new AuditFailure({
        code: "LIGHTHOUSE_NO_FCP",
        message: rt.message,
      })
    case "ERRORED_DOCUMENT_REQUEST":
      return new AuditFailure({ code: "DNS_ERROR", message: rt.message })
    default:
      return new AuditFailure({
        code: "LIGHTHOUSE_CRASH",
        message: `${rt.code}: ${rt.message}`,
      })
  }
}

export function mapHttpStatus(status: number): AuditFailure {
  if (status >= 500 && status < 600) {
    return new AuditFailure({
      code: "HTTP_5XX",
      message: `HTTP ${status} from final URL`,
    })
  }
  return new AuditFailure({
    code: "HTTP_4XX",
    message: `HTTP ${status} from final URL`,
  })
}

export function mapThrownError(err: unknown): AuditFailure {
  if (err instanceof AuditFailure) return err
  if (err instanceof Error) {
    if (err.name === "AbortError")
      return new AuditFailure({ code: "ABORTED", message: err.message, cause: err })
    const code = (err as { code?: string }).code
    if (code === "ETIMEDOUT" || /timed out/i.test(err.message))
      return new AuditFailure({ code: "TIMEOUT", message: err.message, cause: err })
    return new AuditFailure({
      code: "LIGHTHOUSE_CRASH",
      message: err.message,
      cause: err,
    })
  }
  return new AuditFailure({
    code: "LIGHTHOUSE_CRASH",
    message: String(err),
  })
}
