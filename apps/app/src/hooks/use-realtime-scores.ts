"use client"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { shouldDeliverToScores } from "@/lib/realtime/filter"
import { useFanOut } from "@/lib/realtime/use-fan-out"

export function useRealtimeScores(ownerId: string): void {
  const router = useRouter()
  const fanOut = useFanOut(ownerId)
  useEffect(() => {
    return fanOut.subscribe((s) => {
      if (s.kind === "resync") {
        router.refresh()
        return
      }
      if (shouldDeliverToScores(s.envelope)) {
        router.refresh()
      }
    })
  }, [fanOut, router])
}
