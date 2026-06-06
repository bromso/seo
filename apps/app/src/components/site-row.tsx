"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { ScoreCell } from "@/components/score-cell"
import { StatusDot } from "@/components/status-dot"
import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow, SiteRow as SiteRowDbRow } from "@/lib/db-types"
import { formatRelativeTime, type RunStatus } from "@/lib/format"
import { useQueueAudit } from "@/lib/offline/use-queue-audit"

type Props = {
  ownerId: string
  site: SiteRowDbRow
  scores: LatestScoreRow[]
  selfScores: LatestScoreRow[] | null
}

function statusForDot(
  status: RunStatus | null | undefined
): Parameters<typeof StatusDot>[0]["status"] {
  switch (status) {
    case "queued":
      return "queued"
    case "running":
      return "running"
    case "completed":
      return "success"
    case "partial":
      return "caution"
    case "failed":
      return "failure"
    default:
      return "idle"
  }
}

function categoryShort(c: Category): string {
  switch (c) {
    case "performance":
      return "Perf"
    case "seo":
      return "SEO"
    case "best-practices":
      return "BP"
    case "pwa":
      return "PWA"
    case "on-page":
      return "OP"
  }
}

/**
 * Dense, table-row representation of a site + its latest scores.
 * Click anywhere → opens the latest run. R key → triggers a re-audit.
 */
export function SiteRow({ ownerId, site, scores, selfScores }: Props) {
  const router = useRouter()
  const queue = useQueueAudit(ownerId)
  const [pending, start] = useTransition()

  const byCategory = new Map<Category, LatestScoreRow>()
  for (const row of scores) {
    if (row.category) byCategory.set(row.category, row)
  }
  const selfByCategory = new Map<Category, LatestScoreRow>()
  if (selfScores) {
    for (const row of selfScores) {
      if (row.category) selfByCategory.set(row.category, row)
    }
  }

  // Aggregate delta: average of per-category deltas (rounded).
  let deltaSum = 0
  let deltaCount = 0
  for (const c of CATEGORIES) {
    const s = byCategory.get(c)?.score ?? null
    const baseline = site.is_competitor ? (selfByCategory.get(c)?.score ?? null) : null
    if (s !== null && baseline !== null) {
      deltaSum += s - baseline
      deltaCount += 1
    }
  }
  const aggregateDelta = deltaCount > 0 ? Math.round(deltaSum / deltaCount) : null

  const latestRow = scores.find((s) => s.run_id !== null)
  const runStatus = latestRow?.run_status ?? null
  const runId = latestRow?.run_id ?? null
  const lastStarted = latestRow?.run_started_at ?? null

  const runHref = runId ? `/dashboard/runs/${runId}` : null

  const handleRun = () => {
    if (pending) return
    start(async () => {
      const result = await queue({ siteId: site.id, requestedUrl: site.url })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if ("queued" in result) {
        toast("You are offline. Audit will run when you're back online.")
        return
      }
      toast.success(`Audit queued · ${result.runId.slice(0, 8)}`)
      router.push(`/dashboard/runs/${result.runId}`)
    })
  }

  const labelOrHost = site.label ?? new URL(site.url).hostname
  const isSelf = !site.is_competitor

  return (
    <div className="group grid grid-cols-[20px_minmax(0,1.6fr)_repeat(5,minmax(56px,72px))_minmax(60px,72px)_minmax(80px,92px)_28px] items-center gap-x-3 px-3 py-2.5 border-b border-border-subtle hover:bg-surface-sunken/60 transition-colors duration-75">
      {/* Status dot + self badge */}
      <div className="flex items-center">
        <StatusDot status={statusForDot(runStatus)} />
      </div>

      {/* Site label + URL */}
      <div className="flex min-w-0 items-baseline gap-2">
        {runHref ? (
          <Link
            href={runHref}
            className="truncate text-[14px] font-medium text-ink-primary hover:underline underline-offset-4 decoration-border-strong"
          >
            {labelOrHost}
          </Link>
        ) : (
          <span className="truncate text-[14px] font-medium text-ink-primary">{labelOrHost}</span>
        )}
        {isSelf ? (
          <span className="num shrink-0 text-[10px] uppercase tracking-wider text-ink-tertiary">
            you
          </span>
        ) : null}
      </div>

      {/* 5 category score cells */}
      {CATEGORIES.map((c) => {
        const row = byCategory.get(c)
        const score = row?.score ?? null
        const baselineScore = site.is_competitor ? (selfByCategory.get(c)?.score ?? null) : null
        const delta = score !== null && baselineScore !== null ? score - baselineScore : null
        return (
          <div key={c} className="text-right" title={categoryShort(c)}>
            <ScoreCell score={score} delta={delta} />
          </div>
        )
      })}

      {/* Aggregate delta */}
      <div className="text-right">
        {aggregateDelta === null ? (
          <span className="num text-[11px] text-ink-tertiary">·</span>
        ) : (
          <span
            className={`num text-[13px] tabular-nums font-medium ${
              aggregateDelta > 0
                ? "text-status-success"
                : aggregateDelta < 0
                  ? "text-status-failure"
                  : "text-ink-tertiary"
            }`}
          >
            {aggregateDelta > 0 ? "+" : ""}
            {aggregateDelta}
          </span>
        )}
      </div>

      {/* Last started */}
      <div className="text-right">
        <span className="num text-[12px] text-ink-secondary tabular-nums">
          {lastStarted ? formatRelativeTime(lastStarted) : "—"}
        </span>
      </div>

      {/* Run action — visible on hover, focusable */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleRun}
          disabled={pending}
          title="Run audit (R)"
          aria-label={`Run audit for ${labelOrHost}`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-75 inline-flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? (
            <span className="num text-[10px]">…</span>
          ) : (
            <svg
              aria-hidden
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Run</title>
              <path d="M3 2L9.5 6L3 10V2Z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
