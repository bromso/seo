const KEY = "pwa-install-dismissed-at"
export const DISMISS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export function markDismissed(now: number = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(now))
  } catch {
    // Private mode / quota — silently ignored
  }
}

export function isDismissed(now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return now - at < DISMISS_WINDOW_MS
  } catch {
    return false
  }
}
