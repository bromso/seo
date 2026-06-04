import type { AuditError, Category } from "@repo/audit-core"

export type FailureReason = "fetch_failed" | "aggregate_failed" | "db_failed" | "timeout"

export type SkipReason = "run_not_found" | "already_completed"

export type ProcessRunResult =
  | { status: "completed"; resultsInserted: number }
  | { status: "partial"; resultsInserted: number; partialCategories: Category[] }
  | { status: "failed"; reason: FailureReason; error?: AuditError }
  | { status: "skipped"; reason: SkipReason }

export class RunnerError extends Error {
  readonly code: FailureReason | "queue_error"
  constructor(input: {
    code: FailureReason | "queue_error"
    message: string
    cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = "RunnerError"
    this.code = input.code
  }
}
