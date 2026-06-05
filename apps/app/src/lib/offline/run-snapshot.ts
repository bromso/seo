import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { awaitRequest, txStore } from "@/lib/offline/_idb"
import { STORE_RUN_SNAPSHOTS } from "@/lib/offline/db"
import type { FanOutSignal } from "@/lib/realtime/fan-out"

export type RunDetailSnapshot = {
  runId: string
  ownerId: string
  updatedAt: number
  run: AuditRunRow
  results: AuditResultRow[]
}

export const MAX_RUN_SNAPSHOTS_PER_OWNER = 20

export async function readRunSnapshot(
  db: IDBDatabase,
  runId: string
): Promise<RunDetailSnapshot | null> {
  const got = await awaitRequest<RunDetailSnapshot | undefined>(
    txStore(db, STORE_RUN_SNAPSHOTS, "readonly").get(runId)
  )
  return got ?? null
}

export async function writeRunSnapshot(db: IDBDatabase, snap: RunDetailSnapshot): Promise<void> {
  await awaitRequest(txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").put(snap))
}

export async function clearRunSnapshotsForOwner(db: IDBDatabase, ownerId: string): Promise<void> {
  const all = await awaitRequest<RunDetailSnapshot[]>(
    txStore(db, STORE_RUN_SNAPSHOTS, "readonly").getAll()
  )
  for (const snap of all) {
    if (snap.ownerId === ownerId) {
      await awaitRequest(txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").delete(snap.runId))
    }
  }
}

export function applyEventToRunSnapshot(
  prev: RunDetailSnapshot,
  signal: FanOutSignal
): RunDetailSnapshot {
  if (signal.kind === "resync") return prev
  const env = signal.envelope

  if (env.table === "audit_runs") {
    if (env.event !== "UPDATE") return prev
    if (env.row.id !== prev.runId) return prev
    return { ...prev, run: env.row, updatedAt: Date.now() }
  }

  if (env.table === "audit_results") {
    if (env.row.run_id !== prev.runId) return prev
    const already = prev.results.some((r) => r.id === env.row.id)
    if (already) return prev
    return {
      ...prev,
      results: [...prev.results, env.row],
      updatedAt: Date.now(),
    }
  }

  return prev
}

export async function sweepRunSnapshotsLRU(db: IDBDatabase, ownerId: string): Promise<void> {
  const all = await awaitRequest<RunDetailSnapshot[]>(
    txStore(db, STORE_RUN_SNAPSHOTS, "readonly").getAll()
  )
  const owned = all.filter((s) => s.ownerId === ownerId)
  if (owned.length <= MAX_RUN_SNAPSHOTS_PER_OWNER) return
  const sorted = [...owned].sort((a, b) => b.updatedAt - a.updatedAt)
  const toDelete = sorted.slice(MAX_RUN_SNAPSHOTS_PER_OWNER)
  for (const snap of toDelete) {
    await awaitRequest(txStore(db, STORE_RUN_SNAPSHOTS, "readwrite").delete(snap.runId))
  }
}
