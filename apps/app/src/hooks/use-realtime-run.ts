"use client"
import { useEffect, useState } from "react"
import type { AuditResultRow, AuditRunRow } from "@/lib/db-types"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function useRealtimeRun(
  runId: string,
  initialRun: AuditRunRow,
  initialResults: AuditResultRow[]
): { run: AuditRunRow; results: AuditResultRow[] } {
  const [run, setRun] = useState(initialRun)
  const [results, setResults] = useState(initialResults)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`run:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "audit_runs",
          filter: `id=eq.${runId}`,
        },
        (payload) => setRun(payload.new as AuditRunRow)
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_results",
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          setResults((prev) => [...prev, payload.new as AuditResultRow])
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [runId])

  return { run, results }
}
