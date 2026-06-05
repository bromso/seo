const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
])

export function canonicalUrl(input: string): string {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    throw new Error(`canonicalUrl: not a valid URL: ${input}`)
  }
  u.hash = ""
  u.username = ""
  u.password = ""
  u.hostname = u.hostname.toLowerCase()
  for (const p of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(p.toLowerCase())) u.searchParams.delete(p)
  }
  if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "")
  return u.toString()
}
