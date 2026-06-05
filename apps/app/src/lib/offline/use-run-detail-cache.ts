"use client"
import { useEffect, useMemo } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { openOfflineDB } from "@/lib/offline/db"
import { sweepRunSnapshotsLRU, writeRunSnapshot } from "@/lib/offline/run-snapshot"

type State = { run: AuditRunRow; results: AuditResultRow[] }

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

export function useRunDetailCache(ownerId: string, runId: string, live: State): State {
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
    writeDebounced(live)
  }, [live, writeDebounced])

  return live
}
