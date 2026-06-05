export function isIosSafari(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""
): boolean {
  const isiOS = /iPad|iPhone|iPod/.test(ua)
  // Exclude Chrome on iOS (CriOS) and Firefox on iOS (FxiOS) — they can't
  // install PWAs. Only Mobile Safari supports Add to Home Screen.
  const isCriOSorFxiOS = /CriOS|FxiOS/.test(ua)
  return isiOS && !isCriOSorFxiOS
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia("(display-mode: standalone)").matches) return true
  // iOS legacy: Safari sets navigator.standalone when launched from home screen.
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}
