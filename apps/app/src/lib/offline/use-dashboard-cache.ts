"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
import { debounce } from "@/lib/offline/_debounce"
import { sweepOtherOwners } from "@/lib/offline/clear-cache"
import { openOfflineDB } from "@/lib/offline/db"
import {
  applyEventToSnapshot,
  type DashboardSnapshot,
  readSnapshot,
  writeSnapshot,
} from "@/lib/offline/snapshot"
import { useFanOut } from "@/lib/realtime/use-fan-out"

type State = {
  sites: SiteRow[]
  latestScores: LatestScoreRow[]
  trends: ScoreTrendRow[]
}

type CacheState = State & { cacheUpdatedAt: number }

export function useDashboardCache(ownerId: string, propsSnapshot: State): CacheState {
  const propsFetchedAt = useRef<number>(Date.now())
  const [state, setState] = useState<CacheState>(() => ({
    sites: propsSnapshot.sites,
    latestScores: propsSnapshot.latestScores,
    trends: propsSnapshot.trends,
    cacheUpdatedAt: propsFetchedAt.current,
  }))
  const fanOut = useFanOut(ownerId)

  // Stable capture so the mount effect runs once per ownerId.
  const [initialProps] = useState(propsSnapshot)

  // On mount: read IDB; if fresher than props, swap. Otherwise write props.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const db = await openOfflineDB()
        void sweepOtherOwners(db, ownerId)
        const existing = await readSnapshot(db, ownerId)
        if (cancelled) return
        if (existing && existing.updatedAt > propsFetchedAt.current) {
          setState({
            sites: existing.sites,
            latestScores: existing.latestScores,
            trends: existing.trends,
            cacheUpdatedAt: existing.updatedAt,
          })
        } else {
          await writeSnapshot(db, {
            ownerId,
            updatedAt: propsFetchedAt.current,
            ...initialProps,
          })
        }
      } catch {
        // IDB unavailable (e.g., private mode) — silently degrade to props.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, initialProps])

  // Debounced IDB writer for event bursts.
  const writeDebounced = useMemo(
    () =>
      debounce(async (snap: CacheState) => {
        try {
          const db = await openOfflineDB()
          await writeSnapshot(db, {
            ownerId,
            updatedAt: Date.now(),
            sites: snap.sites,
            latestScores: snap.latestScores,
            trends: snap.trends,
          })
        } catch {
          // ignored
        }
      }, 500),
    [ownerId]
  )

  // Subscribe to fan-out; apply events to state.
  useEffect(() => {
    return fanOut.subscribe((s) => {
      setState((prev) => {
        const { cacheUpdatedAt: _unused, ...prevSnap } = prev
        const next = applyEventToSnapshot({ ownerId, updatedAt: Date.now(), ...prevSnap }, s)
        return next.latestScores === prev.latestScores
          ? prev
          : {
              sites: next.sites,
              latestScores: next.latestScores,
              trends: next.trends,
              cacheUpdatedAt: Date.now(),
            }
      })
    })
  }, [fanOut, ownerId])

  // Re-write whenever state changes (debounced).
  useEffect(() => {
    writeDebounced(state)
  }, [state, writeDebounced])

  return state
}
