# @repo/audit-onpage

HTML-fetching on-page SEO audit: fetches the URL via HTTP, parses the HTML with Cheerio, and runs a rule engine to produce a scored `AuditResult`. Does not require Chrome.

## Usage

```ts
import { audit } from "@repo/audit-onpage"
import type { AuditResult } from "@repo/audit-core"

const result: AuditResult = await audit("https://example.com")

if (result.status === "success") {
  console.log(result.score)   // 0–100
  console.log(result.issues)  // Issue[]
}
```

With options:

```ts
const result = await audit("https://example.com", {
  userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)",
  timeoutMs: 15_000,
  signal: AbortSignal.timeout(20_000),
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `userAgent` | `string` | `"SeoAuditBot/0.1 (+https://example.com/seo-audit)"` | User-agent header sent when fetching the page and robots.txt |
| `timeoutMs` | `number` | `30000` | HTTP fetch timeout (ms) |
| `signal` | `AbortSignal` | — | Cancels all in-flight HTTP requests |

## Rules

| Rule ID | Weight | Severity floor | Description |
|---------|--------|---------------|-------------|
| `onpage/title-missing` | — | `error` | `<title>` element is absent |
| `onpage/title-too-short` | — | `warn` | `<title>` is shorter than 10 characters |
| `onpage/title-too-long` | — | `warn` | `<title>` is longer than 70 characters |
| `onpage/meta-description-missing` | — | `warn` | Meta description is absent |
| `onpage/meta-description-too-long` | — | `info` | Meta description exceeds 160 characters |
| `onpage/h1-missing` | — | `error` | No `<h1>` element found |
| `onpage/h1-multiple` | — | `warn` | More than one `<h1>` element |
| `onpage/heading-order-broken` | — | `warn` | Heading hierarchy skips levels (e.g. `<h1>` → `<h3>`) |
| `onpage/alt-missing` | — | `warn` | One or more `<img>` elements are missing an `alt` attribute |
| `onpage/canonical-missing` | — | `info` | No `<link rel="canonical">` found |
| `onpage/canonical-points-elsewhere` | — | `warn` | Canonical URL points to a different page |
| `onpage/hreflang-malformed` | — | `warn` | `hreflang` attribute values are malformed or missing `x-default` |
| `onpage/robots-missing` | — | `info` | No `robots.txt` found at site root |
| `onpage/robots-disallowed` | — | `error` | `robots.txt` disallows crawling of this URL |
| `onpage/sitemap-missing` | — | `info` | No `sitemap.xml` found at site root |

## raw output shape

```ts
{
  finalUrl: string,
  status: number,
  ruleSummary: Array<{
    rule: string,
    weight: number,
    outcome: "pass" | "fail" | "skip",
  }>,
}
```

## See also

- [@repo/audit-core](../audit-core/README.md)
- [Slice 1 design doc](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
