"use client"
import { Button } from "@repo/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { CATEGORIES, type Category } from "@/lib/constants"
import type { LatestScoreRow, SiteRow } from "@/lib/db-types"
import { formatScore, scoreColorClass } from "@/lib/format"
import { useQueueAudit } from "@/lib/offline/use-queue-audit"

export function SiteScoreCard({
  ownerId,
  site,
  scores,
  selfScores,
}: {
  ownerId: string
  site: SiteRow
  scores: LatestScoreRow[]
  selfScores: LatestScoreRow[] | null
}) {
  const [pending, start] = useTransition()
  const router = useRouter()
  const queue = useQueueAudit(ownerId)

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{site.label || site.url}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {CATEGORIES.map((c) => {
          const row = byCategory.get(c)
          const score = row?.score ?? null
          const selfScore = selfByCategory.get(c)?.score ?? null
          const delta = score !== null && selfScore !== null ? score - selfScore : null
          return (
            <div key={c} className="flex items-center justify-between gap-2 text-sm">
              <span className="capitalize text-muted-foreground">{c}</span>
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${scoreColorClass(score)}`}>
                  {formatScore(score)}
                </span>
                {delta !== null && site.is_competitor ? (
                  <span
                    className={`text-xs ${
                      delta > 0
                        ? "text-green-600"
                        : delta < 0
                          ? "text-red-600"
                          : "text-muted-foreground"
                    }`}
                  >
                    {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} {Math.abs(delta)}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          disabled={pending}
          onClick={() => {
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
              toast.success(`Audit queued — ${result.runId.slice(0, 8)}`)
              router.push(`/dashboard/runs/${result.runId}`)
            })
          }}
        >
          {pending ? "Queueing…" : "Run audit"}
        </Button>
      </CardContent>
    </Card>
  )
}
