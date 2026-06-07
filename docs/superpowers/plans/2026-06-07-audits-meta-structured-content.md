# Audits: Meta, Structured, Content — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 11 new user-facing HTML audit checks (14 rules) split across 3 new packages and wire them into `audit-cli` via a per-category result merger, without DB or dashboard changes.

**Architecture:** Extract shared HTML-parsing infra from `@repo/audit-onpage` into a new `@repo/audit-html-core` library. Build 3 new audit packages (`audit-meta`, `audit-structured`, `audit-content`) on top of it. Each new package emits an `AuditResult` keyed to an existing `Category` (`on-page` or `seo`). Extend `audit-cli/src/aggregate.ts` with a `mergeByCategory()` function that folds multiple packages contributing to the same category into a single result, so the DB (`latest_scores_per_site`) keeps one row per `(site_id, category)`.

**Tech Stack:** TypeScript 5.7, Node 20+, tsdown 0.22 (build), vitest 4 (test), msw 2 (network mocks), cheerio (HTML parse), zod (schema validation). No new shared deps.

**Spec:** [`docs/superpowers/specs/2026-06-07-audits-meta-structured-content-design.md`](../specs/2026-06-07-audits-meta-structured-content-design.md)

---

## File Structure

**New package: `packages/audit-html-core/`**
- `package.json` — `@repo/audit-html-core`, builds via tsdown, depends on `@repo/audit-core` + `cheerio`
- `tsconfig.json` — extends `@repo/typescript-config/node.json`
- `tsdown.config.ts` — same shape as audit-onpage
- `vitest.config.ts` — same shape as audit-onpage
- `src/index.ts` — re-exports everything below
- `src/types.ts` — `FetchedPage` (moved from `audit-onpage/src/types.ts`)
- `src/fetch.ts` — `fetchPage`, `FetchPageOptions` (moved from `audit-onpage/src/fetch.ts`)
- `src/parse.ts` — `parse` (moved from `audit-onpage/src/parse.ts`)
- `src/rules.ts` — `Rule`, `RuleContext`, `RuleOutcome` (moved from `audit-onpage/src/rules.ts`)
- `src/score.ts` — `deriveScore` (moved from `audit-onpage/src/score.ts`)
- `src/executor.ts` — NEW: `executeRule` extracted from `audit-onpage/src/index.ts:31-41` with `try/catch` wrap

**Modified: `packages/audit-onpage/`**
- `src/index.ts` — imports from `@repo/audit-html-core` instead of local files
- `src/rules/*.ts` — 8 files, each updates `import type { Rule } from "../rules.js"` → `from "@repo/audit-html-core"`
- `package.json` — adds `"@repo/audit-html-core": "workspace:*"` dep
- DELETE: `src/parse.ts`, `src/fetch.ts`, `src/rules.ts`, `src/score.ts`, `src/types.ts`
- KEEP UNCHANGED: `test/**` — existing 23 tests must still pass

**New package: `packages/audit-meta/`** (same scaffolding shape as audit-onpage)
- `src/index.ts` — wires `RULES` array, emits AuditResult with `category: "on-page"`
- `src/bin.ts` — CLI entry: `audit-meta <url>`
- `src/rules/viewport.ts`
- `src/rules/lang.ts`
- `src/rules/doctype.ts`
- `src/rules/encoding.ts`
- `src/rules/favicon.ts`
- `src/rules/https.ts`
- `test/rules/{viewport,lang,doctype,encoding,favicon,https}.test.ts`
- `test/audit.test.ts` — end-to-end integration test with fixture HTML
- `test/setup.ts` — msw server (favicon HEAD mocks)
- `__fixtures__/*.html` — minimal pages per rule

**New package: `packages/audit-structured/`** (same shape)
- `src/index.ts` — `category: "seo"`
- `src/rules/{schema-org,microformats,llms-txt,open-graph-facebook,open-graph-twitter,open-graph-pinterest,open-graph-linkedin}.ts`
- `test/rules/*.test.ts` (7 files)
- `test/audit.test.ts`
- `test/setup.ts`
- `__fixtures__/*.html`

**New package: `packages/audit-content/`** (same shape)
- `src/index.ts` — `category: "seo"`
- `src/stopwords-en.ts` — `Set<string>` of ~50 English stopwords
- `src/rules/keyword-density.ts`
- `test/rules/keyword-density.test.ts`
- `test/audit.test.ts`
- `__fixtures__/*.html`

**Modified: `packages/audit-cli/`**
- `src/aggregate.ts` — extend `AuditPackages` with `meta`, `structured`, `content`; call them when their category is wanted
- `src/merge.ts` — NEW: `mergeByCategory(results: AuditResult[]): AuditResult[]`
- `src/lib.ts` — wire `auditMeta` / `auditStructured` / `auditContent` into `defaultPackages`
- `package.json` — add the 3 new deps
- `test/merge.test.ts` — NEW: covers merger semantics
- `test/aggregate.test.ts` — extended (or added if missing) to cover full pipeline

---

## Tasks

### Task 1: Scaffold `@repo/audit-html-core` package

**Files:**
- Create: `packages/audit-html-core/package.json`
- Create: `packages/audit-html-core/tsconfig.json`
- Create: `packages/audit-html-core/tsdown.config.ts`
- Create: `packages/audit-html-core/vitest.config.ts`
- Create: `packages/audit-html-core/src/index.ts`

- [ ] **Step 1: Write `packages/audit-html-core/package.json`**

```json
{
  "name": "@repo/audit-html-core",
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
    "@repo/audit-core": "workspace:*",
    "cheerio": "catalog:"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^25.0.2",
    "tsdown": "catalog:",
    "typescript": "^5.7.3",
    "vitest": "^4.0.15"
  }
}
```

- [ ] **Step 2: Write `packages/audit-html-core/tsconfig.json`**

```json
{
  "extends": "@repo/typescript-config/node.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "test"]
}
```

- [ ] **Step 3: Write `packages/audit-html-core/tsdown.config.ts`**

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
  fixedExtension: false,
})
```

- [ ] **Step 4: Write `packages/audit-html-core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 5: Write empty `packages/audit-html-core/src/index.ts`**

```ts
export {}
```

- [ ] **Step 6: Install deps and verify build**

Run: `bun install && bun --filter @repo/audit-html-core build`
Expected: builds to `packages/audit-html-core/dist/index.js` with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/audit-html-core
git commit -m "chore(audit-html-core): scaffold package"
```

---

### Task 2: Move parse/fetch/rules/score/types from `audit-onpage` into `audit-html-core`

This is the riskiest task. The existing `audit-onpage` test suite (23 tests across 8 rule files + 1 score test) must pass unchanged at the end.

**Files:**
- Create: `packages/audit-html-core/src/types.ts`
- Create: `packages/audit-html-core/src/fetch.ts`
- Create: `packages/audit-html-core/src/parse.ts`
- Create: `packages/audit-html-core/src/rules.ts`
- Create: `packages/audit-html-core/src/score.ts`
- Create: `packages/audit-html-core/src/executor.ts`
- Modify: `packages/audit-html-core/src/index.ts`
- Modify: `packages/audit-onpage/package.json` — add `@repo/audit-html-core` dep
- Modify: `packages/audit-onpage/src/index.ts` — import from `@repo/audit-html-core`
- Modify: `packages/audit-onpage/src/rules/{alt,canonical,headings,hreflang,meta-description,robots,sitemap,title}.ts` — 8 files, update `Rule` import
- Modify: `packages/audit-onpage/test/rules/title.test.ts` (and 7 others) — update `load` import + `Rule` import if needed
- Delete: `packages/audit-onpage/src/{types,fetch,parse,rules,score}.ts`

- [ ] **Step 1: Run existing audit-onpage tests as a baseline**

Run: `bun --filter @repo/audit-onpage test`
Expected: 23 tests pass across 8 rule files.

If anything fails before the refactor, stop and investigate.

- [ ] **Step 2: Create `packages/audit-html-core/src/types.ts`**

```ts
export type FetchedPage = {
  requestedUrl: string
  finalUrl: string
  status: number
  html: string
  contentType: string
}
```

- [ ] **Step 3: Create `packages/audit-html-core/src/fetch.ts`**

Copy verbatim from `packages/audit-onpage/src/fetch.ts` (16-line module). The full code:

```ts
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

export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const ua = opts.userAgent ?? DEFAULT_UA
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT

  let currentUrl = url
  let visited = 0
  while (visited <= MAX_REDIRECTS) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal

    const res = await fetch(currentUrl, {
      method: "GET",
      headers: { "user-agent": ua, accept: "text/html,*/*;q=0.5" },
      redirect: "manual",
      signal,
    })

    const status = res.status
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location")
      if (!loc) {
        throw new AuditFailure({
          code: "HTTP_5XX",
          message: `redirect from ${currentUrl} missing Location header`,
        })
      }
      currentUrl = new URL(loc, currentUrl).toString()
      visited++
      continue
    }
    if (status >= 500) {
      throw new AuditFailure({
        code: "HTTP_5XX",
        message: `HTTP ${status} from ${currentUrl}`,
      })
    }
    if (status >= 400) {
      throw new AuditFailure({
        code: "HTTP_4XX",
        message: `HTTP ${status} from ${currentUrl}`,
      })
    }
    const html = await res.text()
    const contentType = res.headers.get("content-type") ?? "text/html"
    return { requestedUrl: url, finalUrl: currentUrl, status, html, contentType }
  }
  throw new AuditFailure({
    code: "HTTP_5XX",
    message: `too many redirects (> ${MAX_REDIRECTS})`,
  })
}
```

- [ ] **Step 4: Create `packages/audit-html-core/src/parse.ts`**

```ts
import { type CheerioAPI, load } from "cheerio"
import type { FetchedPage } from "./types.js"

export function parse(page: FetchedPage): CheerioAPI {
  return load(page.html, { xmlMode: false })
}
```

- [ ] **Step 5: Create `packages/audit-html-core/src/rules.ts`**

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
  id: string
  weight: number
  run?: (ctx: RuleContext) => RuleOutcome
  runAsync?: (ctx: RuleContext) => Promise<RuleOutcome>
}
```

- [ ] **Step 6: Create `packages/audit-html-core/src/score.ts`**

```ts
import type { Issue } from "@repo/audit-core"
import type { Rule, RuleOutcome } from "./rules.js"

export function deriveScore(
  rules: Rule[],
  outcomes: RuleOutcome[]
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

- [ ] **Step 7: Create `packages/audit-html-core/src/executor.ts`**

This is the NEW piece — extracted from `audit-onpage/src/index.ts:31-41` and wrapped in `try/catch` so unexpected throws inside rules don't fail the whole audit.

```ts
import type { Rule, RuleContext, RuleOutcome } from "./rules.js"

export async function executeRule(rule: Rule, ctx: RuleContext): Promise<RuleOutcome> {
  try {
    if (rule.runAsync) return await rule.runAsync(ctx)
    if (rule.run) return rule.run(ctx)
    return { outcome: "skip", reason: "no implementation" }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { outcome: "skip", reason: `unexpected: ${message}` }
  }
}
```

- [ ] **Step 8: Write `packages/audit-html-core/src/index.ts`**

```ts
export { executeRule } from "./executor.js"
export { fetchPage, type FetchPageOptions } from "./fetch.js"
export { parse } from "./parse.js"
export type { Rule, RuleContext, RuleOutcome } from "./rules.js"
export { deriveScore } from "./score.js"
export type { FetchedPage } from "./types.js"
```

- [ ] **Step 9: Add `@repo/audit-html-core` to audit-onpage's `package.json`**

In `packages/audit-onpage/package.json`, add to `dependencies` (keep alphabetical):

```json
"dependencies": {
  "@repo/audit-core": "workspace:*",
  "@repo/audit-html-core": "workspace:*",
  "cheerio": "catalog:",
  "robots-parser": "catalog:"
}
```

Run: `bun install`

- [ ] **Step 10: Update `packages/audit-onpage/src/index.ts` to consume audit-html-core**

Replace the whole file with:

```ts
import { executeRule, fetchPage, parse, type Rule } from "@repo/audit-html-core"
import { withTiming } from "@repo/audit-core"
import packageJson from "../package.json" with { type: "json" }
import { altRules } from "./rules/alt.js"
import { canonicalRules } from "./rules/canonical.js"
import { headingRules } from "./rules/headings.js"
import { hreflangRules } from "./rules/hreflang.js"
import { metaDescriptionRules } from "./rules/meta-description.js"
import { robotsRules } from "./rules/robots.js"
import { sitemapRules } from "./rules/sitemap.js"
import { titleRules } from "./rules/title.js"
import { deriveScore } from "@repo/audit-html-core"

export { fetchPage } from "@repo/audit-html-core"

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

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "on-page",
  packageName: "@repo/audit-onpage",
  packageVersion,
})(async ({ url, opts }) => {
  const page = await fetchPage(url, {
    ...(opts?.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
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

- [ ] **Step 11: Update all 8 audit-onpage rule files to import `Rule` from `@repo/audit-html-core`**

In each of `packages/audit-onpage/src/rules/{alt,canonical,headings,hreflang,meta-description,robots,sitemap,title}.ts`, change:

```ts
import type { Rule } from "../rules.js"
```

to:

```ts
import type { Rule } from "@repo/audit-html-core"
```

- [ ] **Step 12: Delete `audit-onpage`'s now-orphaned local files**

```bash
rm packages/audit-onpage/src/types.ts
rm packages/audit-onpage/src/fetch.ts
rm packages/audit-onpage/src/parse.ts
rm packages/audit-onpage/src/rules.ts
rm packages/audit-onpage/src/score.ts
```

- [ ] **Step 13: Update audit-onpage test imports if they reference the deleted paths**

The existing test files import from `../../src/rules/title.js` (or similar) and from cheerio's `load` directly — neither path references the deleted files, so tests should not need changes. Verify by grep:

Run: `grep -rE "from .*\.\./\.\./src/(types|fetch|parse|rules|score)\.js" packages/audit-onpage/test/`
Expected: no matches.

If matches found, swap them to `from "@repo/audit-html-core"`.

- [ ] **Step 14: Verify build + tests still pass**

Run: `bun --filter @repo/audit-html-core build && bun --filter @repo/audit-onpage build && bun --filter @repo/audit-onpage test`
Expected: builds succeed, all 23 audit-onpage tests pass unchanged.

- [ ] **Step 15: Verify type check across workspace**

Run: `bun turbo check-types`
Expected: zero TypeScript errors.

- [ ] **Step 16: Commit**

```bash
git add packages/audit-html-core packages/audit-onpage
git commit -m "refactor(audit-onpage): consume parse/fetch/rules from @repo/audit-html-core"
```

---

### Task 3: Scaffold `@repo/audit-meta` package

**Files:**
- Create: `packages/audit-meta/package.json`
- Create: `packages/audit-meta/tsconfig.json`
- Create: `packages/audit-meta/tsdown.config.ts`
- Create: `packages/audit-meta/vitest.config.ts`
- Create: `packages/audit-meta/test/setup.ts`
- Create: `packages/audit-meta/src/index.ts` (stub, fills in Task 10)
- Create: `packages/audit-meta/src/bin.ts`

- [ ] **Step 1: Write `packages/audit-meta/package.json`**

```json
{
  "name": "@repo/audit-meta",
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
  "bin": {
    "audit-meta": "./dist/bin.js"
  },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "vitest run"
  },
  "dependencies": {
    "@repo/audit-core": "workspace:*",
    "@repo/audit-html-core": "workspace:*"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^25.0.2",
    "msw": "^2.7.0",
    "tsdown": "catalog:",
    "typescript": "^5.7.3",
    "vitest": "^4.0.15"
  }
}
```

- [ ] **Step 2: Write `packages/audit-meta/tsconfig.json`**

```json
{
  "extends": "@repo/typescript-config/node.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "test", "__fixtures__"]
}
```

- [ ] **Step 3: Write `packages/audit-meta/tsdown.config.ts`**

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
  fixedExtension: false,
})
```

- [ ] **Step 4: Write `packages/audit-meta/vitest.config.ts`**

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

- [ ] **Step 5: Write `packages/audit-meta/test/setup.ts`**

```ts
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll } from "vitest"

export const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

- [ ] **Step 6: Write stub `packages/audit-meta/src/index.ts`**

```ts
export {}
```

- [ ] **Step 7: Write `packages/audit-meta/src/bin.ts`**

```ts
#!/usr/bin/env node
import { audit } from "./index.js"

const url = process.argv[2]
if (!url) {
  console.error("usage: audit-meta <url>")
  process.exit(2)
}
const result = await audit(url)
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === "success" ? 0 : 1)
```

This will not type-check yet because `audit` isn't exported. Task 10 fixes this.

- [ ] **Step 8: Install deps**

Run: `bun install`
Expected: workspace links audit-meta.

- [ ] **Step 9: Commit**

```bash
git add packages/audit-meta
git commit -m "chore(audit-meta): scaffold package"
```

---

### Task 4: `meta/viewport-missing` rule

**Files:**
- Create: `packages/audit-meta/src/rules/viewport.ts`
- Create: `packages/audit-meta/test/rules/viewport.test.ts`
- Create: `packages/audit-meta/__fixtures__/viewport-ok.html`
- Create: `packages/audit-meta/__fixtures__/viewport-missing.html`
- Create: `packages/audit-meta/__fixtures__/viewport-no-device-width.html`

- [ ] **Step 1: Write fixtures**

`__fixtures__/viewport-ok.html`:
```html
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>
```

`__fixtures__/viewport-missing.html`:
```html
<!DOCTYPE html><html><head><title>x</title></head><body></body></html>
```

`__fixtures__/viewport-no-device-width.html`:
```html
<!DOCTYPE html><html><head><meta name="viewport" content="initial-scale=1"></head><body></body></html>
```

- [ ] **Step 2: Write failing test `packages/audit-meta/test/rules/viewport.test.ts`**

```ts
import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { viewportRules } from "../../src/rules/viewport.js"

const fx = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.html`, import.meta.url), "utf8")

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const runAll = (html: string) =>
  viewportRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("viewport rule", () => {
  it("viewport with width=device-width -> pass", () => {
    const outcomes = runAll(fx("viewport-ok"))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("missing viewport meta -> fail with meta/viewport-missing", () => {
    const outcomes = runAll(fx("viewport-missing"))
    const fail = outcomes.find((o) => o.outcome === "fail")
    expect(fail).toBeDefined()
    if (fail?.outcome === "fail") {
      expect(fail.issues[0]?.rule).toBe("meta/viewport-missing")
      expect(fail.issues[0]?.severity).toBe("error")
    }
  })

  it("viewport without width=device-width -> fail with meta/viewport-missing", () => {
    const outcomes = runAll(fx("viewport-no-device-width"))
    const fail = outcomes.find((o) => o.outcome === "fail")
    expect(fail).toBeDefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @repo/audit-meta test test/rules/viewport.test.ts`
Expected: FAIL (module not found: `../../src/rules/viewport.js`).

- [ ] **Step 4: Implement `packages/audit-meta/src/rules/viewport.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

export const viewportRules: Rule[] = [
  {
    id: "meta/viewport-missing",
    weight: 4,
    run: ({ $ }) => {
      const meta = $('head > meta[name="viewport"]').first()
      const content = (meta.attr("content") ?? "").toLowerCase()
      if (meta.length === 0) {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/viewport-missing",
              severity: "error",
              title: "Missing viewport meta tag",
              description: "The page has no <meta name=\"viewport\"> element.",
              recommendation:
                "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the <head>.",
            }),
          ],
        }
      }
      if (!content.includes("width=device-width")) {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/viewport-missing",
              severity: "error",
              title: "Viewport meta does not include width=device-width",
              description: `Viewport content is "${content}".`,
              recommendation:
                "Set content to include width=device-width, e.g. \"width=device-width, initial-scale=1\".",
            }),
          ],
        }
      }
      return { outcome: "pass" }
    },
  },
]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --filter @repo/audit-meta test test/rules/viewport.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-meta/src/rules/viewport.ts packages/audit-meta/test/rules/viewport.test.ts packages/audit-meta/__fixtures__/viewport-*.html
git commit -m "feat(audit-meta): add viewport-missing rule"
```

---

### Task 5: `meta/lang-missing` rule

**Files:**
- Create: `packages/audit-meta/src/rules/lang.ts`
- Create: `packages/audit-meta/test/rules/lang.test.ts`
- Create: `packages/audit-meta/__fixtures__/lang-{ok,missing,malformed}.html`

- [ ] **Step 1: Write fixtures**

`__fixtures__/lang-ok.html`:
```html
<!DOCTYPE html><html lang="en-US"><head></head><body></body></html>
```

`__fixtures__/lang-missing.html`:
```html
<!DOCTYPE html><html><head></head><body></body></html>
```

`__fixtures__/lang-malformed.html`:
```html
<!DOCTYPE html><html lang="english"><head></head><body></body></html>
```

(Note: "english" has 7 chars in the first sub-tag, which exceeds the 2-3 char primary subtag, so the regex rejects it.)

- [ ] **Step 2: Write failing test `test/rules/lang.test.ts`**

```ts
import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { langRules } from "../../src/rules/lang.js"

const fx = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.html`, import.meta.url), "utf8")

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const runAll = (html: string) =>
  langRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("lang rule", () => {
  it("valid BCP-47 lang -> pass", () => {
    expect(runAll(fx("lang-ok")).every((o) => o.outcome === "pass")).toBe(true)
  })
  it("missing lang -> fail", () => {
    const outcomes = runAll(fx("lang-missing"))
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
  it("malformed lang -> fail", () => {
    const outcomes = runAll(fx("lang-malformed"))
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @repo/audit-meta test test/rules/lang.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/rules/lang.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const BCP47 = /^[a-z]{2,3}(-[a-zA-Z0-9]{1,8})*$/i

export const langRules: Rule[] = [
  {
    id: "meta/lang-missing",
    weight: 3,
    run: ({ $ }) => {
      const lang = $("html").attr("lang")?.trim() ?? ""
      if (lang.length > 0 && BCP47.test(lang)) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "meta/lang-missing",
            severity: "warn",
            title: "Missing or malformed `lang` attribute on <html>",
            description:
              lang.length === 0
                ? "The <html> element has no lang attribute."
                : `The lang value "${lang}" does not match the BCP-47 shape.`,
            recommendation:
              'Set <html lang="en"> (or the appropriate BCP-47 tag, e.g. "pt-BR", "zh-Hans-CN").',
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --filter @repo/audit-meta test test/rules/lang.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-meta/src/rules/lang.ts packages/audit-meta/test/rules/lang.test.ts packages/audit-meta/__fixtures__/lang-*.html
git commit -m "feat(audit-meta): add lang-missing rule"
```

---

### Task 6: `meta/doctype-missing` rule

This rule reads `page.html` directly (not via cheerio), because cheerio strips the doctype during parse.

**Files:**
- Create: `packages/audit-meta/src/rules/doctype.ts`
- Create: `packages/audit-meta/test/rules/doctype.test.ts`

- [ ] **Step 1: Write failing test `test/rules/doctype.test.ts`**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { doctypeRules } from "../../src/rules/doctype.js"

const mkPage = (html: string) => ({
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html,
})

const runAll = (html: string) =>
  doctypeRules.map((r) => r.run!({ $: load(html), page: mkPage(html) }))

describe("doctype rule", () => {
  it("HTML5 doctype -> pass", () => {
    const outcomes = runAll("<!DOCTYPE html><html><head></head><body></body></html>")
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })
  it("lowercase doctype -> pass", () => {
    const outcomes = runAll("<!doctype html><html></html>")
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })
  it("XHTML doctype -> fail", () => {
    const outcomes = runAll(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" ""><html></html>'
    )
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
  it("missing doctype -> fail", () => {
    const outcomes = runAll("<html><head></head><body></body></html>")
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-meta test test/rules/doctype.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/doctype.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const HTML5_DOCTYPE = /^\s*<!doctype\s+html\s*>/i

export const doctypeRules: Rule[] = [
  {
    id: "meta/doctype-missing",
    weight: 2,
    run: ({ page }) => {
      const head = page.html.slice(0, 200)
      if (HTML5_DOCTYPE.test(head)) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "meta/doctype-missing",
            severity: "warn",
            title: "Missing or non-HTML5 doctype",
            description: "The document does not start with <!DOCTYPE html>.",
            recommendation: 'Add "<!DOCTYPE html>" as the first line of the document.',
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-meta test test/rules/doctype.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-meta/src/rules/doctype.ts packages/audit-meta/test/rules/doctype.test.ts
git commit -m "feat(audit-meta): add doctype-missing rule"
```

---

### Task 7: `meta/encoding-missing` rule

**Files:**
- Create: `packages/audit-meta/src/rules/encoding.ts`
- Create: `packages/audit-meta/test/rules/encoding.test.ts`
- Create: `packages/audit-meta/__fixtures__/encoding-{utf8,utf16,missing,http-equiv}.html`

- [ ] **Step 1: Write fixtures**

`__fixtures__/encoding-utf8.html`:
```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>
```

`__fixtures__/encoding-utf16.html`:
```html
<!DOCTYPE html><html><head><meta charset="utf-16"></head><body></body></html>
```

`__fixtures__/encoding-missing.html`:
```html
<!DOCTYPE html><html><head><title>x</title></head><body></body></html>
```

`__fixtures__/encoding-http-equiv.html`:
```html
<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body></body></html>
```

- [ ] **Step 2: Write failing test `test/rules/encoding.test.ts`**

```ts
import { readFileSync } from "node:fs"
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { encodingRules } from "../../src/rules/encoding.js"

const fx = (name: string) =>
  readFileSync(new URL(`../../__fixtures__/${name}.html`, import.meta.url), "utf8")

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const runAll = (html: string) =>
  encodingRules.map((r) => r.run!({ $: load(html), page: { ...page, html } }))

describe("encoding rule", () => {
  it("utf-8 charset -> pass", () => {
    expect(runAll(fx("encoding-utf8")).every((o) => o.outcome === "pass")).toBe(true)
  })
  it("http-equiv content-type utf-8 -> pass", () => {
    expect(runAll(fx("encoding-http-equiv")).every((o) => o.outcome === "pass")).toBe(true)
  })
  it("utf-16 charset -> fail", () => {
    expect(runAll(fx("encoding-utf16")).some((o) => o.outcome === "fail")).toBe(true)
  })
  it("missing charset -> fail", () => {
    expect(runAll(fx("encoding-missing")).some((o) => o.outcome === "fail")).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @repo/audit-meta test test/rules/encoding.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/rules/encoding.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

function extractCharset($: ReturnType<typeof import("cheerio").load>): string | null {
  const direct = $('head > meta[charset]').first().attr("charset")
  if (direct) return direct.trim().toLowerCase()
  const httpEquiv = $('head > meta[http-equiv="Content-Type" i]').first().attr("content") ?? ""
  const m = httpEquiv.match(/charset=([^;\s]+)/i)
  return m?.[1] ? m[1].trim().toLowerCase() : null
}

export const encodingRules: Rule[] = [
  {
    id: "meta/encoding-missing",
    weight: 2,
    run: ({ $ }) => {
      const charset = extractCharset($)
      if (charset === null) {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/encoding-missing",
              severity: "warn",
              title: "Missing <meta charset>",
              description: "The <head> declares no character encoding.",
              recommendation: 'Add <meta charset="utf-8"> as the first child of <head>.',
            }),
          ],
        }
      }
      if (charset !== "utf-8") {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "meta/encoding-missing",
              severity: "warn",
              title: "Charset is not utf-8",
              description: `Declared charset is "${charset}".`,
              recommendation: 'Use <meta charset="utf-8">.',
            }),
          ],
        }
      }
      return { outcome: "pass" }
    },
  },
]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --filter @repo/audit-meta test test/rules/encoding.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-meta/src/rules/encoding.ts packages/audit-meta/test/rules/encoding.test.ts packages/audit-meta/__fixtures__/encoding-*.html
git commit -m "feat(audit-meta): add encoding-missing rule"
```

---

### Task 8: `meta/favicon-missing` rule (async, network)

**Files:**
- Create: `packages/audit-meta/src/rules/favicon.ts`
- Create: `packages/audit-meta/test/rules/favicon.test.ts`

- [ ] **Step 1: Write failing test `test/rules/favicon.test.ts`**

```ts
import { load } from "cheerio"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { faviconRules } from "../../src/rules/favicon.js"
import { server } from "../setup.js"

const basePage = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("favicon rule", () => {
  it("link[rel=icon] HEAD 200 -> pass", async () => {
    server.use(http.head("https://example.com/favicon.png", () => new HttpResponse(null, { status: 200 })))
    const $ = load('<link rel="icon" href="/favicon.png">')
    const outcome = await faviconRules[0]!.runAsync!({ $, page: basePage })
    expect(outcome.outcome).toBe("pass")
  })

  it("no link[rel=icon] + /favicon.ico 200 -> pass", async () => {
    server.use(http.head("https://example.com/favicon.ico", () => new HttpResponse(null, { status: 200 })))
    const outcome = await faviconRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("pass")
  })

  it("no favicon anywhere -> fail with meta/favicon-missing", async () => {
    server.use(http.head("https://example.com/favicon.ico", () => new HttpResponse(null, { status: 404 })))
    const outcome = await faviconRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues[0]?.rule).toBe("meta/favicon-missing")
      expect(outcome.issues[0]?.severity).toBe("info")
    }
  })

  it("fetch throws -> skip", async () => {
    server.use(http.head("https://example.com/favicon.ico", () => HttpResponse.error()))
    const outcome = await faviconRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("skip")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-meta test test/rules/favicon.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/favicon.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const FAVICON_TIMEOUT_MS = 5000

export const faviconRules: Rule[] = [
  {
    id: "meta/favicon-missing",
    weight: 1,
    runAsync: async ({ $, page }) => {
      const link = $("head link[rel~='icon']").first()
      const href = link.attr("href")
      const target = href
        ? new URL(href, page.finalUrl).toString()
        : new URL("/favicon.ico", page.finalUrl).toString()
      try {
        const res = await fetch(target, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(FAVICON_TIMEOUT_MS),
        })
        if (res.status === 200) return { outcome: "pass" }
        if (res.status === 404) {
          return {
            outcome: "fail",
            issues: [
              defineIssue({
                rule: "meta/favicon-missing",
                severity: "info",
                title: "Favicon not found",
                description: `HEAD ${target} returned 404.`,
                recommendation:
                  'Add <link rel="icon" href="/favicon.ico"> and serve the file at the site root.',
              }),
            ],
          }
        }
        return { outcome: "skip", reason: `favicon HTTP ${res.status}` }
      } catch (err) {
        return { outcome: "skip", reason: `favicon fetch failed: ${(err as Error).message}` }
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-meta test test/rules/favicon.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-meta/src/rules/favicon.ts packages/audit-meta/test/rules/favicon.test.ts
git commit -m "feat(audit-meta): add favicon-missing rule"
```

---

### Task 9: `meta/https` rule (scheme + mixed content)

**Files:**
- Create: `packages/audit-meta/src/rules/https.ts`
- Create: `packages/audit-meta/test/rules/https.test.ts`

- [ ] **Step 1: Write failing test `test/rules/https.test.ts`**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { httpsRules } from "../../src/rules/https.js"

const mk = (finalUrl: string, html: string) => ({
  requestedUrl: finalUrl,
  finalUrl,
  status: 200,
  contentType: "text/html",
  html,
})

describe("https rules", () => {
  it("https + no http resources -> all pass", () => {
    const page = mk("https://example.com/", '<img src="https://cdn.example.com/x.png">')
    const outcomes = httpsRules.map((r) => r.run!({ $: load(page.html), page }))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("http scheme -> https-scheme fails", () => {
    const page = mk("http://example.com/", "<html></html>")
    const outcomes = httpsRules.map((r) => r.run!({ $: load(page.html), page }))
    expect(
      outcomes.some((o) => o.outcome === "fail" && o.issues[0]?.rule === "meta/https-scheme")
    ).toBe(true)
  })

  it("https with http img src -> mixed-content fails", () => {
    const page = mk("https://example.com/", '<img src="http://insecure.test/a.png">')
    const outcomes = httpsRules.map((r) => r.run!({ $: load(page.html), page }))
    expect(
      outcomes.some(
        (o) => o.outcome === "fail" && o.issues[0]?.rule === "meta/https-mixed-content"
      )
    ).toBe(true)
  })

  it("ignores http://localhost as mixed content", () => {
    const page = mk("https://example.com/", '<img src="http://localhost:3000/dev.png">')
    const outcomes = httpsRules.map((r) => r.run!({ $: load(page.html), page }))
    expect(
      outcomes.every(
        (o) => !(o.outcome === "fail" && o.issues[0]?.rule === "meta/https-mixed-content")
      )
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-meta test test/rules/https.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/https.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-meta test test/rules/https.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-meta/src/rules/https.ts packages/audit-meta/test/rules/https.test.ts
git commit -m "feat(audit-meta): add https scheme + mixed-content rule"
```

---

### Task 10: Wire `audit-meta` RULES array, `audit()` entrypoint, integration test

**Files:**
- Modify: `packages/audit-meta/src/index.ts`
- Create: `packages/audit-meta/test/audit.test.ts`
- Create: `packages/audit-meta/__fixtures__/all-good.html`
- Create: `packages/audit-meta/__fixtures__/all-broken.html`

- [ ] **Step 1: Write fixtures for the integration test**

`__fixtures__/all-good.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="/favicon.png">
    <title>All Good</title>
  </head>
  <body></body>
</html>
```

`__fixtures__/all-broken.html`:
```html
<html>
  <head>
    <title>x</title>
    <img src="http://insecure.test/a.png">
  </head>
  <body></body>
</html>
```

- [ ] **Step 2: Write failing integration test `test/audit.test.ts`**

```ts
import { readFileSync } from "node:fs"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { audit } from "../src/index.js"
import { server } from "./setup.js"

const html = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}.html`, import.meta.url), "utf8")

describe("audit-meta integration", () => {
  it("clean page -> success with score 100", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html(html("all-good"))),
      http.head("https://example.com/favicon.png", () => new HttpResponse(null, { status: 200 }))
    )
    const result = await audit("https://example.com/")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("on-page")
      expect(result.score).toBe(100)
      expect(result.issues).toEqual([])
    }
  })

  it("broken page -> success with issues", async () => {
    server.use(
      http.get("https://example.com/broken", () => HttpResponse.html(html("all-broken"))),
      http.head("https://example.com/favicon.ico", () => new HttpResponse(null, { status: 404 }))
    )
    const result = await audit("https://example.com/broken")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.issues.length).toBeGreaterThan(0)
      const ruleIds = result.issues.map((i) => i.rule)
      expect(ruleIds).toContain("meta/viewport-missing")
      expect(ruleIds).toContain("meta/lang-missing")
      expect(ruleIds).toContain("meta/doctype-missing")
      expect(ruleIds).toContain("meta/encoding-missing")
      expect(ruleIds).toContain("meta/favicon-missing")
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @repo/audit-meta test test/audit.test.ts`
Expected: FAIL (`audit` not exported).

- [ ] **Step 4: Implement `src/index.ts`**

```ts
import { withTiming } from "@repo/audit-core"
import {
  deriveScore,
  executeRule,
  fetchPage,
  parse,
  type Rule,
} from "@repo/audit-html-core"
import packageJson from "../package.json" with { type: "json" }
import { doctypeRules } from "./rules/doctype.js"
import { encodingRules } from "./rules/encoding.js"
import { faviconRules } from "./rules/favicon.js"
import { httpsRules } from "./rules/https.js"
import { langRules } from "./rules/lang.js"
import { viewportRules } from "./rules/viewport.js"

const RULES: Rule[] = [
  ...viewportRules,
  ...langRules,
  ...doctypeRules,
  ...encodingRules,
  ...faviconRules,
  ...httpsRules,
]

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "on-page",
  packageName: "@repo/audit-meta",
  packageVersion,
})(async ({ url, opts }) => {
  const page = await fetchPage(url, {
    ...(opts?.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
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

- [ ] **Step 5: Run all audit-meta tests**

Run: `bun --filter @repo/audit-meta test`
Expected: all rule tests + integration test pass.

- [ ] **Step 6: Verify build works**

Run: `bun --filter @repo/audit-meta build`
Expected: builds `dist/index.js` and `dist/bin.js`.

- [ ] **Step 7: Commit**

```bash
git add packages/audit-meta/src/index.ts packages/audit-meta/test/audit.test.ts packages/audit-meta/__fixtures__/all-*.html
git commit -m "feat(audit-meta): wire RULES array + audit() entrypoint"
```

---

### Task 11: Scaffold `@repo/audit-structured` package

Same shape as Task 3 (`audit-meta` scaffolding) — package.json, tsconfig, tsdown, vitest, test/setup, src/index stub, src/bin.

**Files:**
- Create: `packages/audit-structured/package.json`
- Create: `packages/audit-structured/tsconfig.json`
- Create: `packages/audit-structured/tsdown.config.ts`
- Create: `packages/audit-structured/vitest.config.ts`
- Create: `packages/audit-structured/test/setup.ts`
- Create: `packages/audit-structured/src/index.ts` (stub)
- Create: `packages/audit-structured/src/bin.ts`

- [ ] **Step 1: Write `packages/audit-structured/package.json`** (identical to audit-meta except name and bin)

```json
{
  "name": "@repo/audit-structured",
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
  "bin": {
    "audit-structured": "./dist/bin.js"
  },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "vitest run"
  },
  "dependencies": {
    "@repo/audit-core": "workspace:*",
    "@repo/audit-html-core": "workspace:*"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^25.0.2",
    "msw": "^2.7.0",
    "tsdown": "catalog:",
    "typescript": "^5.7.3",
    "vitest": "^4.0.15"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** (same content as Task 3 Step 2)

```json
{
  "extends": "@repo/typescript-config/node.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "test", "__fixtures__"]
}
```

- [ ] **Step 3: Write `tsdown.config.ts`** (same as Task 3 Step 3)

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
  fixedExtension: false,
})
```

- [ ] **Step 4: Write `vitest.config.ts`** (same as Task 3 Step 4)

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

- [ ] **Step 5: Write `test/setup.ts`** (same as Task 3 Step 5)

```ts
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll } from "vitest"

export const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

- [ ] **Step 6: Write stub `src/index.ts`**

```ts
export {}
```

- [ ] **Step 7: Write `src/bin.ts`**

```ts
#!/usr/bin/env node
import { audit } from "./index.js"

const url = process.argv[2]
if (!url) {
  console.error("usage: audit-structured <url>")
  process.exit(2)
}
const result = await audit(url)
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === "success" ? 0 : 1)
```

- [ ] **Step 8: Install + commit**

Run: `bun install`

```bash
git add packages/audit-structured
git commit -m "chore(audit-structured): scaffold package"
```

---

### Task 12: `structured/schema-org-invalid` rule

**Files:**
- Create: `packages/audit-structured/src/rules/schema-org.ts`
- Create: `packages/audit-structured/test/rules/schema-org.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { schemaOrgRules } from "../../src/rules/schema-org.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("schema-org rule", () => {
  it("valid JSON-LD with @context schema.org -> pass", () => {
    const html =
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","name":"x"}</script>'
    const outcomes = schemaOrgRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes.every((o) => o.outcome === "pass")).toBe(true)
  })

  it("no JSON-LD -> fail with 'No structured data'", () => {
    const outcomes = schemaOrgRules.map((r) => r.run!({ $: load("<p>hi</p>"), page }))
    const fail = outcomes.find((o) => o.outcome === "fail")
    expect(fail).toBeDefined()
    if (fail?.outcome === "fail") {
      expect(fail.issues[0]?.title).toContain("No structured data")
    }
  })

  it("invalid JSON in JSON-LD -> fail", () => {
    const html = '<script type="application/ld+json">{ not json }</script>'
    const outcomes = schemaOrgRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })

  it("JSON-LD without @context -> fail", () => {
    const html = '<script type="application/ld+json">{"@type":"Article"}</script>'
    const outcomes = schemaOrgRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes.some((o) => o.outcome === "fail")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-structured test test/rules/schema-org.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/schema-org.ts`**

```ts
import { defineIssue, type IssueOccurrence } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

function hasSchemaOrgContext(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== "object") return false
  const ctx = (parsed as { "@context"?: unknown })["@context"]
  if (typeof ctx === "string") return ctx.includes("schema.org")
  if (Array.isArray(ctx)) return ctx.some((c) => typeof c === "string" && c.includes("schema.org"))
  return false
}

export const schemaOrgRules: Rule[] = [
  {
    id: "structured/schema-org-invalid",
    weight: 4,
    run: ({ $ }) => {
      const blocks = $('script[type="application/ld+json"]').toArray()
      if (blocks.length === 0) {
        return {
          outcome: "fail",
          issues: [
            defineIssue({
              rule: "structured/schema-org-invalid",
              severity: "warn",
              title: "No structured data",
              description: "The page has no <script type=\"application/ld+json\"> blocks.",
              recommendation:
                "Add JSON-LD structured data describing the primary entity on the page (Article, Product, Organization, …).",
            }),
          ],
        }
      }
      const failures: IssueOccurrence[] = []
      let validCount = 0
      blocks.forEach((el, idx) => {
        const raw = $(el).text().trim()
        try {
          const parsed = JSON.parse(raw)
          if (hasSchemaOrgContext(parsed)) {
            validCount++
          } else {
            failures.push({
              snippet: `block ${idx}: missing schema.org @context`,
            })
          }
        } catch (err) {
          failures.push({
            snippet: `block ${idx}: ${(err as Error).message.slice(0, 100)}`,
          })
        }
      })
      if (validCount > 0 && failures.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/schema-org-invalid",
            severity: "warn",
            title:
              validCount > 0 ? "Some JSON-LD blocks are invalid" : "All JSON-LD blocks are invalid",
            description: `${failures.length} of ${blocks.length} JSON-LD blocks failed to parse or lack a schema.org @context.`,
            recommendation:
              "Validate JSON syntax and include \"@context\": \"https://schema.org\" on each block.",
            occurrences: failures.slice(0, 5),
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-structured test test/rules/schema-org.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-structured/src/rules/schema-org.ts packages/audit-structured/test/rules/schema-org.test.ts
git commit -m "feat(audit-structured): add schema-org-invalid rule"
```

---

### Task 13: `structured/microformats-found` rule

**Files:**
- Create: `packages/audit-structured/src/rules/microformats.ts`
- Create: `packages/audit-structured/test/rules/microformats.test.ts`

**Design note:** `RuleOutcome { outcome: "pass" }` carries no issues — only `fail` does. To surface detected microformats as an informational notice (the spec intent), the rule emits `outcome: "fail"` with `severity: "info"` when microformats are present. The rule's weight is 1, so it can't meaningfully drop the score; the info issue is purely a notice. When no microformats are present, the rule passes silently.

- [ ] **Step 1: Write failing test**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { microformatsRules } from "../../src/rules/microformats.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("microformats rule", () => {
  it("h-card detected -> fail with info severity issue", () => {
    const html = '<div class="h-card"><span class="p-name">Jane</span></div>'
    const outcomes = microformatsRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
    if (outcomes[0]?.outcome === "fail") {
      expect(outcomes[0].issues[0]?.severity).toBe("info")
      expect(outcomes[0].issues[0]?.title).toContain("Microformats detected")
      expect(outcomes[0].issues[0]?.description).toContain("h-card")
    }
  })

  it("no microformats -> pass", () => {
    const outcomes = microformatsRules.map((r) => r.run!({ $: load("<p>x</p>"), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("ignores partial-match classes like h-card-wrapper", () => {
    const html = '<div class="h-card-wrapper"></div>'
    const outcomes = microformatsRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-structured test test/rules/microformats.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/microformats.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const MICROFORMAT_CLASSES = [
  "h-card",
  "h-entry",
  "h-event",
  "h-feed",
  "h-recipe",
  "h-resume",
  "h-review",
  "h-product",
]

export const microformatsRules: Rule[] = [
  {
    id: "structured/microformats-found",
    weight: 1,
    run: ({ $ }) => {
      const found: string[] = []
      for (const cls of MICROFORMAT_CLASSES) {
        if ($(`.${cls}`).length > 0) found.push(cls)
      }
      if (found.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/microformats-found",
            severity: "info",
            title: "Microformats detected",
            description: `The page uses microformats: ${found.join(", ")}.`,
            recommendation:
              "Microformats are a positive signal for semantic content. No action needed.",
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-structured test test/rules/microformats.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-structured/src/rules/microformats.ts packages/audit-structured/test/rules/microformats.test.ts
git commit -m "feat(audit-structured): add microformats-found rule"
```

---

### Task 14: `structured/llms-txt-missing` rule (async)

**Files:**
- Create: `packages/audit-structured/src/rules/llms-txt.ts`
- Create: `packages/audit-structured/test/rules/llms-txt.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { load } from "cheerio"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { llmsTxtRules } from "../../src/rules/llms-txt.js"
import { server } from "../setup.js"

const basePage = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("llms-txt rule", () => {
  it("HEAD /llms.txt 200 -> pass", async () => {
    server.use(http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 200 })))
    const outcome = await llmsTxtRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("pass")
  })

  it("HEAD /llms.txt 404 -> fail with info severity", async () => {
    server.use(http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 404 })))
    const outcome = await llmsTxtRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues[0]?.rule).toBe("structured/llms-txt-missing")
      expect(outcome.issues[0]?.severity).toBe("info")
    }
  })

  it("HEAD /llms.txt 500 -> skip", async () => {
    server.use(http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 500 })))
    const outcome = await llmsTxtRules[0]!.runAsync!({ $: load("<html></html>"), page: basePage })
    expect(outcome.outcome).toBe("skip")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-structured test test/rules/llms-txt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/llms-txt.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"

const LLMS_TIMEOUT_MS = 5000

export const llmsTxtRules: Rule[] = [
  {
    id: "structured/llms-txt-missing",
    weight: 1,
    runAsync: async ({ page }) => {
      const url = new URL("/llms.txt", page.finalUrl).toString()
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(LLMS_TIMEOUT_MS),
        })
        if (res.status === 200) return { outcome: "pass" }
        if (res.status === 404) {
          return {
            outcome: "fail",
            issues: [
              defineIssue({
                rule: "structured/llms-txt-missing",
                severity: "info",
                title: "llms.txt is missing",
                description: `No llms.txt at ${url}.`,
                recommendation:
                  "Add an llms.txt at the site root to help LLM crawlers discover key pages.",
              }),
            ],
          }
        }
        return { outcome: "skip", reason: `llms.txt HTTP ${res.status}` }
      } catch (err) {
        return { outcome: "skip", reason: `llms.txt fetch failed: ${(err as Error).message}` }
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-structured test test/rules/llms-txt.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-structured/src/rules/llms-txt.ts packages/audit-structured/test/rules/llms-txt.test.ts
git commit -m "feat(audit-structured): add llms-txt-missing rule"
```

---

### Task 15: `structured/og-facebook-missing` rule

**Files:**
- Create: `packages/audit-structured/src/rules/open-graph-facebook.ts`
- Create: `packages/audit-structured/test/rules/open-graph-facebook.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { ogFacebookRules } from "../../src/rules/open-graph-facebook.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const ogHtml = (tags: Record<string, string>) =>
  Object.entries(tags)
    .map(([k, v]) => `<meta property="${k}" content="${v}">`)
    .join("")

describe("og-facebook rule", () => {
  it("all 4 required tags present -> pass", () => {
    const html = ogHtml({
      "og:title": "x",
      "og:type": "website",
      "og:image": "https://example.com/i.png",
      "og:url": "https://example.com/",
    })
    const outcomes = ogFacebookRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("missing og:image -> fail listing missing", () => {
    const html = ogHtml({
      "og:title": "x",
      "og:type": "website",
      "og:url": "https://example.com/",
    })
    const outcomes = ogFacebookRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
    if (outcomes[0]?.outcome === "fail") {
      expect(outcomes[0].issues[0]?.rule).toBe("structured/og-facebook-missing")
      expect(outcomes[0].issues[0]?.description).toContain("og:image")
    }
  })

  it("accepts og:* via name= attribute as fallback", () => {
    const html =
      '<meta name="og:title" content="x"><meta name="og:type" content="website"><meta name="og:image" content="https://example.com/i.png"><meta name="og:url" content="https://example.com/">'
    const outcomes = ogFacebookRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-structured test test/rules/open-graph-facebook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/open-graph-facebook.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule, RuleContext } from "@repo/audit-html-core"

export function readOgTag($: RuleContext["$"], tag: string): string | null {
  const byProperty = $(`meta[property="${tag}"]`).first().attr("content")
  if (byProperty) return byProperty
  const byName = $(`meta[name="${tag}"]`).first().attr("content")
  return byName ?? null
}

const REQUIRED = ["og:title", "og:type", "og:image", "og:url"] as const

export const ogFacebookRules: Rule[] = [
  {
    id: "structured/og-facebook-missing",
    weight: 2,
    run: ({ $ }) => {
      const missing = REQUIRED.filter((t) => !readOgTag($, t))
      if (missing.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/og-facebook-missing",
            severity: "warn",
            title: "Missing Open Graph tags for Facebook",
            description: `Missing required tags: ${missing.join(", ")}.`,
            recommendation:
              'Add <meta property="og:title">, <meta property="og:type">, <meta property="og:image">, and <meta property="og:url"> in <head>.',
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-structured test test/rules/open-graph-facebook.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-structured/src/rules/open-graph-facebook.ts packages/audit-structured/test/rules/open-graph-facebook.test.ts
git commit -m "feat(audit-structured): add og-facebook-missing rule"
```

---

### Task 16: `structured/og-twitter-missing` rule

**Files:**
- Create: `packages/audit-structured/src/rules/open-graph-twitter.ts`
- Create: `packages/audit-structured/test/rules/open-graph-twitter.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { ogTwitterRules } from "../../src/rules/open-graph-twitter.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("og-twitter rule", () => {
  it("all twitter:* tags present -> pass", () => {
    const html =
      '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="x"><meta name="twitter:description" content="d"><meta name="twitter:image" content="https://example.com/i.png">'
    const outcomes = ogTwitterRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("twitter:card + og:* fallbacks -> pass", () => {
    const html =
      '<meta name="twitter:card" content="summary_large_image"><meta property="og:title" content="x"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.png">'
    const outcomes = ogTwitterRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("missing twitter:card -> fail", () => {
    const html =
      '<meta property="og:title" content="x"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.png">'
    const outcomes = ogTwitterRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-structured test test/rules/open-graph-twitter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/open-graph-twitter.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import { readOgTag } from "./open-graph-facebook.js"

const TWITTER_REQUIRED: Array<{ tag: string; fallback?: string }> = [
  { tag: "twitter:card" },
  { tag: "twitter:title", fallback: "og:title" },
  { tag: "twitter:description", fallback: "og:description" },
  { tag: "twitter:image", fallback: "og:image" },
]

export const ogTwitterRules: Rule[] = [
  {
    id: "structured/og-twitter-missing",
    weight: 2,
    run: ({ $ }) => {
      const missing: string[] = []
      for (const { tag, fallback } of TWITTER_REQUIRED) {
        if (readOgTag($, tag)) continue
        if (fallback && readOgTag($, fallback)) continue
        missing.push(tag)
      }
      if (missing.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/og-twitter-missing",
            severity: "warn",
            title: "Missing Open Graph tags for Twitter",
            description: `Missing required tags: ${missing.join(", ")} (no og:* fallback found where applicable).`,
            recommendation:
              'Add <meta name="twitter:card" content="summary_large_image"> and the twitter:title / description / image tags (or rely on og:* equivalents).',
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-structured test test/rules/open-graph-twitter.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-structured/src/rules/open-graph-twitter.ts packages/audit-structured/test/rules/open-graph-twitter.test.ts
git commit -m "feat(audit-structured): add og-twitter-missing rule"
```

---

### Task 17: `structured/og-pinterest-missing` rule

**Files:**
- Create: `packages/audit-structured/src/rules/open-graph-pinterest.ts`
- Create: `packages/audit-structured/test/rules/open-graph-pinterest.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { ogPinterestRules } from "../../src/rules/open-graph-pinterest.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("og-pinterest rule", () => {
  it("og:image + og:description present -> pass", () => {
    const html =
      '<meta property="og:image" content="https://example.com/i.png"><meta property="og:description" content="d">'
    const outcomes = ogPinterestRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("missing og:description -> fail", () => {
    const html = '<meta property="og:image" content="https://example.com/i.png">'
    const outcomes = ogPinterestRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-structured test test/rules/open-graph-pinterest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/open-graph-pinterest.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import { readOgTag } from "./open-graph-facebook.js"

const REQUIRED = ["og:image", "og:description"] as const

export const ogPinterestRules: Rule[] = [
  {
    id: "structured/og-pinterest-missing",
    weight: 2,
    run: ({ $ }) => {
      const missing = REQUIRED.filter((t) => !readOgTag($, t))
      if (missing.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/og-pinterest-missing",
            severity: "warn",
            title: "Missing Open Graph tags for Pinterest",
            description: `Missing required tags: ${missing.join(", ")}.`,
            recommendation:
              'Add <meta property="og:image"> (at least 600px wide) and <meta property="og:description"> in <head>.',
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-structured test test/rules/open-graph-pinterest.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-structured/src/rules/open-graph-pinterest.ts packages/audit-structured/test/rules/open-graph-pinterest.test.ts
git commit -m "feat(audit-structured): add og-pinterest-missing rule"
```

---

### Task 18: `structured/og-linkedin-missing` rule

**Files:**
- Create: `packages/audit-structured/src/rules/open-graph-linkedin.ts`
- Create: `packages/audit-structured/test/rules/open-graph-linkedin.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { ogLinkedinRules } from "../../src/rules/open-graph-linkedin.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

describe("og-linkedin rule", () => {
  it("all 4 required tags present -> pass", () => {
    const html =
      '<meta property="og:title" content="x"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.png"><meta property="og:url" content="https://example.com/">'
    const outcomes = ogLinkedinRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("pass")
  })

  it("missing og:url -> fail", () => {
    const html =
      '<meta property="og:title" content="x"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.png">'
    const outcomes = ogLinkedinRules.map((r) => r.run!({ $: load(html), page }))
    expect(outcomes[0]?.outcome).toBe("fail")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-structured test test/rules/open-graph-linkedin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/open-graph-linkedin.ts`**

```ts
import { defineIssue } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import { readOgTag } from "./open-graph-facebook.js"

const REQUIRED = ["og:title", "og:image", "og:description", "og:url"] as const

export const ogLinkedinRules: Rule[] = [
  {
    id: "structured/og-linkedin-missing",
    weight: 2,
    run: ({ $ }) => {
      const missing = REQUIRED.filter((t) => !readOgTag($, t))
      if (missing.length === 0) return { outcome: "pass" }
      return {
        outcome: "fail",
        issues: [
          defineIssue({
            rule: "structured/og-linkedin-missing",
            severity: "warn",
            title: "Missing Open Graph tags for LinkedIn",
            description: `Missing required tags: ${missing.join(", ")}.`,
            recommendation:
              'Add <meta property="og:title">, <meta property="og:image">, <meta property="og:description">, and <meta property="og:url"> in <head>.',
          }),
        ],
      }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-structured test test/rules/open-graph-linkedin.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-structured/src/rules/open-graph-linkedin.ts packages/audit-structured/test/rules/open-graph-linkedin.test.ts
git commit -m "feat(audit-structured): add og-linkedin-missing rule"
```

---

### Task 19: Wire `audit-structured` RULES array, `audit()` entrypoint, integration test

**Files:**
- Modify: `packages/audit-structured/src/index.ts`
- Create: `packages/audit-structured/test/audit.test.ts`
- Create: `packages/audit-structured/__fixtures__/all-good.html`
- Create: `packages/audit-structured/__fixtures__/all-broken.html`

- [ ] **Step 1: Write fixtures**

`__fixtures__/all-good.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","name":"x"}</script>
<meta property="og:title" content="x">
<meta property="og:type" content="article">
<meta property="og:image" content="https://example.com/i.png">
<meta property="og:url" content="https://example.com/">
<meta property="og:description" content="d">
<meta name="twitter:card" content="summary_large_image">
</head>
<body></body>
</html>
```

`__fixtures__/all-broken.html`:
```html
<html><head></head><body></body></html>
```

- [ ] **Step 2: Write failing integration test**

```ts
import { readFileSync } from "node:fs"
import { HttpResponse, http } from "msw"
import { describe, expect, it } from "vitest"
import { audit } from "../src/index.js"
import { server } from "./setup.js"

const html = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}.html`, import.meta.url), "utf8")

describe("audit-structured integration", () => {
  it("clean page -> success with score 100", async () => {
    server.use(
      http.get("https://example.com/", () => HttpResponse.html(html("all-good"))),
      http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 200 }))
    )
    const result = await audit("https://example.com/")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("seo")
      expect(result.score).toBe(100)
    }
  })

  it("broken page -> success with multiple issues", async () => {
    server.use(
      http.get("https://example.com/broken", () => HttpResponse.html(html("all-broken"))),
      http.head("https://example.com/llms.txt", () => new HttpResponse(null, { status: 404 }))
    )
    const result = await audit("https://example.com/broken")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      const ids = result.issues.map((i) => i.rule)
      expect(ids).toContain("structured/schema-org-invalid")
      expect(ids).toContain("structured/llms-txt-missing")
      expect(ids).toContain("structured/og-facebook-missing")
      expect(ids).toContain("structured/og-twitter-missing")
      expect(ids).toContain("structured/og-pinterest-missing")
      expect(ids).toContain("structured/og-linkedin-missing")
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @repo/audit-structured test test/audit.test.ts`
Expected: FAIL (`audit` not exported).

- [ ] **Step 4: Implement `src/index.ts`**

```ts
import { withTiming } from "@repo/audit-core"
import {
  deriveScore,
  executeRule,
  fetchPage,
  parse,
  type Rule,
} from "@repo/audit-html-core"
import packageJson from "../package.json" with { type: "json" }
import { llmsTxtRules } from "./rules/llms-txt.js"
import { microformatsRules } from "./rules/microformats.js"
import { ogFacebookRules } from "./rules/open-graph-facebook.js"
import { ogLinkedinRules } from "./rules/open-graph-linkedin.js"
import { ogPinterestRules } from "./rules/open-graph-pinterest.js"
import { ogTwitterRules } from "./rules/open-graph-twitter.js"
import { schemaOrgRules } from "./rules/schema-org.js"

const RULES: Rule[] = [
  ...schemaOrgRules,
  ...microformatsRules,
  ...llmsTxtRules,
  ...ogFacebookRules,
  ...ogTwitterRules,
  ...ogPinterestRules,
  ...ogLinkedinRules,
]

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "seo",
  packageName: "@repo/audit-structured",
  packageVersion,
})(async ({ url, opts }) => {
  const page = await fetchPage(url, {
    ...(opts?.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
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

- [ ] **Step 5: Run all audit-structured tests + build**

Run: `bun --filter @repo/audit-structured test && bun --filter @repo/audit-structured build`
Expected: all pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-structured/src/index.ts packages/audit-structured/test/audit.test.ts packages/audit-structured/__fixtures__/all-*.html
git commit -m "feat(audit-structured): wire RULES array + audit() entrypoint"
```

---

### Task 20: Scaffold `@repo/audit-content` package + English stopwords

**Files:**
- Create: `packages/audit-content/package.json`
- Create: `packages/audit-content/tsconfig.json`
- Create: `packages/audit-content/tsdown.config.ts`
- Create: `packages/audit-content/vitest.config.ts`
- Create: `packages/audit-content/src/index.ts` (stub)
- Create: `packages/audit-content/src/bin.ts`
- Create: `packages/audit-content/src/stopwords-en.ts`

- [ ] **Step 1: Write `package.json`** (no msw — content rules don't make HTTP requests)

```json
{
  "name": "@repo/audit-content",
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
  "bin": {
    "audit-content": "./dist/bin.js"
  },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "vitest run"
  },
  "dependencies": {
    "@repo/audit-core": "workspace:*",
    "@repo/audit-html-core": "workspace:*"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^25.0.2",
    "tsdown": "catalog:",
    "typescript": "^5.7.3",
    "vitest": "^4.0.15"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** (same as Task 3 Step 2)

```json
{
  "extends": "@repo/typescript-config/node.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "test", "__fixtures__"]
}
```

- [ ] **Step 3: Write `tsdown.config.ts`** (same as Task 3 Step 3)

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
  fixedExtension: false,
})
```

- [ ] **Step 4: Write `vitest.config.ts`** (no setupFiles — no msw)

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 5: Write `src/stopwords-en.ts`**

```ts
export const STOPWORDS_EN: Set<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "have", "he", "her", "his", "i", "in", "is", "it", "its", "more",
  "no", "not", "of", "on", "or", "our", "she", "so", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "to",
  "was", "we", "were", "what", "when", "where", "which", "who", "why",
  "will", "with", "would", "you", "your",
])
```

- [ ] **Step 6: Write stub `src/index.ts`**

```ts
export {}
```

- [ ] **Step 7: Write `src/bin.ts`**

```ts
#!/usr/bin/env node
import { audit } from "./index.js"

const url = process.argv[2]
if (!url) {
  console.error("usage: audit-content <url>")
  process.exit(2)
}
const result = await audit(url)
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === "success" ? 0 : 1)
```

- [ ] **Step 8: Install + commit**

Run: `bun install`

```bash
git add packages/audit-content
git commit -m "chore(audit-content): scaffold package + English stopwords"
```

---

### Task 21: `content/keyword-density` rule

**Files:**
- Create: `packages/audit-content/src/rules/keyword-density.ts`
- Create: `packages/audit-content/test/rules/keyword-density.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { load } from "cheerio"
import { describe, expect, it } from "vitest"
import { keywordDensityRules } from "../../src/rules/keyword-density.js"

const page = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  contentType: "text/html",
  html: "",
}

const repeatText = (word: string, n: number) =>
  `<p>${Array(n).fill(word).join(" ")}</p>`

describe("keyword-density rule", () => {
  it("under 50 tokens -> skip", () => {
    const html = "<p>only a few words here on this small page</p>"
    const outcome = keywordDensityRules[0]!.run!({ $: load(html), page })
    expect(outcome.outcome).toBe("skip")
  })

  it("balanced 100-word content -> emits info-severity issues only", () => {
    const balanced = Array(100)
      .fill(0)
      .map((_, i) => `term${i % 20}`)
      .join(" ")
    const outcome = keywordDensityRules[0]!.run!({
      $: load(`<p>${balanced}</p>`),
      page,
    })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues.every((i) => i.severity === "info")).toBe(true)
    }
  })

  it("single term > 5% -> warn-severity stuffing issue", () => {
    const html = repeatText("widget", 100) + "<p>" + Array(50).fill("filler").join(" ") + "</p>"
    const outcome = keywordDensityRules[0]!.run!({ $: load(html), page })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      const warn = outcome.issues.find((i) => i.severity === "warn")
      expect(warn).toBeDefined()
      expect(warn?.title).toContain("widget")
    }
  })

  it("excludes <script> and <style> from content", () => {
    const html =
      '<script>const x = "hidden";</script><style>.a {}</style>' +
      repeatText("visible", 60)
    const outcome = keywordDensityRules[0]!.run!({ $: load(html), page })
    expect(outcome.outcome).toBe("fail")
    if (outcome.outcome === "fail") {
      expect(outcome.issues.every((i) => !i.description.includes("hidden"))).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-content test test/rules/keyword-density.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/rules/keyword-density.ts`**

```ts
import { defineIssue, type Issue, type IssueOccurrence } from "@repo/audit-core"
import type { Rule } from "@repo/audit-html-core"
import { STOPWORDS_EN } from "../stopwords-en.js"

const WORD_RE = /[\p{L}]+/gu
const MIN_TOKENS = 50
const MAX_TOKENS = 100_000
const TOP_N = 10
const STUFFING_THRESHOLD = 0.05

function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? []
}

function buildNgrams(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>()
  if (tokens.length < n) return counts
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n).join(" ")
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

function topByCount(counts: Map<string, number>, k: number): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
}

export const keywordDensityRules: Rule[] = [
  {
    id: "content/keyword-density",
    weight: 1,
    run: ({ $ }) => {
      const text = $("body").clone().find("script,style,noscript").remove().end().text()
      const allTokens = tokenize(text)
      if (allTokens.length < MIN_TOKENS) {
        return { outcome: "skip", reason: `page has only ${allTokens.length} tokens` }
      }
      const tokens = allTokens.slice(0, MAX_TOKENS)
      const issues: Issue[] = []
      for (const n of [1, 2, 3, 4] as const) {
        const sourceTokens =
          n === 1 ? tokens.filter((t) => !STOPWORDS_EN.has(t)) : tokens
        const counts = buildNgrams(sourceTokens, n)
        const total = [...counts.values()].reduce((a, b) => a + b, 0)
        if (total === 0) continue
        const top = topByCount(counts, TOP_N)
        const occurrences: IssueOccurrence[] = top.map(([term, count]) => ({
          snippet: `${term} — ${count}× (${((count / total) * 100).toFixed(2)}%)`,
        }))
        issues.push(
          defineIssue({
            rule: "content/keyword-density",
            severity: "info",
            title: `Top ${n}-word phrases`,
            description: `Top ${Math.min(TOP_N, top.length)} ${n}-word phrases by frequency (out of ${total} total ${n}-grams).`,
            recommendation:
              n === 1
                ? "Use this to spot keyword bias. v1 English-only; stopwords filtered."
                : "Use this to spot unintentional repetition of phrases.",
            occurrences: occurrences.slice(0, 5),
          })
        )
        for (const [term, count] of top) {
          const density = count / total
          if (density > STUFFING_THRESHOLD) {
            issues.push(
              defineIssue({
                rule: "content/keyword-density",
                severity: "warn",
                title: `Possible keyword stuffing: "${term}" appears in ${(density * 100).toFixed(1)}% of ${n}-grams`,
                description: `"${term}" occurs ${count} times out of ${total} ${n}-grams (>${(STUFFING_THRESHOLD * 100).toFixed(0)}% threshold).`,
                recommendation:
                  "Vary phrasing and use related terms to keep content natural and readable.",
              })
            )
          }
        }
      }
      if (issues.length === 0) return { outcome: "pass" }
      return { outcome: "fail", issues }
    },
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @repo/audit-content test test/rules/keyword-density.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/audit-content/src/rules/keyword-density.ts packages/audit-content/test/rules/keyword-density.test.ts
git commit -m "feat(audit-content): add keyword-density rule"
```

---

### Task 22: Wire `audit-content` RULES array, `audit()` entrypoint, integration test

**Files:**
- Modify: `packages/audit-content/src/index.ts`
- Create: `packages/audit-content/test/audit.test.ts`
- Create: `packages/audit-content/__fixtures__/short.html`

- [ ] **Step 1: Write fixture `__fixtures__/short.html`** (deliberately under 50 tokens to trigger skip)

```html
<!DOCTYPE html><html><head></head><body><p>Hello world this is short.</p></body></html>
```

- [ ] **Step 2: Write failing integration test**

```ts
import { readFileSync } from "node:fs"
import { HttpResponse, http } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { audit } from "../src/index.js"

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const html = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}.html`, import.meta.url), "utf8")

describe("audit-content integration", () => {
  it("short page -> success with skipped rule (score 100)", async () => {
    server.use(
      http.get("https://example.com/short", () => HttpResponse.html(html("short")))
    )
    const result = await audit("https://example.com/short")
    expect(result.status).toBe("success")
    if (result.status === "success") {
      expect(result.category).toBe("seo")
      expect(result.score).toBe(100)
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @repo/audit-content test test/audit.test.ts`
Expected: FAIL (`audit` not exported).

- [ ] **Step 4: Implement `src/index.ts`**

```ts
import { withTiming } from "@repo/audit-core"
import {
  deriveScore,
  executeRule,
  fetchPage,
  parse,
  type Rule,
} from "@repo/audit-html-core"
import packageJson from "../package.json" with { type: "json" }
import { keywordDensityRules } from "./rules/keyword-density.js"

const RULES: Rule[] = [...keywordDensityRules]

const packageVersion = (packageJson as { version: string }).version

export const audit = withTiming({
  category: "seo",
  packageName: "@repo/audit-content",
  packageVersion,
})(async ({ url, opts }) => {
  const page = await fetchPage(url, {
    ...(opts?.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
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

- [ ] **Step 5: Run all audit-content tests + build**

Run: `bun --filter @repo/audit-content test && bun --filter @repo/audit-content build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-content/src/index.ts packages/audit-content/test/audit.test.ts packages/audit-content/__fixtures__/short.html
git commit -m "feat(audit-content): wire RULES array + audit() entrypoint"
```

---

### Task 23: Extend `AuditPackages` contract with `meta` / `structured` / `content`

**Files:**
- Modify: `packages/audit-cli/package.json` — add 3 new workspace deps
- Modify: `packages/audit-cli/src/aggregate.ts`

- [ ] **Step 1: Update `packages/audit-cli/package.json`**

Add to `dependencies` (keep alphabetical):

```json
"@repo/audit-best-practices": "workspace:*",
"@repo/audit-content": "workspace:*",
"@repo/audit-core": "workspace:*",
"@repo/audit-meta": "workspace:*",
"@repo/audit-onpage": "workspace:*",
"@repo/audit-perf": "workspace:*",
"@repo/audit-pwa": "workspace:*",
"@repo/audit-seo": "workspace:*",
"@repo/audit-structured": "workspace:*",
"@repo/lighthouse-runner": "workspace:*",
"commander": "catalog:",
"zod": "catalog:"
```

Run: `bun install`

- [ ] **Step 2: Extend `AuditPackages` type in `packages/audit-cli/src/aggregate.ts`**

Add these three fields to the `AuditPackages` type and wire them into `aggregate()` so they run alongside the existing per-category packages.

Replace the file contents with:

```ts
import type { AuditResult, Category } from "@repo/audit-core"

export type AuditPackages = {
  runLighthouse: (
    url: string,
    opts: { timeoutMs?: number; formFactor?: "mobile" | "desktop" }
  ) => Promise<unknown>
  perf: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  seo: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  bestPractices: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  pwa: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  onpage: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
  meta: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
  structured: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
  content: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
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
  pkgs: AuditPackages
): Promise<AuditResult[]> {
  const wants = (c: Category) => !opts.only || opts.only.includes(c)

  const needsLh = wants("performance") || wants("seo") || wants("best-practices") || wants("pwa")

  let lhr: unknown
  if (needsLh) {
    try {
      lhr = await pkgs.runLighthouse(url, {
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.formFactor !== undefined ? { formFactor: opts.formFactor } : {}),
      })
    } catch {
      lhr = undefined
    }
  }

  const tasks: Promise<AuditResult>[] = []
  const subOpts = (extra?: object) => ({
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...extra,
  })

  if (wants("performance")) tasks.push(pkgs.perf(url, subOpts({ lighthouseResult: lhr })))
  if (wants("seo")) tasks.push(pkgs.seo(url, subOpts({ lighthouseResult: lhr })))
  if (wants("best-practices"))
    tasks.push(pkgs.bestPractices(url, subOpts({ lighthouseResult: lhr })))
  if (wants("pwa")) tasks.push(pkgs.pwa(url, subOpts({ lighthouseResult: lhr })))

  const onpageOpts = subOpts(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {})

  if (wants("on-page")) {
    tasks.push(pkgs.onpage(url, onpageOpts))
    tasks.push(pkgs.meta(url, onpageOpts))
  }
  if (wants("seo")) {
    tasks.push(pkgs.structured(url, onpageOpts))
    tasks.push(pkgs.content(url, onpageOpts))
  }

  return Promise.all(tasks)
}
```

- [ ] **Step 3: Verify type check**

Run: `bun --filter @repo/audit-cli check-types`
Expected: type-checking succeeds (no implementations broken).

- [ ] **Step 4: Commit**

```bash
git add packages/audit-cli/package.json packages/audit-cli/src/aggregate.ts
git commit -m "feat(audit-cli): extend AuditPackages contract with meta/structured/content"
```

---

### Task 24: `mergeByCategory` + tests

**Files:**
- Create: `packages/audit-cli/src/merge.ts`
- Create: `packages/audit-cli/test/merge.test.ts`
- Create: `packages/audit-cli/vitest.config.ts` if not present

- [ ] **Step 1: Verify or create vitest config**

Check: `cat packages/audit-cli/vitest.config.ts` — if missing, create it:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 2: Write failing test `packages/audit-cli/test/merge.test.ts`**

```ts
import type { AuditResult } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { mergeByCategory } from "../src/merge.js"

const base = {
  url: "https://example.com/",
  requestedUrl: "https://example.com/",
  startedAt: "2026-06-07T10:00:00.000Z",
  durationMs: 100,
  packageVersion: "0.0.0",
}

const success = (overrides: Partial<AuditResult> & { packageName: string }): AuditResult =>
  ({
    ...base,
    category: "seo",
    status: "success",
    score: 90,
    issues: [],
    raw: { ruleSummary: [{ rule: "r/x", weight: 1, outcome: "pass" }] },
    ...overrides,
  }) as AuditResult

const failed = (overrides: Partial<AuditResult> & { packageName: string }): AuditResult =>
  ({
    ...base,
    category: "seo",
    status: "failed",
    error: { code: "UNKNOWN", message: "boom", retryable: false },
    ...overrides,
  }) as AuditResult

describe("mergeByCategory", () => {
  it("single-package category passes through untouched", () => {
    const input = [success({ packageName: "@repo/audit-perf", category: "performance" })]
    const out = mergeByCategory(input)
    expect(out).toHaveLength(1)
    expect(out[0]?.packageName).toBe("@repo/audit-perf")
  })

  it("two successful contributors -> single merged success result", () => {
    const a = success({
      packageName: "@repo/audit-seo",
      score: 90,
      raw: { ruleSummary: [{ rule: "seo/a", weight: 4, outcome: "pass" }] },
    })
    const b = success({
      packageName: "@repo/audit-structured",
      score: 50,
      raw: { ruleSummary: [{ rule: "str/b", weight: 2, outcome: "fail" }] },
    })
    const out = mergeByCategory([a, b])
    expect(out).toHaveLength(1)
    const m = out[0]
    expect(m?.status).toBe("success")
    expect(m?.category).toBe("seo")
    expect(m?.packageName).toBe("merged")
    if (m?.status === "success") {
      // weighted average: (90*4 + 50*2) / 6 = 460/6 = 76.67 -> 77
      expect(m.score).toBe(77)
    }
  })

  it("one failed + one success -> merged partial with partialReasons", () => {
    const a = success({ packageName: "@repo/audit-seo", score: 80 })
    const b = failed({ packageName: "@repo/audit-structured" })
    const out = mergeByCategory([a, b])
    expect(out).toHaveLength(1)
    const m = out[0]
    expect(m?.status).toBe("partial")
    if (m?.status === "partial") {
      expect(m.partialReasons.some((r) => r.includes("@repo/audit-structured"))).toBe(true)
      expect(m.score).toBe(80)
    }
  })

  it("all contributors failed -> merged failed with aggregated message", () => {
    const a = failed({ packageName: "@repo/audit-seo" })
    const b = failed({ packageName: "@repo/audit-structured" })
    const out = mergeByCategory([a, b])
    expect(out).toHaveLength(1)
    expect(out[0]?.status).toBe("failed")
    if (out[0]?.status === "failed") {
      expect(out[0].error.message).toContain("@repo/audit-seo")
      expect(out[0].error.message).toContain("@repo/audit-structured")
    }
  })

  it("concatenates issues from all successful contributors", () => {
    const issueA = {
      rule: "x/a", severity: "warn" as const, title: "a", description: "a",
      recommendation: "a", count: 1, occurrences: [],
    }
    const issueB = {
      rule: "x/b", severity: "info" as const, title: "b", description: "b",
      recommendation: "b", count: 1, occurrences: [],
    }
    const a = success({ packageName: "@repo/audit-seo", issues: [issueA] })
    const b = success({ packageName: "@repo/audit-structured", issues: [issueB] })
    const out = mergeByCategory([a, b])
    if (out[0]?.status === "success") {
      const ruleIds = out[0].issues.map((i) => i.rule)
      expect(ruleIds).toContain("x/a")
      expect(ruleIds).toContain("x/b")
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @repo/audit-cli test test/merge.test.ts`
Expected: FAIL (`mergeByCategory` not exported).

- [ ] **Step 4: Implement `packages/audit-cli/src/merge.ts`**

```ts
import type { AuditResult, Category, Issue } from "@repo/audit-core"

type RuleSummaryRow = { rule: string; weight: number; outcome: string }

function totalWeight(r: AuditResult): number {
  if (r.status === "failed") return 0
  const raw = r.raw as { ruleSummary?: RuleSummaryRow[] } | null
  const rows = raw?.ruleSummary ?? []
  return rows.reduce((acc, row) => acc + (typeof row.weight === "number" ? row.weight : 0), 0)
}

function mergeOneCategory(category: Category, contributors: AuditResult[]): AuditResult {
  const first = contributors[0]
  if (!first) throw new Error("mergeOneCategory called with empty contributors")
  const succeeded = contributors.filter(
    (c): c is AuditResult & { status: "success" | "partial" } =>
      c.status === "success" || c.status === "partial"
  )
  const failedOnes = contributors.filter(
    (c): c is AuditResult & { status: "failed" } => c.status === "failed"
  )
  const partialOnes = contributors.filter(
    (c): c is AuditResult & { status: "partial" } => c.status === "partial"
  )
  const startedAtMs = Math.min(...contributors.map((c) => new Date(c.startedAt).getTime()))
  const endedAtMs = Math.max(
    ...contributors.map((c) => new Date(c.startedAt).getTime() + c.durationMs)
  )

  const baseFields = {
    category,
    url: first.url,
    requestedUrl: first.requestedUrl,
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs,
    packageName: "merged",
    packageVersion: "merged",
  }

  if (succeeded.length === 0) {
    const message =
      "all contributors failed: " +
      failedOnes.map((c) => `${c.packageName}: ${c.error.message}`).join("; ")
    return {
      ...baseFields,
      status: "failed",
      error: { code: "UNKNOWN", message, retryable: false },
    }
  }

  let weightedSum = 0
  let weightTotal = 0
  for (const c of succeeded) {
    const w = totalWeight(c)
    if (w === 0) continue
    weightedSum += c.score * w
    weightTotal += w
  }
  const score = weightTotal === 0 ? 100 : Math.round(weightedSum / weightTotal)

  const issues: Issue[] = succeeded.flatMap((c) => c.issues)
  const raw = Object.fromEntries(succeeded.map((c) => [c.packageName, c.raw]))

  const partialReasons: string[] = [
    ...failedOnes.map((c) => `${c.packageName} failed: ${c.error.message}`),
    ...partialOnes.flatMap((c) => c.partialReasons.map((r) => `${c.packageName}: ${r}`)),
  ]

  if (partialReasons.length > 0) {
    return {
      ...baseFields,
      status: "partial",
      score,
      issues,
      raw,
      partialReasons,
    }
  }

  return {
    ...baseFields,
    status: "success",
    score,
    issues,
    raw,
  }
}

export function mergeByCategory(results: AuditResult[]): AuditResult[] {
  const byCategory = new Map<Category, AuditResult[]>()
  for (const r of results) {
    const arr = byCategory.get(r.category) ?? []
    arr.push(r)
    byCategory.set(r.category, arr)
  }
  const out: AuditResult[] = []
  for (const [category, contributors] of byCategory) {
    if (contributors.length === 1 && contributors[0]) {
      out.push(contributors[0])
    } else {
      out.push(mergeOneCategory(category, contributors))
    }
  }
  return out
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --filter @repo/audit-cli test test/merge.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/audit-cli/src/merge.ts packages/audit-cli/test/merge.test.ts packages/audit-cli/vitest.config.ts
git commit -m "feat(audit-cli): add mergeByCategory for multi-package categories"
```

---

### Task 25: Wire mergeByCategory into `aggregate()` + `defaultPackages`, integration test

**Files:**
- Modify: `packages/audit-cli/src/aggregate.ts` — call `mergeByCategory` on results
- Modify: `packages/audit-cli/src/lib.ts` — wire the 3 new packages
- Create: `packages/audit-cli/test/aggregate.test.ts`

- [ ] **Step 1: Write failing integration test `test/aggregate.test.ts`**

```ts
import type { AuditFn, AuditResult } from "@repo/audit-core"
import { describe, expect, it } from "vitest"
import { aggregate, type AuditPackages } from "../src/aggregate.js"

const base = {
  url: "https://example.com/",
  requestedUrl: "https://example.com/",
  startedAt: "2026-06-07T10:00:00.000Z",
  durationMs: 50,
  packageVersion: "0.0.0",
}

const mkSuccess = (packageName: string, category: AuditResult["category"], score: number): AuditResult =>
  ({
    ...base,
    packageName,
    category,
    status: "success",
    score,
    issues: [],
    raw: { ruleSummary: [{ rule: "x/x", weight: 1, outcome: "pass" }] },
  }) as AuditResult

const stubPkgs: AuditPackages = {
  runLighthouse: async () => undefined,
  perf: async () => mkSuccess("@repo/audit-perf", "performance", 80),
  seo: async () => mkSuccess("@repo/audit-seo", "seo", 90),
  bestPractices: async () => mkSuccess("@repo/audit-best-practices", "best-practices", 70),
  pwa: async () => mkSuccess("@repo/audit-pwa", "pwa", 60),
  onpage: async () => mkSuccess("@repo/audit-onpage", "on-page", 95),
  meta: async () => mkSuccess("@repo/audit-meta", "on-page", 85),
  structured: async () => mkSuccess("@repo/audit-structured", "seo", 50),
  content: async () => mkSuccess("@repo/audit-content", "seo", 100),
}

describe("aggregate end-to-end with merger", () => {
  it("returns one result per category after merging", async () => {
    const results = await aggregate("https://example.com/", {}, stubPkgs)
    const categories = new Set(results.map((r) => r.category))
    expect(categories.size).toBe(results.length)
    expect(results.length).toBe(5)
  })

  it("on-page result is merged from onpage + meta packages", async () => {
    const results = await aggregate("https://example.com/", {}, stubPkgs)
    const onpage = results.find((r) => r.category === "on-page")
    expect(onpage?.packageName).toBe("merged")
    if (onpage?.status === "success") {
      // equal weights (both have 1 rule, weight 1) => avg of 95 and 85 = 90
      expect(onpage.score).toBe(90)
    }
  })

  it("seo result is merged from 3 contributors (seo + structured + content)", async () => {
    const results = await aggregate("https://example.com/", {}, stubPkgs)
    const seo = results.find((r) => r.category === "seo")
    expect(seo?.packageName).toBe("merged")
    if (seo?.status === "success") {
      // equal weights => avg of 90, 50, 100 = 80
      expect(seo.score).toBe(80)
    }
  })

  it("--only on-page returns only the merged on-page result", async () => {
    const results = await aggregate("https://example.com/", { only: ["on-page"] }, stubPkgs)
    expect(results).toHaveLength(1)
    expect(results[0]?.category).toBe("on-page")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @repo/audit-cli test test/aggregate.test.ts`
Expected: FAIL — `aggregate` returns 8 unmerged results, not 5 merged ones.

- [ ] **Step 3: Update `aggregate.ts` to call `mergeByCategory` on results**

Edit `packages/audit-cli/src/aggregate.ts` — change the final line from `return Promise.all(tasks)` to:

```ts
  const results = await Promise.all(tasks)
  return mergeByCategory(results)
}
```

And at the top of the file, add the import:

```ts
import { mergeByCategory } from "./merge.js"
```

Final aggregate.ts (full replacement):

```ts
import type { AuditResult, Category } from "@repo/audit-core"
import { mergeByCategory } from "./merge.js"

export type AuditPackages = {
  runLighthouse: (
    url: string,
    opts: { timeoutMs?: number; formFactor?: "mobile" | "desktop" }
  ) => Promise<unknown>
  perf: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  seo: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  bestPractices: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  pwa: (
    url: string,
    opts: { lighthouseResult?: unknown; timeoutMs?: number }
  ) => Promise<AuditResult>
  onpage: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
  meta: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
  structured: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
  content: (url: string, opts: { userAgent?: string; timeoutMs?: number }) => Promise<AuditResult>
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
  pkgs: AuditPackages
): Promise<AuditResult[]> {
  const wants = (c: Category) => !opts.only || opts.only.includes(c)

  const needsLh = wants("performance") || wants("seo") || wants("best-practices") || wants("pwa")

  let lhr: unknown
  if (needsLh) {
    try {
      lhr = await pkgs.runLighthouse(url, {
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.formFactor !== undefined ? { formFactor: opts.formFactor } : {}),
      })
    } catch {
      lhr = undefined
    }
  }

  const tasks: Promise<AuditResult>[] = []
  const subOpts = (extra?: object) => ({
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...extra,
  })

  if (wants("performance")) tasks.push(pkgs.perf(url, subOpts({ lighthouseResult: lhr })))
  if (wants("seo")) tasks.push(pkgs.seo(url, subOpts({ lighthouseResult: lhr })))
  if (wants("best-practices"))
    tasks.push(pkgs.bestPractices(url, subOpts({ lighthouseResult: lhr })))
  if (wants("pwa")) tasks.push(pkgs.pwa(url, subOpts({ lighthouseResult: lhr })))

  const onpageOpts = subOpts(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {})

  if (wants("on-page")) {
    tasks.push(pkgs.onpage(url, onpageOpts))
    tasks.push(pkgs.meta(url, onpageOpts))
  }
  if (wants("seo")) {
    tasks.push(pkgs.structured(url, onpageOpts))
    tasks.push(pkgs.content(url, onpageOpts))
  }

  const results = await Promise.all(tasks)
  return mergeByCategory(results)
}
```

- [ ] **Step 4: Update `packages/audit-cli/src/lib.ts` to wire the 3 new packages**

Replace contents:

```ts
import { audit as auditBP } from "@repo/audit-best-practices"
import { audit as auditContent } from "@repo/audit-content"
import { audit as auditMeta } from "@repo/audit-meta"
import { audit as auditOnpage } from "@repo/audit-onpage"
import { audit as auditPerf } from "@repo/audit-perf"
import { audit as auditPwa } from "@repo/audit-pwa"
import { audit as auditSeo } from "@repo/audit-seo"
import { audit as auditStructured } from "@repo/audit-structured"
import { runLighthouse } from "@repo/lighthouse-runner"
import type { AuditPackages } from "./aggregate.js"

export { type AggregateOptions, type AuditPackages, aggregate } from "./aggregate.js"

export const defaultPackages: AuditPackages = {
  runLighthouse: (u, o) => runLighthouse(u, o),
  perf: (u, o) => auditPerf(u, o),
  seo: (u, o) => auditSeo(u, o),
  bestPractices: (u, o) => auditBP(u, o),
  pwa: (u, o) => auditPwa(u, o),
  onpage: (u, o) => auditOnpage(u, o),
  meta: (u, o) => auditMeta(u, o),
  structured: (u, o) => auditStructured(u, o),
  content: (u, o) => auditContent(u, o),
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --filter @repo/audit-cli test test/aggregate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the full workspace test gate**

Run:
```bash
bun --filter @repo/audit-html-core test
bun --filter @repo/audit-onpage test
bun --filter @repo/audit-meta test
bun --filter @repo/audit-structured test
bun --filter @repo/audit-content test
bun --filter @repo/audit-cli test
bun turbo check-types
bun run lint
bun turbo build
```
Expected: all green.

- [ ] **Step 7: Smoke-test the CLI against a real URL** (sanity check, no commit-gating)

Run:
```bash
bun --filter @repo/audit-cli build
node packages/audit-cli/dist/index.js https://example.com --json | head -50
```
Expected: JSON output where the `seo` and `on-page` results each have `packageName: "merged"`.

- [ ] **Step 8: Commit**

```bash
git add packages/audit-cli/src/aggregate.ts packages/audit-cli/src/lib.ts packages/audit-cli/test/aggregate.test.ts
git commit -m "feat(audit-cli): wire meta/structured/content into aggregate with per-category merger"
```
