"use client"
import { useEffect, useState } from "react"
import type { ViewMode } from "@/components/view-mode-toggle"

const STORAGE_KEY = "dashboard.view-mode"

/**
 * Persisted view-mode preference. Starts on the SSR-safe default ("table"),
 * then reads the stored value once on mount and keeps it in sync on change.
 */
export function usePersistedViewMode(defaultMode: ViewMode = "table"): {
  mode: ViewMode
  setMode: (next: ViewMode) => void
} {
  const [mode, setModeState] = useState<ViewMode>(defaultMode)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === "table" || raw === "cards") {
        setModeState(raw)
      }
    } catch {
      // localStorage disabled — keep default.
    }
  }, [])

  const setMode = (next: ViewMode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage disabled — preference is per-session only.
    }
  }

  return { mode, setMode }
}
