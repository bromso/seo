"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { debounce } from "@/lib/offline/_debounce"
import { openOfflineDB } from "@/lib/offline/db"
import { readRunSnapshot, sweepRunSnapshotsLRU, writeRunSnapshot } from "@/lib/offline/run-snapshot"

type State = { run: AuditRunRow; results: AuditResultRow[] }

export function useRunDetailCache(ownerId: string, runId: string, live: State): State {
  const propsFetchedAt = useRef<number>(Date.now())
  const [initialLive] = useState(live)
  const [state, setState] = useState<State>(live)

  // Mount: read IDB and swap if fresher.
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
          setState({ run: existing.run, results: existing.results })
        }
      } catch {
        // IDB unavailable — silent degrade.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, runId])

  // Live updates from above (realtime) override.
  useEffect(() => {
    if (live !== initialLive) setState(live)
  }, [live, initialLive])

  // Debounced write on every state change.
  const writeDebounced = useMemo(
    () =>
      debounce(async (snap: State) => {
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
