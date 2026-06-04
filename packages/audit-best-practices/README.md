# @repo/audit-best-practices

Lighthouse-backed Best Practices audit: projects Lighthouse best-practices audits into a scored `AuditResult`.

## Usage

```ts
import { audit } from "@repo/audit-best-practices"
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
import { audit } from "@repo/audit-best-practices"

const lhr = await runLighthouse("https://example.com")
const result = await audit("https://example.com", { lighthouseResult: lhr })
```

## Rules

| Rule ID | Severity floor | Description |
|---------|---------------|-------------|
| `bp/is-on-https` | `error` / `warn` | Page is served over HTTP instead of HTTPS |
| `bp/no-vulnerable-libraries` | `error` / `warn` | Page uses JavaScript libraries with known CVEs |
| `bp/errors-in-console` | `error` / `warn` | Browser console has errors that may indicate broken functionality |

Severity: `error` when Lighthouse score < 0.5, `warn` when score >= 0.5 and < 1.

## raw output shape

```ts
{
  categoryScore: number | null,       // raw LH category score (0–1)
  projectedAuditIds: string[],        // LH audit IDs checked: ["is-on-https", "no-vulnerable-libraries", "errors-in-console"]
}
```

## See also

- [@repo/audit-core](../audit-core/README.md)
- [Slice 1 design doc](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
