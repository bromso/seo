"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { ScoreCell } from "@/components/score-cell"
import { SiteRadarMini } from "@/components/site-radar-mini"
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
 * Calm-operator card form of a site. Same data as `SiteRow`, laid out for the
 * grid view: hairline border, no shadow, 5 category scores in a 5-column row.
 */
export function SiteCard({ ownerId, site, scores, selfScores }: Props) {
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

  const latestRow = scores.find((s) => s.run_id !== null)
  const runStatus = latestRow?.run_status ?? null
  const runId = latestRow?.run_id ?? null
  const lastStarted = latestRow?.run_started_at ?? null

  const labelOrHost = site.label ?? new URL(site.url).hostname
  const isSelf = !site.is_competitor
  const runHref = runId ? `/dashboard/runs/${runId}` : null

  const handleRun = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
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

  return (
    <article className="group flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-raised p-5 transition-colors duration-75 hover:border-border-strong">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <StatusDot status={statusForDot(runStatus)} />
            {runHref ? (
              <Link
                href={runHref}
                className="truncate text-[17px] font-semibold text-ink-primary hover:underline underline-offset-4 decoration-border-strong"
              >
                {labelOrHost}
              </Link>
            ) : (
              <span className="truncate text-[17px] font-semibold text-ink-primary">
                {labelOrHost}
              </span>
            )}
            {isSelf ? (
              <span className="num shrink-0 text-[12px] uppercase tracking-wider text-ink-tertiary">
                you
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-[14px] text-ink-secondary">
            <span className="num truncate">{site.url}</span>
            {lastStarted ? (
              <span className="num shrink-0">· {formatRelativeTime(lastStarted)}</span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={handleRun}
          disabled={pending}
          title="Run audit"
          aria-label={`Run audit for ${labelOrHost}`}
          className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded text-ink-secondary hover:bg-surface-sunken hover:text-ink-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? (
            <span className="num text-[12px]">…</span>
          ) : (
            <svg
              aria-hidden
              width="14"
              height="14"
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
      </header>

      {/* Radar — full width of the card body, gets the visual breathing room */}
      <div className="flex justify-center border-t border-border-subtle pt-4">
        <SiteRadarMini scores={scores} variant={isSelf ? "primary" : "neutral"} size={196} />
      </div>

      {/* Score row — 5 stacked cells across the bottom */}
      <div className="grid grid-cols-5 gap-3 border-t border-border-subtle pt-4">
        {CATEGORIES.map((c) => {
          const row = byCategory.get(c)
          const score = row?.score ?? null
          const baselineScore = site.is_competitor ? (selfByCategory.get(c)?.score ?? null) : null
          const delta = score !== null && baselineScore !== null ? score - baselineScore : null
          return (
            <div key={c} className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                {categoryShort(c)}
              </span>
              <ScoreCell score={score} delta={delta} layout="stacked" />
            </div>
          )
        })}
      </div>
    </article>
  )
}
