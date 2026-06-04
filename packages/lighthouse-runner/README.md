# @repo/lighthouse-runner

Runs Lighthouse headlessly against a URL and returns a typed `RawLighthouseResult` that the LH-backed audit packages consume.

## Requirements

- Google Chrome must be installed locally (used via `chrome-launcher`).
- In Docker / CI without a sandbox, set `LH_NO_SANDBOX=1` — the runner will pass `--no-sandbox` to Chrome automatically.

## Usage

```ts
import { runLighthouse } from "@repo/lighthouse-runner"
import type { RawLighthouseResult, LighthouseRunOptions } from "@repo/lighthouse-runner"

// Minimal — mobile form factor, 60 s timeout
const lhr: RawLighthouseResult = await runLighthouse("https://example.com")

// With options
const lhr2 = await runLighthouse("https://example.com", {
  formFactor: "desktop",
  timeoutMs: 90_000,
  signal: AbortSignal.timeout(120_000),
  logger: (event) => console.log(event.kind, event.message),
})

// Access projected categories
console.log(lhr2.categories.performance.score) // 0–1 or null
console.log(lhr2.categories.seo.score)
console.log(lhr2.categories["best-practices"].score)
console.log(lhr2.categories.pwa?.score)         // may be absent in LH 12
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `formFactor` | `"mobile" \| "desktop"` | `"mobile"` | Lighthouse emulation mode. Desktop disables throttling and uses 1350×940. |
| `timeoutMs` | `number` | `60000` | Overall timeout for the Lighthouse run (ms). |
| `signal` | `AbortSignal` | — | Cancels the Chrome process and rejects with `ABORTED`. |
| `logger` | `(event: LogEvent) => void` | — | Receives `progress`, `warn`, and `debug` events during the run. |

## Environment variables

| Variable | Effect |
|----------|--------|
| `LH_NO_SANDBOX=1` | Passes `--no-sandbox` to Chrome. Required in most Docker/CI environments. |

## Error mapping

`runLighthouse` throws an `AuditFailure` from `@repo/audit-core` on all failure paths:

| Condition | `ErrorCode` |
|-----------|------------|
| Lighthouse `NO_FCP` runtime error | `LIGHTHOUSE_NO_FCP` |
| Lighthouse `ERRORED_DOCUMENT_REQUEST` | `DNS_ERROR` |
| Other Lighthouse runtime error | `LIGHTHOUSE_CRASH` |
| Final URL returned HTTP 4xx | `HTTP_4XX` |
| Final URL returned HTTP 5xx | `HTTP_5XX` |
| `AbortSignal` fired | `ABORTED` |
| ETIMEDOUT / operation timed out | `TIMEOUT` |
| Any other thrown `Error` | `LIGHTHOUSE_CRASH` |

## Exported types

| Type | Description |
|------|-------------|
| `RawLighthouseResult` | Typed subset of the LHR: `categories`, `audits`, `requestedUrl`, `finalUrl`, `fetchTime` |
| `LighthouseAudit` | Single audit entry: `id`, `score`, `scoreDisplayMode`, `displayValue`, `details` |
| `LighthouseCategory` | Category entry: `id`, `title`, `score`, `auditRefs` |
| `LighthouseRunOptions` | Options accepted by `runLighthouse` |

## See also

- [@repo/audit-core](../audit-core/README.md)
- [Slice 1 design doc](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
