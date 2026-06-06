export function parseAndValidateRedirectTo(
  raw: string | undefined,
  allowlist: string[]
): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const ok = allowlist.some((origin) => {
    try {
      return new URL(origin).origin === url.origin
    } catch {
      return false
    }
  })
  return ok ? url.toString() : null
}
