# @repo/audit-perf

Lighthouse-backed performance audit: projects Core Web Vitals from an LHR into a scored `AuditResult`.

## Usage

```ts
import { audit } from "@repo/audit-perf"
import type { AuditResult } from "@repo/audit-core"

const result: AuditResult = await audit("https://example.com")

if (result.status === "success") {
  console.log(result.score)   // 0–100
  console.log(result.issues)  // Issue[]
}
```

The package runs Lighthouse internally via `@repo/lighthouse-runner`. Pass a pre-fetched LHR via `opts.lighthouseResult` to avoid running Chrome twice (as `audit-cli` does):

```ts
import { runLighthouse } from "@repo/lighthouse-runner"
import { audit } from "@repo/audit-perf"

const lhr = await runLighthouse("https://example.com")
const result = await audit("https://example.com", { lighthouseResult: lhr })
```

## Rules

| Rule ID | Severity floor | Description |
|---------|---------------|-------------|
| `perf/lcp` | `warn` (score < 0.9) / `error` (score < 0.5) | Largest Contentful Paint is slow (target < 2.5 s) |
| `perf/cls` | `warn` (score < 0.9) / `error` (score < 0.5) | Cumulative Layout Shift is high (target < 0.1) |
| `perf/tbt` | `warn` (score < 0.9) / `error` (score < 0.5) | Total Blocking Time is high (target < 200 ms) |

Severity is derived from the numeric Lighthouse score for each audit: `error` when score < 0.5, `warn` when score < 0.9, no issue when score >= 0.9.

## raw output shape

```ts
{
  categoryScore: number | null,       // raw LH category score (0–1)
  projectedAuditIds: string[],        // LH audit IDs checked: ["largest-contentful-paint", "cumulative-layout-shift", "total-blocking-time"]
}
```

## See also

- [@repo/audit-core](../audit-core/README.md)
- [Slice 1 design doc](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
