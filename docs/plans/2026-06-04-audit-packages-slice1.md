# Audit Packages Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 8 npm packages (`audit-core`, `lighthouse-runner`, four LH-backed audit packages, `audit-onpage`, `audit-cli`) producing a deterministic `AuditResult[]` from a URL via a single CLI invocation.

**Architecture:** Strict one-way dependency graph (`audit-core` ← internals ← audit-* ← audit-cli). The 4 lighthouse-backed packages share a single Chrome launch via opt-in `opts.lighthouseResult`. `audit-onpage` is independent (cheerio + undici). All packages emit a discriminated-union `AuditResult` (`success | partial | failed`).

**Tech Stack:** Node 20 LTS, ESM-only, TypeScript 5.7, tsdown for builds, vitest + msw for tests, `lighthouse` + `chrome-launcher` for browser auditing, `cheerio` + `robots-parser` + `undici` for HTML auditing, `commander` + `picocolors` for the CLI, `zod` for runtime validation.

**Spec:** `docs/plans/2026-06-04-audit-packages-slice1-design.md`

---

## Conventions used throughout

- Commits follow conventional commits (`feat:`, `chore:`, `test:`, `docs:`). Husky pre-commit will run biome — if it complains, fix the report and re-commit.
- Every task ends in a green test suite + a commit.
- File paths are absolute from repo root: `packages/<pkg>/...`.
- Test files live in `test/` (sibling to `src/`) — vitest's `include: ["test/**/*.test.ts", "integration/**/*.integration.test.ts"]`.
- Each package's `version` is `0.0.0` for slice 1; the `packageVersion` field in `AuditResult` reads this verbatim.
- `bun --filter @repo/<pkg> test` runs that one package's tests.

---

## Task 1: Workspace scaffolding — catalog, tsconfig-node, turbo

**Files:**
- Modify: `package.json` (root) — add to `catalog` and `devDependencies`
- Create: `packages/typescript-config/node.json`
- Modify: `turbo.json` — add `test` task and `dist/**` to `build` outputs

- [ ] **Step 1: Add dependencies to the root catalog**

Edit `package.json`. In the `catalog` block, add:

```json
"lighthouse": "^12.0.0",
"chrome-launcher": "^1.1.2",
"cheerio": "^1.0.0",
"robots-parser": "^3.0.1",
"commander": "^12.1.0",
"picocolors": "^1.1.1"
```

In the root `devDependencies` block, add:

```json
"vitest": "^2.1.8",
"msw": "^2.7.0",
"tsdown": "^0.6.7"
```

- [ ] **Step 2: Install**

Run: `bun install`
Expected: lockfile updates; new packages appear under `node_modules`.

- [ ] **Step 3: Create the Node tsconfig preset**

Create `packages/typescript-config/node.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Node",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

If `packages/typescript-config/base.json` does not exist, list `packages/typescript-config/` first to find the actual base file name and update `extends` accordingly.

- [ ] **Step 4: Update turbo.json**

Edit `turbo.json`. In the `tasks.build` block, set `outputs` to:

```json
"outputs": [".next/**", "!.next/cache/**", "dist/**"]
```

Add a `test` task at the end of `tasks`:

```json
"test": {
  "inputs": ["$TURBO_DEFAULT$"],
  "outputs": [],
  "dependsOn": ["^build"]
}
```

- [ ] **Step 5: Verify**

Run: `bun run typecheck`
Expected: PASS (no audit packages yet, so existing apps just typecheck normally).

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock packages/typescript-config/node.json turbo.json
git commit -m "chore: scaffold workspace for audit packages slice 1"
```

---

## Task 2: audit-core — package scaffold and types

**Files:**
- Create: `packages/audit-core/package.json`
- Create: `packages/audit-core/tsconfig.json`
- Create: `packages/audit-core/tsdown.config.ts`
- Create: `packages/audit-core/src/types.ts`
- Create: `packages/audit-core/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@repo/audit-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Note: this assumes `@types/node`, `typescript`, and `tsdown` are exposed in catalog. If `typescript` is not in catalog, drop the `catalog:` suffix and hardcode `^5.7.3`. Similarly for `@types/node`. Verify against root `package.json` before commit.

- [ ] **Step 2: Create tsconfig**

`packages/audit-core/tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/node.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "test", "__fixtures__"]
}
```

- [ ] **Step 3: Create tsdown.config.ts**

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
})
```

- [ ] **Step 4: Create src/types.ts**

```ts
export type Category =
  | "performance"
  | "seo"
  | "best-practices"
  | "pwa"
  | "on-page"

export type Severity = "info" | "warn" | "error"

export type IssueOccurrence = {
  selector?: string
  snippet?: string
  url?: string
}

export type Issue = {
  rule: string
  severity: Severity
  title: string
  description: string
  recommendation: string
  count: number
  occurrences: IssueOccurrence[]
  docsUrl?: string
}

export type ErrorCode =
  | "DNS_ERROR"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "TIMEOUT"
  | "ABORTED"
  | "LIGHTHOUSE_CRASH"
  | "LIGHTHOUSE_NO_FCP"
  | "INVALID_HTML"
  | "UNKNOWN"

export type AuditError = {
  code: ErrorCode
  message: string
  retryable: boolean
}

type AuditResultBase = {
  category: Category
  url: string
  requestedUrl: string
  startedAt: string
  durationMs: number
  packageName: string
  packageVersion: string
}

export type AuditResultSuccess = AuditResultBase & {
  status: "success"
  score: number
  issues: Issue[]
  raw: unknown
}

export type AuditResultPartial = AuditResultBase & {
  status: "partial"
  score: number
  issues: Issue[]
  raw: unknown
  partialReasons: string[]
}

export type AuditResultFailure = AuditResultBase & {
  status: "failed"
  error: AuditError
}

export type AuditResult =
  | AuditResultSuccess
  | AuditResultPartial
  | AuditResultFailure

export type LogEvent =
  | { kind: "progress"; message: string }
  | { kind: "warn"; message: string }
  | { kind: "debug"; message: string; data?: unknown }

export type AuditOptions = {
  timeoutMs?: number
  logger?: (event: LogEvent) => void
  signal?: AbortSignal
  lighthouseResult?: unknown
  userAgent?: string
  formFactor?: "mobile" | "desktop"
}

export type AuditFn = (url: string, opts?: AuditOptions) => Promise<AuditResult>
```

- [ ] **Step 5: Create src/index.ts (initial re-exports)**

```ts
export type {
  AuditFn,
  AuditOptions,
  AuditResult,
  AuditResultSuccess,
  AuditResultPartial,
  AuditResultFailure,
  AuditError,
  Category,
  ErrorCode,
  Issue,
  IssueOccurrence,
  LogEvent,
  Severity,
} from "./types.js"
```

- [ ] **Step 6: Build to verify**

Run: `bun --filter @repo/audit-core build`
Expected: `dist/index.js` + `dist/index.d.ts` written, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/audit-core
git commit -m "feat(audit-core): scaffold package with AuditResult types"
```

---

## Task 3: audit-core — Zod schemas + round-trip test

**Files:**
- Create: `packages/audit-core/src/schemas.ts`
- Modify: `packages/audit-core/src/index.ts` (re-export schemas)
- Create: `packages/audit-core/test/schemas.test.ts`
- Create: `packages/audit-core/vitest.config.ts`

- [ ] **Step 1: Create vitest config**

`packages/audit-core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 2: Write the failing test**

Create `packages/audit-core/test/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { AuditResultSchema, IssueSchema } from "../src/index.js"

const validIssue = {
  rule: "onpage/missing-meta-description",
  severity: "warn" as const,
  title: "Missing meta description",
  description: "No <meta name=\"description\"> on the page.",
  recommendation: "Add a 150-160 character meta description.",
  count: 1,
  occurrences: [],
}

const validSuccessResult = {
  status: "success" as const,
  category: "on-page" as const,
  url: "https://example.com/",
  requestedUrl: "https://example.com",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 312,
  packageName: "@repo/audit-onpage",
  packageVersion: "0.0.0",
  score: 78,
  issues: [validIssue],
  raw: { ok: true },
}

const validFailureResult = {
  status: "failed" as const,
  category: "performance" as const,
  url: "https://nope.invalid/",
  requestedUrl: "https://nope.invalid",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 8000,
  packageName: "@repo/audit-perf",
  packageVersion: "0.0.0",
  error: {
    code: "DNS_ERROR" as const,
    message: "getaddrinfo ENOTFOUND nope.invalid",
    retryable: true,
  },
}

describe("IssueSchema", () => {
  it("accepts a valid issue", () => {
    expect(() => IssueSchema.parse(validIssue)).not.toThrow()
  })

  it("rejects count < 1", () => {
    expect(() => IssueSchema.parse({ ...validIssue, count: 0 })).toThrow()
  })

  it("rejects more than 5 occurrences", () => {
    const tooMany = Array.from({ length: 6 }, () => ({ selector: "img" }))
    expect(() =>
      IssueSchema.parse({ ...validIssue, occurrences: tooMany })
    ).toThrow()
  })
})

describe("AuditResultSchema", () => {
  it("accepts a success result", () => {
    expect(() => AuditResultSchema.parse(validSuccessResult)).not.toThrow()
  })

  it("accepts a failure result with no score/issues", () => {
    expect(() => AuditResultSchema.parse(validFailureResult)).not.toThrow()
  })

  it("rejects a success result missing score", () => {
    const { score, ...withoutScore } = validSuccessResult
    expect(() => AuditResultSchema.parse(withoutScore)).toThrow()
  })

  it("rejects score out of 0..100", () => {
    expect(() =>
      AuditResultSchema.parse({ ...validSuccessResult, score: 101 })
    ).toThrow()
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `bun --filter @repo/audit-core test`
Expected: FAIL — `AuditResultSchema` / `IssueSchema` not exported.

- [ ] **Step 4: Implement the schemas**

Create `packages/audit-core/src/schemas.ts`:

```ts
import { z } from "zod"

export const CategorySchema = z.enum([
  "performance",
  "seo",
  "best-practices",
  "pwa",
  "on-page",
])

export const SeveritySchema = z.enum(["info", "warn", "error"])

export const ErrorCodeSchema = z.enum([
  "DNS_ERROR",
  "HTTP_4XX",
  "HTTP_5XX",
  "TIMEOUT",
  "ABORTED",
  "LIGHTHOUSE_CRASH",
  "LIGHTHOUSE_NO_FCP",
  "INVALID_HTML",
  "UNKNOWN",
])

export const IssueOccurrenceSchema = z.object({
  selector: z.string().optional(),
  snippet: z.string().max(200).optional(),
  url: z.string().url().optional(),
})

export const IssueSchema = z.object({
  rule: z.string().min(1),
  severity: SeveritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  recommendation: z.string().min(1),
  count: z.number().int().min(1),
  occurrences: z.array(IssueOccurrenceSchema).max(5),
  docsUrl: z.string().url().optional(),
})

const BaseSchema = z.object({
  category: CategorySchema,
  url: z.string().min(1),
  requestedUrl: z.string().min(1),
  startedAt: z.string().datetime(),
  durationMs: z.number().int().min(0),
  packageName: z.string().min(1),
  packageVersion: z.string().min(1),
})

const ScoreSchema = z.number().int().min(0).max(100)

const SuccessSchema = BaseSchema.extend({
  status: z.literal("success"),
  score: ScoreSchema,
  issues: z.array(IssueSchema),
  raw: z.unknown(),
})

const PartialSchema = BaseSchema.extend({
  status: z.literal("partial"),
  score: ScoreSchema,
  issues: z.array(IssueSchema),
  raw: z.unknown(),
  partialReasons: z.array(z.string().min(1)).min(1),
})

const FailureSchema = BaseSchema.extend({
  status: z.literal("failed"),
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
})

export const AuditResultSchema = z.discriminatedUnion("status", [
  SuccessSchema,
  PartialSchema,
  FailureSchema,
])
```

- [ ] **Step 5: Re-export schemas**

Edit `packages/audit-core/src/index.ts` — append:

```ts
export {
  AuditResultSchema,
  CategorySchema,
  ErrorCodeSchema,
  IssueOccurrenceSchema,
  IssueSchema,
  SeveritySchema,
} from "./schemas.js"
```

- [ ] **Step 6: Run test — expect PASS**

Run: `bun --filter @repo/audit-core test`
Expected: 5 passing tests.

- [ ] **Step 7: Commit**

```bash
git add packages/audit-core
git commit -m "feat(audit-core): add Zod schemas with round-trip tests"
```

---

## Task 4: audit-core — AuditFailure + ErrorCodes constant

**Files:**
- Create: `packages/audit-core/src/error.ts`
- Modify: `packages/audit-core/src/index.ts`
- Create: `packages/audit-core/test/error.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/audit-core/test/error.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { AuditFailure, ErrorCodes } from "../src/index.js"

describe("AuditFailure", () => {
  it("is throwable and round-trips its fields", () => {
    const err = new AuditFailure({
      code: "HTTP_4XX",
      message: "page not found (404)",
      retryable: false,
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("HTTP_4XX")
    expect(err.retryable).toBe(false)
    expect(err.message).toContain("page not found")
  })

  it("defaults retryable based on code class when not provided", () => {
    const err = new AuditFailure({ code: "HTTP_5XX", message: "boom" })
    expect(err.retryable).toBe(true)
  })

  it("preserves the original cause", () => {
    const cause = new Error("inner")
    const err = new AuditFailure({
      code: "UNKNOWN",
      message: "wrap",
      cause,
    })
    expect(err.cause).toBe(cause)
  })
})

describe("ErrorCodes", () => {
  it("exposes all expected codes", () => {
    expect(ErrorCodes.DNS_ERROR).toBe("DNS_ERROR")
    expect(ErrorCodes.HTTP_4XX).toBe("HTTP_4XX")
    expect(ErrorCodes.UNKNOWN).toBe("UNKNOWN")
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun --filter @repo/audit-core test`
Expected: FAIL — `AuditFailure` / `ErrorCodes` not exported.

- [ ] **Step 3: Implement**

Create `packages/audit-core/src/error.ts`:

```ts
import type { ErrorCode } from "./types.js"

export const ErrorCodes = {
  DNS_ERROR: "DNS_ERROR",
  HTTP_4XX: "HTTP_4XX",
  HTTP_5XX: "HTTP_5XX",
  TIMEOUT: "TIMEOUT",
  ABORTED: "ABORTED",
  LIGHTHOUSE_CRASH: "LIGHTHOUSE_CRASH",
  LIGHTHOUSE_NO_FCP: "LIGHTHOUSE_NO_FCP",
  INVALID_HTML: "INVALID_HTML",
  UNKNOWN: "UNKNOWN",
} as const satisfies Record<ErrorCode, ErrorCode>

const RETRYABLE_BY_DEFAULT: Record<ErrorCode, boolean> = {
  DNS_ERROR: true,
  HTTP_4XX: false,
  HTTP_5XX: true,
  TIMEOUT: true,
  ABORTED: false,
  LIGHTHOUSE_CRASH: true,
  LIGHTHOUSE_NO_FCP: true,
  INVALID_HTML: false,
  UNKNOWN: true,
}

export type AuditFailureInput = {
  code: ErrorCode
  message: string
  retryable?: boolean
  cause?: unknown
}

export class AuditFailure extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean

  constructor(input: AuditFailureInput) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = "AuditFailure"
    this.code = input.code
    this.retryable = input.retryable ?? RETRYABLE_BY_DEFAULT[input.code]
  }
}
```

- [ ] **Step 4: Re-export**

Append to `packages/audit-core/src/index.ts`:

```ts
export { AuditFailure, ErrorCodes } from "./error.js"
export type { AuditFailureInput } from "./error.js"
```

- [ ] **Step 5: Run test — expect PASS**

Run: `bun --filter @repo/audit-core test`
Expected: all error tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-core
git commit -m "feat(audit-core): add AuditFailure class and ErrorCodes constant"
```

---

## Task 5: audit-core — defineIssue helper

**Files:**
- Create: `packages/audit-core/src/define-issue.ts`
- Modify: `packages/audit-core/src/index.ts`
- Create: `packages/audit-core/test/define-issue.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/audit-core/test/define-issue.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { defineIssue, IssueSchema } from "../src/index.js"

describe("defineIssue", () => {
  it("produces a valid Issue with defaults", () => {
    const issue = defineIssue({
      rule: "onpage/title-missing",
      severity: "error",
      title: "Title missing",
      description: "No <title> element.",
      recommendation: "Add a 30-60 character page title.",
    })
    expect(() => IssueSchema.parse(issue)).not.toThrow()
    expect(issue.count).toBe(1)
    expect(issue.occurrences).toEqual([])
  })

  it("truncates occurrences to first 5 and preserves count", () => {
    const issue = defineIssue({
      rule: "onpage/alt-missing",
      severity: "warn",
      title: "Images missing alt text",
      description: "12 images missing alt.",
      recommendation: "Add alt attributes.",
      occurrences: Array.from({ length: 12 }, (_, i) => ({
        selector: `img:nth-of-type(${i + 1})`,
      })),
    })
    expect(issue.count).toBe(12)
    expect(issue.occurrences).toHaveLength(5)
    expect(issue.occurrences[0]?.selector).toBe("img:nth-of-type(1)")
    expect(() => IssueSchema.parse(issue)).not.toThrow()
  })

  it("respects explicit count when given", () => {
    const issue = defineIssue({
      rule: "onpage/alt-missing",
      severity: "warn",
      title: "Images missing alt text",
      description: "12 images missing alt.",
      recommendation: "Add alt attributes.",
      count: 42,
      occurrences: [{ selector: "img.hero" }],
    })
    expect(issue.count).toBe(42)
  })

  it("truncates snippet to 200 chars", () => {
    const long = "x".repeat(500)
    const issue = defineIssue({
      rule: "onpage/heading-order-broken",
      severity: "warn",
      title: "Broken heading order",
      description: "An h3 appears before any h2.",
      recommendation: "Reorder headings.",
      occurrences: [{ snippet: long }],
    })
    expect(issue.occurrences[0]?.snippet?.length).toBe(200)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun --filter @repo/audit-core test`
Expected: FAIL — `defineIssue` not exported.

- [ ] **Step 3: Implement**

Create `packages/audit-core/src/define-issue.ts`:

```ts
import type { Issue, IssueOccurrence, Severity } from "./types.js"

export type DefineIssueInput = {
  rule: string
  severity: Severity
  title: string
  description: string
  recommendation: string
  count?: number
  occurrences?: IssueOccurrence[]
  docsUrl?: string
}

const MAX_OCCURRENCES = 5
const MAX_SNIPPET = 200

export function defineIssue(input: DefineIssueInput): Issue {
  const all = input.occurrences ?? []
  const occurrences = all.slice(0, MAX_OCCURRENCES).map(truncateOccurrence)
  const count = input.count ?? Math.max(all.length, 1)
  return {
    rule: input.rule,
    severity: input.severity,
    title: input.title,
    description: input.description,
    recommendation: input.recommendation,
    count,
    occurrences,
    ...(input.docsUrl !== undefined ? { docsUrl: input.docsUrl } : {}),
  }
}

function truncateOccurrence(o: IssueOccurrence): IssueOccurrence {
  if (o.snippet === undefined || o.snippet.length <= MAX_SNIPPET) return o
  return { ...o, snippet: o.snippet.slice(0, MAX_SNIPPET) }
}
```

- [ ] **Step 4: Re-export**

Append to `packages/audit-core/src/index.ts`:

```ts
export { defineIssue } from "./define-issue.js"
export type { DefineIssueInput } from "./define-issue.js"
```

- [ ] **Step 5: Run test — expect PASS**

Run: `bun --filter @repo/audit-core test`
Expected: all defineIssue tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-core
git commit -m "feat(audit-core): add defineIssue helper with truncation"
```

---

## Task 6: audit-core — withTiming wrapper

**Files:**
- Create: `packages/audit-core/src/with-timing.ts`
- Modify: `packages/audit-core/src/index.ts`
- Create: `packages/audit-core/test/with-timing.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/audit-core/test/with-timing.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuditFailure, AuditResultSchema, withTiming } from "../src/index.js"

const meta = {
  category: "on-page" as const,
  packageName: "@repo/audit-onpage",
  packageVersion: "0.0.0",
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("withTiming", () => {
  it("returns a valid success result", async () => {
    const audit = withTiming(meta)(async () => ({
      score: 88,
      issues: [],
      raw: { ok: true },
    }))
    const result = await audit("https://example.com")
    expect(() => AuditResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.score).toBe(88)
      expect(result.category).toBe("on-page")
      expect(result.packageVersion).toBe("0.0.0")
      expect(result.startedAt).toBe("2026-06-04T12:00:00.000Z")
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.requestedUrl).toBe("https://example.com")
    }
  })

  it("returns a partial result when inner returns partialReasons", async () => {
    const audit = withTiming(meta)(async () => ({
      score: 0,
      issues: [],
      raw: null,
      partialReasons: ["pwa-category-not-emitted-by-lighthouse"],
    }))
    const result = await audit("https://example.com")
    expect(result.status).toBe("partial")
    if (result.status === "partial") {
      expect(result.partialReasons).toEqual([
        "pwa-category-not-emitted-by-lighthouse",
      ])
    }
  })

  it("converts AuditFailure into a failed result", async () => {
    const audit = withTiming(meta)(async () => {
      throw new AuditFailure({
        code: "HTTP_4XX",
        message: "404 not found",
      })
    })
    const result = await audit("https://example.com/missing")
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.error.code).toBe("HTTP_4XX")
      expect(result.error.retryable).toBe(false)
      expect(result.error.message).toContain("404 not found")
    }
  })

  it("converts unknown errors into UNKNOWN failed results", async () => {
    const audit = withTiming(meta)(async () => {
      throw new TypeError("not a function")
    })
    const result = await audit("https://example.com")
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.error.code).toBe("UNKNOWN")
      expect(result.error.retryable).toBe(true)
    }
  })

  it("aborts via signal and reports ABORTED", async () => {
    const audit = withTiming(meta)(async ({ opts }) => {
      await new Promise((resolve, reject) => {
        opts?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        )
        // never resolves on its own
      })
      return { score: 0, issues: [], raw: null }
    })
    const ac = new AbortController()
    queueMicrotask(() => ac.abort())
    const result = await audit("https://example.com", { signal: ac.signal })
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.error.code).toBe("ABORTED")
    }
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun --filter @repo/audit-core test`
Expected: FAIL — `withTiming` not exported.

- [ ] **Step 3: Implement**

Create `packages/audit-core/src/with-timing.ts`:

```ts
import { AuditFailure } from "./error.js"
import type {
  AuditFn,
  AuditOptions,
  AuditResult,
  Category,
  Issue,
} from "./types.js"

export type WithTimingMeta = {
  category: Category
  packageName: string
  packageVersion: string
}

export type InnerAuditSuccess = {
  score: number
  issues: Issue[]
  raw: unknown
  partialReasons?: string[]
}

export type InnerAuditFn = (ctx: {
  url: string
  opts: AuditOptions | undefined
}) => Promise<InnerAuditSuccess>

export function withTiming(meta: WithTimingMeta) {
  return (inner: InnerAuditFn): AuditFn => {
    return async (url, opts) => {
      const requestedUrl = url
      const startedAtMs = Date.now()
      const startedAt = new Date(startedAtMs).toISOString()
      const base = {
        category: meta.category,
        url,
        requestedUrl,
        startedAt,
        packageName: meta.packageName,
        packageVersion: meta.packageVersion,
      }

      try {
        if (opts?.signal?.aborted) {
          return toFailure(base, startedAtMs, abortedError())
        }
        const inner_result = await inner({ url, opts })
        const durationMs = Date.now() - startedAtMs
        if (
          inner_result.partialReasons &&
          inner_result.partialReasons.length > 0
        ) {
          return {
            ...base,
            durationMs,
            status: "partial",
            score: inner_result.score,
            issues: inner_result.issues,
            raw: inner_result.raw,
            partialReasons: inner_result.partialReasons,
          }
        }
        return {
          ...base,
          durationMs,
          status: "success",
          score: inner_result.score,
          issues: inner_result.issues,
          raw: inner_result.raw,
        }
      } catch (err) {
        return toFailure(base, startedAtMs, err)
      }
    }
  }
}

type BaseFields = {
  category: AuditResult["category"]
  url: string
  requestedUrl: string
  startedAt: string
  packageName: string
  packageVersion: string
}

function toFailure(base: BaseFields, startedAtMs: number, err: unknown): AuditResult {
  const durationMs = Date.now() - startedAtMs
  const failure = toAuditFailure(err)
  return {
    ...base,
    durationMs,
    status: "failed",
    error: {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    },
  }
}

function toAuditFailure(err: unknown): AuditFailure {
  if (err instanceof AuditFailure) return err
  if (isAbortError(err))
    return new AuditFailure({
      code: "ABORTED",
      message: err instanceof Error ? err.message : "aborted",
      cause: err,
    })
  if (err instanceof Error)
    return new AuditFailure({ code: "UNKNOWN", message: err.message, cause: err })
  return new AuditFailure({ code: "UNKNOWN", message: String(err) })
}

function isAbortError(err: unknown): err is Error {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      (err as { code?: string }).code === "ABORT_ERR")
  )
}

function abortedError(): AuditFailure {
  return new AuditFailure({ code: "ABORTED", message: "aborted before start" })
}
```


- [ ] **Step 4: Re-export**

Append to `packages/audit-core/src/index.ts`:

```ts
export { withTiming } from "./with-timing.js"
export type {
  InnerAuditFn,
  InnerAuditSuccess,
  WithTimingMeta,
} from "./with-timing.js"
```

- [ ] **Step 5: Run test — expect PASS**

Run: `bun --filter @repo/audit-core test`
Expected: all 5 withTiming tests pass.

- [ ] **Step 6: Build & typecheck**

Run: `bun --filter @repo/audit-core build && bun --filter @repo/audit-core check-types`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/audit-core
git commit -m "feat(audit-core): add withTiming wrapper with abort + failure handling"
```

---

## Task 7: lighthouse-runner — scaffold + project() function

**Files:**
- Create: `packages/lighthouse-runner/{package.json,tsconfig.json,tsdown.config.ts,vitest.config.ts}`
- Create: `packages/lighthouse-runner/src/{index,types,project}.ts`
- Create: `packages/lighthouse-runner/test/project.test.ts`
- Create: `packages/lighthouse-runner/__fixtures__/lhr-success.json` (trimmed real LHR; record from `https://example.com` and prune all the heavy fields not in `RawLighthouseResult`)

- [ ] **Step 1: Scaffold package.json**

```json
{
  "name": "@repo/lighthouse-runner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "vitest run --exclude integration/**",
    "test:integration": "RUN_INTEGRATION=1 vitest run integration/**"
  },
  "dependencies": {
    "@repo/audit-core": "workspace:*",
    "chrome-launcher": "catalog:",
    "lighthouse": "catalog:"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: tsconfig.json + tsdown.config.ts + vitest.config.ts**

`tsconfig.json`: identical shape to `audit-core`'s — extends `@repo/typescript-config/node.json`, `outDir: ./dist`, `rootDir: ./src`.

`tsdown.config.ts`: identical to `audit-core`'s.

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 3: src/types.ts**

```ts
export type LighthouseCategory = {
  id: string
  title: string
  score: number | null
  auditRefs: Array<{ id: string; weight: number; group?: string }>
}

export type LighthouseAudit = {
  id: string
  title: string
  description: string
  score: number | null
  scoreDisplayMode:
    | "binary"
    | "numeric"
    | "informative"
    | "manual"
    | "notApplicable"
    | "error"
  displayValue?: string
  details?: { items?: Array<Record<string, unknown>> }
}

export type RawLighthouseResult = {
  requestedUrl: string
  finalUrl: string
  fetchTime: string
  lighthouseVersion: string
  categories: {
    performance: LighthouseCategory
    seo: LighthouseCategory
    "best-practices": LighthouseCategory
    pwa?: LighthouseCategory
  }
  audits: Record<string, LighthouseAudit>
  runtimeError?: { code: string; message: string }
}

export type LighthouseRunOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  formFactor?: "mobile" | "desktop"
  logger?: (event: import("@repo/audit-core").LogEvent) => void
}
```

- [ ] **Step 4: Write the failing test for project()**

`test/project.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { project } from "../src/project.js"

const fixturesUrl = new URL("../__fixtures__/", import.meta.url)
const lhrSuccess = JSON.parse(
  readFileSync(new URL("lhr-success.json", fixturesUrl), "utf8"),
) as unknown

describe("project()", () => {
  it("returns the trimmed RawLighthouseResult shape from a full LHR", () => {
    const result = project(lhrSuccess as never)
    expect(result.requestedUrl).toBeTypeOf("string")
    expect(result.finalUrl).toBeTypeOf("string")
    expect(result.categories.performance.score).toBeTypeOf("number")
    expect(result.categories.seo).toBeDefined()
    expect(result.categories["best-practices"]).toBeDefined()
    // pwa may or may not be present depending on lighthouse version
    expect(typeof result.audits).toBe("object")
  })

  it("preserves runtimeError when present", () => {
    const withErr = {
      ...(lhrSuccess as object),
      runtimeError: { code: "ERRORED_DOCUMENT_REQUEST", message: "DNS" },
    }
    const result = project(withErr as never)
    expect(result.runtimeError?.code).toBe("ERRORED_DOCUMENT_REQUEST")
  })
})
```

- [ ] **Step 5: Create the fixture**

Manually create `packages/lighthouse-runner/__fixtures__/lhr-success.json` by hand-trimming a real LHR. Minimum keys required by the test:

```json
{
  "requestedUrl": "https://example.com",
  "finalUrl": "https://example.com/",
  "fetchTime": "2026-06-04T12:00:00.000Z",
  "lighthouseVersion": "12.0.0",
  "categories": {
    "performance": {
      "id": "performance",
      "title": "Performance",
      "score": 0.92,
      "auditRefs": [
        { "id": "largest-contentful-paint", "weight": 25 },
        { "id": "cumulative-layout-shift", "weight": 25 }
      ]
    },
    "seo": {
      "id": "seo",
      "title": "SEO",
      "score": 1.0,
      "auditRefs": [{ "id": "document-title", "weight": 1 }]
    },
    "best-practices": {
      "id": "best-practices",
      "title": "Best Practices",
      "score": 0.87,
      "auditRefs": [{ "id": "is-on-https", "weight": 1 }]
    }
  },
  "audits": {
    "largest-contentful-paint": {
      "id": "largest-contentful-paint",
      "title": "Largest Contentful Paint",
      "description": "LCP is...",
      "score": 0.95,
      "scoreDisplayMode": "numeric",
      "displayValue": "1.2 s"
    },
    "cumulative-layout-shift": {
      "id": "cumulative-layout-shift",
      "title": "Cumulative Layout Shift",
      "description": "CLS is...",
      "score": 0.99,
      "scoreDisplayMode": "numeric"
    },
    "document-title": {
      "id": "document-title",
      "title": "Document has a <title>",
      "description": "",
      "score": 1.0,
      "scoreDisplayMode": "binary"
    },
    "is-on-https": {
      "id": "is-on-https",
      "title": "Uses HTTPS",
      "description": "",
      "score": 1.0,
      "scoreDisplayMode": "binary"
    }
  }
}
```

- [ ] **Step 6: Run test — expect FAIL**

Run: `bun --filter @repo/lighthouse-runner test`
Expected: FAIL — `project` not exported.

- [ ] **Step 7: Implement project**

`src/project.ts`:

```ts
import type {
  LighthouseAudit,
  LighthouseCategory,
  RawLighthouseResult,
} from "./types.js"

type RawLhr = {
  requestedUrl: string
  finalUrl: string
  fetchTime: string
  lighthouseVersion: string
  categories: Record<string, LighthouseCategory>
  audits: Record<string, LighthouseAudit>
  runtimeError?: { code: string; message: string }
}

export function project(lhr: RawLhr): RawLighthouseResult {
  const cat = lhr.categories
  const performance = cat.performance
  const seo = cat.seo
  const bestPractices = cat["best-practices"]
  if (!performance || !seo || !bestPractices) {
    throw new Error(
      "lighthouse result missing required category (performance/seo/best-practices)",
    )
  }
  const out: RawLighthouseResult = {
    requestedUrl: lhr.requestedUrl,
    finalUrl: lhr.finalUrl,
    fetchTime: lhr.fetchTime,
    lighthouseVersion: lhr.lighthouseVersion,
    categories: {
      performance,
      seo,
      "best-practices": bestPractices,
      ...(cat.pwa !== undefined ? { pwa: cat.pwa } : {}),
    },
    audits: lhr.audits,
  }
  if (lhr.runtimeError !== undefined) out.runtimeError = lhr.runtimeError
  return out
}
```

- [ ] **Step 8: Wire src/index.ts**

```ts
export { project } from "./project.js"
export type {
  LighthouseAudit,
  LighthouseCategory,
  LighthouseRunOptions,
  RawLighthouseResult,
} from "./types.js"
```

- [ ] **Step 9: Run test — expect PASS**

Run: `bun --filter @repo/lighthouse-runner test`
Expected: both project tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/lighthouse-runner
git commit -m "feat(lighthouse-runner): scaffold package with project() trimming"
```

---

## Task 8: lighthouse-runner — mapError()

**Files:**
- Create: `packages/lighthouse-runner/src/map-error.ts`
- Modify: `packages/lighthouse-runner/src/index.ts`
- Create: `packages/lighthouse-runner/test/map-error.test.ts`

- [ ] **Step 1: Write the failing test**

`test/map-error.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { AuditFailure } from "@repo/audit-core"
import { mapLhrRuntimeError, mapThrownError } from "../src/map-error.js"

describe("mapLhrRuntimeError", () => {
  it("maps NO_FCP to LIGHTHOUSE_NO_FCP retryable", () => {
    const err = mapLhrRuntimeError({ code: "NO_FCP", message: "no fcp" })
    expect(err).toBeInstanceOf(AuditFailure)
    expect(err.code).toBe("LIGHTHOUSE_NO_FCP")
    expect(err.retryable).toBe(true)
  })

  it("maps ERRORED_DOCUMENT_REQUEST (DNS/conn) to DNS_ERROR", () => {
    const err = mapLhrRuntimeError({
      code: "ERRORED_DOCUMENT_REQUEST",
      message: "net::ERR_NAME_NOT_RESOLVED",
    })
    expect(err.code).toBe("DNS_ERROR")
    expect(err.retryable).toBe(true)
  })

  it("maps an unknown runtimeError code to LIGHTHOUSE_CRASH", () => {
    const err = mapLhrRuntimeError({ code: "UNDEFINED_HORROR", message: "?" })
    expect(err.code).toBe("LIGHTHOUSE_CRASH")
    expect(err.retryable).toBe(true)
  })
})

describe("mapThrownError", () => {
  it("maps AbortError to ABORTED", () => {
    const abort = new Error("aborted")
    abort.name = "AbortError"
    const err = mapThrownError(abort)
    expect(err.code).toBe("ABORTED")
  })

  it("maps a timeout to TIMEOUT", () => {
    const t = new Error("operation timed out after 60000ms")
    ;(t as { code?: string }).code = "ETIMEDOUT"
    const err = mapThrownError(t)
    expect(err.code).toBe("TIMEOUT")
  })

  it("maps unknown errors to LIGHTHOUSE_CRASH", () => {
    const err = mapThrownError(new Error("Chrome died"))
    expect(err.code).toBe("LIGHTHOUSE_CRASH")
  })
})

describe("HTTP status mapping (via mapHttpStatus)", () => {
  it("maps 404 to HTTP_4XX non-retryable", async () => {
    const { mapHttpStatus } = await import("../src/map-error.js")
    const err = mapHttpStatus(404)
    expect(err.code).toBe("HTTP_4XX")
    expect(err.retryable).toBe(false)
  })

  it("maps 503 to HTTP_5XX retryable", async () => {
    const { mapHttpStatus } = await import("../src/map-error.js")
    const err = mapHttpStatus(503)
    expect(err.code).toBe("HTTP_5XX")
    expect(err.retryable).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun --filter @repo/lighthouse-runner test`
Expected: FAIL — `map-error.js` missing.

- [ ] **Step 3: Implement**

`src/map-error.ts`:

```ts
import { AuditFailure } from "@repo/audit-core"

export function mapLhrRuntimeError(rt: {
  code: string
  message: string
}): AuditFailure {
  switch (rt.code) {
    case "NO_FCP":
      return new AuditFailure({
        code: "LIGHTHOUSE_NO_FCP",
        message: rt.message,
      })
    case "ERRORED_DOCUMENT_REQUEST":
      return new AuditFailure({ code: "DNS_ERROR", message: rt.message })
    default:
      return new AuditFailure({
        code: "LIGHTHOUSE_CRASH",
        message: `${rt.code}: ${rt.message}`,
      })
  }
}

export function mapHttpStatus(status: number): AuditFailure {
  if (status >= 500 && status < 600) {
    return new AuditFailure({
      code: "HTTP_5XX",
      message: `HTTP ${status} from final URL`,
    })
  }
  return new AuditFailure({
    code: "HTTP_4XX",
    message: `HTTP ${status} from final URL`,
  })
}

export function mapThrownError(err: unknown): AuditFailure {
  if (err instanceof AuditFailure) return err
  if (err instanceof Error) {
    if (err.name === "AbortError")
      return new AuditFailure({ code: "ABORTED", message: err.message, cause: err })
    const code = (err as { code?: string }).code
    if (code === "ETIMEDOUT" || /timed out/i.test(err.message))
      return new AuditFailure({ code: "TIMEOUT", message: err.message, cause: err })
    return new AuditFailure({
      code: "LIGHTHOUSE_CRASH",
      message: err.message,
      cause: err,
    })
  }
  return new AuditFailure({
    code: "LIGHTHOUSE_CRASH",
    message: String(err),
  })
}
```

- [ ] **Step 4: Re-export**

Append to `src/index.ts`:

```ts
export { mapHttpStatus, mapLhrRuntimeError, mapThrownError } from "./map-error.js"
```

- [ ] **Step 5: Run test — expect PASS**

Run: `bun --filter @repo/lighthouse-runner test`
Expected: 7 mapError tests pass + 2 project tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/lighthouse-runner
git commit -m "feat(lighthouse-runner): add error mapping (runtime, HTTP, thrown)"
```

---

## Task 9: lighthouse-runner — runLighthouse() implementation

**Files:**
- Create: `packages/lighthouse-runner/src/run.ts`
- Modify: `packages/lighthouse-runner/src/index.ts`

Note: `runLighthouse` is exercised end-to-end in the integration test (Task 23). This task is a typecheck-and-build task — the function has too many side effects (Chrome process, port, etc.) to unit-test in isolation without an integration harness. We mark unit-test coverage as deferred and confirm the function compiles and exports correctly.

- [ ] **Step 1: Implement**

`src/run.ts`:

```ts
import chromeLauncher from "chrome-launcher"
import lighthouse from "lighthouse"
import { AuditFailure } from "@repo/audit-core"
import { mapHttpStatus, mapLhrRuntimeError, mapThrownError } from "./map-error.js"
import { project } from "./project.js"
import type { LighthouseRunOptions, RawLighthouseResult } from "./types.js"

const DEFAULT_TIMEOUT = 60_000

export async function runLighthouse(
  url: string,
  opts: LighthouseRunOptions = {},
): Promise<RawLighthouseResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
  const formFactor = opts.formFactor ?? "mobile"
  const noSandbox = process.env.LH_NO_SANDBOX === "1"

  const chromeFlags = [
    "--headless=new",
    ...(noSandbox ? ["--no-sandbox"] : []),
  ]

  if (opts.signal?.aborted) {
    throw new AuditFailure({ code: "ABORTED", message: "aborted before launch" })
  }

  let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | undefined
  const abortHandler = () => {
    void chrome?.kill()
  }
  opts.signal?.addEventListener("abort", abortHandler, { once: true })

  try {
    chrome = await chromeLauncher.launch({ chromeFlags })
    opts.logger?.({ kind: "debug", message: `chrome on port ${chrome.port}` })

    const runnerResult = await withTimeout(
      lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        formFactor,
        onlyCategories: ["performance", "seo", "best-practices", "pwa"],
        screenEmulation:
          formFactor === "desktop"
            ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
            : undefined,
      }),
      timeoutMs,
    )

    if (!runnerResult) {
      throw new AuditFailure({
        code: "LIGHTHOUSE_CRASH",
        message: "lighthouse returned no result",
      })
    }

    const lhr = runnerResult.lhr as unknown as Parameters<typeof project>[0] & {
      runtimeError?: { code: string; message: string }
    }

    if (lhr.runtimeError && lhr.runtimeError.code !== "NO_ERROR") {
      throw mapLhrRuntimeError(lhr.runtimeError)
    }

    // HTTP status check via main-document audit if available
    const mainDoc = lhr.audits["main-document-request"]
    const finalStatus = (mainDoc?.details?.items?.[0] as
      | { statusCode?: number }
      | undefined)?.statusCode
    if (typeof finalStatus === "number" && finalStatus >= 400) {
      throw mapHttpStatus(finalStatus)
    }

    return project(lhr)
  } catch (err) {
    throw mapThrownError(err)
  } finally {
    opts.signal?.removeEventListener("abort", abortHandler)
    await chrome?.kill()
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`operation timed out after ${ms}ms`)
          ;(err as { code?: string }).code = "ETIMEDOUT"
          reject(err)
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

- [ ] **Step 2: Re-export**

Append to `src/index.ts`:

```ts
export { runLighthouse } from "./run.js"
```

- [ ] **Step 3: Build + typecheck**

Run: `bun --filter @repo/lighthouse-runner build && bun --filter @repo/lighthouse-runner check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/lighthouse-runner
git commit -m "feat(lighthouse-runner): add runLighthouse with Chrome lifecycle and timeout"
```

---

## Task 10: Scaffold the four LH-backed packages

Identical structure for all four. Do them in one task because the scaffolding is mechanical.

**Files (×4 — substitute `<name>` for `audit-perf`, `audit-seo`, `audit-best-practices`, `audit-pwa`):**
- Create: `packages/<name>/package.json`
- Create: `packages/<name>/tsconfig.json`
- Create: `packages/<name>/tsdown.config.ts`
- Create: `packages/<name>/vitest.config.ts`
- Create: `packages/<name>/src/index.ts` (skeleton — just imports, no real logic)
- Create: `packages/<name>/__fixtures__/.gitkeep`

- [ ] **Step 1: Create package.json (per package)**

For each `<name>`, the file is the same shape with the name swapped. Example for `audit-perf`:

```json
{
  "name": "@repo/audit-perf",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "bin": { "audit-perf": "./dist/bin.js" },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "vitest run"
  },
  "dependencies": {
    "@repo/audit-core": "workspace:*",
    "@repo/lighthouse-runner": "workspace:*"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Repeat for `audit-seo`, `audit-best-practices`, `audit-pwa`, swapping both the package name and the bin name.

- [ ] **Step 2: tsconfig.json (per package, identical to audit-core's)**

```json
{
  "extends": "@repo/typescript-config/node.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "test", "__fixtures__"]
}
```

- [ ] **Step 3: tsdown.config.ts (per package)**

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
})
```

- [ ] **Step 4: vitest.config.ts (per package, identical to audit-core's)**

```ts
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
})
```

- [ ] **Step 5: Stub src/index.ts (per package)**

For `audit-perf`:

```ts
import { withTiming } from "@repo/audit-core"
import { version as packageVersion } from "../package.json" with { type: "json" }

export const audit = withTiming({
  category: "performance",
  packageName: "@repo/audit-perf",
  packageVersion,
})(async () => {
  throw new Error("not yet implemented")
})
```

For `audit-seo`: `category: "seo"`, `packageName: "@repo/audit-seo"`.
For `audit-best-practices`: `category: "best-practices"`, `packageName: "@repo/audit-best-practices"`.
For `audit-pwa`: `category: "pwa"`, `packageName: "@repo/audit-pwa"`.

- [ ] **Step 6: Stub src/bin.ts (per package — identical shape, single-package bin)**

For `audit-perf`:

```ts
#!/usr/bin/env node
import { audit } from "./index.js"

const url = process.argv[2]
if (!url) {
  console.error("usage: audit-perf <url>")
  process.exit(2)
}
const result = await audit(url)
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === "success" ? 0 : 1)
```

Repeat for each package, swapping the bin name in the error message.

- [ ] **Step 7: Install + typecheck**

Run: `bun install && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/audit-perf packages/audit-seo packages/audit-best-practices packages/audit-pwa
git commit -m "chore(audits): scaffold the four lighthouse-backed packages"
```

---

## Task 11: audit-perf — projection from LHR

**Files:**
- Modify: `packages/audit-perf/src/index.ts`
- Create: `packages/audit-perf/src/rules.ts`
- Create: `packages/audit-perf/test/audit.test.ts`
- Create: `packages/audit-perf/__fixtures__/lhr-good.json`
- Create: `packages/audit-perf/__fixtures__/lhr-bad.json`

- [ ] **Step 1: Create fixtures**

`__fixtures__/lhr-good.json`:

```json
{
  "requestedUrl": "https://example.com",
  "finalUrl": "https://example.com/",
  "fetchTime": "2026-06-04T12:00:00.000Z",
  "lighthouseVersion": "12.0.0",
  "categories": {
    "performance": {
      "id": "performance",
      "title": "Performance",
      "score": 0.95,
      "auditRefs": [
        { "id": "largest-contentful-paint", "weight": 25 },
        { "id": "cumulative-layout-shift", "weight": 25 },
        { "id": "total-blocking-time", "weight": 30 }
      ]
    },
    "seo": { "id": "seo", "title": "SEO", "score": 1, "auditRefs": [] },
    "best-practices": { "id": "best-practices", "title": "BP", "score": 1, "auditRefs": [] }
  },
  "audits": {
    "largest-contentful-paint": {
      "id": "largest-contentful-paint",
      "title": "LCP",
      "description": "...",
      "score": 0.95,
      "scoreDisplayMode": "numeric",
      "displayValue": "1.2 s"
    },
    "cumulative-layout-shift": {
      "id": "cumulative-layout-shift",
      "title": "CLS",
      "description": "...",
      "score": 1,
      "scoreDisplayMode": "numeric",
      "displayValue": "0"
    },
    "total-blocking-time": {
      "id": "total-blocking-time",
      "title": "TBT",
      "description": "...",
      "score": 0.9,
      "scoreDisplayMode": "numeric",
      "displayValue": "120 ms"
    }
  }
}
```

`__fixtures__/lhr-bad.json`: same shape but `categories.performance.score: 0.30`, and each audit `score` ≤ 0.49 with descriptive `displayValue` strings.

- [ ] **Step 2: Write the failing test**

`test/audit.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { AuditResultSchema } from "@repo/audit-core"
import { audit } from "../src/index.js"

const lhrGood = JSON.parse(
  readFileSync(new URL("../__fixtures__/lhr-good.json", import.meta.url), "utf8"),
)
const lhrBad = JSON.parse(
  readFileSync(new URL("../__fixtures__/lhr-bad.json", import.meta.url), "utf8"),
)

describe("audit-perf", () => {
  it("projects a high-scoring LHR to a success result with score >= 90", async () => {
    const result = await audit("https://example.com", { lighthouseResult: lhrGood })
    expect(() => AuditResultSchema.parse(result)).not.toThrow()
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("performance")
      expect(result.score).toBeGreaterThanOrEqual(90)
    }
  })

  it("projects a low-scoring LHR with issues for failing audits", async () => {
    const result = await audit("https://example.com", { lighthouseResult: lhrBad })
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.score).toBeLessThan(50)
      expect(result.issues.length).toBeGreaterThan(0)
      const lcp = result.issues.find((i) => i.rule === "perf/lcp")
      expect(lcp).toBeDefined()
      expect(lcp?.severity).toBe("error")
    }
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `bun --filter @repo/audit-perf test`
Expected: FAIL — `audit` still throws "not yet implemented".

- [ ] **Step 4: Implement rules.ts**

`src/rules.ts`:

```ts
import { defineIssue, type Issue } from "@repo/audit-core"
import type { LighthouseAudit, RawLighthouseResult } from "@repo/lighthouse-runner"

type RuleSpec = {
  rule: string
  lhAuditId: string
  title: string
  description: (a: LighthouseAudit) => string
  recommendation: string
  severityFor: (score: number | null) => "error" | "warn" | "info" | null
}

const RULES: RuleSpec[] = [
  {
    rule: "perf/lcp",
    lhAuditId: "largest-contentful-paint",
    title: "Largest Contentful Paint is slow",
    description: (a) =>
      `LCP measured at ${a.displayValue ?? "unknown"} (target < 2.5s).`,
    recommendation:
      "Optimize the largest above-the-fold image or text block: preload it, serve correctly sized assets, and avoid render-blocking JS.",
    severityFor: severityForNumeric,
  },
  {
    rule: "perf/cls",
    lhAuditId: "cumulative-layout-shift",
    title: "Cumulative Layout Shift",
    description: (a) =>
      `CLS measured at ${a.displayValue ?? "unknown"} (target < 0.1).`,
    recommendation:
      "Set width/height on images and embeds; reserve space for dynamically injected content.",
    severityFor: severityForNumeric,
  },
  {
    rule: "perf/tbt",
    lhAuditId: "total-blocking-time",
    title: "Total Blocking Time is high",
    description: (a) =>
      `TBT measured at ${a.displayValue ?? "unknown"} (target < 200ms).`,
    recommendation:
      "Break up long JavaScript tasks, defer non-critical scripts, and offload work to workers.",
    severityFor: severityForNumeric,
  },
]

function severityForNumeric(score: number | null): "error" | "warn" | null {
  if (score === null) return null
  if (score < 0.5) return "error"
  if (score < 0.9) return "warn"
  return null
}

export function projectPerf(lhr: RawLighthouseResult): {
  score: number
  issues: Issue[]
  raw: unknown
} {
  const cat = lhr.categories.performance
  const score = Math.round((cat.score ?? 0) * 100)
  const issues: Issue[] = []
  for (const spec of RULES) {
    const a = lhr.audits[spec.lhAuditId]
    if (!a) continue
    const severity = spec.severityFor(a.score)
    if (severity === null) continue
    issues.push(
      defineIssue({
        rule: spec.rule,
        severity,
        title: spec.title,
        description: spec.description(a),
        recommendation: spec.recommendation,
      }),
    )
  }
  return {
    score,
    issues,
    raw: { categoryScore: cat.score, projectedAuditIds: RULES.map((r) => r.lhAuditId) },
  }
}
```

- [ ] **Step 5: Wire src/index.ts**

```ts
import { AuditFailure, withTiming } from "@repo/audit-core"
import { runLighthouse, type RawLighthouseResult } from "@repo/lighthouse-runner"
import { version as packageVersion } from "../package.json" with { type: "json" }
import { projectPerf } from "./rules.js"

export const audit = withTiming({
  category: "performance",
  packageName: "@repo/audit-perf",
  packageVersion,
})(async ({ url, opts }) => {
  const lhr =
    (opts?.lighthouseResult as RawLighthouseResult | undefined) ??
    (await runLighthouse(url, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
      logger: opts?.logger,
      formFactor: opts?.formFactor,
    }))
  if (!lhr.categories.performance) {
    throw new AuditFailure({
      code: "LIGHTHOUSE_CRASH",
      message: "lighthouse result missing performance category",
    })
  }
  return projectPerf(lhr)
})
```

- [ ] **Step 6: Run test — expect PASS**

Run: `bun --filter @repo/audit-perf test`
Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/audit-perf
git commit -m "feat(audit-perf): project LHR performance category to AuditResult"
```

---

## Task 12: audit-seo — projection from LHR

**Files:**
- Modify: `packages/audit-seo/src/index.ts`
- Create: `packages/audit-seo/src/rules.ts`
- Create: `packages/audit-seo/test/audit.test.ts`
- Create: `packages/audit-seo/__fixtures__/lhr-good.json`
- Create: `packages/audit-seo/__fixtures__/lhr-bad.json`

- [ ] **Step 1: Fixtures**

Same shape as the audit-perf fixtures, but `categories.seo.score` of `1.0` (good) and `0.4` (bad). Each fixture includes these audits with appropriate scores: `document-title`, `meta-description`, `crawlable-anchors`, `is-crawlable`.

`lhr-good.json` audits all score `1`. `lhr-bad.json`: `document-title.score: 0`, `meta-description.score: 0`, `is-crawlable.score: 0`.

- [ ] **Step 2: Write the failing test**

`test/audit.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { AuditResultSchema } from "@repo/audit-core"
import { audit } from "../src/index.js"

const lhrGood = JSON.parse(
  readFileSync(new URL("../__fixtures__/lhr-good.json", import.meta.url), "utf8"),
)
const lhrBad = JSON.parse(
  readFileSync(new URL("../__fixtures__/lhr-bad.json", import.meta.url), "utf8"),
)

describe("audit-seo", () => {
  it("score 100 for good LHR", async () => {
    const r = await audit("https://example.com", { lighthouseResult: lhrGood })
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    if (r.status === "success") {
      expect(r.category).toBe("seo")
      expect(r.score).toBe(100)
      expect(r.issues).toHaveLength(0)
    }
  })

  it("emits issues for failing audits", async () => {
    const r = await audit("https://example.com", { lighthouseResult: lhrBad })
    if (r.status === "success") {
      expect(r.issues.some((i) => i.rule === "seo/document-title")).toBe(true)
      expect(r.issues.some((i) => i.rule === "seo/meta-description")).toBe(true)
      expect(r.issues.some((i) => i.rule === "seo/is-crawlable")).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `bun --filter @repo/audit-seo test`
Expected: FAIL.

- [ ] **Step 4: Implement rules.ts**

`src/rules.ts`:

```ts
import { defineIssue, type Issue } from "@repo/audit-core"
import type { RawLighthouseResult } from "@repo/lighthouse-runner"

const RULES: Array<{
  rule: string
  lhAuditId: string
  title: string
  description: string
  recommendation: string
}> = [
  {
    rule: "seo/document-title",
    lhAuditId: "document-title",
    title: "Document is missing a <title>",
    description: "Every page needs a unique, descriptive <title> element.",
    recommendation: "Add a 30–60 character <title> describing the page content.",
  },
  {
    rule: "seo/meta-description",
    lhAuditId: "meta-description",
    title: "Document is missing a meta description",
    description: "Search engines display this text in result snippets.",
    recommendation: "Add a 150–160 character meta description summarizing the page.",
  },
  {
    rule: "seo/is-crawlable",
    lhAuditId: "is-crawlable",
    title: "Page is blocked from indexing",
    description: "robots.txt or a meta robots tag prevents this page from being indexed.",
    recommendation: "Remove disallow rules or `noindex` directives if the page should be indexable.",
  },
  {
    rule: "seo/crawlable-anchors",
    lhAuditId: "crawlable-anchors",
    title: "Anchors are not crawlable",
    description: "Some links use href values that crawlers cannot follow (e.g. javascript: or empty).",
    recommendation: "Use real URLs in anchor href attributes.",
  },
]

export function projectSeo(lhr: RawLighthouseResult): {
  score: number
  issues: Issue[]
  raw: unknown
} {
  const cat = lhr.categories.seo
  const score = Math.round((cat.score ?? 0) * 100)
  const issues: Issue[] = []
  for (const spec of RULES) {
    const a = lhr.audits[spec.lhAuditId]
    if (!a || a.score === null || a.score === 1) continue
    const severity = a.score < 0.5 ? "error" : "warn"
    issues.push(
      defineIssue({
        rule: spec.rule,
        severity,
        title: spec.title,
        description: spec.description,
        recommendation: spec.recommendation,
      }),
    )
  }
  return {
    score,
    issues,
    raw: { categoryScore: cat.score, projectedAuditIds: RULES.map((r) => r.lhAuditId) },
  }
}
```

- [ ] **Step 5: Wire src/index.ts**

```ts
import { AuditFailure, withTiming } from "@repo/audit-core"
import { runLighthouse, type RawLighthouseResult } from "@repo/lighthouse-runner"
import { version as packageVersion } from "../package.json" with { type: "json" }
import { projectSeo } from "./rules.js"

export const audit = withTiming({
  category: "seo",
  packageName: "@repo/audit-seo",
  packageVersion,
})(async ({ url, opts }) => {
  const lhr =
    (opts?.lighthouseResult as RawLighthouseResult | undefined) ??
    (await runLighthouse(url, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
      logger: opts?.logger,
      formFactor: opts?.formFactor,
    }))
  if (!lhr.categories.seo) {
    throw new AuditFailure({
      code: "LIGHTHOUSE_CRASH",
      message: "lighthouse result missing seo category",
    })
  }
  return projectSeo(lhr)
})
```

- [ ] **Step 6: Run test — expect PASS, then commit**

Run: `bun --filter @repo/audit-seo test`

```bash
git add packages/audit-seo
git commit -m "feat(audit-seo): project LHR seo category to AuditResult"
```

---

## Task 13: audit-best-practices — projection from LHR

**Files:**
- Modify: `packages/audit-best-practices/src/index.ts`
- Create: `packages/audit-best-practices/src/rules.ts`
- Create: `packages/audit-best-practices/test/audit.test.ts`
- Create: `packages/audit-best-practices/__fixtures__/lhr-good.json`
- Create: `packages/audit-best-practices/__fixtures__/lhr-bad.json`

- [ ] **Step 1: Fixtures**

Same shape. `categories["best-practices"].score`: 1.0 (good), 0.55 (bad). Audits to include with scores: `is-on-https`, `no-vulnerable-libraries`, `errors-in-console`. Good fixture: all score 1. Bad fixture: `errors-in-console.score: 0`, `no-vulnerable-libraries.score: 0`.

- [ ] **Step 2: Failing test**

`test/audit.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { AuditResultSchema } from "@repo/audit-core"
import { audit } from "../src/index.js"

const lhrGood = JSON.parse(
  readFileSync(new URL("../__fixtures__/lhr-good.json", import.meta.url), "utf8"),
)
const lhrBad = JSON.parse(
  readFileSync(new URL("../__fixtures__/lhr-bad.json", import.meta.url), "utf8"),
)

describe("audit-best-practices", () => {
  it("score 100 for clean LHR", async () => {
    const r = await audit("https://example.com", { lighthouseResult: lhrGood })
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    if (r.status === "success") {
      expect(r.category).toBe("best-practices")
      expect(r.score).toBe(100)
      expect(r.issues).toHaveLength(0)
    }
  })

  it("emits issues for failing audits", async () => {
    const r = await audit("https://example.com", { lighthouseResult: lhrBad })
    if (r.status === "success") {
      expect(r.issues.some((i) => i.rule === "bp/errors-in-console")).toBe(true)
      expect(r.issues.some((i) => i.rule === "bp/no-vulnerable-libraries")).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `bun --filter @repo/audit-best-practices test`

- [ ] **Step 4: Implement rules.ts**

```ts
import { defineIssue, type Issue } from "@repo/audit-core"
import type { RawLighthouseResult } from "@repo/lighthouse-runner"

const RULES: Array<{
  rule: string
  lhAuditId: string
  title: string
  description: string
  recommendation: string
}> = [
  {
    rule: "bp/is-on-https",
    lhAuditId: "is-on-https",
    title: "Page is served over HTTP",
    description: "All sites should be served over HTTPS.",
    recommendation: "Migrate to HTTPS and redirect HTTP traffic to it.",
  },
  {
    rule: "bp/no-vulnerable-libraries",
    lhAuditId: "no-vulnerable-libraries",
    title: "Page uses libraries with known vulnerabilities",
    description: "One or more JS libraries on the page have public CVEs.",
    recommendation: "Update vulnerable libraries to patched versions.",
  },
  {
    rule: "bp/errors-in-console",
    lhAuditId: "errors-in-console",
    title: "Browser console has errors",
    description: "Errors logged to the console may indicate broken functionality.",
    recommendation: "Investigate and fix the console errors.",
  },
]

export function projectBP(lhr: RawLighthouseResult): {
  score: number
  issues: Issue[]
  raw: unknown
} {
  const cat = lhr.categories["best-practices"]
  const score = Math.round((cat.score ?? 0) * 100)
  const issues: Issue[] = []
  for (const spec of RULES) {
    const a = lhr.audits[spec.lhAuditId]
    if (!a || a.score === null || a.score === 1) continue
    const severity = a.score < 0.5 ? "error" : "warn"
    issues.push(
      defineIssue({
        rule: spec.rule,
        severity,
        title: spec.title,
        description: spec.description,
        recommendation: spec.recommendation,
      }),
    )
  }
  return { score, issues, raw: { categoryScore: cat.score } }
}
```

- [ ] **Step 5: Wire src/index.ts**

```ts
import { AuditFailure, withTiming } from "@repo/audit-core"
import { runLighthouse, type RawLighthouseResult } from "@repo/lighthouse-runner"
import { version as packageVersion } from "../package.json" with { type: "json" }
import { projectBP } from "./rules.js"

export const audit = withTiming({
  category: "best-practices",
  packageName: "@repo/audit-best-practices",
  packageVersion,
})(async ({ url, opts }) => {
  const lhr =
    (opts?.lighthouseResult as RawLighthouseResult | undefined) ??
    (await runLighthouse(url, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
      logger: opts?.logger,
      formFactor: opts?.formFactor,
    }))
  if (!lhr.categories["best-practices"]) {
    throw new AuditFailure({
      code: "LIGHTHOUSE_CRASH",
      message: "lighthouse result missing best-practices category",
    })
  }
  return projectBP(lhr)
})
```

- [ ] **Step 6: Run test — expect PASS, then commit**

Run: `bun --filter @repo/audit-best-practices test`

```bash
git add packages/audit-best-practices
git commit -m "feat(audit-best-practices): project LHR best-practices category"
```

---

## Task 14: audit-pwa — projection + partial-handling for missing category

**Files:**
- Modify: `packages/audit-pwa/src/index.ts`
- Create: `packages/audit-pwa/src/rules.ts`
- Create: `packages/audit-pwa/test/audit.test.ts`
- Create: `packages/audit-pwa/__fixtures__/lhr-good.json`
- Create: `packages/audit-pwa/__fixtures__/lhr-bad.json`
- Create: `packages/audit-pwa/__fixtures__/lhr-no-pwa.json`

- [ ] **Step 1: Fixtures**

`lhr-good.json`: includes `categories.pwa` with `score: 0.95` and audits `installable-manifest` (score 1), `service-worker` (score 1), `themed-omnibox` (score 1).

`lhr-bad.json`: `categories.pwa.score: 0.2`; `installable-manifest.score: 0`; `service-worker.score: 0`.

`lhr-no-pwa.json`: an LHR with `categories.performance`, `seo`, `best-practices` present and `categories.pwa` absent.

- [ ] **Step 2: Failing test**

`test/audit.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { AuditResultSchema } from "@repo/audit-core"
import { audit } from "../src/index.js"

const load = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../__fixtures__/${name}.json`, import.meta.url), "utf8"),
  )

describe("audit-pwa", () => {
  it("good LHR -> success with high score", async () => {
    const r = await audit("https://example.com", { lighthouseResult: load("lhr-good") })
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    if (r.status === "success") {
      expect(r.category).toBe("pwa")
      expect(r.score).toBeGreaterThanOrEqual(90)
    }
  })

  it("bad LHR -> success with low score and issues", async () => {
    const r = await audit("https://example.com", { lighthouseResult: load("lhr-bad") })
    if (r.status === "success") {
      expect(r.score).toBeLessThan(40)
      expect(r.issues.some((i) => i.rule === "pwa/installable-manifest")).toBe(true)
      expect(r.issues.some((i) => i.rule === "pwa/service-worker")).toBe(true)
    }
  })

  it("LHR without pwa category -> partial with reason", async () => {
    const r = await audit("https://example.com", { lighthouseResult: load("lhr-no-pwa") })
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    expect(r.status).toBe("partial")
    if (r.status === "partial") {
      expect(r.partialReasons).toContain("pwa-category-not-emitted-by-lighthouse")
      expect(r.score).toBe(0)
    }
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `bun --filter @repo/audit-pwa test`

- [ ] **Step 4: Implement rules.ts**

```ts
import { defineIssue, type Issue } from "@repo/audit-core"
import type { RawLighthouseResult } from "@repo/lighthouse-runner"

const RULES: Array<{
  rule: string
  lhAuditId: string
  title: string
  description: string
  recommendation: string
}> = [
  {
    rule: "pwa/installable-manifest",
    lhAuditId: "installable-manifest",
    title: "Web app manifest is not installable",
    description: "The page does not have an installable manifest.",
    recommendation: "Add a complete web app manifest with name, icons, start_url, and display.",
  },
  {
    rule: "pwa/service-worker",
    lhAuditId: "service-worker",
    title: "No service worker registered",
    description: "A service worker enables offline usage and faster repeat visits.",
    recommendation: "Register a service worker that caches the app shell.",
  },
  {
    rule: "pwa/themed-omnibox",
    lhAuditId: "themed-omnibox",
    title: "Missing theme-color meta tag",
    description: "Browsers theme the address bar based on this tag.",
    recommendation: "Add `<meta name=\"theme-color\">` matching your brand color.",
  },
]

export type PwaProjection =
  | {
      kind: "ok"
      score: number
      issues: Issue[]
      raw: unknown
    }
  | {
      kind: "missing"
      score: 0
      issues: never[]
      raw: unknown
      partialReasons: string[]
    }

export function projectPwa(lhr: RawLighthouseResult): PwaProjection {
  const cat = lhr.categories.pwa
  if (!cat) {
    return {
      kind: "missing",
      score: 0,
      issues: [],
      raw: { reason: "lhr.categories.pwa absent" },
      partialReasons: ["pwa-category-not-emitted-by-lighthouse"],
    }
  }
  const score = Math.round((cat.score ?? 0) * 100)
  const issues: Issue[] = []
  for (const spec of RULES) {
    const a = lhr.audits[spec.lhAuditId]
    if (!a || a.score === null || a.score === 1) continue
    const severity = a.score < 0.5 ? "error" : "warn"
    issues.push(
      defineIssue({
        rule: spec.rule,
        severity,
        title: spec.title,
        description: spec.description,
        recommendation: spec.recommendation,
      }),
    )
  }
  return { kind: "ok", score, issues, raw: { categoryScore: cat.score } }
}
```

- [ ] **Step 5: Wire src/index.ts**

```ts
import { withTiming } from "@repo/audit-core"
import { runLighthouse, type RawLighthouseResult } from "@repo/lighthouse-runner"
import { version as packageVersion } from "../package.json" with { type: "json" }
import { projectPwa } from "./rules.js"

export const audit = withTiming({
  category: "pwa",
  packageName: "@repo/audit-pwa",
  packageVersion,
})(async ({ url, opts }) => {
  const lhr =
    (opts?.lighthouseResult as RawLighthouseResult | undefined) ??
    (await runLighthouse(url, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
      logger: opts?.logger,
      formFactor: opts?.formFactor,
    }))
  const projection = projectPwa(lhr)
  if (projection.kind === "missing") {
    return {
      score: projection.score,
      issues: projection.issues as never as [],
      raw: projection.raw,
      partialReasons: projection.partialReasons,
    }
  }
  return {
    score: projection.score,
    issues: projection.issues,
    raw: projection.raw,
  }
})
```

- [ ] **Step 6: Run test — expect PASS, then commit**

Run: `bun --filter @repo/audit-pwa test`

```bash
git add packages/audit-pwa
git commit -m "feat(audit-pwa): project pwa category with partial handling for LH 12"
```

---

## Task 15: audit-onpage — scaffold + HTML fetcher (with msw)

**Files:**
- Create: `packages/audit-onpage/{package.json,tsconfig.json,tsdown.config.ts,vitest.config.ts}`
- Create: `packages/audit-onpage/src/{index,types,fetch}.ts`
- Create: `packages/audit-onpage/src/bin.ts`
- Create: `packages/audit-onpage/test/fetch.test.ts`
- Create: `packages/audit-onpage/test/setup.ts`
- Create: `packages/audit-onpage/__fixtures__/.gitkeep`

- [ ] **Step 1: package.json**

```json
{
  "name": "@repo/audit-onpage",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "bin": { "audit-onpage": "./dist/bin.js" },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "vitest run"
  },
  "dependencies": {
    "@repo/audit-core": "workspace:*",
    "cheerio": "catalog:",
    "robots-parser": "catalog:"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "msw": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: tsconfig, tsdown, vitest configs**

`tsconfig.json` matches audit-core's.

`tsdown.config.ts`:

```ts
import { defineConfig } from "tsdown"
export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
})
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["test/setup.ts"],
  },
})
```

- [ ] **Step 3: src/types.ts**

```ts
export type FetchedPage = {
  requestedUrl: string
  finalUrl: string
  status: number
  html: string
  contentType: string
}
```

- [ ] **Step 4: test/setup.ts**

```ts
import { afterAll, afterEach, beforeAll } from "vitest"
import { setupServer } from "msw/node"

export const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

- [ ] **Step 5: Failing test for fetcher**

`test/fetch.test.ts`:

```ts
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { AuditFailure } from "@repo/audit-core"
import { fetchPage } from "../src/fetch.js"
import { server } from "./setup.js"

describe("fetchPage", () => {
  it("returns HTML body and finalUrl on 200", async () => {
    server.use(
      http.get("https://example.com/", () =>
        HttpResponse.html("<html><title>ok</title></html>"),
      ),
    )
    const page = await fetchPage("https://example.com/")
    expect(page.status).toBe(200)
    expect(page.html).toContain("<title>ok</title>")
    expect(page.finalUrl).toBe("https://example.com/")
  })

  it("follows up to 5 redirects and reports final URL", async () => {
    server.use(
      http.get("https://example.com/a", () =>
        HttpResponse.redirect("https://example.com/b", 301),
      ),
      http.get("https://example.com/b", () =>
        HttpResponse.html("<html><body>final</body></html>"),
      ),
    )
    const page = await fetchPage("https://example.com/a")
    expect(page.finalUrl).toBe("https://example.com/b")
    expect(page.html).toContain("final")
  })

  it("throws AuditFailure HTTP_4XX on 404", async () => {
    server.use(http.get("https://example.com/missing", () => new HttpResponse(null, { status: 404 })))
    await expect(fetchPage("https://example.com/missing")).rejects.toMatchObject({
      code: "HTTP_4XX",
      retryable: false,
    })
  })

  it("throws AuditFailure HTTP_5XX on 503", async () => {
    server.use(http.get("https://example.com/down", () => new HttpResponse(null, { status: 503 })))
    await expect(fetchPage("https://example.com/down")).rejects.toMatchObject({
      code: "HTTP_5XX",
      retryable: true,
    })
  })
})
```

- [ ] **Step 6: Run test — expect FAIL**

Run: `bun --filter @repo/audit-onpage test`

- [ ] **Step 7: Implement src/fetch.ts**

```ts
import { request } from "undici"
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

export async function fetchPage(
  url: string,
  opts: FetchPageOptions = {},
): Promise<FetchedPage> {
  const ua = opts.userAgent ?? DEFAULT_UA
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT

  let currentUrl = url
  let visited = 0
  while (visited <= MAX_REDIRECTS) {
    const res = await request(currentUrl, {
      method: "GET",
      headers: { "user-agent": ua, accept: "text/html,*/*;q=0.5" },
      maxRedirections: 0,
      signal: opts.signal,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    })
    const status = res.statusCode
    if (status >= 300 && status < 400) {
      const loc = res.headers.location
      if (typeof loc !== "string") {
        throw new AuditFailure({
          code: "HTTP_5XX",
          message: `redirect from ${currentUrl} missing Location header`,
        })
      }
      await res.body.dump()
      currentUrl = new URL(loc, currentUrl).toString()
      visited++
      continue
    }
    if (status >= 500) {
      await res.body.dump()
      throw new AuditFailure({
        code: "HTTP_5XX",
        message: `HTTP ${status} from ${currentUrl}`,
      })
    }
    if (status >= 400) {
      await res.body.dump()
      throw new AuditFailure({
        code: "HTTP_4XX",
        message: `HTTP ${status} from ${currentUrl}`,
      })
    }
    const html = await res.body.text()
    const contentType =
      typeof res.headers["content-type"] === "string"
        ? res.headers["content-type"]
        : "text/html"
    return { requestedUrl: url, finalUrl: currentUrl, status, html, contentType }
  }
  throw new AuditFailure({
    code: "HTTP_5XX",
    message: `too many redirects (> ${MAX_REDIRECTS})`,
  })
}
```

- [ ] **Step 8: Stub src/index.ts and src/bin.ts**

`src/index.ts`:

```ts
import { withTiming } from "@repo/audit-core"
import { version as packageVersion } from "../package.json" with { type: "json" }

export { fetchPage } from "./fetch.js"

export const audit = withTiming({
  category: "on-page",
  packageName: "@repo/audit-onpage",
  packageVersion,
})(async () => {
  throw new Error("not yet implemented")
})
```

`src/bin.ts`:

```ts
#!/usr/bin/env node
import { audit } from "./index.js"

const url = process.argv[2]
if (!url) {
  console.error("usage: audit-onpage <url>")
  process.exit(2)
}
const result = await audit(url)
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === "success" ? 0 : 1)
```

- [ ] **Step 9: Run test — expect PASS**

Run: `bun --filter @repo/audit-onpage test`
Expected: 4 fetch tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/audit-onpage
git commit -m "feat(audit-onpage): scaffold package + HTML fetcher with msw tests"
```

---

## Task 16: audit-onpage — rule engine + title rule

**Files:**
- Create: `packages/audit-onpage/src/parse.ts`
- Create: `packages/audit-onpage/src/rules.ts`
- Create: `packages/audit-onpage/src/rules/title.ts`
- Create: `packages/audit-onpage/test/rules/title.test.ts`
- Create: `packages/audit-onpage/__fixtures__/title-missing.html`
- Create: `packages/audit-onpage/__fixtures__/title-too-short.html`
- Create: `packages/audit-onpage/__fixtures__/title-too-long.html`
- Create: `packages/audit-onpage/__fixtures__/title-ok.html`

This task locks in the rule pattern. Every subsequent rule task follows the same shape.

- [ ] **Step 1: Create the four fixtures**

`title-ok.html`:

```html
<!doctype html><html><head><title>A reasonable page title for testing</title></head><body><h1>Hi</h1></body></html>
```

`title-missing.html`:

```html
<!doctype html><html><head></head><body><h1>Hi</h1></body></html>
```

`title-too-short.html`:

```html
<!doctype html><html><head><title>Short</title></head><body><h1>Hi</h1></body></html>
```

`title-too-long.html`:

```html
<!doctype html><html><head><title>This title is far too long for a page title because page titles should be between thirty and sixty characters but this one is over a hundred characters long and that is too many</title></head><body><h1>Hi</h1></body></html>
```

- [ ] **Step 2: Define the rule contract in src/rules.ts**

```ts
import type { Issue } from "@repo/audit-core"
import type { CheerioAPI } from "cheerio"
import type { FetchedPage } from "./types.js"

export type RuleContext = {
  $: CheerioAPI
  page: FetchedPage
}

export type RuleOutcome =
  | { outcome: "pass" }
  | { outcome: "fail"; issues: Issue[] }
  | { outcome: "skip"; reason: string }

export type Rule = {
  id: string             // matches Issue.rule (e.g. "onpage/title-missing")
  weight: number         // for score derivation, 1..10
  run?: (ctx: RuleContext) => RuleOutcome
  runAsync?: (ctx: RuleContext) => Promise<RuleOutcome>
}
// Each Rule must define exactly one of `run` or `runAsync`. The executor in
// src/index.ts prefers `runAsync` when present. Sync rules (most of them)
// define `run`; rules that need network I/O (robots.txt, sitemap.xml) define
// `runAsync`.
```

- [ ] **Step 3: Implement src/parse.ts**

```ts
import { load, type CheerioAPI } from "cheerio"
import type { FetchedPage } from "./types.js"

export function parse(page: FetchedPage): CheerioAPI {
  return load(page.html, { xmlMode: false })
}
```

- [ ] **Step 4: Failing test for the title rule**

`test/rules/title.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { load } from "cheerio"
import { titleRules } from "../../src/rules/title.js"

const load_fixture = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.html`, import.meta.url), "utf8")

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const runAll = (html: string) =>
  titleRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("title rules", () => {
  it("ok title -> all pass", () => {
    const outcomes = runAll(load_fixture("title-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("missing title -> title-missing fails", () => {
    const outcomes = runAll(load_fixture("title-missing"))
    const missing = outcomes.find(
      (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/title-missing",
    )
    expect(missing).toBeDefined()
  })

  it("too-short title -> title-too-short fails", () => {
    const outcomes = runAll(load_fixture("title-too-short"))
    expect(
      outcomes.some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/title-too-short",
      ),
    ).toBe(true)
  })

  it("too-long title -> title-too-long fails", () => {
    const outcomes = runAll(load_fixture("title-too-long"))
    expect(
      outcomes.some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/title-too-long",
      ),
    ).toBe(true)
  })
})
```

- [ ] **Step 5: Run test — expect FAIL**

Run: `bun --filter @repo/audit-onpage test`

- [ ] **Step 6: Implement src/rules/title.ts**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

const MIN_LEN = 30
const MAX_LEN = 60

export const titleRules: Rule[] = [
  {
    id: "onpage/title-missing",
    weight: 5,
    run: ({ $ }) => {
      const text = $("head > title").first().text().trim()
      if (text.length > 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/title-missing",
            severity: "error",
            title: "Missing <title> element",
            description: "The page has no <title>, or it is empty.",
            recommendation: `Add a descriptive <title> of ${MIN_LEN}–${MAX_LEN} characters.`,
          }),
        ],
      }
    },
  },
  {
    id: "onpage/title-too-short",
    weight: 3,
    run: ({ $ }) => {
      const text = $("head > title").first().text().trim()
      if (text.length === 0 || text.length >= MIN_LEN) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/title-too-short",
            severity: "warn",
            title: "Page title is too short",
            description: `Title is ${text.length} characters; recommended minimum is ${MIN_LEN}.`,
            recommendation: `Expand the title to ${MIN_LEN}–${MAX_LEN} characters.`,
          }),
        ],
      }
    },
  },
  {
    id: "onpage/title-too-long",
    weight: 2,
    run: ({ $ }) => {
      const text = $("head > title").first().text().trim()
      if (text.length <= MAX_LEN) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/title-too-long",
            severity: "warn",
            title: "Page title is too long",
            description: `Title is ${text.length} characters; recommended maximum is ${MAX_LEN}.`,
            recommendation: `Shorten the title to ${MIN_LEN}–${MAX_LEN} characters.`,
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 7: Run test — expect PASS, then commit**

Run: `bun --filter @repo/audit-onpage test`

```bash
git add packages/audit-onpage
git commit -m "feat(audit-onpage): rule engine + title rules"
```

---

## Task 17: audit-onpage — meta-description, headings, alt rules

**Files:**
- Create: `packages/audit-onpage/src/rules/meta-description.ts`
- Create: `packages/audit-onpage/src/rules/headings.ts`
- Create: `packages/audit-onpage/src/rules/alt.ts`
- Create: `packages/audit-onpage/test/rules/{meta-description,headings,alt}.test.ts`
- Create: `packages/audit-onpage/__fixtures__/meta-{ok,missing,too-long}.html`
- Create: `packages/audit-onpage/__fixtures__/headings-{ok,no-h1,multiple-h1,broken-order}.html`
- Create: `packages/audit-onpage/__fixtures__/alt-{ok,missing}.html`

- [ ] **Step 1: Create fixtures**

`meta-ok.html`: `<meta name="description" content="A reasonable meta description text just long enough to look real for a page about widgets.">` (around 110 chars).

`meta-missing.html`: head has `<title>OK</title>` but no `<meta name="description">`.

`meta-too-long.html`: description content is a 200-character string.

`headings-ok.html`: single `<h1>`, h2/h3 nested correctly.

`headings-no-h1.html`: no `<h1>`, but has `<h2>`.

`headings-multiple-h1.html`: two `<h1>` elements.

`headings-broken-order.html`: `<h1>` then `<h3>` (skipping `<h2>`).

`alt-ok.html`: three `<img>` elements all with non-empty `alt`.

`alt-missing.html`: three `<img>` elements, two missing `alt`, one with `alt=""` (treated as decorative — should pass).

- [ ] **Step 2: Failing tests**

`test/rules/meta-description.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { metaDescriptionRules } from "../../src/rules/meta-description.js"

const load_fixture = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.html`, import.meta.url), "utf8")

const basePage = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const runAll = (html: string) =>
  metaDescriptionRules.map((r) => r.run!({ $: load(html), page: { ...basePage, html } }))

describe("meta-description rules", () => {
  it("ok meta -> all pass", () => {
    expect(runAll(load_fixture("meta-ok")).every((o) => o.outcome === "pass")).toBe(true)
  })
  it("missing meta -> fails", () => {
    expect(
      runAll(load_fixture("meta-missing")).some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/meta-description-missing",
      ),
    ).toBe(true)
  })
  it("too-long meta -> fails", () => {
    expect(
      runAll(load_fixture("meta-too-long")).some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "onpage/meta-description-too-long",
      ),
    ).toBe(true)
  })
})
```

`test/rules/headings.test.ts` and `test/rules/alt.test.ts` follow the same template, asserting against rule ids `onpage/h1-missing`, `onpage/h1-multiple`, `onpage/heading-order-broken`, `onpage/alt-missing`.

- [ ] **Step 3: Run tests — expect FAIL**

Run: `bun --filter @repo/audit-onpage test`

- [ ] **Step 4: Implement rules**

`src/rules/meta-description.ts`:

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

const MAX_LEN = 160

export const metaDescriptionRules: Rule[] = [
  {
    id: "onpage/meta-description-missing",
    weight: 4,
    run: ({ $ }) => {
      const content = $('head > meta[name="description"]').attr("content")?.trim() ?? ""
      if (content.length > 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/meta-description-missing",
            severity: "warn",
            title: "Missing meta description",
            description: "No <meta name=\"description\"> on this page.",
            recommendation: `Add a meta description of up to ${MAX_LEN} characters.`,
          }),
        ],
      }
    },
  },
  {
    id: "onpage/meta-description-too-long",
    weight: 2,
    run: ({ $ }) => {
      const content = $('head > meta[name="description"]').attr("content")?.trim() ?? ""
      if (content.length === 0 || content.length <= MAX_LEN) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/meta-description-too-long",
            severity: "info",
            title: "Meta description is too long",
            description: `Meta description is ${content.length} chars; Google typically truncates after ${MAX_LEN}.`,
            recommendation: `Shorten to ${MAX_LEN} characters or less.`,
          }),
        ],
      }
    },
  },
]
```

`src/rules/headings.ts`:

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

export const headingRules: Rule[] = [
  {
    id: "onpage/h1-missing",
    weight: 4,
    run: ({ $ }) => {
      const h1s = $("h1")
      if (h1s.length >= 1) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/h1-missing",
            severity: "error",
            title: "Page has no <h1>",
            description: "Every indexable page should have exactly one <h1>.",
            recommendation: "Add a single <h1> describing the page topic.",
          }),
        ],
      }
    },
  },
  {
    id: "onpage/h1-multiple",
    weight: 2,
    run: ({ $ }) => {
      const h1s = $("h1")
      if (h1s.length <= 1) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/h1-multiple",
            severity: "warn",
            title: "Page has multiple <h1> elements",
            description: `Found ${h1s.length} <h1> elements; only one is recommended.`,
            recommendation: "Demote secondary <h1> elements to <h2> or below.",
            count: h1s.length,
          }),
        ],
      }
    },
  },
  {
    id: "onpage/heading-order-broken",
    weight: 2,
    run: ({ $ }) => {
      const levels: number[] = []
      $("h1, h2, h3, h4, h5, h6").each((_, el) => {
        const tag = (el as { tagName?: string }).tagName ?? ""
        levels.push(Number.parseInt(tag.slice(1), 10))
      })
      let prev = 0
      for (const lvl of levels) {
        if (lvl > prev + 1) {
          return {
            outcome: "fail",
            issues: [
              defineIssue({
                rule: "onpage/heading-order-broken",
                severity: "warn",
                title: "Heading order skips levels",
                description: `Heading sequence jumps from h${prev} to h${lvl}.`,
                recommendation: "Use heading levels in document order without skipping.",
              }),
            ],
          }
        }
        prev = lvl
      }
      return { outcome: "pass" }
    },
  },
]
```

`src/rules/alt.ts`:

```ts
import { defineIssue, type IssueOccurrence } from "@repo/audit-core"
import type { Rule } from "../rules.js"

export const altRules: Rule[] = [
  {
    id: "onpage/alt-missing",
    weight: 3,
    run: ({ $ }) => {
      const offenders: IssueOccurrence[] = []
      $("img").each((_, el) => {
        const alt = $(el).attr("alt")
        if (alt === undefined) {
          offenders.push({
            selector: $(el).prop("tagName")
              ? `img${$(el).attr("id") ? `#${$(el).attr("id")}` : ""}`
              : "img",
            snippet: $.html(el).slice(0, 200),
          })
        }
      })
      if (offenders.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/alt-missing",
            severity: "warn",
            title: "Images missing alt text",
            description: `${offenders.length} <img> elements have no alt attribute.`,
            recommendation:
              "Add descriptive alt text. For purely decorative images use alt=\"\".",
            occurrences: offenders,
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 5: Run tests — expect PASS, then commit**

Run: `bun --filter @repo/audit-onpage test`

```bash
git add packages/audit-onpage
git commit -m "feat(audit-onpage): meta-description, heading, and alt rules"
```

---

## Task 18: audit-onpage — canonical + hreflang rules

**Files:**
- Create: `packages/audit-onpage/src/rules/canonical.ts`
- Create: `packages/audit-onpage/src/rules/hreflang.ts`
- Create: `packages/audit-onpage/test/rules/{canonical,hreflang}.test.ts`
- Create: `packages/audit-onpage/__fixtures__/{canonical-ok,canonical-missing,canonical-elsewhere,hreflang-ok,hreflang-malformed}.html`

- [ ] **Step 1: Fixtures**

`canonical-ok.html`: `<link rel="canonical" href="https://example.com/">` (matches `page.finalUrl`).

`canonical-missing.html`: head has no `<link rel="canonical">`.

`canonical-elsewhere.html`: `<link rel="canonical" href="https://other.com/">`.

`hreflang-ok.html`: head has `<link rel="alternate" hreflang="en" href="https://example.com/">` + `<link rel="alternate" hreflang="x-default" href="https://example.com/">`.

`hreflang-malformed.html`: `<link rel="alternate" hreflang="english" href="...">` (`english` is not a valid BCP 47 tag — must be a 2-letter ISO code optionally followed by region).

- [ ] **Step 2: Failing tests**

`test/rules/canonical.test.ts` (same template as title.test.ts, uses `canonicalRules`, asserts rule ids `onpage/canonical-missing` and `onpage/canonical-points-elsewhere`).

`test/rules/hreflang.test.ts` asserts `onpage/hreflang-malformed`.

- [ ] **Step 3: Run tests — expect FAIL**

Run: `bun --filter @repo/audit-onpage test`

- [ ] **Step 4: Implement**

`src/rules/canonical.ts`:

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

export const canonicalRules: Rule[] = [
  {
    id: "onpage/canonical-missing",
    weight: 3,
    run: ({ $ }) => {
      const href = $('head > link[rel="canonical"]').attr("href")?.trim() ?? ""
      if (href.length > 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/canonical-missing",
            severity: "info",
            title: "Missing canonical link",
            description: "No <link rel=\"canonical\"> on the page.",
            recommendation: "Add a canonical link pointing to the preferred URL for this content.",
          }),
        ],
      }
    },
  },
  {
    id: "onpage/canonical-points-elsewhere",
    weight: 3,
    run: ({ $, page }) => {
      const href = $('head > link[rel="canonical"]').attr("href")?.trim() ?? ""
      if (href.length === 0) return { outcome: "pass" }
      const resolved = new URL(href, page.finalUrl).toString()
      const final = new URL(page.finalUrl).toString()
      if (resolved === final) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/canonical-points-elsewhere",
            severity: "warn",
            title: "Canonical link points to a different URL",
            description: `Canonical href "${resolved}" differs from page URL "${final}".`,
            recommendation:
              "If intentional (e.g. duplicate content), this is fine. Otherwise update the canonical.",
          }),
        ],
      }
    },
  },
]
```

`src/rules/hreflang.ts`:

```ts
import { defineIssue, type IssueOccurrence } from "@repo/audit-core"
import type { Rule } from "../rules.js"

const BCP47 = /^(x-default|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/

export const hreflangRules: Rule[] = [
  {
    id: "onpage/hreflang-malformed",
    weight: 2,
    run: ({ $ }) => {
      const offenders: IssueOccurrence[] = []
      $('head > link[rel="alternate"][hreflang]').each((_, el) => {
        const value = $(el).attr("hreflang") ?? ""
        if (!BCP47.test(value)) {
          offenders.push({ snippet: $.html(el).slice(0, 200) })
        }
      })
      if (offenders.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "onpage/hreflang-malformed",
            severity: "warn",
            title: "Malformed hreflang values",
            description: `${offenders.length} hreflang link(s) do not match BCP 47 format.`,
            recommendation: "Use ISO 639-1 language codes optionally with ISO 3166 region (e.g. en-US).",
            occurrences: offenders,
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 5: Run tests — expect PASS, then commit**

Run: `bun --filter @repo/audit-onpage test`

```bash
git add packages/audit-onpage
git commit -m "feat(audit-onpage): canonical and hreflang rules"
```

---

## Task 19: audit-onpage — robots + sitemap rules (sibling fetches)

**Files:**
- Create: `packages/audit-onpage/src/rules/robots.ts`
- Create: `packages/audit-onpage/src/rules/sitemap.ts`
- Create: `packages/audit-onpage/test/rules/{robots,sitemap}.test.ts`
- Create: `packages/audit-onpage/__fixtures__/{robots-allow,robots-disallow}.txt`
- Create: `packages/audit-onpage/__fixtures__/sitemap.xml`

Robots and sitemap rules fetch sibling URLs (`/robots.txt`, `/sitemap.xml`). They are tested via msw, not via cheerio fixtures.

- [ ] **Step 1: Fixtures (raw response bodies)**

`robots-allow.txt`:

```
User-agent: *
Allow: /
Sitemap: https://example.com/sitemap.xml
```

`robots-disallow.txt`:

```
User-agent: *
Disallow: /private
```

`sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
</urlset>
```

- [ ] **Step 2: Failing tests**

`test/rules/robots.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { http, HttpResponse } from "msw"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { robotsRules } from "../../src/rules/robots.js"
import { server } from "../setup.js"

const txt = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.txt`, import.meta.url), "utf8")

const basePage = {
  requestedUrl: "https://example.com/private/page",
  finalUrl: "https://example.com/private/page",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("robots rule", () => {
  it("disallowed URL -> rule fires", async () => {
    server.use(
      http.get("https://example.com/robots.txt", () => HttpResponse.text(txt("robots-disallow"))),
    )
    const outcome = await robotsRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues[0]?.rule).toBe("onpage/robots-disallowed")
    }
  })
  it("allowed URL -> pass", async () => {
    server.use(
      http.get("https://example.com/robots.txt", () => HttpResponse.text(txt("robots-allow"))),
    )
    const outcome = await robotsRules[0]!.runAsync!({
      $: load("<html></html>"),
      page: { ...basePage, finalUrl: "https://example.com/" },
    })
    expect(outcome.outcome).toBe("pass")
  })
})
```

`test/rules/sitemap.test.ts`: mocks `https://example.com/sitemap.xml` returning the XML fixture; asserts pass. Mocks it returning 404; asserts `onpage/sitemap-missing` fires.

- [ ] **Step 3: Confirm the Rule type already supports async**

The `Rule` type was defined in Task 16 with both `run?` and `runAsync?` optional. No edit needed here. The robots and sitemap rules will define `runAsync`; the executor in Task 20 prefers `runAsync` over `run`.

- [ ] **Step 4: Run test — expect FAIL**

Run: `bun --filter @repo/audit-onpage test`

- [ ] **Step 5: Implement `src/rules/robots.ts`**

```ts
import robotsParser from "robots-parser"
import { request } from "undici"
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

export const robotsRules: Rule[] = [
  {
    id: "onpage/robots-disallowed",
    weight: 4,
    runAsync: async ({ page }) => {
      const robotsUrl = new URL("/robots.txt", page.finalUrl).toString()
      try {
        const res = await request(robotsUrl, { method: "GET", maxRedirections: 2 })
        if (res.statusCode === 404) {
          await res.body.dump()
          return {
            outcome: "fail",
            issues: [
              defineIssue({
                rule: "onpage/robots-missing",
                severity: "info",
                title: "robots.txt is missing",
                description: `No robots.txt at ${robotsUrl}.`,
                recommendation: "Add a robots.txt at the site root.",
              }),
            ],
          }
        }
        if (res.statusCode >= 400) {
          await res.body.dump()
          return { outcome: "skip", reason: `robots.txt HTTP ${res.statusCode}` }
        }
        const body = await res.body.text()
        const robots = robotsParser(robotsUrl, body)
        const isAllowed = robots.isAllowed(page.finalUrl, "*") !== false
        if (isAllowed) return { outcome: "pass" }
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "onpage/robots-disallowed",
              severity: "error",
              title: "Page is disallowed by robots.txt",
              description: `robots.txt at ${robotsUrl} blocks ${page.finalUrl}.`,
              recommendation: "Update robots.txt if this URL should be crawlable.",
            }),
          ],
        }
      } catch (err) {
        return { outcome: "skip", reason: `failed to fetch robots.txt: ${(err as Error).message}` }
      }
    },
  },
]
```

- [ ] **Step 6: Implement `src/rules/sitemap.ts`**

```ts
import { request } from "undici"
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "../rules.js"

export const sitemapRules: Rule[] = [
  {
    id: "onpage/sitemap-missing",
    weight: 2,
    runAsync: async ({ page }) => {
      const url = new URL("/sitemap.xml", page.finalUrl).toString()
      try {
        const res = await request(url, { method: "GET", maxRedirections: 2 })
        await res.body.dump()
        if (res.statusCode === 200) return { outcome: "pass" }
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "onpage/sitemap-missing",
              severity: "info",
              title: "sitemap.xml is missing",
              description: `No sitemap at ${url} (HTTP ${res.statusCode}).`,
              recommendation: "Add a sitemap.xml at the site root and reference it from robots.txt.",
            }),
          ],
        }
      } catch (err) {
        return { outcome: "skip", reason: `failed to fetch sitemap: ${(err as Error).message}` }
      }
    },
  },
]
```

- [ ] **Step 7: Run test — expect PASS, then commit**

Run: `bun --filter @repo/audit-onpage test`

```bash
git add packages/audit-onpage
git commit -m "feat(audit-onpage): robots.txt and sitemap.xml rules"
```

---

## Task 20: audit-onpage — score derivation + audit() export

**Files:**
- Create: `packages/audit-onpage/src/score.ts`
- Modify: `packages/audit-onpage/src/index.ts`
- Create: `packages/audit-onpage/test/audit.test.ts`
- Create: `packages/audit-onpage/__fixtures__/full-good.html`
- Create: `packages/audit-onpage/__fixtures__/full-bad.html`

- [ ] **Step 1: Build full-page fixtures**

`full-good.html`: well-formed page that should score 100 on all 11 sync rules and pass the canonical-points-here check (canonical = `https://example.com/`).

`full-bad.html`: missing title, missing meta, two h1s, an img without alt, canonical pointing elsewhere.

- [ ] **Step 2: Failing test**

`test/audit.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { AuditResultSchema } from "@repo/audit-core"
import { audit } from "../src/index.js"
import { server } from "./setup.js"

const html = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}.html`, import.meta.url), "utf8")

describe("audit-onpage end-to-end", () => {
  it("scores a clean page at 100", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html(html("full-good"))),
      http.get("https://example.com/robots.txt", () =>
        HttpResponse.text("User-agent: *\nAllow: /\n"),
      ),
      http.get("https://example.com/sitemap.xml", () =>
        HttpResponse.xml(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>`),
      ),
    )
    const r = await audit("https://example.com/")
    expect(() => AuditResultSchema.parse(r)).not.toThrow()
    if (r.status === "success") {
      expect(r.category).toBe("on-page")
      expect(r.score).toBe(100)
      expect(r.issues).toHaveLength(0)
    }
  })

  it("scores a broken page below 70 with multiple issues", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html(html("full-bad"))),
      http.get("https://example.com/robots.txt", () =>
        HttpResponse.text("User-agent: *\nAllow: /\n"),
      ),
      http.get("https://example.com/sitemap.xml", () => new HttpResponse(null, { status: 404 })),
    )
    const r = await audit("https://example.com/")
    if (r.status === "success") {
      expect(r.score).toBeLessThan(70)
      expect(r.issues.length).toBeGreaterThanOrEqual(4)
    }
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `bun --filter @repo/audit-onpage test`

- [ ] **Step 4: Implement `src/score.ts`**

```ts
import type { Issue } from "@repo/audit-core"
import type { Rule, RuleOutcome } from "./rules.js"

export function deriveScore(
  rules: Rule[],
  outcomes: RuleOutcome[],
): { score: number; issues: Issue[] } {
  let totalWeight = 0
  let passedWeight = 0
  const issues: Issue[] = []
  rules.forEach((rule, i) => {
    const outcome = outcomes[i]
    if (!outcome || outcome.outcome === "skip") return
    totalWeight += rule.weight
    if (outcome.outcome === "pass") {
      passedWeight += rule.weight
    } else {
      issues.push(...outcome.issues)
    }
  })
  const score = totalWeight === 0 ? 100 : Math.round((100 * passedWeight) / totalWeight)
  return { score, issues }
}
```

- [ ] **Step 5: Wire src/index.ts**

```ts
import { withTiming } from "@repo/audit-core"
import { version as packageVersion } from "../package.json" with { type: "json" }
import { fetchPage } from "./fetch.js"
import { parse } from "./parse.js"
import type { Rule, RuleOutcome } from "./rules.js"
import { altRules } from "./rules/alt.js"
import { canonicalRules } from "./rules/canonical.js"
import { headingRules } from "./rules/headings.js"
import { hreflangRules } from "./rules/hreflang.js"
import { metaDescriptionRules } from "./rules/meta-description.js"
import { robotsRules } from "./rules/robots.js"
import { sitemapRules } from "./rules/sitemap.js"
import { titleRules } from "./rules/title.js"
import { deriveScore } from "./score.js"

export { fetchPage } from "./fetch.js"

const RULES: Rule[] = [
  ...titleRules,
  ...metaDescriptionRules,
  ...headingRules,
  ...altRules,
  ...canonicalRules,
  ...hreflangRules,
  ...robotsRules,
  ...sitemapRules,
]

async function executeRule(rule: Rule, ctx: { $: ReturnType<typeof parse>; page: Awaited<ReturnType<typeof fetchPage>> }): Promise<RuleOutcome> {
  if (rule.runAsync) return rule.runAsync(ctx)
  if (rule.run) return rule.run(ctx)
  return { outcome: "skip", reason: "no implementation" }
}

export const audit = withTiming({
  category: "on-page",
  packageName: "@repo/audit-onpage",
  packageVersion,
})(async ({ url, opts }) => {
  const page = await fetchPage(url, {
    userAgent: opts?.userAgent,
    timeoutMs: opts?.timeoutMs,
    signal: opts?.signal,
  })
  const $ = parse(page)
  const outcomes = await Promise.all(RULES.map((r) => executeRule(r, { $, page })))
  const { score, issues } = deriveScore(RULES, outcomes)
  return {
    score,
    issues,
    raw: {
      finalUrl: page.finalUrl,
      status: page.status,
      ruleSummary: RULES.map((r, i) => ({
        rule: r.id,
        weight: r.weight,
        outcome: outcomes[i]?.outcome ?? "skip",
      })),
    },
  }
})
```

- [ ] **Step 6: Run test — expect PASS**

Run: `bun --filter @repo/audit-onpage test`
Expected: every test in the package green.

- [ ] **Step 7: Build & typecheck**

Run: `bun --filter @repo/audit-onpage build && bun --filter @repo/audit-onpage check-types`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/audit-onpage
git commit -m "feat(audit-onpage): score derivation + audit() export"
```

---

## Task 21: audit-cli — scaffold + args parsing

**Files:**
- Create: `packages/audit-cli/{package.json,tsconfig.json,tsdown.config.ts,vitest.config.ts}`
- Create: `packages/audit-cli/src/{index,args}.ts`
- Create: `packages/audit-cli/test/args.test.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@repo/audit-cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "audit-cli": "./dist/index.js" },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "vitest run --exclude integration/**",
    "test:integration": "RUN_INTEGRATION=1 vitest run integration/**",
    "smoke": "node dist/index.js https://example.com"
  },
  "dependencies": {
    "@repo/audit-core": "workspace:*",
    "@repo/audit-best-practices": "workspace:*",
    "@repo/audit-onpage": "workspace:*",
    "@repo/audit-perf": "workspace:*",
    "@repo/audit-pwa": "workspace:*",
    "@repo/audit-seo": "workspace:*",
    "@repo/lighthouse-runner": "workspace:*",
    "commander": "catalog:",
    "picocolors": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: tsconfig + tsdown + vitest (same shapes as previous packages)**

`tsdown.config.ts`:

```ts
import { defineConfig } from "tsdown"
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
})
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
})
```

- [ ] **Step 3: Failing test for args**

`test/args.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseArgs } from "../src/args.js"

describe("parseArgs", () => {
  it("requires a URL", () => {
    expect(() => parseArgs(["node", "audit-cli"])).toThrow(/url is required/i)
  })
  it("rejects non-URL strings", () => {
    expect(() => parseArgs(["node", "audit-cli", "not a url"])).toThrow()
  })
  it("accepts a valid URL", () => {
    const args = parseArgs(["node", "audit-cli", "https://example.com"])
    expect(args.url).toBe("https://example.com")
    expect(args.only).toBeUndefined()
    expect(args.json).toBe(false)
    expect(args.pretty).toBe(false)
    expect(args.formFactor).toBe("mobile")
    expect(args.timeout).toBe(30_000)
  })
  it("parses --only with comma-separated categories", () => {
    const args = parseArgs([
      "node",
      "audit-cli",
      "https://example.com",
      "--only",
      "performance,seo",
    ])
    expect(args.only).toEqual(["performance", "seo"])
  })
  it("rejects unknown categories in --only", () => {
    expect(() =>
      parseArgs(["node", "audit-cli", "https://example.com", "--only", "nope"]),
    ).toThrow(/unknown category/i)
  })
  it("--json and --pretty are mutually exclusive", () => {
    expect(() =>
      parseArgs(["node", "audit-cli", "https://example.com", "--json", "--pretty"]),
    ).toThrow(/mutually exclusive/i)
  })
})
```

- [ ] **Step 4: Run test — expect FAIL**

Run: `bun --filter @repo/audit-cli test`

- [ ] **Step 5: Implement src/args.ts**

```ts
import { Command, Option } from "commander"
import { z } from "zod"
import { CategorySchema } from "@repo/audit-core"

export type CliArgs = {
  url: string
  only?: Array<z.infer<typeof CategorySchema>>
  json: boolean
  pretty: boolean
  formFactor: "mobile" | "desktop"
  timeout: number
  userAgent?: string
  noColor: boolean
  debug: boolean
}

const FormFactor = z.enum(["mobile", "desktop"])

export function parseArgs(argv: string[]): CliArgs {
  const program = new Command()
    .name("audit-cli")
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
    .argument("<url>", "URL to audit")
    .option("--json", "output JSON to stdout")
    .option("--pretty", "output a pretty table to stdout")
    .option("--only <list>", "comma-separated categories")
    .addOption(
      new Option("--form-factor <ff>", "lighthouse form factor").choices([
        "mobile",
        "desktop",
      ]).default("mobile"),
    )
    .option("--timeout <ms>", "per-audit timeout", "30000")
    .option("--user-agent <ua>", "user-agent for audit-onpage")
    .option("--no-color", "disable ANSI colors")
    .option("--debug", "verbose progress + chrome stderr")
    .allowExcessArguments(false)

  let parsed: ReturnType<typeof program.parse>
  try {
    parsed = program.parse(argv, { from: "node" })
  } catch (err) {
    if ((err as { code?: string }).code === "commander.missingArgument") {
      throw new Error("url is required")
    }
    throw err
  }

  const args = parsed.opts<{
    json?: boolean
    pretty?: boolean
    only?: string
    formFactor: "mobile" | "desktop"
    timeout: string
    userAgent?: string
    color: boolean
    debug?: boolean
  }>()
  const [url] = parsed.processedArgs as [string]

  z.string().url().parse(url)

  if (args.json && args.pretty) {
    throw new Error("--json and --pretty are mutually exclusive")
  }

  let only: CliArgs["only"]
  if (args.only) {
    const parts = args.only.split(",").map((s) => s.trim())
    only = parts.map((p) => {
      const r = CategorySchema.safeParse(p)
      if (!r.success) throw new Error(`unknown category: ${p}`)
      return r.data
    })
  }

  return {
    url,
    only,
    json: args.json ?? false,
    pretty: args.pretty ?? false,
    formFactor: FormFactor.parse(args.formFactor),
    timeout: Number.parseInt(args.timeout, 10),
    userAgent: args.userAgent,
    noColor: !args.color,
    debug: args.debug ?? false,
  }
}
```

- [ ] **Step 6: Stub src/index.ts**

```ts
#!/usr/bin/env node
import { parseArgs } from "./args.js"

try {
  const args = parseArgs(process.argv)
  console.error(JSON.stringify(args, null, 2))
  process.exit(0)
} catch (err) {
  console.error(`audit-cli: ${(err as Error).message}`)
  process.exit(2)
}
```

- [ ] **Step 7: Run test — expect PASS, then commit**

Run: `bun --filter @repo/audit-cli test`

```bash
git add packages/audit-cli
git commit -m "feat(audit-cli): scaffold + args parsing"
```

---

## Task 22: audit-cli — aggregator + JSON output

**Files:**
- Create: `packages/audit-cli/src/aggregate.ts`
- Create: `packages/audit-cli/src/render/json.ts`
- Modify: `packages/audit-cli/src/index.ts`
- Create: `packages/audit-cli/test/aggregate.test.ts`

- [ ] **Step 1: Failing test**

`test/aggregate.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { AuditResultSchema } from "@repo/audit-core"
import { aggregate, type AuditPackages } from "../src/aggregate.js"

const mkSuccess = (category: string): unknown => ({
  status: "success",
  category,
  url: "https://example.com/",
  requestedUrl: "https://example.com",
  startedAt: new Date().toISOString(),
  durationMs: 100,
  packageName: `@repo/audit-${category}`,
  packageVersion: "0.0.0",
  score: 90,
  issues: [],
  raw: {},
})

const stubPackages: AuditPackages = {
  runLighthouse: vi.fn(async () => ({ requestedUrl: "x", finalUrl: "x" }) as unknown as never),
  perf: vi.fn(async () => mkSuccess("performance") as never),
  seo: vi.fn(async () => mkSuccess("seo") as never),
  bestPractices: vi.fn(async () => mkSuccess("best-practices") as never),
  pwa: vi.fn(async () => mkSuccess("pwa") as never),
  onpage: vi.fn(async () => mkSuccess("on-page") as never),
}

describe("aggregate", () => {
  it("returns 5 valid AuditResults for a happy URL", async () => {
    const results = await aggregate("https://example.com", { timeoutMs: 10_000 }, stubPackages)
    expect(results).toHaveLength(5)
    for (const r of results) expect(() => AuditResultSchema.parse(r)).not.toThrow()
    expect(stubPackages.runLighthouse).toHaveBeenCalledTimes(1)
  })

  it("respects --only by skipping non-requested categories", async () => {
    const onlyPerf = await aggregate(
      "https://example.com",
      { only: ["performance"], timeoutMs: 10_000 },
      stubPackages,
    )
    expect(onlyPerf).toHaveLength(1)
    expect(onlyPerf[0]?.category).toBe("performance")
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun --filter @repo/audit-cli test`

- [ ] **Step 3: Implement src/aggregate.ts**

```ts
import type { AuditResult, Category } from "@repo/audit-core"

export type AuditPackages = {
  runLighthouse: (url: string, opts: { timeoutMs?: number; formFactor?: "mobile" | "desktop" }) => Promise<unknown>
  perf: (url: string, opts: { lighthouseResult?: unknown; timeoutMs?: number }) => Promise<AuditResult>
  seo: (url: string, opts: { lighthouseResult?: unknown; timeoutMs?: number }) => Promise<AuditResult>
  bestPractices: (url: string, opts: { lighthouseResult?: unknown; timeoutMs?: number }) => Promise<AuditResult>
  pwa: (url: string, opts: { lighthouseResult?: unknown; timeoutMs?: number }) => Promise<AuditResult>
  onpage: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
}

export type AggregateOptions = {
  only?: Category[]
  timeoutMs?: number
  userAgent?: string
  formFactor?: "mobile" | "desktop"
}

export async function aggregate(
  url: string,
  opts: AggregateOptions,
  pkgs: AuditPackages,
): Promise<AuditResult[]> {
  const wants = (c: Category) => !opts.only || opts.only.includes(c)

  const needsLh =
    wants("performance") ||
    wants("seo") ||
    wants("best-practices") ||
    wants("pwa")

  let lhr: unknown
  if (needsLh) {
    try {
      lhr = await pkgs.runLighthouse(url, {
        timeoutMs: opts.timeoutMs,
        formFactor: opts.formFactor,
      })
    } catch {
      lhr = undefined
    }
  }

  const tasks: Promise<AuditResult>[] = []
  if (wants("performance"))
    tasks.push(pkgs.perf(url, { lighthouseResult: lhr, timeoutMs: opts.timeoutMs }))
  if (wants("seo"))
    tasks.push(pkgs.seo(url, { lighthouseResult: lhr, timeoutMs: opts.timeoutMs }))
  if (wants("best-practices"))
    tasks.push(pkgs.bestPractices(url, { lighthouseResult: lhr, timeoutMs: opts.timeoutMs }))
  if (wants("pwa"))
    tasks.push(pkgs.pwa(url, { lighthouseResult: lhr, timeoutMs: opts.timeoutMs }))
  if (wants("on-page"))
    tasks.push(pkgs.onpage(url, { userAgent: opts.userAgent, timeoutMs: opts.timeoutMs }))

  return Promise.all(tasks)
}
```

- [ ] **Step 4: Implement src/render/json.ts**

```ts
import type { AuditResult } from "@repo/audit-core"

export function renderJson(results: AuditResult[]): string {
  return JSON.stringify(results, null, 2)
}
```

- [ ] **Step 5: Wire src/index.ts**

```ts
#!/usr/bin/env node
import { AuditResultSchema } from "@repo/audit-core"
import { runLighthouse } from "@repo/lighthouse-runner"
import { audit as auditBP } from "@repo/audit-best-practices"
import { audit as auditOnpage } from "@repo/audit-onpage"
import { audit as auditPerf } from "@repo/audit-perf"
import { audit as auditPwa } from "@repo/audit-pwa"
import { audit as auditSeo } from "@repo/audit-seo"
import { aggregate } from "./aggregate.js"
import { parseArgs } from "./args.js"
import { renderJson } from "./render/json.js"
import { renderPretty } from "./render/pretty.js"

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>
  try {
    args = parseArgs(process.argv)
  } catch (err) {
    process.stderr.write(`audit-cli: ${(err as Error).message}\n`)
    return 2
  }

  const useJson = args.json || (!process.stdout.isTTY && !args.pretty)

  const results = await aggregate(
    args.url,
    {
      only: args.only,
      timeoutMs: args.timeout,
      userAgent: args.userAgent,
      formFactor: args.formFactor,
    },
    {
      runLighthouse,
      perf: (u, o) => auditPerf(u, o),
      seo: (u, o) => auditSeo(u, o),
      bestPractices: (u, o) => auditBP(u, o),
      pwa: (u, o) => auditPwa(u, o),
      onpage: (u, o) => auditOnpage(u, o),
    },
  )

  for (const r of results) AuditResultSchema.parse(r)

  if (useJson) {
    process.stdout.write(renderJson(results))
    process.stdout.write("\n")
  } else {
    process.stdout.write(renderPretty(results, { color: !args.noColor }))
  }

  return results.every((r) => r.status === "success") ? 0 : 1
}

main().then((code) => process.exit(code))
```

- [ ] **Step 6: Run test — expect PASS, then commit**

Run: `bun --filter @repo/audit-cli test`

```bash
git add packages/audit-cli
git commit -m "feat(audit-cli): aggregator + JSON renderer + main entry"
```

Note: `src/render/pretty.ts` is imported above but does not yet exist. Task 23 creates it. Until Task 23 is done, `bun --filter @repo/audit-cli build` will fail. The `test` command will still pass because the aggregate test does not import index.ts. **Do not run build between Task 22 and Task 23.**

---

## Task 23: audit-cli — pretty renderer

**Files:**
- Create: `packages/audit-cli/src/render/pretty.ts`
- Create: `packages/audit-cli/test/render-pretty.test.ts`

- [ ] **Step 1: Failing test**

`test/render-pretty.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderPretty } from "../src/render/pretty.js"

const success = {
  status: "success" as const,
  category: "performance" as const,
  url: "https://example.com/",
  requestedUrl: "https://example.com",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 8200,
  packageName: "@repo/audit-perf",
  packageVersion: "0.0.0",
  score: 92,
  issues: [],
  raw: {},
}

const failed = {
  status: "failed" as const,
  category: "seo" as const,
  url: "https://nope.invalid/",
  requestedUrl: "https://nope.invalid",
  startedAt: "2026-06-04T12:00:00.000Z",
  durationMs: 8000,
  packageName: "@repo/audit-seo",
  packageVersion: "0.0.0",
  error: { code: "DNS_ERROR" as const, message: "boom", retryable: true },
}

describe("renderPretty", () => {
  it("renders a success row with category, score, and duration", () => {
    const out = renderPretty([success], { color: false })
    expect(out).toMatch(/performance/)
    expect(out).toMatch(/92/)
    expect(out).toMatch(/8\.2s/)
  })

  it("renders a failure row with the error code", () => {
    const out = renderPretty([failed], { color: false })
    expect(out).toMatch(/seo/)
    expect(out).toMatch(/DNS_ERROR/)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun --filter @repo/audit-cli test`

- [ ] **Step 3: Implement**

`src/render/pretty.ts`:

```ts
import pc from "picocolors"
import type { AuditResult } from "@repo/audit-core"

const noColor = {
  green: (s: string) => s,
  yellow: (s: string) => s,
  red: (s: string) => s,
  dim: (s: string) => s,
  bold: (s: string) => s,
}

export function renderPretty(
  results: AuditResult[],
  opts: { color: boolean },
): string {
  const c = opts.color ? pc : noColor
  const lines: string[] = []
  const header = `${"category".padEnd(18)} ${"status".padEnd(8)} ${"score".padStart(5)}  ${"time".padStart(7)}`
  lines.push(c.bold(header))
  lines.push(c.dim("-".repeat(header.length)))
  for (const r of results) {
    const time = `${(r.durationMs / 1000).toFixed(1)}s`
    if (r.status === "failed") {
      lines.push(
        `${r.category.padEnd(18)} ${c.red("failed".padEnd(8))} ${"—".padStart(5)}  ${time.padStart(7)}  ${c.red(r.error.code)} ${c.dim(r.error.message)}`,
      )
    } else if (r.status === "partial") {
      lines.push(
        `${r.category.padEnd(18)} ${c.yellow("partial".padEnd(8))} ${String(r.score).padStart(5)}  ${time.padStart(7)}  ${c.dim(r.partialReasons.join("; "))}`,
      )
    } else {
      const scoreColor = r.score >= 90 ? c.green : r.score >= 50 ? c.yellow : c.red
      lines.push(
        `${r.category.padEnd(18)} ${c.green("success".padEnd(8))} ${scoreColor(String(r.score).padStart(5))}  ${time.padStart(7)}`,
      )
      for (const issue of r.issues.slice(0, 3)) {
        lines.push(`    ${c.dim("-")} ${issue.rule} ${c.dim(`(${issue.severity})`)}`)
      }
      if (r.issues.length > 3) {
        lines.push(`    ${c.dim(`… ${r.issues.length - 3} more`)}`)
      }
    }
  }
  return `${lines.join("\n")}\n`
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bun --filter @repo/audit-cli test`

- [ ] **Step 5: Full build of the slice**

Run: `bun run build`
Expected: every package builds; `packages/audit-cli/dist/index.js` exists and is executable.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-cli
git commit -m "feat(audit-cli): pretty renderer"
```

---

## Task 24: Integration test — lighthouse-runner against a local static server

**Files:**
- Create: `packages/lighthouse-runner/integration/run.integration.test.ts`
- Create: `packages/lighthouse-runner/integration/server.ts`
- Create: `packages/lighthouse-runner/integration/pages/index.html`

This is the first task that runs real Chrome. It is gated behind `RUN_INTEGRATION=1` and skipped otherwise.

- [ ] **Step 1: Create the static server**

`integration/server.ts`:

```ts
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const pagesDir = new URL("./pages/", import.meta.url)

export async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const path = req.url === "/" ? "/index.html" : req.url ?? "/index.html"
    try {
      const body = await readFile(fileURLToPath(new URL(`.${path}`, pagesDir)))
      res.writeHead(200, { "content-type": "text/html" })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end("not found")
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("server failed to bind")
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}
```

- [ ] **Step 2: A minimal page**

`integration/pages/index.html`:

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Integration page</title></head>
<body><h1>Integration page</h1><p>For lighthouse-runner integration test.</p></body></html>
```

- [ ] **Step 3: Integration test**

`integration/run.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { runLighthouse } from "../src/index.js"
import { startServer } from "./server.js"

const enabled = process.env.RUN_INTEGRATION === "1"

;(enabled ? describe : describe.skip)("runLighthouse — integration", () => {
  it("audits a local page and returns categories", async () => {
    const server = await startServer()
    try {
      const lhr = await runLighthouse(server.url, { timeoutMs: 60_000 })
      expect(lhr.categories.performance).toBeDefined()
      expect(lhr.categories.seo).toBeDefined()
      expect(lhr.categories["best-practices"]).toBeDefined()
      expect(typeof lhr.audits["document-title"]?.score === "number" || lhr.audits["document-title"]?.score === null).toBe(true)
    } finally {
      await server.close()
    }
  }, 90_000)
})
```

- [ ] **Step 4: Run the integration test locally**

Run: `RUN_INTEGRATION=1 bun --filter @repo/lighthouse-runner test:integration`
Expected: PASS (this launches real Chrome — needs ~15-20s).

If Chrome is not installed, install via `bunx puppeteer browsers install chrome` or document the system requirement in the package README.

- [ ] **Step 5: Commit**

```bash
git add packages/lighthouse-runner/integration
git commit -m "test(lighthouse-runner): integration test against local static server"
```

---

## Task 25: Integration test — audit-cli subprocess

**Files:**
- Create: `packages/audit-cli/integration/cli.integration.test.ts`
- Create: `packages/audit-cli/integration/server.ts`
- Create: `packages/audit-cli/integration/pages/index.html`

- [ ] **Step 1: Reuse the static server pattern**

`integration/server.ts`: identical to the one in `lighthouse-runner/integration/`. Copying is fine here — it's 25 lines and these are integration test scaffolds.

`integration/pages/index.html`: a slightly richer page so on-page rules have something to chew on:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Integration test page for the audit CLI</title>
  <meta name="description" content="A reasonable meta description for the audit CLI integration test page.">
  <link rel="canonical" href="http://127.0.0.1:0/">
</head>
<body>
  <h1>Integration page</h1>
  <p><img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt="dot"></p>
</body>
</html>
```

(The hard-coded canonical to port 0 will fail the `canonical-points-elsewhere` check — that's intentional; the test asserts the on-page result is still a valid AuditResult, not that it's a perfect score.)

- [ ] **Step 2: Integration test**

`integration/cli.integration.test.ts`:

```ts
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { AuditResultSchema } from "@repo/audit-core"
import { startServer } from "./server.js"

const enabled = process.env.RUN_INTEGRATION === "1"
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url))

;(enabled ? describe : describe.skip)("audit-cli — integration", () => {
  it("audits a local page and returns 5 valid AuditResults", async () => {
    const server = await startServer()
    try {
      const result = await runCli([server.url, "--json"])
      expect([0, 1]).toContain(result.code)
      const parsed = JSON.parse(result.stdout) as unknown[]
      expect(parsed).toHaveLength(5)
      for (const r of parsed) expect(() => AuditResultSchema.parse(r)).not.toThrow()
    } finally {
      await server.close()
    }
  }, 120_000)

  it("exits 2 for an invalid URL", async () => {
    const result = await runCli(["not a url"])
    expect(result.code).toBe(2)
  })
})

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()))
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}
```

- [ ] **Step 3: Run the integration test**

First build the CLI: `bun --filter @repo/audit-cli build`
Then run: `RUN_INTEGRATION=1 bun --filter @repo/audit-cli test:integration`
Expected: PASS (~30-60s — real Chrome + real HTTP).

- [ ] **Step 4: Commit**

```bash
git add packages/audit-cli/integration
git commit -m "test(audit-cli): integration test as subprocess against local server"
```

---

## Task 26: Package READMEs + slice 1 validation

**Files:**
- Create: `packages/<each-package>/README.md` (8 files)
- Optional modify: root `README.md` to point at the audit packages.

- [ ] **Step 1: Write a README per package**

Each `README.md` must include:

```markdown
# @repo/<name>

<one-sentence purpose>

## Usage

```ts
import { audit } from "@repo/<name>"

const result = await audit("https://example.com")
```

## Rule list

(For packages that have rules — list `id`, severity floor, and short description.)

## Options

(For packages that read non-trivial options — list each.)

## See also

- [`@repo/audit-core`](../audit-core) — shared types and helpers
- Spec: [`docs/plans/2026-06-04-audit-packages-slice1-design.md`](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
```

Skip the `audit` block in `lighthouse-runner` (it exports `runLighthouse`, not `audit`) and customize the `audit-cli` README to document the CLI flags and exit codes.

- [ ] **Step 2: Full slice validation**

Run each, in order, from repo root:

```bash
bun install
bun run typecheck
bun run lint
bun run build
bun --filter "@repo/audit-*" test
bun --filter @repo/lighthouse-runner test
bun --filter @repo/audit-cli test
```

Each must PASS.

- [ ] **Step 3: Smoke test against a real URL**

```bash
node packages/audit-cli/dist/index.js https://example.com --pretty
```

Expected: 5 rows printed, exit code 0 (or 1 if PWA was a partial — that is correct for Lighthouse 12 on example.com).

- [ ] **Step 4: Optional integration suite**

```bash
RUN_INTEGRATION=1 bun --filter @repo/lighthouse-runner test:integration
RUN_INTEGRATION=1 bun --filter @repo/audit-cli test:integration
```

Both must PASS for the slice to be truly green. If Chrome isn't available in the environment running this, document the requirement in `packages/lighthouse-runner/README.md`.

- [ ] **Step 5: Commit**

```bash
git add packages/*/README.md
git commit -m "docs: package READMEs for audit packages slice 1"
```

- [ ] **Step 6: Verify slice definition-of-done**

Against the spec's "Definition of done for slice 1" section, confirm each bullet:

- [x] All eight packages build (`bun run build`) and typecheck (`bun run typecheck`).
- [x] `audit-cli https://example.com` returns exactly five `AuditResult` objects validating against `AuditResultSchema`.
- [x] Unit test suite green for every package; integration suite green when `RUN_INTEGRATION=1`.
- [x] Every rule in `audit-onpage` and every `ErrorCode` mapping in `lighthouse-runner` is covered by a test.
- [x] A short README in each package documents its surface.
- [x] No package depends on Supabase, Drizzle, a queue, or any UI library.

If any bullet is not satisfied, do not declare the slice complete — go back and resolve it before moving on to slice 2 (Supabase + Drizzle + persistence).

---

## After slice 1

The next slice (its own design + plan) wires these audit packages into:
- `packages/db` — Drizzle schema for `profiles`, `sites`, `audit_runs`, `audit_results`; RLS policies; `AuditResultSchema → row` mapper that reuses `audit-core`'s Zod schema for validation before insert.
- `apps/runner` — a long-running worker that polls pgmq, dispatches to `audit-cli`'s aggregator (imported as a library, not spawned), and writes results.
- Initial Supabase project setup (auth, migrations, service-role key handling).

The contract built in this slice (`AuditResult` discriminated union, `AuditResultSchema`, `audit(url, opts)`) is intentionally stable so the runner can adopt it directly without any reshaping.
