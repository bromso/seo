import type { AggregateOptions, AuditPackages } from "@repo/audit-cli/lib"
import type { AuditResult, Category, LogEvent } from "@repo/audit-core"
import type { ProcessRunResult } from "./errors.js"

export type ProcessRunDbApi = {
  getAuditRun: (runId: string) => Promise<
    | {
        id: string
        siteId: string
        ownerId: string
        status: "queued" | "running" | "completed" | "partial" | "failed"
        requestedUrl: string
      }
    | undefined
  >
  markAuditRunRunning: (runId: string) => Promise<number>
  getCompletedCategoriesForRun: (runId: string) => Promise<Set<Category>>
  insertAuditResult: (result: AuditResult, runId: string, ownerId: string) => Promise<string>
}

export type AggregateFn = (
  url: string,
  opts: AggregateOptions,
  packages: AuditPackages
) => Promise<AuditResult[]>

export type ProcessRunOptions = {
  dbApi: ProcessRunDbApi
  aggregate: AggregateFn
  packages: AuditPackages
  logger: (event: LogEvent) => void
  timeoutMs?: number
  signal?: AbortSignal
}

const ALL_CATEGORIES: Category[] = ["performance", "seo", "best-practices", "pwa", "on-page"]

export async function processRun(
  runId: string,
  opts: ProcessRunOptions
): Promise<ProcessRunResult> {
  const { dbApi, aggregate, packages, logger, timeoutMs, signal } = opts

  // Step 1: load run
  const run = await dbApi.getAuditRun(runId)
  if (!run) return { status: "skipped", reason: "run_not_found" }
  if (run.status === "completed" || run.status === "partial" || run.status === "failed") {
    return { status: "skipped", reason: "already_completed" }
  }

  // Step 2: mark running (idempotent)
  await dbApi.markAuditRunRunning(runId)

  // Step 3: idempotent skip of categories that already have a row
  const completed = await dbApi.getCompletedCategoriesForRun(runId)
  const missing = ALL_CATEGORIES.filter((c) => !completed.has(c))
  if (missing.length === 0) {
    return { status: "completed", resultsInserted: 0 }
  }

  logger({
    kind: "progress",
    message: `processRun ${runId}: running ${missing.length} categories`,
  })

  // Step 4: run aggregator
  let results: AuditResult[]
  try {
    const aggregateOpts: AggregateOptions = {
      only: missing,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      formFactor: "mobile",
    }
    results = await aggregate(run.requestedUrl, aggregateOpts, packages)
  } catch (err) {
    logger({
      kind: "warn",
      message: `aggregate threw: ${(err as Error).message}`,
    })
    const synth = makeFailedResults(run.requestedUrl, missing, "UNKNOWN", (err as Error).message)
    for (const r of synth) {
      await dbApi.insertAuditResult(r, runId, run.ownerId)
    }
    return { status: "failed", reason: "aggregate_failed" }
  }

  // Step 5: persist
  let inserted = 0
  const partialCategories: Category[] = []
  let hadFailure = false
  for (const r of results) {
    await dbApi.insertAuditResult(r, runId, run.ownerId)
    inserted++
    if (r.status === "partial") partialCategories.push(r.category)
    if (r.status === "failed") hadFailure = true
    if (signal?.aborted) {
      const remaining = missing.filter((c) => !results.some((x) => x.category === c))
      const synth = makeFailedResults(run.requestedUrl, remaining, "ABORTED", "aborted mid-run")
      for (const s of synth) {
        await dbApi.insertAuditResult(s, runId, run.ownerId)
        inserted++
      }
      return { status: "failed", reason: "timeout" }
    }
  }

  if (hadFailure) {
    return { status: "failed", reason: "aggregate_failed" }
  }
  if (partialCategories.length > 0) {
    return {
      status: "partial",
      resultsInserted: inserted,
      partialCategories,
    }
  }
  return { status: "completed", resultsInserted: inserted }
}

function makeFailedResults(
  requestedUrl: string,
  categories: Category[],
  code: "UNKNOWN" | "ABORTED",
  message: string
): AuditResult[] {
  return categories.map((c) => ({
    category: c,
    url: requestedUrl,
    requestedUrl,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    packageName: `@repo/audit-${c}`,
    packageVersion: "0.0.0",
    status: "failed" as const,
    error: {
      code,
      message,
      retryable: code === "UNKNOWN",
    },
  }))
}
