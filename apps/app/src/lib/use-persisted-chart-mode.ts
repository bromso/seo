"use client"
import { useEffect, useState } from "react"

export type ChartMode = "radar" | "bars"

const STORAGE_KEY = "dashboard.chart-mode"

/**
 * Persisted chart-shape preference. SSR-safe: starts on the default ("radar"),
 * reads from localStorage once on mount, then writes through on change.
 */
export function usePersistedChartMode(defaultMode: ChartMode = "radar"): {
  mode: ChartMode
  setMode: (next: ChartMode) => void
} {
  const [mode, setModeState] = useState<ChartMode>(defaultMode)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === "radar" || raw === "bars") setModeState(raw)
    } catch {
      // localStorage disabled — keep default.
    }
  }, [])

  const setMode = (next: ChartMode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage disabled — preference is per-session only.
    }
  }

  return { mode, setMode }
}
