"use client"
import { useEffect, useMemo } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { debounce } from "@/lib/offline/_debounce"
import { openOfflineDB } from "@/lib/offline/db"
import { sweepRunSnapshotsLRU, writeRunSnapshot } from "@/lib/offline/run-snapshot"

type State = { run: AuditRunRow; results: AuditResultRow[] }

export function useRunDetailCache(ownerId: string, runId: string, live: State): State {
  const { run, results } = live

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
          // IDB unavailable / quota — silent degrade
        }
      }, 500),
    [ownerId, runId]
  )

  useEffect(() => {
    writeDebounced({ run, results })
  }, [run, results, writeDebounced])

  return live
}
