"use client"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { createBrowserSupabase } from "@/lib/supabase-browser"

export function useRealtimeScores(ownerId: string): void {
  const router = useRouter()
  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`scores:${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_results",
          filter: `owner_id=eq.${ownerId}`,
        },
        () => router.refresh()
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [ownerId, router])
}
