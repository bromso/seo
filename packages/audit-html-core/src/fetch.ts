import { AuditFailure } from "@repo/audit-core"
import type { FetchedPage } from "./types.js"

const DEFAULT_UA = "SeoAuditBot/0.1 (+https://example.com/seo-audit)"
const DEFAULT_TIMEOUT = 30_000
const MAX_REDIRECTS = 5

export type FetchPageOptions = {
  userAgent?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const ua = opts.userAgent ?? DEFAULT_UA
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT

  let currentUrl = url
  let visited = 0
  while (visited <= MAX_REDIRECTS) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal

    const res = await fetch(currentUrl, {
      method: "GET",
      headers: { "user-agent": ua, accept: "text/html,*/*;q=0.5" },
      redirect: "manual",
      signal,
    })

    const status = res.status
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location")
      if (!loc) {
        throw new AuditFailure({
          code: "HTTP_5XX",
          message: `redirect from ${currentUrl} missing Location header`,
        })
      }
      currentUrl = new URL(loc, currentUrl).toString()
      visited++
      continue
    }
    if (status >= 500) {
      throw new AuditFailure({
        code: "HTTP_5XX",
        message: `HTTP ${status} from ${currentUrl}`,
      })
    }
    if (status >= 400) {
      throw new AuditFailure({
        code: "HTTP_4XX",
        message: `HTTP ${status} from ${currentUrl}`,
      })
    }
    const html = await res.text()
    const contentType = res.headers.get("content-type") ?? "text/html"
    return { requestedUrl: url, finalUrl: currentUrl, status, html, contentType }
  }
  throw new AuditFailure({
    code: "HTTP_5XX",
    message: `too many redirects (> ${MAX_REDIRECTS})`,
  })
}
