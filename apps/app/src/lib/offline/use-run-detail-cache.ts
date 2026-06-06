"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { debounce } from "@/lib/offline/_debounce"
import { openOfflineDB } from "@/lib/offline/db"
import { readRunSnapshot, sweepRunSnapshotsLRU, writeRunSnapshot } from "@/lib/offline/run-snapshot"

type LiveState = { run: AuditRunRow; results: AuditResultRow[] }
type CacheState = LiveState & { cacheUpdatedAt: number }

export function useRunDetailCache(ownerId: string, runId: string, live: LiveState): CacheState {
  const propsFetchedAt = useRef<number>(Date.now())
  const [initialLive] = useState(live)
  const [state, setState] = useState<CacheState>(() => ({
    run: live.run,
    results: live.results,
    cacheUpdatedAt: propsFetchedAt.current,
  }))

  // Mount: read IDB; swap if fresher, otherwise write a baseline.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const db = await openOfflineDB()
        const existing = await readRunSnapshot(db, runId)
        if (cancelled) return
        if (
          existing &&
          existing.ownerId === ownerId &&
          existing.updatedAt > propsFetchedAt.current
        ) {
          setState((prev) =>
            prev.run === initialLive.run && prev.results === initialLive.results
              ? {
                  run: existing.run,
                  results: existing.results,
                  cacheUpdatedAt: existing.updatedAt,
                }
              : prev
          )
        } else {
          await writeRunSnapshot(db, {
            runId,
            ownerId,
            updatedAt: propsFetchedAt.current,
            run: initialLive.run,
            results: initialLive.results,
          })
          await sweepRunSnapshotsLRU(db, ownerId)
        }
      } catch {
        // IDB unavailable — silent degrade.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, runId, initialLive])

  // Live updates from above (realtime) override.
  useEffect(() => {
    if (live !== initialLive) {
      setState({
        run: live.run,
        results: live.results,
        cacheUpdatedAt: Date.now(),
      })
    }
  }, [live, initialLive])

  // Debounced write on every state change.
  const writeDebounced = useMemo(
    () =>
      debounce(async (snap: CacheState) => {
        try {
          const db = await openOfflineDB()
          await writeRunSnapshot(db, {
            runId,
            ownerId,
            updatedAt: Date.now(),
            run: snap.run,
            results: snap.results,
          })
          await sweepRunSnapshotsLRU(db, ownerId)
        } catch {
          // IDB unavailable / quota — silent degrade.
        }
      }, 500),
    [ownerId, runId]
  )

  useEffect(() => {
    writeDebounced(state)
  }, [state, writeDebounced])

  return state
}
