import { TRENDS_WINDOW_DAYS } from "@/lib/constants"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import { STORE_DASHBOARD } from "@/lib/offline/db"

const TRENDS_WINDOW_MS = TRENDS_WINDOW_DAYS * 86_400_000

export type DashboardSnapshot = {
  ownerId: string
  updatedAt: number
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}

export async function readSnapshot(
  db: IDBDatabase,
  ownerId: string
): Promise<DashboardSnapshot | null> {
  const got = await awaitRequest<DashboardSnapshot | undefined>(
    txStore(db, STORE_DASHBOARD, "readonly").get(ownerId)
  )
  return got ?? null
}

export async function writeSnapshot(db: IDBDatabase, snap: DashboardSnapshot): Promise<void> {
  await awaitRequest(txStore(db, STORE_DASHBOARD, "readwrite").put(snap))
}

export async function clearSnapshot(db: IDBDatabase, ownerId: string): Promise<void> {
  await awaitRequest(txStore(db, STORE_DASHBOARD, "readwrite").delete(ownerId))
}

import type { FanOutSignal } from "@/lib/realtime/fan-out"

export function applyEventToSnapshot(
  prev: DashboardSnapshot,
  signal: FanOutSignal
): DashboardSnapshot {
  if (signal.kind === "resync") return prev
  const env = signal.envelope
  if (env.table === "audit_runs") return prev

  // env.table === "audit_results", env.event === "INSERT"
  const result = env.row
  // Find the site this result belongs to by matching the run_id against any
  // latestScores row's run_id. If the run isn't represented in the snapshot
  // (e.g., a brand-new audit before the dashboard refreshes), skip.
  const siteId = prev.latestScores.find((s) => s.run_id === result.run_id)?.site_id
  if (!siteId) return prev

  const existing = prev.latestScores.find(
    (s) => s.site_id === siteId && s.category === result.category
  )
  const updatedScore: (typeof prev.latestScores)[number] = existing
    ? { ...existing, score: result.score, result_status: result.status }
    : {
        site_id: siteId,
        owner_id: result.owner_id,
        url: "",
        label: null,
        is_competitor: false,
        run_id: result.run_id,
        run_status: "completed",
        run_started_at: result.started_at,
        category: result.category,
        result_status: result.status,
        score: result.score,
      }

  const latestScores = existing
    ? prev.latestScores.map((s) => (s === existing ? updatedScore : s))
    : [...prev.latestScores, updatedScore]

  const siteForTrend = prev.sites.find((s) => s.id === siteId)
  const newTrend: ScoreTrendRow | null =
    result.score !== null
      ? {
          site_id: siteId,
          owner_id: result.owner_id,
          label: siteForTrend?.label ?? null,
          is_competitor: siteForTrend?.is_competitor ?? false,
          category: result.category,
          score: result.score,
          measured_at: result.started_at,
        }
      : null

  const isDuplicate =
    newTrend !== null &&
    prev.trends.some(
      (t) =>
        t.site_id === newTrend.site_id &&
        t.category === newTrend.category &&
        t.measured_at === newTrend.measured_at
    )

  const eventTimeMs = Date.parse(result.started_at)
  const cutoff = Number.isFinite(eventTimeMs)
    ? eventTimeMs - TRENDS_WINDOW_MS
    : Number.NEGATIVE_INFINITY
  const pruned = prev.trends.filter((t) => {
    const tMs = Date.parse(t.measured_at)
    return Number.isFinite(tMs) ? tMs >= cutoff : true
  })

  const trends = newTrend === null || isDuplicate ? pruned : [...pruned, newTrend]

  return { ...prev, latestScores, trends }
}
