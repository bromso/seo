# @repo/audit-pwa

Lighthouse-backed PWA audit: projects Lighthouse PWA audits into a scored `AuditResult`, with graceful partial handling when Lighthouse 12 does not emit the PWA category.

## Usage

```ts
import { audit } from "@repo/audit-pwa"
import type { AuditResult } from "@repo/audit-core"

const result: AuditResult = await audit("https://example.com")

if (result.status === "success") {
  console.log(result.score)   // 0–100
  console.log(result.issues)  // Issue[]
} else if (result.status === "partial") {
  // Lighthouse 12 may not emit the PWA category — this is expected
  console.log(result.partialReasons) // ["pwa-category-not-emitted-by-lighthouse"]
}
```

Pass a pre-fetched LHR to avoid running Chrome twice:

```ts
import { runLighthouse } from "@repo/lighthouse-runner"
import { audit } from "@repo/audit-pwa"

const lhr = await runLighthouse("https://example.com")
const result = await audit("https://example.com", { lighthouseResult: lhr })
```

## Rules

| Rule ID | Severity floor | Description |
|---------|---------------|-------------|
| `pwa/installable-manifest` | `error` / `warn` | Web app manifest is missing or not installable |
| `pwa/service-worker` | `error` / `warn` | No service worker registered — required for offline use |
| `pwa/themed-omnibox` | `error` / `warn` | Missing `<meta name="theme-color">` tag |

Severity: `error` when Lighthouse score < 0.5, `warn` when score >= 0.5 and < 1.

## Partial result

When `lhr.categories.pwa` is absent (Lighthouse 12 removed standalone PWA scoring in some configurations), the audit returns:

```ts
{
  status: "partial",
  score: 0,
  issues: [],
  partialReasons: ["pwa-category-not-emitted-by-lighthouse"],
}
```

This is not an error — exit code 1 from `audit-cli` in this case is expected and acceptable.

## raw output shape

When the PWA category is present (`status: "success"`):
```ts
{
  categoryScore: number | null,
  projectedAuditIds: string[],  // ["installable-manifest", "service-worker", "themed-omnibox"]
}
```

When absent (`status: "partial"`):
```ts
{ reason: "lhr.categories.pwa absent" }
```

## See also

- [@repo/audit-core](../audit-core/README.md)
- [Slice 1 design doc](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
