"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import type { LatestScoreRow, ScoreTrendRow, SiteRow } from "@/lib/db-types"
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

function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }
}

export function useDashboardCache(ownerId: string, propsSnapshot: State): State {
  const propsFetchedAt = useRef<number>(Date.now())
  const [state, setState] = useState<State>(propsSnapshot)
  const fanOut = useFanOut(ownerId)

  // Stable capture so the mount effect runs once per ownerId.
  const [initialProps] = useState(propsSnapshot)

  // On mount: read IDB; if fresher than props, swap. Otherwise write props.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const db = await openOfflineDB()
        const existing = await readSnapshot(db, ownerId)
        if (cancelled) return
        if (existing && existing.updatedAt > propsFetchedAt.current) {
          setState({
            sites: existing.sites,
            latestScores: existing.latestScores,
            trends: existing.trends,
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
      debounce(async (snap: State) => {
        try {
          const db = await openOfflineDB()
          await writeSnapshot(db, { ownerId, updatedAt: Date.now(), ...snap })
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
        const next = applyEventToSnapshot({ ownerId, updatedAt: Date.now(), ...prev }, s)
        return next === prev || next.latestScores === prev.latestScores
          ? prev
          : { sites: next.sites, latestScores: next.latestScores, trends: next.trends }
      })
    })
  }, [fanOut, ownerId])

  // Re-write whenever state changes (debounced).
  useEffect(() => {
    writeDebounced(state)
  }, [state, writeDebounced])

  return state
}
