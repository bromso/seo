import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const LOOPBACK_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i

function isInsecureUrl(url: string): boolean {
  if (!url.startsWith("http://")) return false
  if (LOOPBACK_RE.test(url)) return false
  return true
}

export const httpsRules: Rule[] = [
  {
    id: "meta/https-scheme",
    weight: 5,
    run: ({ page }) => {
      try {
        const u = new URL(page.finalUrl)
        if (u.protocol === "https:") return { outcome: "pass" }
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/https-scheme",
              severity: "error",
              title: "Page served over HTTP",
              description: `Final URL ${page.finalUrl} uses ${u.protocol}.`,
              recommendation: "Serve the page over HTTPS and redirect HTTP requests permanently.",
            }),
          ],
        }
      } catch {
        return { outcome: "skip", reason: "invalid final URL" }
      }
    },
  },
  {
    id: "meta/https-mixed-content",
    weight: 4,
    run: ({ $, page }) => {
      try {
        const u = new URL(page.finalUrl)
        if (u.protocol !== "https:") {
          return { outcome: "skip", reason: "page is not HTTPS" }
        }
      } catch {
        return { outcome: "skip", reason: "invalid final URL" }
      }
      const hits: string[] = []
      $("img[src], script[src], iframe[src]").each((_, el) => {
        const src = $(el).attr("src") ?? ""
        if (isInsecureUrl(src)) hits.push(src)
      })
      $("link[href]").each((_, el) => {
        const href = $(el).attr("href") ?? ""
        if (isInsecureUrl(href)) hits.push(href)
      })
      $("[style]").each((_, el) => {
        const style = $(el).attr("style") ?? ""
        const m = style.match(/url\((http:\/\/[^)]+)\)/gi)
        if (m) for (const u of m) hits.push(u.slice(4, -1))
      })
      $("style").each((_, el) => {
        const text = $(el).text()
        const m = text.match(/url\((http:\/\/[^)]+)\)/gi)
        if (m) for (const u of m) hits.push(u.slice(4, -1))
      })
      if (hits.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "meta/https-mixed-content",
            severity: "error",
            title: `Mixed content: ${hits.length} HTTP resources on HTTPS page`,
            description: `Found ${hits.length} insecure resource URL(s).`,
            recommendation:
              "Migrate referenced resources to HTTPS (or to protocol-relative URLs on hosts that support both).",
            occurrences: hits.slice(0, 5).map((url) => ({ url })),
          }),
        ],
      }
    },
  },
]
