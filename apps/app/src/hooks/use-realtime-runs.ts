"use client"
import { useEffect, useState } from "react"
import type { AuditRunRow } from "@/lib/db-types"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function useRealtimeRuns(siteId: string, initial: AuditRunRow[]): AuditRunRow[] {
  const [runs, setRuns] = useState(initial)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`runs-for-site:${siteId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_runs",
          filter: `site_id=eq.${siteId}`,
        },
        (payload) => {
          setRuns((prev) => [payload.new as AuditRunRow, ...prev].slice(0, 20))
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "audit_runs",
          filter: `site_id=eq.${siteId}`,
        },
        (payload) => {
          const updated = payload.new as AuditRunRow
          setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [siteId])

  return runs
}
