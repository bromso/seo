"use client"
import { useCallback, useEffect, useState } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { shouldDeliverToRun } from "@/lib/realtime/filter"
import { useFanOut } from "@/lib/realtime/use-fan-out"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function useRealtimeRun(
  ownerId: string,
  runId: string,
  initialRun: AuditRunRow,
  initialResults: AuditResultRow[]
): { run: AuditRunRow; results: AuditResultRow[] } {
  const [run, setRun] = useState(initialRun)
  const [results, setResults] = useState(initialResults)
  const fanOut = useFanOut(ownerId)

  const resync = useCallback(async () => {
    const supabase = createBrowserSupabase()
    const [{ data: nextRun }, { data: nextResults }] = await Promise.all([
      supabase
        .from("audit_runs")
        .select(
          "id,site_id,owner_id,status,requested_url,final_url,started_at,finished_at,triggered_by"
        )
        .eq("id", runId)
        .maybeSingle<AuditRunRow>(),
      supabase
        .from("audit_results")
        .select(
          "id,run_id,owner_id,category,status,score,issues,raw,partial_reasons,error_code,error_message,error_retryable,package_name,package_version,duration_ms,started_at"
        )
        .eq("run_id", runId)
        .returns<AuditResultRow[]>(),
    ])
    if (nextRun) setRun(nextRun)
    if (nextResults) setResults(nextResults)
  }, [runId])

  useEffect(() => {
    return fanOut.subscribe((s) => {
      if (s.kind === "resync") {
        void resync()
        return
      }
      if (!shouldDeliverToRun(s.envelope, runId)) return
      if (s.envelope.table === "audit_runs" && s.envelope.event === "UPDATE") {
        setRun(s.envelope.row)
      } else if (s.envelope.table === "audit_results" && s.envelope.event === "INSERT") {
        const row = s.envelope.row
        setResults((prev) => [...prev, row])
      }
    })
  }, [fanOut, runId, resync])

  return { run, results }
}
