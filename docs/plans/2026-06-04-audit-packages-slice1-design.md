# Audit Packages — Slice 1 Design

**Status:** approved
**Date:** 2026-06-04
**Scope:** First slice of the SEO Competitive Intelligence Platform — audit packages and a CLI only. No Supabase, no runner app, no UI, no DB.

## Goal

Establish the foundational audit layer of the platform as a set of small, pure-function npm packages plus a single aggregator CLI. Pin down the shared `AuditResult` contract so every subsequent slice (the queueing runner, the Drizzle/Supabase data layer, the web dashboard) consumes a single, stable type.

A successful slice 1 is the command:

```
$ audit-cli https://example.com
```

…producing a deterministic `AuditResult[]` (JSON or pretty-printed) covering five categories: `performance`, `seo`, `best-practices`, `pwa`, `on-page`.

## Scope decomposition (why this slice exists)

The overall platform brief contains ~8 independent subsystems (platform setup, schema/RLS, runner infra, audit packages, web dashboard, PWA workers, realtime fanout, K8s). Designing all of them in one spec locks in too many decisions too early. This slice intentionally cuts everything except the audit packages so the `AuditResult` contract can be validated end-to-end (URL in → typed result out) before any infrastructure depends on it.

Subsequent slices (each its own design doc):

1. **This slice.** Audit packages + CLI.
2. Supabase schema, RLS, Drizzle `db` package, AuditResult persistence.
3. Runner app, pgmq, Realtime broadcast.
4. Web dashboard (single-site MVP).
5. Multi-site / competitor comparison.
6. PWA + workers.
7. Remaining audit packages (a11y, structured, social, links, security).
8. Scheduling, K8s, ops.

## Out of scope for slice 1 (explicit)

Supabase, Drizzle, queueing, K8s/Docker, the web dashboard, browser workers (Service/Shared/Dedicated), auth, RLS, time-series storage, rate-limiting, robots-txt-respecting fetch (the rule check in `audit-onpage` reports the directive; honoring it is a runner-level concern), retries, scheduled re-audits, IBM accessibility-checker, structured-data audits, social audits, links audits, security audits.

## Architecture decisions summary

| # | Decision | Choice |
|---|---|---|
| 1 | Result cardinality per audit call | One `AuditResult` per package; category = package identity; sub-checks distinguished via `Issue.rule` |
| 2 | Lighthouse package split | Four packages (`audit-perf`, `audit-seo`, `audit-best-practices`, `audit-pwa`) plus an internal `lighthouse-runner` |
| 3 | Issue shape | Stable namespaced rule id + severity + count + first-5 occurrences |
| 4 | Error model | Discriminated union `success \| partial \| failed`; `audit()` never throws on content-level failure |
| 5 | CLI surface | Per-package bin + thin aggregator `audit-cli` |
| 6 | Lighthouse orchestration | Shared via opt-in hint (`opts.lighthouseResult`); aggregator runs Chrome once and fans the result to four packages |

## Package layout

Eight packages, all under `packages/`, all `private: true` in slice 1:

```
packages/
  audit-core/             # types, Zod schemas, helpers (issue builder, score utils, error codes)
  lighthouse-runner/      # internal: launches Chrome + Lighthouse once, returns RawLighthouseResult
  audit-perf/             # category: "performance"        | depends on audit-core, lighthouse-runner
  audit-seo/              # category: "seo"                | depends on audit-core, lighthouse-runner
  audit-best-practices/   # category: "best-practices"     | depends on audit-core, lighthouse-runner
  audit-pwa/              # category: "pwa"                | depends on audit-core, lighthouse-runner
  audit-onpage/           # category: "on-page"            | depends on audit-core only
  audit-cli/              # bin: audit-cli                 | depends on ALL of the above
```

Package names use the existing repo scope: `@repo/audit-core`, `@repo/audit-perf`, etc.

### Dependency direction (enforced by tsconfig project references)

```
audit-core   ←  lighthouse-runner
audit-core   ←  audit-onpage
audit-core, lighthouse-runner   ←  audit-perf / audit-seo / audit-best-practices / audit-pwa
all of the above   ←  audit-cli
```

Hard rules:
- No `audit-*` package imports another `audit-*` package.
- No package imports `audit-cli`.
- `lighthouse-runner` is the only place `lighthouse` and `chrome-launcher` are dependencies. The four lighthouse-backed packages don't know how Chrome starts.

### `@repo/audit-core` exports (the surface)

```ts
// types
export type AuditResult, AuditResultSuccess, AuditResultPartial, AuditResultFailure
export type Issue, IssueOccurrence, Severity, Category
export type AuditOptions, AuditFn, LogEvent
export type ErrorCode

// schemas
export const AuditResultSchema: ZodSchema<AuditResult>
export const IssueSchema: ZodSchema<Issue>

// helpers
export function defineIssue(input: { rule, severity, ... }): Issue
export function withTiming(meta: { category, packageName, packageVersion }): <T extends InnerAuditFn>(fn: T) => AuditFn
export class AuditFailure extends Error { code: ErrorCode; retryable: boolean }

// constants
export const ErrorCodes: { DNS_ERROR, HTTP_4XX, HTTP_5XX, TIMEOUT, LIGHTHOUSE_CRASH, LIGHTHOUSE_NO_FCP, INVALID_HTML, UNKNOWN, ... } as const
```

## The contract

### `Category`

```ts
type Category =
  | "performance"
  | "seo"
  | "best-practices"
  | "pwa"
  | "on-page"
// future: "accessibility" | "structured-data" | "social" | "links" | "security"
```

### `Issue`

```ts
type Severity = "info" | "warn" | "error"

type IssueOccurrence = {
  selector?: string      // CSS selector when applicable
  snippet?: string       // truncated to 200 chars
  url?: string           // for link-related issues in future packages
}

type Issue = {
  rule: string           // stable snake-case id, namespaced by package: "onpage/missing-meta-description"
  severity: Severity
  title: string          // human, short
  description: string    // human, what is wrong on THIS page
  recommendation: string // human, what to do
  count: number          // >= 1
  occurrences: IssueOccurrence[]   // length <= 5; the rest are summarized in `count`
  docsUrl?: string
}
```

Rule ids are namespaced by package (`onpage/missing-meta-description`, `perf/lcp-too-slow`). Stops collisions when the dashboard de-duplicates across runs and across packages.

### `AuditResult` (discriminated union)

```ts
type AuditResultBase = {
  category: Category
  url: string            // post-redirect-resolved
  requestedUrl: string   // as passed in
  startedAt: string      // ISO 8601
  durationMs: number
  packageName: string    // e.g. "@repo/audit-perf"
  packageVersion: string // from package.json at build time
}

type AuditResultSuccess = AuditResultBase & {
  status: "success"
  score: number          // 0–100, integer
  issues: Issue[]
  raw: unknown           // upstream tool's verbatim output (projected for size)
}

type AuditResultPartial = AuditResultBase & {
  status: "partial"
  score: number          // 0–100, scored on the parts that succeeded
  issues: Issue[]
  raw: unknown
  partialReasons: string[]   // e.g. ["pwa-category-not-emitted-by-lighthouse"]
}

type AuditResultFailure = AuditResultBase & {
  status: "failed"
  error: {
    code: ErrorCode
    message: string
    retryable: boolean
  }
}

type AuditResult = AuditResultSuccess | AuditResultPartial | AuditResultFailure
```

### Function signature

```ts
type AuditOptions = {
  timeoutMs?: number           // default 30_000 (60_000 for lighthouse-backed)
  logger?: (event: LogEvent) => void   // optional; no console.log inside packages
  signal?: AbortSignal         // honored by all packages
  lighthouseResult?: RawLighthouseResult   // only the 4 LH-backed packages read this; others ignore
  userAgent?: string           // only audit-onpage reads this
  formFactor?: "mobile" | "desktop"   // only LH packages read this
}

type AuditFn = (url: string, opts?: AuditOptions) => Promise<AuditResult>
```

`audit()` never throws on content-level failure. It throws only for programmer error (invalid URL string, malformed options). Such errors are caught at the `audit-cli` boundary and reported as exit code 2.

### `withTiming` helper

Each audit package wraps its inner implementation with `withTiming`:

```ts
// packages/audit-onpage/src/index.ts (sketch)
import { withTiming, AuditFailure } from "@repo/audit-core"
import { version as packageVersion } from "../package.json" with { type: "json" }

export const audit = withTiming({
  category: "on-page",
  packageName: "@repo/audit-onpage",
  packageVersion,
})(async ({ url, opts, partial }) => {
  // implementation returns { score, issues, raw }
  //   or { score, issues, raw, partial: [reason] } via the partial() helper
  //   or throws new AuditFailure({ code, message, retryable })
})
```

`withTiming` is responsible for:
- Stamping `startedAt`, `durationMs`, `packageName`, `packageVersion`, `category`, `requestedUrl`, `url` on the returned result.
- Catching `AuditFailure` and converting to `status: "failed"`.
- Catching unknown thrown errors and converting to `status: "failed"` with `code: "UNKNOWN"`, `retryable: true`.
- Propagating `AbortSignal` cancellation as `status: "failed"`, `code: "TIMEOUT"` or `"ABORTED"`.

### Zod validation

`AuditResultSchema` exported from `audit-core` is used by:
- `audit-cli` to validate every package's output before printing (defensive — catches a misbehaving package early).
- Future slices: the DB-writer validates before insert; runtime safety in addition to Drizzle's static types.

### `packageVersion` plumbing

Each audit package imports `version` from its own `package.json` via `tsconfig` `resolveJsonModule: true` (and `import attributes` `with { type: "json" }`). No build-time codegen.

## Lighthouse orchestration

### `@repo/lighthouse-runner` surface

```ts
type LighthouseRunOptions = {
  timeoutMs?: number              // default 60_000
  signal?: AbortSignal
  formFactor?: "mobile" | "desktop"  // default "mobile"
  logger?: (event: LogEvent) => void
}

type RawLighthouseResult = {
  // a structurally-stable subset of Lighthouse's LHR shape (full LHR is huge)
  categories: {
    performance:    LighthouseCategory
    seo:            LighthouseCategory
    "best-practices": LighthouseCategory
    pwa?:           LighthouseCategory   // optional — LH 12 deprecated PWA
  }
  audits: Record<string, LighthouseAudit>
  finalUrl: string
  requestedUrl: string
  fetchTime: string
  runtimeError?: { code: string; message: string }
}

export async function runLighthouse(
  url: string,
  opts?: LighthouseRunOptions,
): Promise<RawLighthouseResult>
```

### Chrome lifecycle

- Use `chrome-launcher` (lighter than Playwright; Lighthouse natively expects it). Revisit Playwright in a later slice if multi-step auth flows surface.
- One Chrome instance per `runLighthouse()` call. Launched on a random free port. Killed in `finally`.
- Headless. `--no-sandbox` is set only when `process.env.LH_NO_SANDBOX === "1"` (needed inside Docker; not by default locally).
- RAM cap: rely on the OS for slice 1; the runner app in a later slice will set cgroup limits.

### Error code mapping (lighthouse-runner → `AuditFailure`)

| Lighthouse condition | ErrorCode | retryable |
|---|---|---|
| `runtimeError.code === "NO_FCP"` | `LIGHTHOUSE_NO_FCP` | true |
| `runtimeError.code === "ERRORED_DOCUMENT_REQUEST"` (DNS, conn refused) | `DNS_ERROR` | true |
| HTTP 4xx final response | `HTTP_4XX` (with status in message) | false |
| HTTP 5xx final response | `HTTP_5XX` | true |
| Lighthouse throws / Chrome crashes | `LIGHTHOUSE_CRASH` | true |
| Timeout exceeded | `TIMEOUT` | true |

### How the four lighthouse packages consume the result

```ts
// packages/audit-perf/src/index.ts (sketch)
import { withTiming } from "@repo/audit-core"
import { runLighthouse } from "@repo/lighthouse-runner"
import { version as packageVersion } from "../package.json" with { type: "json" }

export const audit = withTiming({
  category: "performance",
  packageName: "@repo/audit-perf",
  packageVersion,
})(async ({ url, opts }) => {
  const lhr = opts?.lighthouseResult ?? await runLighthouse(url, {
    timeoutMs: opts?.timeoutMs,
    signal: opts?.signal,
    logger: opts?.logger,
    formFactor: opts?.formFactor,
  })

  const category = lhr.categories.performance
  const score = Math.round(category.score * 100)
  const issues = projectAudits(lhr.audits, PERF_AUDIT_RULES)
  return { score, issues, raw: { category, auditRefs: PERF_AUDIT_RULES } }
})
```

### Aggregator (`audit-cli`) flow

1. Validate URL via Zod (`z.string().url()`).
2. Call `runLighthouse(url)` once → `RawLighthouseResult` (or `AuditFailure`).
3. If LH succeeded, pass result to `audit-perf` / `audit-seo` / `audit-best-practices` / `audit-pwa` via `opts.lighthouseResult`.
   If LH failed, those four packages each receive a `failed` `AuditResult` with the same error code (constructed directly; no need to call them).
4. Concurrently call `audit-onpage(url)` (no LH dependency).
5. `Promise.all` over the five; validate each via `AuditResultSchema`; collect `AuditResult[]`.
6. Render (JSON to stdout, progress to stderr; or pretty table).

### PWA-specific partial handling

Lighthouse 12 dropped PWA as a default category. If `lhr.categories.pwa` is missing, `audit-pwa` returns `status: "partial"` with `partialReasons: ["pwa-category-not-emitted-by-lighthouse"]` and `score: 0`. The run itself didn't fail; the data just isn't there.

## `audit-onpage` (independent of Lighthouse)

- Fetch HTML via Node's built-in `undici`. No extra dep.
- Redirects followed up to 5 hops; 30s timeout; configurable `User-Agent` (default `SeoAuditBot/0.1 (+https://...)`).
- Parse with `cheerio`.
- Robots.txt and sitemap.xml fetched as sibling requests; missing/unreachable surfaces as a low-severity rule, not a failure.
- Rule list (~15 rules for slice 1, firmed up in implementation):
  - `onpage/title-missing`
  - `onpage/title-too-long`
  - `onpage/title-too-short`
  - `onpage/meta-description-missing`
  - `onpage/meta-description-too-long`
  - `onpage/h1-missing`
  - `onpage/h1-multiple`
  - `onpage/heading-order-broken`
  - `onpage/alt-missing`
  - `onpage/canonical-missing`
  - `onpage/canonical-points-elsewhere`
  - `onpage/hreflang-malformed`
  - `onpage/robots-disallowed`
  - `onpage/robots-missing`
  - `onpage/sitemap-missing`
- Score derivation: each rule has a static `weight` and a `pass | fail` outcome → `score = round(100 × passedWeight / totalWeight)`.

## CLI

### `audit-cli` aggregator

```
$ audit-cli <url> [options]

Positional:
  url                        URL to audit (http or https; Zod-validated)

Options:
  --json                     Print AuditResult[] as JSON to stdout (default if not a TTY)
  --pretty                   Human-readable table to stdout (default if stdout is a TTY)
  --only <category[,...]>    Run only the listed categories
                             (performance|seo|best-practices|pwa|on-page)
  --form-factor <m|d>        Lighthouse form factor (default: mobile)
  --timeout <ms>             Per-audit timeout (default: 30000; LH gets 60000)
  --user-agent <string>      For audit-onpage HTTP fetch
  --no-color                 Disable ANSI colors in --pretty
  --debug                    Surface Chrome stderr and verbose progress
  -h, --help
  --version

Exit codes:
  0   all audits status === "success"
  1   at least one audit status === "partial" or "failed"
  2   CLI usage error (bad URL, unknown flag, etc.)

Streams:
  stdout: JSON payload OR pretty table
  stderr: progress, warnings, LH chrome stderr (silenced unless --debug)
```

### Per-package bins

`audit-perf`, `audit-seo`, `audit-best-practices`, `audit-pwa`, `audit-onpage` — thin wrappers that call `audit(url, opts)`, accept the option subset that's meaningful to them, and print/JSON the single result with the same exit-code rules.

### Argument parsing

`commander`. Tiny, ESM-native, well-typed. (`yargs` is heavier and brings extra surface; not needed.)

### Pretty renderer

`audit-cli/src/render/pretty.ts`. Uses `picocolors` (no deps) plus manual column alignment. No table libraries.

## Testing strategy

| Layer | Tool | Approach |
|---|---|---|
| Unit (every package) | `vitest` | Recorded HTML fixtures under `__fixtures__/`; pure functions hit fixture, assert `AuditResult` shape via `AuditResultSchema.parse` plus targeted assertions on score, issues, status. |
| Unit (audit-perf / seo / bp / pwa) | `vitest` | Recorded LHR JSON fixtures under `__fixtures__/lhr/`. Pass via `opts.lighthouseResult` so no Chrome is ever launched in unit tests. |
| Unit (audit-onpage) | `vitest` + `msw` | Mock the HTTP layer (undici); fixture HTML responses plus canned `robots.txt` / `sitemap.xml`. |
| Integration (lighthouse-runner) | `vitest` (tag: `@integration`) | Real Chrome against a tiny `vite` static server serving fixture HTML. Skipped unless `RUN_INTEGRATION=1`. |
| Integration (audit-cli) | `vitest` (tag: `@integration`) | Spawn the CLI as a subprocess against the same local server. Asserts: exit codes, JSON shape, pretty contains expected substrings. |
| Smoke (manual) | `bun --filter @repo/audit-cli smoke` | Hits `https://example.com`. Not in CI by default. |

### Fixture recording

A `scripts/record-fixture.ts` in each LH-backed package can fetch a fresh LHR for a URL and write it to `__fixtures__/lhr/<name>.json`. Re-run when the `lighthouse` minor or major version changes (patch bumps generally preserve LHR shape).

### Coverage target

Not a coverage number. The contract is the target:
- Every rule in `audit-onpage` has a test.
- Every `ErrorCode` mapping in `lighthouse-runner` has a test.
- The `withTiming` wrapper's success / partial / failed / throw paths have tests in `audit-core`.

## Runtime, build, dev loop

### Runtime

Node 20 LTS for slice 1 across the board. Lighthouse needs Node; using Node everywhere keeps the story simple. The existing `apps/*` (Next 16, Bun) are unaffected — these are leaf packages with no app dependency yet.

### Module system

ESM only (`"type": "module"`).

### Build

`tsdown` (zero-config, esbuild-backed, fast). One `dist/` per package, emitting `index.js` + `index.d.ts`. Chosen over `tsc` for emit speed + zero-config `package.json` handling; chosen over `tsup` for active maintenance and matching `bun` flavor.

### TypeScript

Add `packages/typescript-config/node.json` alongside the existing config. Extends base with:

```jsonc
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  }
}
```

Each audit package extends this.

### Turbo

`apps/*` and `packages/*` workspace globs already pick up the new packages. Touch `turbo.json` to add a `test` task and confirm `dist/**` outputs are cached for `build`:

```jsonc
{
  "tasks": {
    "build": { "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "test": { "inputs": ["$TURBO_DEFAULT$"], "outputs": [], "dependsOn": ["^build"] }
  }
}
```

### Catalog additions (root `package.json`)

Production:
- `lighthouse`
- `chrome-launcher`
- `cheerio`
- `robots-parser`
- `commander`
- `picocolors`
- `zod` (already in catalog — reuse)

Dev:
- `vitest`
- `msw`
- `tsdown`

### Lint

Existing `biome.json` already applies repo-wide. No changes.

## Definition of done for slice 1

- All eight packages build (`bun run build`) and typecheck (`bun run typecheck`).
- `audit-cli https://example.com` returns exactly five `AuditResult` objects (one per category), each validating against `AuditResultSchema`. Any of them may be `success`, `partial`, or `failed`; what matters is that the contract is honored.
- Unit test suite green for every package; integration suite green when `RUN_INTEGRATION=1`.
- Every rule in `audit-onpage` and every `ErrorCode` mapping in `lighthouse-runner` is covered by a test.
- A short README in each package documents `audit(url, opts)` and the rule list it owns.
- No package depends on Supabase, Drizzle, a queue, or any UI library.
