"use client"
import { createBrowserSupabase } from "@repo/supabase/browser"
import { useEffect, useState } from "react"
import { FanOut, type FanOutDeps } from "@/lib/realtime/fan-out"

type RegistryEntry = { fanOut: FanOut; refs: number }
const registry = new Map<string, RegistryEntry>()

/** Test-only: clear the registry between cases. */
export function _resetFanOutRegistry(): void {
  for (const entry of registry.values()) entry.fanOut.close()
  registry.clear()
}

// Fallback BC stub for environments without the global. The "always-leader"
// lock fallback means every tab opens its own subscriptions and never needs
// to receive a remote message, so postMessage is a safe no-op.
class StubBC {
  onmessage: ((ev: MessageEvent) => void) | null = null
  constructor(public readonly name: string) {}
  postMessage(_data: unknown): void {}
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return false
  }
}

function defaultDeps(): FanOutDeps {
  const realLocks =
    typeof navigator !== "undefined" && "locks" in navigator
      ? (navigator as { locks: LockManager }).locks
      : null
  const locks: LockManager =
    realLocks ??
    // Synchronous "always-leader" stub. Every tab opens its own Supabase
    // channels — slice-5 behavior preserved for older browsers / non-DOM envs.
    ({
      async request<T>(
        name: string,
        _opts: { mode: "exclusive"; signal?: AbortSignal },
        cb: (lock: { name: string; mode: "exclusive" }) => Promise<T> | T
      ): Promise<T> {
        return cb({ name, mode: "exclusive" })
      },
    } as unknown as LockManager)
  return {
    bcFactory: (name) =>
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(name)
        : (new StubBC(name) as unknown as BroadcastChannel),
    locks,
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
