"use client"
import { useEffect, useState } from "react"
import { FanOut, type FanOutDeps } from "@/lib/realtime/fan-out"
import { createBrowserSupabase } from "@/lib/supabase-browser"

type RegistryEntry = { fanOut: FanOut; refs: number }
const registry = new Map<string, RegistryEntry>()

/** Test-only: clear the registry between cases. */
export function _resetFanOutRegistry(): void {
  for (const entry of registry.values()) entry.fanOut.close()
  registry.clear()
}

function defaultDeps(): FanOutDeps {
  return {
    bcFactory: (name) => new BroadcastChannel(name),
    locks: navigator.locks,
    supabaseFactory: () => createBrowserSupabase() as unknown,
    now: () => Date.now(),
  }
}

function getDeps(): FanOutDeps {
  const overridden = (globalThis as unknown as { __realtimeDeps?: FanOutDeps }).__realtimeDeps
  return overridden ?? defaultDeps()
}

export function useFanOut(ownerId: string): FanOut {
  const [instance] = useState<FanOut>(() => {
    const existing = registry.get(ownerId)
    if (existing) {
      existing.refs += 1
      return existing.fanOut
    }
    const fanOut = new FanOut(ownerId, getDeps())
    registry.set(ownerId, { fanOut, refs: 1 })
    return fanOut
  })

  useEffect(() => {
    return () => {
      const entry = registry.get(ownerId)
      if (!entry) return
      entry.refs -= 1
      if (entry.refs <= 0) {
        entry.fanOut.close()
        registry.delete(ownerId)
      }
    }
  }, [ownerId])

  return instance
}
