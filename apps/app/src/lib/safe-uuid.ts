// `crypto.randomUUID` requires a secure context (HTTPS or `localhost`).
// Dev runs on `app.lvh.me`, which is HTTP and not on Chrome's secure-context
// allowlist, so `crypto.randomUUID` is undefined there and throws on call.
// `crypto.getRandomValues` is available in every browser context, so we
// build a v4 UUID from 16 random bytes when the convenience API is missing.

export function safeRandomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // RFC 4122 v4: set version bits + variant bits
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push((bytes[i] ?? 0).toString(16).padStart(2, "0"))
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}` +
    `-${hex[4]}${hex[5]}` +
    `-${hex[6]}${hex[7]}` +
    `-${hex[8]}${hex[9]}` +
    `-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  )
}
