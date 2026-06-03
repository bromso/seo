import { AuditFailure } from "./error.js"
import type { AuditFn, AuditOptions, AuditResult, Category, Issue } from "./types.js"

export type WithTimingMeta = {
  category: Category
  packageName: string
  packageVersion: string
}

export type InnerAuditSuccess = {
  score: number
  issues: Issue[]
  raw: unknown
  partialReasons?: string[]
}

export type InnerAuditFn = (ctx: {
  url: string
  opts: AuditOptions | undefined
}) => Promise<InnerAuditSuccess>

type BaseFields = {
  category: Category
  url: string
  requestedUrl: string
  startedAt: string
  packageName: string
  packageVersion: string
}

export function withTiming(meta: WithTimingMeta) {
  return (inner: InnerAuditFn): AuditFn => {
    return async (url, opts) => {
      const requestedUrl = url
      const startedAtMs = Date.now()
      const startedAt = new Date(startedAtMs).toISOString()
      const base: BaseFields = {
        category: meta.category,
        url,
        requestedUrl,
        startedAt,
        packageName: meta.packageName,
        packageVersion: meta.packageVersion,
      }

      try {
        if (opts?.signal?.aborted) {
          return toFailure(base, startedAtMs, abortedError())
        }
        const inner_result = await inner({ url, opts })
        const durationMs = Date.now() - startedAtMs
        if (inner_result.partialReasons && inner_result.partialReasons.length > 0) {
          return {
            ...base,
            durationMs,
            status: "partial",
            score: inner_result.score,
            issues: inner_result.issues,
            raw: inner_result.raw,
            partialReasons: inner_result.partialReasons,
          }
        }
        return {
          ...base,
          durationMs,
          status: "success",
          score: inner_result.score,
          issues: inner_result.issues,
          raw: inner_result.raw,
        }
      } catch (err) {
        return toFailure(base, startedAtMs, err)
      }
    }
  }
}

function toFailure(base: BaseFields, startedAtMs: number, err: unknown): AuditResult {
  const durationMs = Date.now() - startedAtMs
  const failure = toAuditFailure(err)
  return {
    ...base,
    durationMs,
    status: "failed",
    error: {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    },
  }
}

function toAuditFailure(err: unknown): AuditFailure {
  if (err instanceof AuditFailure) return err
  if (isAbortError(err))
    return new AuditFailure({
      code: "ABORTED",
      message: err instanceof Error ? err.message : "aborted",
      cause: err,
    })
  if (err instanceof Error)
    return new AuditFailure({ code: "UNKNOWN", message: err.message, cause: err })
  return new AuditFailure({ code: "UNKNOWN", message: String(err) })
}

function isAbortError(err: unknown): err is Error {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR")
  )
}

function abortedError(): AuditFailure {
  return new AuditFailure({ code: "ABORTED", message: "aborted before start" })
}
