# @repo/audit-seo

Lighthouse-backed SEO audit: projects Lighthouse SEO audits into a scored `AuditResult`.

## Usage

```ts
import { audit } from "@repo/audit-seo"
import type { AuditResult } from "@repo/audit-core"

const result: AuditResult = await audit("https://example.com")

if (result.status === "success") {
  console.log(result.score)   // 0–100
  console.log(result.issues)  // Issue[]
}
```

Pass a pre-fetched LHR to avoid running Chrome twice:

```ts
import { runLighthouse } from "@repo/lighthouse-runner"
import { audit } from "@repo/audit-seo"

const lhr = await runLighthouse("https://example.com")
const result = await audit("https://example.com", { lighthouseResult: lhr })
```

## Rules

| Rule ID | Severity floor | Description |
|---------|---------------|-------------|
| `seo/document-title` | `error` (score < 0.5) / `warn` | Document is missing a `<title>` element |
| `seo/meta-description` | `error` / `warn` | Document is missing a meta description |
| `seo/is-crawlable` | `error` / `warn` | Page is blocked from indexing by robots.txt or a `noindex` directive |
| `seo/crawlable-anchors` | `error` / `warn` | Anchors use href values that crawlers cannot follow (e.g. `javascript:`) |

Severity: `error` when Lighthouse score < 0.5, `warn` when score >= 0.5 and < 1.

## raw output shape

```ts
{
  categoryScore: number | null,       // raw LH category score (0–1)
  projectedAuditIds: string[],        // LH audit IDs checked
}
```

## See also

- [@repo/audit-core](../audit-core/README.md)
- [Slice 1 design doc](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
