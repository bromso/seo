"use client"
import { createBrowserSupabase } from "@repo/supabase/browser"
import { useCallback, useEffect, useState } from "react"
import type { AuditRunRow } from "@/lib/db-types"
import { shouldDeliverToRuns } from "@/lib/realtime/filter"
import { useFanOut } from "@/lib/realtime/use-fan-out"

export function useRealtimeRuns(
  ownerId: string,
  siteId: string,
  initial: AuditRunRow[]
): AuditRunRow[] {
  const [runs, setRuns] = useState(initial)
  const fanOut = useFanOut(ownerId)

  const resync = useCallback(async () => {
    const supabase = createBrowserSupabase()
    const { data } = await supabase
      .from("audit_runs")
      .select(
        "id,site_id,owner_id,status,requested_url,final_url,started_at,finished_at,triggered_by"
      )
      .eq("site_id", siteId)
      .order("started_at", { ascending: false })
      .limit(20)
      .returns<AuditRunRow[]>()
    if (data) setRuns(data)
  }, [siteId])

  useEffect(() => {
    return fanOut.subscribe((s) => {
      if (s.kind === "resync") {
        void resync()
        return
      }
      if (!shouldDeliverToRuns(s.envelope, siteId)) return
      const row = s.envelope.row as AuditRunRow
      if (s.envelope.event === "INSERT") {
        setRuns((prev) => [row, ...prev].slice(0, 20))
      } else {
        setRuns((prev) => prev.map((r) => (r.id === row.id ? row : r)))
      }
    })
  }, [fanOut, siteId, resync])

  return runs
}
