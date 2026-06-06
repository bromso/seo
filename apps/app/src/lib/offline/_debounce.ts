// Internal helper shared by use-dashboard-cache.ts and use-run-detail-cache.ts.
// Not exported from the offline barrel; consumers import directly.

export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }
}
