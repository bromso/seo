export async function registerBackgroundSync(tag: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false
  if (!("serviceWorker" in navigator)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    if (!("sync" in reg)) return false
    const syncManager = (
      reg as unknown as {
        sync: { register: (t: string) => Promise<void> }
      }
    ).sync
    await syncManager.register(tag)
    return true
  } catch {
    return false
  }
}
