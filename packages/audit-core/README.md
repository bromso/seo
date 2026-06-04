# @repo/audit-core

Shared types, schemas, helpers, and the `withTiming` wrapper used by every audit package in this slice.

## Usage

```ts
import {
  AuditResultSchema,
  AuditFailure,
  ErrorCodes,
  defineIssue,
  withTiming,
} from "@repo/audit-core"
import type { AuditResult, AuditFn, Issue, Category, ErrorCode } from "@repo/audit-core"

// Validate any AuditResult at runtime
const result: AuditResult = await myAudit("https://example.com")
AuditResultSchema.parse(result) // throws ZodError if invalid

// Define a rule violation
const issue = defineIssue({
  rule: "my-package/my-rule",
  severity: "warn",
  title: "Something is wrong",
  description: "Longer explanation of the problem.",
  recommendation: "Here is how to fix it.",
})

// Throw a typed error
throw new AuditFailure({ code: "TIMEOUT", message: "timed out after 30s" })

// Wrap an inner audit function with timing + error handling
const audit = withTiming({
  category: "performance",
  packageName: "@repo/audit-perf",
  packageVersion: "0.0.0",
})(async ({ url, opts }) => {
  // ... run audit logic, return { score, issues, raw }
  return { score: 95, issues: [], raw: {} }
})

const result2 = await audit("https://example.com")
// result2.status === "success" | "partial" | "failed"
// result2.durationMs, result2.startedAt, result2.packageName, etc.
```

## API surface

### Types

| Type | Description |
|------|-------------|
| `AuditResult` | Union of `AuditResultSuccess`, `AuditResultPartial`, `AuditResultFailure` |
| `AuditResultSuccess` | `status: "success"`, `score`, `issues`, `raw` |
| `AuditResultPartial` | `status: "partial"`, `score`, `issues`, `raw`, `partialReasons` |
| `AuditResultFailure` | `status: "failed"`, `error` (`code`, `message`, `retryable`) |
| `Issue` | `rule`, `severity`, `title`, `description`, `recommendation`, `count`, `occurrences` |
| `Category` | `"performance" \| "seo" \| "best-practices" \| "pwa" \| "on-page"` |
| `ErrorCode` | `DNS_ERROR`, `HTTP_4XX`, `HTTP_5XX`, `TIMEOUT`, `ABORTED`, `LIGHTHOUSE_CRASH`, `LIGHTHOUSE_NO_FCP`, `INVALID_HTML`, `UNKNOWN` |
| `AuditFn` | `(url, opts?) => Promise<AuditResult>` |
| `AuditOptions` | `timeoutMs?`, `logger?`, `signal?`, `lighthouseResult?`, `userAgent?`, `formFactor?` |

### Exports

| Export | Kind | Description |
|--------|------|-------------|
| `defineIssue` | function | Creates an `Issue` with `count: 1` and empty `occurrences` by default |
| `withTiming` | function | Higher-order function that adds timing, `try/catch → AuditFailure`, and result shaping |
| `AuditFailure` | class | Typed error with `code: ErrorCode`, `message`, optional `cause` |
| `ErrorCodes` | const | Object containing all valid `ErrorCode` string values |
| `AuditResultSchema` | Zod schema | Full schema for `AuditResult` (all three variants) |
| `IssueSchema` | Zod schema | Schema for a single `Issue` |
| `CategorySchema` | Zod schema | Schema for `Category` |
| `SeveritySchema` | Zod schema | Schema for `"info" \| "warn" \| "error"` |

## See also

- [Slice 1 design doc](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
