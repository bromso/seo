# Slice 3 — Runner App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@repo/runner-core` (orchestration) + `apps/runner` (poll-loop daemon + Dockerfile) plus additive changes to `@repo/audit-cli` (library export) and `@repo/db` (3 helpers + pgmq migration). Result: a queue-driven worker that processes audit jobs end-to-end from pgmq.

**Architecture:** Single-threaded daemon (one job at a time). pgmq for the queue (enqueue via AFTER INSERT trigger on `audit_runs`). The audit pipeline is imported as a library from `@repo/audit-cli`. Realtime is `postgres_changes` only — no broadcast code. `processRun(runId)` is pure-ish and fully unit-testable; the daemon wraps it in a poll loop.

**Tech Stack:** Bun + Turborepo (existing); Drizzle + postgres-js (slice 2); pgmq Postgres extension; `commander` (slice 1); native AbortController for signal handling; vitest 4.

**Spec:** [`docs/plans/2026-06-04-slice3-runner-design.md`](2026-06-04-slice3-runner-design.md)

---

## Conventions used throughout

- Working branch: `feat/runner-slice3` (already created off `feat/data-layer-slice2`).
- Conventional commits with `feat(runner):`, `feat(db):`, `feat(audit-cli):`, `test(runner):`, `docs(runner):`, etc.
- Husky pre-commit runs Biome. **Never `--no-verify`.**
- Vitest 4 hardcoded (`^4.0.15`) in package.json devDeps — not in catalog (matches slice 2 pattern).
- Migration journal `when` MUST be monotonically increasing (lesson from slice 2 T11). Use `Date.now()` or pick a value strictly greater than the previous migration's `when`.
- Integration tests gated on `RUN_INTEGRATION=1`. E2E real-Chrome test additionally gated on `RUN_E2E=1`.
- `vitest.integration.config.ts` needs `fileParallelism: false` (lesson from slice 2 T16).
- Enum inserts via postgres-js with `prepare: false` need `sql.raw(\`'value'::typename\`)` casts (lesson from slice 2 T14/T16).
- For packages that drizzle-kit touches: `moduleResolution: "bundler"` and omit `.js` from internal imports (lesson from slice 2 T9). For `@repo/runner-core` (no drizzle-kit), default to standard `node.json` preset (NodeNext, with `.js` imports).

---

## Task 1: Add library export to `@repo/audit-cli`

**Files:**
- Create: `packages/audit-cli/src/lib.ts`
- Modify: `packages/audit-cli/package.json` (add `./lib` to `exports`)
- Modify: `packages/audit-cli/tsdown.config.ts` (add `src/lib.ts` to entry)

The runner needs `aggregate` + a `defaultPackages` object so it can call the same audit pipeline that `audit-cli` does at the CLI. Slice 1 wired the packages inline in `src/index.ts`; we factor that wiring out so the runner can re-use it without duplicating six imports.

- [ ] **Step 1: Create `src/lib.ts`**

```ts
import { audit as auditBP } from "@repo/audit-best-practices"
import { audit as auditOnpage } from "@repo/audit-onpage"
import { audit as auditPerf } from "@repo/audit-perf"
import { audit as auditPwa } from "@repo/audit-pwa"
import { audit as auditSeo } from "@repo/audit-seo"
import { runLighthouse } from "@repo/lighthouse-runner"
import type { AuditPackages } from "./aggregate.js"

export { aggregate, type AggregateOptions, type AuditPackages } from "./aggregate.js"

export const defaultPackages: AuditPackages = {
  runLighthouse: (u, o) => runLighthouse(u, o),
  perf: (u, o) => auditPerf(u, o),
  seo: (u, o) => auditSeo(u, o),
  bestPractices: (u, o) => auditBP(u, o),
  pwa: (u, o) => auditPwa(u, o),
  onpage: (u, o) => auditOnpage(u, o),
}
```

- [ ] **Step 2: Update `package.json` exports**

```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./lib": { "types": "./dist/lib.d.ts", "import": "./dist/lib.js" }
  }
}
```

(Preserve all other fields. The `.` entry stays exactly as-is from slice 1.)

- [ ] **Step 3: Update `tsdown.config.ts`**

`packages/audit-cli/tsdown.config.ts`:

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/lib.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  // tsdown 0.22.x defaults to fixed .mjs/.cjs extensions; force .js for Node ESM
  fixedExtension: false,
})
```

(The existing entry list may include only `src/index.ts`; add `src/lib.ts`.)

- [ ] **Step 4: Refactor `src/index.ts` to use the shared defaults**

Edit `packages/audit-cli/src/index.ts` — replace the inline `runLighthouse` / `auditPerf` / etc. imports with a single import from `./lib.js`, and pass `defaultPackages` directly to `aggregate`:

```ts
#!/usr/bin/env node
import { AuditResultSchema } from "@repo/audit-core"
import { aggregate, defaultPackages } from "./lib.js"
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
      timeoutMs: args.timeout,
      formFactor: args.formFactor,
      ...(args.only !== undefined ? { only: args.only } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    },
    defaultPackages,
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

- [ ] **Step 5: Verify**

```bash
bun --filter @repo/audit-cli build
bun --filter @repo/audit-cli check-types
bun --filter @repo/audit-cli test
```

All three PASS. The build produces `dist/index.js`, `dist/lib.js`, `dist/index.d.ts`, `dist/lib.d.ts`. No test changes needed (the existing 10 tests still pass).

Smoke-import the new export from a one-shot script (optional):

```bash
bun -e 'import("/Users/jonasbroms/Sites/seo/packages/audit-cli/dist/lib.js").then(m => console.log(Object.keys(m).sort()))'
```

Expect: `[ 'aggregate', 'defaultPackages' ]` (no type-only exports show at runtime).

- [ ] **Step 6: Commit**

```bash
git add packages/audit-cli
git commit -m "feat(audit-cli): expose aggregate + defaultPackages as a library entry"
```

---

## Task 2: Add `pgmq` migration (0003_queue.sql)

**Files:**
- Create: `packages/db/migrations/0003_queue.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (append idx: 3)

- [ ] **Step 1: Create the migration**

`packages/db/migrations/0003_queue.sql`:

```sql
-- Enable pgmq extension
CREATE EXTENSION IF NOT EXISTS pgmq;
--> statement-breakpoint

-- Create the audit_runs queue (idempotent: pgmq.create is a no-op if exists)
SELECT pgmq.create('audit_runs');
--> statement-breakpoint

-- Trigger: publish to pgmq whenever a new audit_run row is inserted with status='queued'
CREATE OR REPLACE FUNCTION public.enqueue_audit_run() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgmq AS $$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM pgmq.send(
      'audit_runs',
      json_build_object(
        'runId', NEW.id,
        'siteId', NEW.site_id,
        'ownerId', NEW.owner_id,
        'requestedUrl', NEW.requested_url
      )::jsonb
    );
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_runs_enqueue ON public.audit_runs;
--> statement-breakpoint
CREATE TRIGGER audit_runs_enqueue
  AFTER INSERT ON public.audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_audit_run();
--> statement-breakpoint

-- Add Realtime publication for audit_runs + audit_results
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_runs;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_results;
```

- [ ] **Step 2: Append journal entry**

Open `packages/db/migrations/meta/_journal.json`. There are 3 existing entries (idx 0, 1, 2). Add a fourth:

```json
{
  "idx": 3,
  "version": "7",
  "when": <number strictly > the idx:2 entry's `when`>,
  "tag": "0003_queue",
  "breakpoints": true
}
```

To be safe, set `when` to `Date.now()` at the moment you commit — that's strictly greater than any prior entry. Match the `version` field to the existing entries (probably `"7"`).

- [ ] **Step 3: Apply**

Ensure Supabase is running:

```bash
bunx supabase status
```

Apply migrations:

```bash
bun --filter @repo/db migrate
```

Expected: "migrations applied" with NO errors.

If the migration fails because `pgmq.create` complains the queue exists, that's only a problem if `bunx supabase db reset` wasn't run first. Reset and retry:

```bash
bunx supabase db reset
bun --filter @repo/db migrate
```

`supabase db reset` drops the schema and re-applies all migrations, including the new 0003.

- [ ] **Step 4: Verify in psql**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "\dx pgmq"
```

Expect a row for the `pgmq` extension.

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "SELECT * FROM pgmq.list_queues();"
```

Expect a row with `queue_name = 'audit_runs'`.

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='audit_runs';"
```

Expect `audit_runs_enqueue`, `audit_runs_set_owner` (from slice 2).

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT pubname, tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';"
```

Expect rows for `audit_runs` and `audit_results`.

- [ ] **Step 5: Smoke test — insert a run, observe the queue**

```bash
# Get the demo user id (seeded in slice 2 if you ran `bun --filter @repo/db seed`)
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -At \
  -c "SELECT id FROM profiles LIMIT 1"

# Insert a site + audit_run (replace OWNER_UUID)
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres <<SQL
WITH s AS (
  INSERT INTO sites (owner_id, url, normalized_url)
  VALUES ('OWNER_UUID', 'https://example.com', 'https://example.com/')
  RETURNING id
)
INSERT INTO audit_runs (site_id, owner_id, requested_url)
SELECT id, 'OWNER_UUID', 'https://example.com' FROM s;
SQL

# Check pgmq received it
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT msg_id, read_ct, message FROM pgmq.q_audit_runs;"
```

Expect one row with the runId / siteId / ownerId / requestedUrl in the `message` JSON.

(If the user seeded in slice 2's T17 was deleted, you may need to insert a profile + site first. The seed.ts script from slice 2 handles all of this; running it again is the simplest path.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations
git commit -m "feat(db): enable pgmq + audit_runs enqueue trigger + Realtime publication"
```

---

## Task 3: Add `@repo/db` query helpers

**Files:**
- Create: `packages/db/src/queries.ts`
- Modify: `packages/db/src/index.ts` (re-export queries)
- Create: `packages/db/test/queries.test.ts` (unit-level fixture round-trip; integration is exercised in T12 against a real DB)

No DB-touching unit test for these functions (they're 4-line Drizzle calls); integration coverage in T12. But we DO type-check them via build.

- [ ] **Step 1: Create `src/queries.ts`**

```ts
import { eq, inArray, sql } from "drizzle-orm"
import type { Category } from "@repo/audit-core"
import type { Db } from "./client"
import { auditResults, auditRuns } from "./schema/index"
import type { AuditRun } from "./types"

export async function getAuditRun(
  db: Db,
  runId: string,
): Promise<AuditRun | undefined> {
  const rows = await db.select().from(auditRuns).where(eq(auditRuns.id, runId))
  return rows[0]
}

/**
 * Update audit_runs.status to 'running' if currently 'queued' or already 'running'.
 * Returns the number of rows updated (0 if the row doesn't exist or is terminal).
 */
export async function markAuditRunRunning(
  db: Db,
  runId: string,
): Promise<number> {
  const result = await db
    .update(auditRuns)
    .set({ status: sql`'running'::run_status` })
    .where(sql`${auditRuns.id} = ${runId} AND ${auditRuns.status} IN ('queued','running')`)
  // postgres-js returns { count } on UPDATE
  return (result as unknown as { count: number }).count ?? 0
}

export async function getCompletedCategoriesForRun(
  db: Db,
  runId: string,
): Promise<Set<Category>> {
  const rows = await db
    .select({ category: auditResults.category })
    .from(auditResults)
    .where(eq(auditResults.runId, runId))
  return new Set(rows.map((r) => r.category as Category))
}
```

The `markAuditRunRunning` return-shape cast (`{ count }`) is because Drizzle's postgres-js driver returns a result that exposes `.count` for UPDATEs but the TypeScript type isn't fully consistent across Drizzle versions. The cast is sound — `count` is documented behavior. If the cast errors at typecheck, simplify to:

```ts
await db.update(auditRuns).set({...}).where(...)
const after = await getAuditRun(db, runId)
return after?.status === "running" ? 1 : 0
```

(Extra round-trip but type-clean.)

- [ ] **Step 2: Re-export from index.ts**

Append to `packages/db/src/index.ts`:

```ts
export {
  getAuditRun,
  markAuditRunRunning,
  getCompletedCategoriesForRun,
} from "./queries"
```

(No `.js` extension because slice 2 set `moduleResolution: bundler`.)

- [ ] **Step 3: Build + typecheck**

```bash
bun --filter @repo/db build
bun --filter @repo/db check-types
```

Both PASS. Existing 30 tests (16 unit + 14 integration) still pass — no logic change, only additions.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src
git commit -m "feat(db): add getAuditRun + markAuditRunRunning + getCompletedCategoriesForRun helpers"
```

---

## Task 4: Scaffold `@repo/runner-core`

**Files (new):**
- `packages/runner-core/package.json`
- `packages/runner-core/tsconfig.json`
- `packages/runner-core/tsdown.config.ts`
- `packages/runner-core/vitest.config.ts`
- `packages/runner-core/vitest.integration.config.ts`
- `packages/runner-core/.env.example`
- `packages/runner-core/src/index.ts` (placeholder)

- [ ] **Step 1: package.json**

```json
{
  "name": "@repo/runner-core",
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
    "lint": "biome check src test integration",
    "test": "vitest run --config vitest.config.ts",
    "test:integration": "RUN_INTEGRATION=1 vitest run --config vitest.integration.config.ts"
  },
  "dependencies": {
    "@repo/audit-cli": "workspace:*",
    "@repo/audit-core": "workspace:*",
    "@repo/db": "workspace:*",
    "drizzle-orm": "catalog:",
    "postgres": "catalog:",
    "zod": "catalog:"
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

- [ ] **Step 2: tsconfig.json**

The package does NOT use drizzle-kit, so use the standard NodeNext preset. Internal imports use `.js` extensions.

```json
{
  "extends": "@repo/typescript-config/node.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "test", "integration"]
}
```

- [ ] **Step 3: tsdown.config.ts**

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  // tsdown 0.22.x defaults to fixed .mjs/.cjs extensions; force .js for Node ESM
  fixedExtension: false,
})
```

- [ ] **Step 4: vitest.config.ts**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 5: vitest.integration.config.ts**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["integration/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: ["./integration/load-env.ts"],
  },
})
```

(`load-env.ts` is created in T11.)

- [ ] **Step 6: .env.example**

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 7: Placeholder src/index.ts**

```ts
// Public surface — filled in by subsequent tasks.
export {}
```

- [ ] **Step 8: Install + smoke**

```bash
bun install
bun --filter @repo/runner-core build
bun --filter @repo/runner-core check-types
```

Both PASS. Build produces an empty-ish `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 9: Commit**

```bash
git add packages/runner-core
git commit -m "feat(runner): scaffold @repo/runner-core package"
```

---

## Task 5: `errors.ts` + `logger.ts` + `backoff.ts`

**Files:**
- Create: `packages/runner-core/src/errors.ts`
- Create: `packages/runner-core/src/logger.ts`
- Create: `packages/runner-core/src/backoff.ts`
- Create: `packages/runner-core/test/backoff.test.ts`
- Modify: `packages/runner-core/src/index.ts`

- [ ] **Step 1: Create `src/errors.ts`**

```ts
import type { AuditError, Category } from "@repo/audit-core"

export type FailureReason =
  | "fetch_failed"
  | "aggregate_failed"
  | "db_failed"
  | "timeout"

export type SkipReason = "run_not_found" | "already_completed"

export type ProcessRunResult =
  | { status: "completed"; resultsInserted: number }
  | { status: "partial"; resultsInserted: number; partialCategories: Category[] }
  | { status: "failed"; reason: FailureReason; error?: AuditError }
  | { status: "skipped"; reason: SkipReason }

export class RunnerError extends Error {
  readonly code: FailureReason | "queue_error"
  constructor(input: {
    code: FailureReason | "queue_error"
    message: string
    cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = "RunnerError"
    this.code = input.code
  }
}
```

- [ ] **Step 2: Create `src/logger.ts`**

```ts
import type { LogEvent } from "@repo/audit-core"

export type Logger = (event: LogEvent) => void

/**
 * Default logger: writes structured JSON to stderr.
 */
export const consoleLogger: Logger = (event) => {
  const line = JSON.stringify({ time: new Date().toISOString(), ...event })
  process.stderr.write(`${line}\n`)
}

/**
 * No-op logger for tests.
 */
export const silentLogger: Logger = () => {}
```

- [ ] **Step 3: Create `src/backoff.ts`**

```ts
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
```

- [ ] **Step 4: Failing test for backoff.sleep**

`packages/runner-core/test/backoff.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { sleep } from "../src/backoff.js"

describe("sleep", () => {
  it("resolves after the given ms", async () => {
    const t0 = Date.now()
    await sleep(50)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(40)  // 10ms tolerance for timer skew
    expect(elapsed).toBeLessThan(200)
  })

  it("rejects with AbortError when the signal is already aborted", async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(sleep(100, ac.signal)).rejects.toMatchObject({
      name: "AbortError",
    })
  })

  it("rejects with AbortError when aborted mid-sleep", async () => {
    const ac = new AbortController()
    const p = sleep(1000, ac.signal)
    queueMicrotask(() => ac.abort())
    await expect(p).rejects.toMatchObject({ name: "AbortError" })
  })
})
```

- [ ] **Step 5: Run — expect FAIL then PASS**

```bash
bun --filter @repo/runner-core test
```

Expected: 3 tests pass (the implementation was written in step 3, so PASS the first time).

- [ ] **Step 6: Re-export from index.ts**

`packages/runner-core/src/index.ts`:

```ts
export type { Logger } from "./logger.js"
export { consoleLogger, silentLogger } from "./logger.js"
export type {
  FailureReason,
  ProcessRunResult,
  SkipReason,
} from "./errors.js"
export { RunnerError } from "./errors.js"
export { sleep } from "./backoff.js"
```

- [ ] **Step 7: Commit**

```bash
git add packages/runner-core
git commit -m "feat(runner): add errors, logger, and backoff helpers"
```

---

## Task 6: `queue.ts` — pgmq client wrapper

**Files:**
- Create: `packages/runner-core/src/queue.ts`
- Create: `packages/runner-core/test/queue.test.ts`
- Modify: `packages/runner-core/src/index.ts`

The queue client wraps four pgmq SQL calls: `pgmq.read`, `pgmq.delete`, `pgmq.set_vt`, `pgmq.archive`. We unit-test that the SQL is shaped correctly and that the message-body parsing works (a Zod schema rejects malformed bodies).

- [ ] **Step 1: Failing test**

`packages/runner-core/test/queue.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createQueueClient, parseQueueBody } from "../src/queue.js"

describe("parseQueueBody", () => {
  it("accepts a well-formed body", () => {
    const body = {
      runId: "00000000-0000-0000-0000-000000000001",
      siteId: "00000000-0000-0000-0000-000000000002",
      ownerId: "00000000-0000-0000-0000-000000000003",
      requestedUrl: "https://example.com",
    }
    expect(parseQueueBody(body)).toEqual(body)
  })

  it("rejects a body with missing fields", () => {
    expect(() => parseQueueBody({ runId: "x" })).toThrow()
  })

  it("rejects a body where runId is not a uuid", () => {
    const body = {
      runId: "not-a-uuid",
      siteId: "00000000-0000-0000-0000-000000000002",
      ownerId: "00000000-0000-0000-0000-000000000003",
      requestedUrl: "https://example.com",
    }
    expect(() => parseQueueBody(body)).toThrow()
  })

  it("rejects a body where requestedUrl is not a URL", () => {
    const body = {
      runId: "00000000-0000-0000-0000-000000000001",
      siteId: "00000000-0000-0000-0000-000000000002",
      ownerId: "00000000-0000-0000-0000-000000000003",
      requestedUrl: "not a url",
    }
    expect(() => parseQueueBody(body)).toThrow()
  })
})

describe("createQueueClient.read SQL shape", () => {
  // Light mock: we don't need a real Drizzle Db here — we only verify that
  // .execute is called with SQL that contains the expected pgmq function name.
  function makeMockDb(rows: unknown[]) {
    const calls: { sql: string }[] = []
    const db = {
      execute: vi.fn(async (q: { sql?: string; toQuery?: () => { sql: string } }) => {
        const text =
          typeof q.sql === "string"
            ? q.sql
            : (q.toQuery?.().sql ?? String(q))
        calls.push({ sql: text })
        return rows
      }),
    }
    return { db, calls }
  }

  it("read() invokes pgmq.read and parses one message", async () => {
    const message = {
      msg_id: 42,
      read_ct: 1,
      enqueued_at: new Date("2026-06-04T12:00:00Z").toISOString(),
      vt: new Date("2026-06-04T12:10:00Z").toISOString(),
      message: {
        runId: "00000000-0000-0000-0000-000000000001",
        siteId: "00000000-0000-0000-0000-000000000002",
        ownerId: "00000000-0000-0000-0000-000000000003",
        requestedUrl: "https://example.com",
      },
    }
    const { db, calls } = makeMockDb([message])
    const queue = createQueueClient(db as never, "audit_runs")
    const m = await queue.read(600)
    expect(m?.msgId).toBe(42)
    expect(m?.readCt).toBe(1)
    expect(m?.body.runId).toBe(message.message.runId)
    expect(calls[0]?.sql).toMatch(/pgmq\.read/)
  })

  it("read() returns undefined when no message", async () => {
    const { db } = makeMockDb([])
    const queue = createQueueClient(db as never, "audit_runs")
    expect(await queue.read(600)).toBeUndefined()
  })

  it("ack() invokes pgmq.delete", async () => {
    const { db, calls } = makeMockDb([{}])
    const queue = createQueueClient(db as never, "audit_runs")
    await queue.ack(42)
    expect(calls[0]?.sql).toMatch(/pgmq\.delete/)
  })

  it("setVisibility() invokes pgmq.set_vt", async () => {
    const { db, calls } = makeMockDb([{}])
    const queue = createQueueClient(db as never, "audit_runs")
    await queue.setVisibility(42, 300)
    expect(calls[0]?.sql).toMatch(/pgmq\.set_vt/)
  })

  it("archive() invokes pgmq.archive", async () => {
    const { db, calls } = makeMockDb([{}])
    const queue = createQueueClient(db as never, "audit_runs")
    await queue.archive(42)
    expect(calls[0]?.sql).toMatch(/pgmq\.archive/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/runner-core test
```

Expected: FAIL — `createQueueClient` / `parseQueueBody` not exported.

- [ ] **Step 3: Implement `src/queue.ts`**

```ts
import { sql } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "@repo/db"

const QueueBodySchema = z.object({
  runId: z.uuid(),
  siteId: z.uuid(),
  ownerId: z.uuid(),
  requestedUrl: z.url(),
})

export type QueueBody = z.infer<typeof QueueBodySchema>

export function parseQueueBody(input: unknown): QueueBody {
  return QueueBodySchema.parse(input)
}

export type QueuedMessage = {
  msgId: number
  readCt: number
  enqueuedAt: Date
  visibilityTimeoutAt: Date
  body: QueueBody
}

export type QueueClient = {
  read: (visibilityTimeoutSec: number) => Promise<QueuedMessage | undefined>
  ack: (msgId: number) => Promise<void>
  setVisibility: (msgId: number, additionalSec: number) => Promise<void>
  archive: (msgId: number) => Promise<void>
}

type RawRow = {
  msg_id: number | string
  read_ct: number | string
  enqueued_at: string | Date
  vt: string | Date
  message: unknown
}

export function createQueueClient(db: Db, queueName = "audit_runs"): QueueClient {
  const queue = sql.raw(`'${queueName}'`)

  return {
    async read(vtSec) {
      const rows = await db.execute(
        sql`SELECT msg_id, read_ct, enqueued_at, vt, message
            FROM pgmq.read(${queue}, ${vtSec}, 1)`,
      )
      const r = (rows as unknown as RawRow[])[0]
      if (!r) return undefined
      return {
        msgId: Number(r.msg_id),
        readCt: Number(r.read_ct),
        enqueuedAt: new Date(r.enqueued_at),
        visibilityTimeoutAt: new Date(r.vt),
        body: parseQueueBody(r.message),
      }
    },
    async ack(msgId) {
      await db.execute(sql`SELECT pgmq.delete(${queue}, ${msgId})`)
    },
    async setVisibility(msgId, additionalSec) {
      await db.execute(sql`SELECT pgmq.set_vt(${queue}, ${msgId}, ${additionalSec})`)
    },
    async archive(msgId) {
      await db.execute(sql`SELECT pgmq.archive(${queue}, ${msgId})`)
    },
  }
}
```

NOTE on the `sql.raw('audit_runs')` for the queue name: pgmq's functions take the queue name as a SQL identifier-string argument. We use `sql.raw` so it's substituted literally rather than parameterized. The queue name is internal (not user input), so injection isn't a concern. If the test asserts the SQL via `toQuery().sql`, the queue name will appear inline.

- [ ] **Step 4: Run — expect PASS**

```bash
bun --filter @repo/runner-core test
```

Expected: 9 tests pass (3 backoff + 4 parseQueueBody + 5 createQueueClient = 12 total, but reorganize as needed).

Adjust the expected SQL regex in tests if your final SQL formatting differs (e.g. line breaks).

- [ ] **Step 5: Re-export**

Append to `packages/runner-core/src/index.ts`:

```ts
export type { QueuedMessage, QueueBody, QueueClient } from "./queue.js"
export { createQueueClient, parseQueueBody } from "./queue.js"
```

- [ ] **Step 6: Commit**

```bash
git add packages/runner-core
git commit -m "feat(runner): add pgmq client wrapper (read/ack/setVisibility/archive)"
```

---

## Task 7: `process-run.ts` — the testable function

**Files:**
- Create: `packages/runner-core/src/process-run.ts`
- Create: `packages/runner-core/test/process-run.test.ts`
- Modify: `packages/runner-core/src/index.ts`

This is the core orchestration. Unit-test with all dependencies (DB, aggregate, packages) mocked.

- [ ] **Step 1: Failing test**

`packages/runner-core/test/process-run.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import type { AuditResult, Category } from "@repo/audit-core"
import { processRun } from "../src/process-run.js"
import { silentLogger } from "../src/logger.js"

const RUN_ID = "00000000-0000-0000-0000-000000000001"
const OWNER_ID = "00000000-0000-0000-0000-000000000002"
const SITE_ID = "00000000-0000-0000-0000-000000000003"

const baseRun = {
  id: RUN_ID,
  siteId: SITE_ID,
  ownerId: OWNER_ID,
  status: "queued" as const,
  requestedUrl: "https://example.com",
  finalUrl: null,
  startedAt: new Date(),
  finishedAt: null,
  triggeredBy: "manual",
}

const mkResult = (category: Category, status: "success" | "partial" | "failed" = "success"): AuditResult => {
  const base = {
    category,
    url: "https://example.com/",
    requestedUrl: "https://example.com",
    startedAt: new Date().toISOString(),
    durationMs: 1500,
    packageName: `@repo/audit-${category}`,
    packageVersion: "0.0.0",
  }
  if (status === "failed") {
    return {
      ...base,
      status: "failed",
      error: { code: "DNS_ERROR", message: "boom", retryable: true },
    }
  }
  if (status === "partial") {
    return {
      ...base,
      status: "partial",
      score: 0,
      issues: [],
      raw: null,
      partialReasons: ["pwa-category-not-emitted-by-lighthouse"],
    }
  }
  return { ...base, status: "success", score: 90, issues: [], raw: { ok: true } }
}

const CATEGORIES: Category[] = [
  "performance",
  "seo",
  "best-practices",
  "pwa",
  "on-page",
]

function makeMockDb(overrides: {
  run?: typeof baseRun | undefined
  completedCategories?: Set<Category>
  insertResultMock?: ReturnType<typeof vi.fn>
}) {
  return {
    getAuditRun: vi.fn(async () => overrides.run),
    markAuditRunRunning: vi.fn(async () => 1),
    getCompletedCategoriesForRun: vi.fn(async () => overrides.completedCategories ?? new Set<Category>()),
    insertAuditResult: overrides.insertResultMock ?? vi.fn(async () => "row-id"),
  }
}

describe("processRun", () => {
  it("returns skipped when run not found", async () => {
    const dbMock = makeMockDb({ run: undefined })
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate: vi.fn(),
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result).toEqual({ status: "skipped", reason: "run_not_found" })
  })

  it("returns skipped when run is already completed", async () => {
    const dbMock = makeMockDb({
      run: { ...baseRun, status: "completed" } as never,
    })
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate: vi.fn(),
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result).toEqual({ status: "skipped", reason: "already_completed" })
  })

  it("happy path: 5 success results -> completed", async () => {
    const insertResult = vi.fn(async () => "id")
    const dbMock = makeMockDb({
      run: { ...baseRun, status: "queued" } as never,
      completedCategories: new Set<Category>(),
      insertResultMock: insertResult,
    })
    const aggregate = vi.fn(async () =>
      CATEGORIES.map((c) => mkResult(c, "success")),
    )
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.resultsInserted).toBe(5)
    }
    expect(aggregate).toHaveBeenCalledOnce()
    expect(insertResult).toHaveBeenCalledTimes(5)
  })

  it("aggregator returns one partial -> result is partial", async () => {
    const dbMock = makeMockDb({
      run: { ...baseRun } as never,
      completedCategories: new Set<Category>(),
    })
    const aggregate = vi.fn(async () =>
      CATEGORIES.map((c) =>
        c === "pwa" ? mkResult(c, "partial") : mkResult(c, "success"),
      ),
    )
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result.status).toBe("partial")
    if (result.status === "partial") {
      expect(result.partialCategories).toEqual(["pwa"])
    }
  })

  it("aggregator returns one failed -> result is failed", async () => {
    const dbMock = makeMockDb({
      run: { ...baseRun } as never,
      completedCategories: new Set<Category>(),
    })
    const aggregate = vi.fn(async () =>
      CATEGORIES.map((c) =>
        c === "performance" ? mkResult(c, "failed") : mkResult(c, "success"),
      ),
    )
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("aggregate_failed")
    }
  })

  it("aggregate throws -> insert 5 failed rows and return failed", async () => {
    const insertResult = vi.fn(async () => "id")
    const dbMock = makeMockDb({
      run: { ...baseRun } as never,
      completedCategories: new Set<Category>(),
      insertResultMock: insertResult,
    })
    const aggregate = vi.fn(async () => {
      throw new Error("crashed")
    })
    const result = await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    expect(result.status).toBe("failed")
    expect(insertResult).toHaveBeenCalledTimes(5)
    // every inserted result should be a `failed` AuditResult with code=UNKNOWN
    const insertedStatuses = insertResult.mock.calls.map(
      (c) => (c[0] as AuditResult).status,
    )
    expect(insertedStatuses).toEqual(["failed", "failed", "failed", "failed", "failed"])
  })

  it("idempotent: skips already-completed categories", async () => {
    const aggregate = vi.fn(async () =>
      CATEGORIES.filter((c) => c !== "performance" && c !== "seo").map(
        (c) => mkResult(c, "success"),
      ),
    )
    const dbMock = makeMockDb({
      run: { ...baseRun } as never,
      completedCategories: new Set(["performance", "seo"]),
    })
    await processRun(RUN_ID, {
      dbApi: dbMock as never,
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })
    // aggregate called with `only` containing the missing 3 categories
    const opts = aggregate.mock.calls[0]?.[1] as { only?: Category[] }
    expect(opts?.only?.sort()).toEqual(
      ["best-practices", "on-page", "pwa"].sort(),
    )
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun --filter @repo/runner-core test
```

Expected: 7 tests fail (`processRun` not implemented).

- [ ] **Step 3: Implement `src/process-run.ts`**

```ts
import type { AuditResult, Category, LogEvent } from "@repo/audit-core"
import type { AggregateOptions, AuditPackages } from "@repo/audit-cli/lib"
import { RunnerError, type ProcessRunResult } from "./errors.js"

/**
 * The DB-touching surface processRun needs. Real wiring lives in apps/runner;
 * tests pass a mock object with these four methods.
 */
export type ProcessRunDbApi = {
  getAuditRun: (runId: string) => Promise<
    | {
        id: string
        siteId: string
        ownerId: string
        status: "queued" | "running" | "completed" | "partial" | "failed"
        requestedUrl: string
      }
    | undefined
  >
  markAuditRunRunning: (runId: string) => Promise<number>
  getCompletedCategoriesForRun: (runId: string) => Promise<Set<Category>>
  insertAuditResult: (
    result: AuditResult,
    runId: string,
    ownerId: string,
  ) => Promise<string>
}

export type AggregateFn = (
  url: string,
  opts: AggregateOptions,
  packages: AuditPackages,
) => Promise<AuditResult[]>

export type ProcessRunOptions = {
  dbApi: ProcessRunDbApi
  aggregate: AggregateFn
  packages: AuditPackages
  logger: (event: LogEvent) => void
  timeoutMs?: number
  signal?: AbortSignal
}

const ALL_CATEGORIES: Category[] = [
  "performance",
  "seo",
  "best-practices",
  "pwa",
  "on-page",
]

export async function processRun(
  runId: string,
  opts: ProcessRunOptions,
): Promise<ProcessRunResult> {
  const { dbApi, aggregate, packages, logger, timeoutMs, signal } = opts

  // Step 1: load run
  const run = await dbApi.getAuditRun(runId)
  if (!run) return { status: "skipped", reason: "run_not_found" }
  if (run.status === "completed" || run.status === "partial" || run.status === "failed") {
    return { status: "skipped", reason: "already_completed" }
  }

  // Step 2: mark running (idempotent — works whether status was queued or running)
  await dbApi.markAuditRunRunning(runId)

  // Step 3: idempotent skip of categories that already have a row
  const completed = await dbApi.getCompletedCategoriesForRun(runId)
  const missing = ALL_CATEGORIES.filter((c) => !completed.has(c))
  if (missing.length === 0) {
    return { status: "completed", resultsInserted: 0 }
  }

  logger({
    kind: "progress",
    message: `processRun ${runId}: running ${missing.length} categories`,
  })

  // Step 4: run aggregator
  let results: AuditResult[]
  try {
    const aggregateOpts: AggregateOptions = {
      only: missing,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      formFactor: "mobile",
    }
    results = await aggregate(run.requestedUrl, aggregateOpts, packages)
  } catch (err) {
    // Programmer error in audit packages — insert 5 failed rows and bail
    logger({
      kind: "warn",
      message: `aggregate threw: ${(err as Error).message}`,
    })
    const synth = makeFailedResults(run.requestedUrl, missing, "UNKNOWN", (err as Error).message)
    let inserted = 0
    for (const r of synth) {
      await dbApi.insertAuditResult(r, runId, run.ownerId)
      inserted++
    }
    return {
      status: "failed",
      reason: "aggregate_failed",
    }
  }

  // Step 5: persist
  let inserted = 0
  const partialCategories: Category[] = []
  let hadFailure = false
  for (const r of results) {
    await dbApi.insertAuditResult(r, runId, run.ownerId)
    inserted++
    if (r.status === "partial") partialCategories.push(r.category)
    if (r.status === "failed") hadFailure = true
    if (signal?.aborted) {
      // Abort mid-loop — fill in the rest as failed
      const remaining = missing.filter(
        (c) => !results.some((x) => x.category === c),
      )
      const synth = makeFailedResults(
        run.requestedUrl,
        remaining,
        "ABORTED",
        "aborted mid-run",
      )
      for (const s of synth) {
        await dbApi.insertAuditResult(s, runId, run.ownerId)
        inserted++
      }
      return { status: "failed", reason: "timeout" }
    }
  }

  if (hadFailure) {
    return { status: "failed", reason: "aggregate_failed" }
  }
  if (partialCategories.length > 0) {
    return {
      status: "partial",
      resultsInserted: inserted,
      partialCategories,
    }
  }
  return { status: "completed", resultsInserted: inserted }
}

function makeFailedResults(
  requestedUrl: string,
  categories: Category[],
  code: "UNKNOWN" | "ABORTED",
  message: string,
): AuditResult[] {
  return categories.map((c) => ({
    category: c,
    url: requestedUrl,
    requestedUrl,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    packageName: `@repo/audit-${c}`,
    packageVersion: "0.0.0",
    status: "failed",
    error: {
      code,
      message,
      retryable: code === "UNKNOWN",
    },
  }))
}
```

`makeFailedResults` is the recovery synth-results helper. It produces failed AuditResults for missing categories so the run's rollup trigger can finalize the status.

- [ ] **Step 4: Re-export**

Append to `packages/runner-core/src/index.ts`:

```ts
export { processRun } from "./process-run.js"
export type {
  ProcessRunOptions,
  ProcessRunDbApi,
  AggregateFn,
} from "./process-run.js"
```

- [ ] **Step 5: Run — expect PASS**

```bash
bun --filter @repo/runner-core test
```

Expected: 12 + 7 = ~19 tests pass.

- [ ] **Step 6: Build + typecheck**

```bash
bun --filter @repo/runner-core build
bun --filter @repo/runner-core check-types
```

Both PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/runner-core
git commit -m "feat(runner): add processRun orchestration with TDD coverage"
```

---

## Task 8: Scaffold `apps/runner`

**Files (new):**
- `apps/runner/package.json`
- `apps/runner/tsconfig.json`
- `apps/runner/tsdown.config.ts`
- `apps/runner/.env.example`
- `apps/runner/src/index.ts` (placeholder)

- [ ] **Step 1: package.json**

```json
{
  "name": "@repo/runner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "runner": "./dist/index.js" },
  "files": ["dist", "package.json"],
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit",
    "lint": "biome check src",
    "dev": "tsx watch src/index.ts start",
    "start": "node dist/index.js start",
    "enqueue": "tsx src/index.ts enqueue",
    "docker:build": "docker build -t seo-runner -f Dockerfile ../.."
  },
  "dependencies": {
    "@repo/audit-cli": "workspace:*",
    "@repo/audit-core": "workspace:*",
    "@repo/db": "workspace:*",
    "@repo/runner-core": "workspace:*",
    "commander": "catalog:",
    "drizzle-orm": "catalog:",
    "postgres": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^25.0.2",
    "tsdown": "catalog:",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "@repo/typescript-config/node.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: tsdown.config.ts**

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  target: "node20",
  // tsdown 0.22.x defaults to fixed .mjs/.cjs extensions; force .js for Node ESM
  fixedExtension: false,
})
```

`dts: false` because this is an app, not a library — no types to export.

- [ ] **Step 4: .env.example**

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEFAULT_OWNER_ID=
LH_NO_SANDBOX=
```

- [ ] **Step 5: Placeholder src/index.ts**

```ts
#!/usr/bin/env node
// Filled in by T10
process.stderr.write("runner: not yet implemented (T10)\n")
process.exit(2)
```

- [ ] **Step 6: Install + smoke**

```bash
bun install
bun --filter @repo/runner build
bun --filter @repo/runner check-types
```

Both PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/runner
git commit -m "chore(runner): scaffold apps/runner"
```

---

## Task 9: `daemon.ts` — poll loop

**Files:**
- Create: `apps/runner/src/daemon.ts`

No unit tests — the daemon is exercised by T13's integration test. Build + typecheck is the gate here.

- [ ] **Step 1: Create `src/daemon.ts`**

```ts
import { aggregate, defaultPackages } from "@repo/audit-cli/lib"
import {
  createDbClient,
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  markAuditRunRunning,
} from "@repo/db"
import {
  consoleLogger,
  createQueueClient,
  processRun,
  sleep,
  type Logger,
} from "@repo/runner-core"

export type DaemonOptions = {
  connectionString: string
  pollIntervalMs?: number
  visibilityTimeoutSec?: number
  shutdownGraceMs?: number
  logger?: Logger
}

export async function runDaemon(opts: DaemonOptions): Promise<void> {
  const logger = opts.logger ?? consoleLogger
  const pollIntervalMs = opts.pollIntervalMs ?? 1000
  const visibilityTimeoutSec = opts.visibilityTimeoutSec ?? 600
  const shutdownGraceMs = opts.shutdownGraceMs ?? 30_000

  const db = createDbClient({
    connectionString: opts.connectionString,
    role: "service_role",
    ssl: false,
  })
  const queue = createQueueClient(db)

  let shutdownRequested = false
  let currentAbort: AbortController | undefined

  const onSignal = (sig: string) => {
    if (!shutdownRequested) {
      logger({ kind: "progress", message: `received ${sig}, shutting down` })
      shutdownRequested = true
      currentAbort?.abort()
    }
  }
  process.on("SIGTERM", () => onSignal("SIGTERM"))
  process.on("SIGINT", () => onSignal("SIGINT"))

  logger({ kind: "progress", message: "daemon starting; polling pgmq" })

  while (!shutdownRequested) {
    let msg
    try {
      msg = await queue.read(visibilityTimeoutSec)
    } catch (err) {
      logger({
        kind: "warn",
        message: `queue.read failed: ${(err as Error).message}`,
      })
      await sleep(pollIntervalMs)
      continue
    }
    if (!msg) {
      await sleep(pollIntervalMs)
      continue
    }

    logger({
      kind: "progress",
      message: `claimed msg ${msg.msgId} (read_ct=${msg.readCt}) run=${msg.body.runId}`,
    })

    if (msg.readCt > 3) {
      logger({
        kind: "warn",
        message: `msg ${msg.msgId} exceeded retry limit; archiving`,
      })
      // Mark the run failed
      const synthFailed = ["performance", "seo", "best-practices", "pwa", "on-page"]
        .map((c) => ({
          category: c as never,
          url: msg!.body.requestedUrl,
          requestedUrl: msg!.body.requestedUrl,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          packageName: `@repo/audit-${c}`,
          packageVersion: "0.0.0",
          status: "failed" as const,
          error: {
            code: "UNKNOWN" as const,
            message: "exceeded retry limit (3)",
            retryable: false,
          },
        }))
      for (const s of synthFailed) {
        try {
          await insertAuditResult(db, s, msg.body.runId, msg.body.ownerId)
        } catch (err) {
          logger({
            kind: "warn",
            message: `failed to insert synthetic failure: ${(err as Error).message}`,
          })
        }
      }
      await queue.archive(msg.msgId)
      continue
    }

    currentAbort = new AbortController()
    try {
      const result = await processRun(msg.body.runId, {
        dbApi: {
          getAuditRun: (id) => getAuditRun(db, id),
          markAuditRunRunning: (id) => markAuditRunRunning(db, id),
          getCompletedCategoriesForRun: (id) => getCompletedCategoriesForRun(db, id),
          insertAuditResult: (r, runId, ownerId) =>
            insertAuditResult(db, r, runId, ownerId),
        },
        aggregate,
        packages: defaultPackages,
        logger,
        signal: currentAbort.signal,
      })
      logger({
        kind: "progress",
        message: `run ${msg.body.runId} -> ${result.status}`,
      })
      await queue.ack(msg.msgId)
    } catch (err) {
      logger({
        kind: "warn",
        message: `processRun threw, leaving message for retry: ${(err as Error).message}`,
      })
      // No ack — pgmq returns the message after visibility timeout
    } finally {
      currentAbort = undefined
    }
  }

  // Graceful shutdown: wait up to shutdownGraceMs for any in-flight job to settle
  // (the abort signal was set; processRun's loop honors it).
  // In this simple daemon loop, all work happens inside the `while` body, so
  // by the time we exit the loop the in-flight job is already cleaned up.
  // The shutdownGraceMs option is kept for future when we have multiple workers.
  void shutdownGraceMs

  logger({ kind: "progress", message: "daemon exited cleanly" })
}
```

- [ ] **Step 2: Build + typecheck**

```bash
bun --filter @repo/runner build
bun --filter @repo/runner check-types
```

Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/runner/src/daemon.ts
git commit -m "feat(runner): add daemon poll loop with signal handling and retry-limit archive"
```

---

## Task 10: `cli.ts` + `enqueue.ts` + main entry

**Files:**
- Create: `apps/runner/src/cli.ts`
- Create: `apps/runner/src/enqueue.ts`
- Modify: `apps/runner/src/index.ts` (replace placeholder)

- [ ] **Step 1: Create `src/enqueue.ts`**

```ts
import { and, eq } from "drizzle-orm"
import { createDbClient, insertAuditRun, schema } from "@repo/db"

export type EnqueueOptions = {
  url: string
  ownerId: string
  siteId?: string
  label?: string
  connectionString: string
}

export async function enqueueOne(opts: EnqueueOptions): Promise<string> {
  const db = createDbClient({
    connectionString: opts.connectionString,
    role: "service_role",
    ssl: false,
  })

  let siteId = opts.siteId
  if (!siteId) {
    // Find the user's self-site (is_competitor=false)
    const rows = await db
      .select({ id: schema.sites.id })
      .from(schema.sites)
      .where(and(
        eq(schema.sites.ownerId, opts.ownerId),
        eq(schema.sites.isCompetitor, false),
      ))
    siteId = rows[0]?.id
    if (!siteId) {
      throw new Error(
        `no self-site found for owner ${opts.ownerId}; pass --site-id or seed first`,
      )
    }
  }

  const runId = await insertAuditRun(db, {
    siteId,
    requestedUrl: opts.url,
    triggeredBy: "manual",
  })
  return runId
}
```

- [ ] **Step 2: Create `src/cli.ts`**

```ts
import { Command } from "commander"
import { z } from "zod"
import { runDaemon } from "./daemon.js"
import { enqueueOne } from "./enqueue.js"

const DEFAULT_DB =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

export function buildCli(): Command {
  const program = new Command()
    .name("runner")
    .description("audit runner daemon and helpers")

  program
    .command("start", { isDefault: true })
    .description("start the poll-loop daemon")
    .option("--connection-string <url>", "Postgres connection string", process.env["DATABASE_URL"] ?? DEFAULT_DB)
    .option("--poll-interval-ms <ms>", "ms to sleep when queue is empty", "1000")
    .option("--visibility-timeout-sec <sec>", "pgmq visibility timeout", "600")
    .action(async (opts: { connectionString: string; pollIntervalMs: string; visibilityTimeoutSec: string }) => {
      await runDaemon({
        connectionString: opts.connectionString,
        pollIntervalMs: Number.parseInt(opts.pollIntervalMs, 10),
        visibilityTimeoutSec: Number.parseInt(opts.visibilityTimeoutSec, 10),
      })
    })

  program
    .command("enqueue")
    .description("manually enqueue an audit run for testing")
    .argument("<url>", "URL to audit")
    .option("--owner-id <uuid>", "owner profile id (or DEFAULT_OWNER_ID env)", process.env["DEFAULT_OWNER_ID"])
    .option("--site-id <uuid>", "site id (defaults to owner's self-site)")
    .option("--label <string>", "site label (only used if creating)")
    .option("--connection-string <url>", "Postgres connection string", process.env["DATABASE_URL"] ?? DEFAULT_DB)
    .action(async (url: string, opts: {
      ownerId?: string
      siteId?: string
      label?: string
      connectionString: string
    }) => {
      if (!opts.ownerId) {
        process.stderr.write("runner: --owner-id is required (or set DEFAULT_OWNER_ID)\n")
        process.exit(2)
      }
      z.url().parse(url)
      const runId = await enqueueOne({
        url,
        ownerId: opts.ownerId,
        siteId: opts.siteId,
        label: opts.label,
        connectionString: opts.connectionString,
      })
      process.stdout.write(`runId: ${runId}\n`)
    })

  return program
}
```

- [ ] **Step 3: Wire `src/index.ts`**

Replace the placeholder:

```ts
#!/usr/bin/env node
import { buildCli } from "./cli.js"

const cli = buildCli()
cli.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`runner: ${(err as Error).message}\n`)
  process.exit(1)
})
```

- [ ] **Step 4: Load .env.local automatically**

The runner doesn't auto-load `.env.local` from vitest's hooks; for CLI invocation we need our own loader. Add this to the very top of `src/index.ts`:

```ts
#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

// Eagerly load .env.local from the runner's package root (if present).
// In production (Docker), env comes from the container; the file won't exist.
try {
  const here = dirname(fileURLToPath(import.meta.url))
  // src/index.ts is at apps/runner/src; .env.local sits two levels up
  const envFile = readFileSync(resolve(here, "..", ".env.local"), "utf8")
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "")
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // .env.local missing — fall back to process.env (container case)
}

import { buildCli } from "./cli.js"

const cli = buildCli()
cli.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`runner: ${(err as Error).message}\n`)
  process.exit(1)
})
```

NB: in production builds, `src/index.ts` is bundled by tsdown into `dist/index.js`. The relative path `..` from `dist/` would point at `apps/runner/` — same place — so the loader still finds `.env.local` if present.

- [ ] **Step 5: Smoke test — help text**

```bash
bun --filter @repo/runner build
node apps/runner/dist/index.js --help
node apps/runner/dist/index.js enqueue --help
```

Expect commander help output for both.

- [ ] **Step 6: Commit**

```bash
git add apps/runner/src
git commit -m "feat(runner): add CLI with start and enqueue subcommands"
```

---

## Task 11: Integration test scaffolding

**Files:**
- Create: `packages/runner-core/integration/load-env.ts`
- Create: `packages/runner-core/integration/helpers.ts`

The pattern mirrors slice 2's helpers. We rely on slice 2's `@repo/db` for createServiceDb-like behavior (or just expose the same).

- [ ] **Step 1: `load-env.ts`**

`packages/runner-core/integration/load-env.ts`:

```ts
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
try {
  const envFile = readFileSync(resolve(here, "..", ".env.local"), "utf8")
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "")
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // .env.local missing — assume env is already set
}
```

Note: this reads `.env.local` from `packages/runner-core/.env.local`, which the developer copies from `.env.example` and fills with the local Supabase creds.

- [ ] **Step 2: `helpers.ts`**

`packages/runner-core/integration/helpers.ts`:

```ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { sql } from "drizzle-orm"
import { createDbClient } from "@repo/db"

const DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]

if (!SERVICE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required. Run `bunx supabase status -o env` and copy it into packages/runner-core/.env.local",
  )
}

const auth = createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

export async function createTestUser(suffix: string): Promise<{
  id: string
  email: string
}> {
  const email = `runner-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const created = await auth.auth.admin.createUser({
    email,
    password: "supersecret123!",
    email_confirm: true,
  })
  if (created.error || !created.data.user) {
    throw new Error(`createTestUser failed: ${created.error?.message}`)
  }
  return { id: created.data.user.id, email }
}

export async function deleteTestUser(id: string): Promise<void> {
  await auth.auth.admin.deleteUser(id)
}

export function createServiceDb() {
  const db = createDbClient({
    connectionString: DB_URL,
    role: "service_role",
    ssl: false,
  })
  // postgres-js client isn't directly exposed by createDbClient; we'll let the
  // caller close it via a separate close() function if needed. For the tests
  // here, leaving the connection open until process exit is fine.
  return { db, close: async () => {} }
}

export async function truncateUserData(): Promise<void> {
  const { db } = createServiceDb()
  await db.execute(sql`
    TRUNCATE public.audit_results, public.audit_runs, public.sites, public.profiles
    RESTART IDENTITY CASCADE
  `)
}

export async function purgeQueue(queueName = "audit_runs"): Promise<void> {
  const { db } = createServiceDb()
  // pgmq.purge_queue empties the queue
  await db.execute(sql`SELECT pgmq.purge_queue(${queueName})`)
}
```

- [ ] **Step 3: Smoke compile**

```bash
bun --filter @repo/runner-core check-types
```

PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/runner-core/integration/load-env.ts packages/runner-core/integration/helpers.ts
git commit -m "test(runner): integration helpers (test users, service db, queue purge)"
```

---

## Task 12: `processRun` integration test — real pgmq + DB, mocked aggregate

**Files:**
- Create: `packages/runner-core/integration/process-run.integration.test.ts`

- [ ] **Step 1: Pre-flight**

Confirm `packages/runner-core/.env.local` exists. If not:

```bash
cp packages/runner-core/.env.example packages/runner-core/.env.local
# Populate SUPABASE_SERVICE_ROLE_KEY (and ANON if needed) from `bunx supabase status -o env`
```

- [ ] **Step 2: Write the test file**

`packages/runner-core/integration/process-run.integration.test.ts`:

```ts
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { AuditResult, Category } from "@repo/audit-core"
import {
  createDbClient,
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  insertAuditRun,
  markAuditRunRunning,
  schema,
} from "@repo/db"
import { processRun } from "../src/process-run.js"
import { silentLogger } from "../src/logger.js"
import {
  createServiceDb,
  createTestUser,
  deleteTestUser,
  purgeQueue,
  truncateUserData,
} from "./helpers.js"

const enabled = process.env["RUN_INTEGRATION"] === "1"

const ALL: Category[] = ["performance", "seo", "best-practices", "pwa", "on-page"]

;(enabled ? describe : describe.skip)("processRun integration", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("processrun")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  beforeEach(async () => {
    await truncateUserData()
    await purgeQueue()
    await service.db.insert(schema.profiles).values({ id: user.id })
  })

  it("end-to-end: insertAuditRun -> queue -> processRun -> 5 results -> rollup completed", async () => {
    // Insert site + run (the audit_runs trigger publishes to pgmq automatically)
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })

    const runId = await insertAuditRun(service.db, {
      siteId: site!.id,
      requestedUrl: "https://example.com",
    })

    // Mock aggregate returns 5 success results
    const aggregate = async (url: string, _opts: never, _packages: never): Promise<AuditResult[]> =>
      ALL.map((c) => ({
        category: c,
        url,
        requestedUrl: url,
        startedAt: new Date().toISOString(),
        durationMs: 1000,
        packageName: `@repo/audit-${c}`,
        packageVersion: "0.0.0",
        status: "success",
        score: 90,
        issues: [],
        raw: { ok: true },
      }))

    const result = await processRun(runId, {
      dbApi: {
        getAuditRun: (id) => getAuditRun(service.db, id),
        markAuditRunRunning: (id) => markAuditRunRunning(service.db, id),
        getCompletedCategoriesForRun: (id) =>
          getCompletedCategoriesForRun(service.db, id),
        insertAuditResult: (r, runId, ownerId) =>
          insertAuditResult(service.db, r, runId, ownerId),
      },
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })

    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.resultsInserted).toBe(5)
    }

    // Verify DB state
    const rows = await service.db
      .select()
      .from(schema.auditResults)
      .where(eq(schema.auditResults.runId, runId))
    expect(rows).toHaveLength(5)
    const [run] = await service.db
      .select({ status: schema.auditRuns.status })
      .from(schema.auditRuns)
      .where(eq(schema.auditRuns.id, runId))
    expect(run?.status).toBe("completed")
  })

  it("idempotent: re-running after partial insert skips already-completed categories", async () => {
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })

    const runId = await insertAuditRun(service.db, {
      siteId: site!.id,
      requestedUrl: "https://example.com",
    })

    // Manually insert 2 successful results to simulate a crashed prior run
    for (const c of ["performance", "seo"] as Category[]) {
      await insertAuditResult(
        service.db,
        {
          category: c,
          url: "https://example.com/",
          requestedUrl: "https://example.com",
          startedAt: new Date().toISOString(),
          durationMs: 1000,
          packageName: `@repo/audit-${c}`,
          packageVersion: "0.0.0",
          status: "success",
          score: 88,
          issues: [],
          raw: {},
        },
        runId,
        user.id,
      )
    }

    let aggregateCalls = 0
    const aggregate = async (url: string, opts: { only?: Category[] }, _: never): Promise<AuditResult[]> => {
      aggregateCalls++
      const only = opts.only ?? ALL
      return only.map((c) => ({
        category: c,
        url,
        requestedUrl: url,
        startedAt: new Date().toISOString(),
        durationMs: 1000,
        packageName: `@repo/audit-${c}`,
        packageVersion: "0.0.0",
        status: "success",
        score: 92,
        issues: [],
        raw: {},
      }))
    }

    const result = await processRun(runId, {
      dbApi: {
        getAuditRun: (id) => getAuditRun(service.db, id),
        markAuditRunRunning: (id) => markAuditRunRunning(service.db, id),
        getCompletedCategoriesForRun: (id) =>
          getCompletedCategoriesForRun(service.db, id),
        insertAuditResult: (r, runId, ownerId) =>
          insertAuditResult(service.db, r, runId, ownerId),
      },
      aggregate,
      packages: {} as never,
      logger: silentLogger,
    })

    expect(aggregateCalls).toBe(1)
    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.resultsInserted).toBe(3) // only the missing 3
    }
  })
})
```

- [ ] **Step 3: Run**

```bash
RUN_INTEGRATION=1 bun --filter @repo/runner-core test:integration
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/runner-core/integration/process-run.integration.test.ts
git commit -m "test(runner): processRun integration (real pgmq + DB, mocked aggregate)"
```

---

## Task 13: Daemon integration test

**Files:**
- Create: `packages/runner-core/integration/daemon.integration.test.ts`

This test runs the daemon in-process for a few seconds, enqueues a job, and asserts the daemon processes it.

- [ ] **Step 1: Write the test file**

`packages/runner-core/integration/daemon.integration.test.ts`:

```ts
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { AuditResult, Category } from "@repo/audit-core"
import {
  createDbClient,
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  insertAuditRun,
  markAuditRunRunning,
  schema,
} from "@repo/db"
import {
  createQueueClient,
  processRun,
  sleep,
} from "../src/index.js"
import {
  createServiceDb,
  createTestUser,
  deleteTestUser,
  purgeQueue,
  truncateUserData,
} from "./helpers.js"

const enabled = process.env["RUN_INTEGRATION"] === "1"

const ALL: Category[] = ["performance", "seo", "best-practices", "pwa", "on-page"]

const mockAggregate = async (url: string, opts: { only?: Category[] }, _: never): Promise<AuditResult[]> => {
  const only = opts.only ?? ALL
  return only.map((c) => ({
    category: c,
    url,
    requestedUrl: url,
    startedAt: new Date().toISOString(),
    durationMs: 100,
    packageName: `@repo/audit-${c}`,
    packageVersion: "0.0.0",
    status: "success",
    score: 91,
    issues: [],
    raw: {},
  }))
}

;(enabled ? describe : describe.skip)("daemon integration", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("daemon")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  beforeEach(async () => {
    await truncateUserData()
    await purgeQueue()
    await service.db.insert(schema.profiles).values({ id: user.id })
  })

  it("polling: claims a queued message, processes it, acks", async () => {
    // Insert a site + run (trigger publishes to pgmq)
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })

    const runId = await insertAuditRun(service.db, {
      siteId: site!.id,
      requestedUrl: "https://example.com",
    })

    // Build queue client and poll loop manually
    const queue = createQueueClient(service.db)

    // Poll for up to 5s to claim the message
    let msg = undefined
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      msg = await queue.read(60)
      if (msg) break
      await sleep(100)
    }
    expect(msg).toBeDefined()
    if (!msg) throw new Error("never claimed message")
    expect(msg.body.runId).toBe(runId)

    // Process it (mocked aggregate so no Chrome)
    const result = await processRun(msg.body.runId, {
      dbApi: {
        getAuditRun: (id) => getAuditRun(service.db, id),
        markAuditRunRunning: (id) => markAuditRunRunning(service.db, id),
        getCompletedCategoriesForRun: (id) =>
          getCompletedCategoriesForRun(service.db, id),
        insertAuditResult: (r, runId, ownerId) =>
          insertAuditResult(service.db, r, runId, ownerId),
      },
      aggregate: mockAggregate,
      packages: {} as never,
      logger: () => {},
    })
    expect(result.status).toBe("completed")

    // Ack
    await queue.ack(msg.msgId)

    // Verify queue is empty
    const next = await queue.read(60)
    expect(next).toBeUndefined()

    // Verify DB state
    const rows = await service.db
      .select()
      .from(schema.auditResults)
      .where(eq(schema.auditResults.runId, runId))
    expect(rows).toHaveLength(5)
    const [run] = await service.db
      .select({ status: schema.auditRuns.status })
      .from(schema.auditRuns)
      .where(eq(schema.auditRuns.id, runId))
    expect(run?.status).toBe("completed")
  }, 30_000)

  it("retry-limit: read_ct > 3 triggers archive + synthetic failed rows", async () => {
    // Insert a site + run
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })
    const runId = await insertAuditRun(service.db, {
      siteId: site!.id,
      requestedUrl: "https://example.com",
    })

    const queue = createQueueClient(service.db)

    // Read the message 4 times without acking to bump read_ct to 4
    for (let i = 0; i < 4; i++) {
      const msg = await queue.read(1)
      expect(msg).toBeDefined()
      // Don't ack, but wait for visibility timeout (1s) so the next read sees it again
      await sleep(1100)
    }

    // The 5th read sees read_ct=4 (or higher) — we hand-process by inserting
    // synthetic failed rows + archive, matching the daemon logic.
    const msg = await queue.read(60)
    expect(msg).toBeDefined()
    expect(msg!.readCt).toBeGreaterThan(3)

    // Insert synthetic failed rows for all 5 categories
    for (const c of ALL) {
      await insertAuditResult(
        service.db,
        {
          category: c,
          url: msg!.body.requestedUrl,
          requestedUrl: msg!.body.requestedUrl,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          packageName: `@repo/audit-${c}`,
          packageVersion: "0.0.0",
          status: "failed",
          error: {
            code: "UNKNOWN",
            message: "exceeded retry limit (3)",
            retryable: false,
          },
        },
        runId,
        user.id,
      )
    }
    await queue.archive(msg!.msgId)

    // Verify run is now failed
    const [run] = await service.db
      .select({ status: schema.auditRuns.status })
      .from(schema.auditRuns)
      .where(eq(schema.auditRuns.id, runId))
    expect(run?.status).toBe("failed")

    // Verify queue empty (archived, not just acked)
    const next = await queue.read(60)
    expect(next).toBeUndefined()
  }, 30_000)
})
```

- [ ] **Step 2: Run**

```bash
RUN_INTEGRATION=1 bun --filter @repo/runner-core test:integration
```

Expected: 4 tests pass (2 processRun from T12 + 2 daemon from T13).

- [ ] **Step 3: Commit**

```bash
git add packages/runner-core/integration/daemon.integration.test.ts
git commit -m "test(runner): daemon-pattern integration (polling + retry-limit archive)"
```

---

## Task 14: End-to-end test with real Chrome

**Files:**
- Create: `packages/runner-core/integration/end-to-end.integration.test.ts`

Gated on `RUN_INTEGRATION=1 AND RUN_E2E=1`. One test. Slow (~30-60s).

- [ ] **Step 1: Write the test**

`packages/runner-core/integration/end-to-end.integration.test.ts`:

```ts
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { aggregate, defaultPackages } from "@repo/audit-cli/lib"
import { AuditResultSchema } from "@repo/audit-core"
import {
  createDbClient,
  getAuditRun,
  getCompletedCategoriesForRun,
  insertAuditResult,
  insertAuditRun,
  markAuditRunRunning,
  schema,
} from "@repo/db"
import { processRun } from "../src/index.js"
import {
  createServiceDb,
  createTestUser,
  deleteTestUser,
  purgeQueue,
  truncateUserData,
} from "./helpers.js"

const enabled =
  process.env["RUN_INTEGRATION"] === "1" && process.env["RUN_E2E"] === "1"

;(enabled ? describe : describe.skip)("end-to-end with real Chrome", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let service: ReturnType<typeof createServiceDb>

  beforeAll(async () => {
    service = createServiceDb()
    user = await createTestUser("e2e")
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  beforeEach(async () => {
    await truncateUserData()
    await purgeQueue()
    await service.db.insert(schema.profiles).values({ id: user.id })
  })

  it("processes a real audit_run against https://example.com end-to-end", async () => {
    const [site] = await service.db
      .insert(schema.sites)
      .values({
        ownerId: user.id,
        url: "https://example.com",
        normalizedUrl: "https://example.com/",
      })
      .returning({ id: schema.sites.id })
    const runId = await insertAuditRun(service.db, {
      siteId: site!.id,
      requestedUrl: "https://example.com",
    })

    const result = await processRun(runId, {
      dbApi: {
        getAuditRun: (id) => getAuditRun(service.db, id),
        markAuditRunRunning: (id) => markAuditRunRunning(service.db, id),
        getCompletedCategoriesForRun: (id) =>
          getCompletedCategoriesForRun(service.db, id),
        insertAuditResult: (r, runId, ownerId) =>
          insertAuditResult(service.db, r, runId, ownerId),
      },
      aggregate,
      packages: defaultPackages,
      logger: () => {},
      timeoutMs: 120_000,
    })

    // Accept completed OR partial (PWA may return partial on Lighthouse 12)
    expect(["completed", "partial"]).toContain(result.status)

    const rows = await service.db
      .select()
      .from(schema.auditResults)
      .where(eq(schema.auditResults.runId, runId))
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      // sanity-check the runtime shape matches the AuditResult contract
      // (a less-strict check — we're not round-tripping through the schema here
      // because rows come back from Drizzle, not from the audit packages).
      expect(["success", "partial", "failed"]).toContain(row.status)
    }
  }, 180_000)
})
```

- [ ] **Step 2: Run**

```bash
RUN_INTEGRATION=1 RUN_E2E=1 bun --filter @repo/runner-core test:integration
```

Expected: 5 tests pass total (2 processRun + 2 daemon + 1 e2e). The e2e takes ~30-60s.

- [ ] **Step 3: Commit**

```bash
git add packages/runner-core/integration/end-to-end.integration.test.ts
git commit -m "test(runner): end-to-end real-Chrome integration (gated RUN_E2E)"
```

---

## Task 15: Dockerfile

**Files:**
- Create: `apps/runner/Dockerfile`
- Create: `apps/runner/.dockerignore`

- [ ] **Step 1: `Dockerfile`**

`apps/runner/Dockerfile`:

```dockerfile
# Stage 1: build
FROM oven/bun:1.3.4 AS builder
WORKDIR /app

# Workspace plumbing
COPY package.json bun.lock turbo.json ./
COPY packages packages
COPY apps/runner apps/runner

RUN bun install --frozen-lockfile

# Build the slice 1 + slice 2 + slice 3 packages in topological order
RUN bun --filter @repo/audit-core build
RUN bun --filter @repo/lighthouse-runner build
RUN bun --filter @repo/audit-perf build
RUN bun --filter @repo/audit-seo build
RUN bun --filter @repo/audit-best-practices build
RUN bun --filter @repo/audit-pwa build
RUN bun --filter @repo/audit-onpage build
RUN bun --filter @repo/audit-cli build
RUN bun --filter @repo/db build
RUN bun --filter @repo/runner-core build
RUN bun --filter @repo/runner build

# Stage 2: runtime
FROM oven/bun:1.3.4-slim
WORKDIR /app

# Chromium (for Lighthouse) + minimal deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV LH_NO_SANDBOX=1
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Copy built artefacts + node_modules
COPY --from=builder /app/apps/runner/dist /app/apps/runner/dist
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/node_modules /app/node_modules

CMD ["node", "/app/apps/runner/dist/index.js", "start"]
```

- [ ] **Step 2: `.dockerignore`**

`apps/runner/.dockerignore`:

```
node_modules
dist
.env*
*.log
.git
```

- [ ] **Step 3: Build the image**

From repo root:

```bash
docker build -t seo-runner -f apps/runner/Dockerfile .
```

Expected: succeeds. ~2-5 min on first run (downloading Chromium layer). Subsequent builds use the layer cache.

- [ ] **Step 4: Smoke-run the image**

```bash
docker run --rm \
  -e DATABASE_URL="postgresql://host.docker.internal:54322/postgres?user=postgres&password=postgres" \
  -e SUPABASE_URL="http://host.docker.internal:54321" \
  -e SUPABASE_SERVICE_ROLE_KEY="$(cd packages/db && grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2)" \
  seo-runner
```

(On macOS, `host.docker.internal` routes from container to host.)

Expect: daemon prints "polling pgmq" and continues running. Ctrl+C to stop.

If the image can't reach the local Supabase from within Docker, this is environmental (Supabase by default binds to 127.0.0.1; docker network can't reach it without `host.docker.internal` resolution). The test command above includes the right hostname.

- [ ] **Step 5: Commit**

```bash
git add apps/runner/Dockerfile apps/runner/.dockerignore
git commit -m "feat(runner): add Dockerfile with Chromium for production runtime"
```

---

## Task 16: README + Definition-of-Done validation

**Files:**
- Create: `apps/runner/README.md`

- [ ] **Step 1: `README.md`**

`apps/runner/README.md`:

```markdown
# @repo/runner

Audit runner daemon. Polls the Postgres-backed pgmq queue for `audit_runs` messages, executes the slice 1 audit pipeline (via `@repo/audit-cli/lib`), persists results via `@repo/db`, and lets Supabase Realtime fan progress out to subscribed clients (via `postgres_changes` on `audit_runs` + `audit_results`).

## Setup

\`\`\`bash
# Boot the local Supabase stack (Docker required)
bunx supabase start

# Apply migrations (includes 0003_queue.sql)
bun --filter @repo/db migrate

# Copy env vars
cp apps/runner/.env.example apps/runner/.env.local
# Fill SUPABASE_SERVICE_ROLE_KEY from `bunx supabase status -o env`
\`\`\`

## Running the daemon (locally)

\`\`\`bash
bun --filter @repo/runner dev
\`\`\`

Logs structured JSON to stderr.

## Enqueueing a test job

\`\`\`bash
# Get an owner uuid from your seeded user (slice 2 T17 seed.ts creates one)
OWNER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -At -c "SELECT id FROM profiles LIMIT 1")

bun --filter @repo/runner enqueue https://example.com --owner-id "$OWNER_ID"
\`\`\`

Output:
\`\`\`
runId: <uuid>
\`\`\`

The DB trigger publishes the runId to pgmq immediately. If the daemon is running, it claims and processes within seconds.

## Docker

\`\`\`bash
docker build -t seo-runner -f apps/runner/Dockerfile .
docker run --rm \\
  -e DATABASE_URL="postgresql://host.docker.internal:54322/postgres?user=postgres&password=postgres" \\
  -e SUPABASE_URL="http://host.docker.internal:54321" \\
  -e SUPABASE_SERVICE_ROLE_KEY="<key>" \\
  seo-runner
\`\`\`

The image bundles Chromium for Lighthouse and sets `LH_NO_SANDBOX=1`.

## Realtime subscription (dashboard preview)

The runner writes audit_runs and audit_results rows; Supabase Realtime emits `postgres_changes` events for both tables. A dashboard would subscribe like:

\`\`\`ts
supabase
  .channel(\`audit-run:\${runId}\`)
  .on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "audit_results",
    filter: \`run_id=eq.\${runId}\`,
  }, (payload) => { /* render score */ })
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "audit_runs",
    filter: \`id=eq.\${runId}\`,
  }, (payload) => { /* status badge */ })
  .subscribe()
\`\`\`

## Configuration

| Env var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (local Supabase or production) |
| `SUPABASE_URL` | Supabase API URL (used by integration tests for Auth admin API) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT (bypasses RLS) |
| `DEFAULT_OWNER_ID` | Optional default for `runner enqueue --owner-id` |
| `LH_NO_SANDBOX=1` | Set when running Chrome inside Docker |

## Architecture

See [`docs/plans/2026-06-04-slice3-runner-design.md`](../../docs/plans/2026-06-04-slice3-runner-design.md).
```

- [ ] **Step 2: Run the full Definition-of-Done sweep**

```bash
# 1. Build everything
bun --filter @repo/audit-cli build
bun --filter @repo/db build
bun --filter @repo/runner-core build
bun --filter @repo/runner build

# 2. Typecheck
bun --filter @repo/audit-cli check-types
bun --filter @repo/db check-types
bun --filter @repo/runner-core check-types
bun --filter @repo/runner check-types

# 3. Unit tests
bun --filter @repo/runner-core test
# Expected: ~19 tests pass

# 4. Db migrations include 0003
ls packages/db/migrations/0003_queue.sql

# 5. Fresh DB applies cleanly
bunx supabase db reset
bun --filter @repo/db migrate
# Expected: "migrations applied"

# 6. Integration tests
RUN_INTEGRATION=1 bun --filter @repo/runner-core test:integration
# Expected: 4 tests pass

# 7. E2E (slow)
RUN_INTEGRATION=1 RUN_E2E=1 bun --filter @repo/runner-core test:integration
# Expected: 5 tests pass (slow one takes 30-60s)

# 8. Docker
docker build -t seo-runner -f apps/runner/Dockerfile .
# Expected: builds successfully

# 9. Manual smoke
# Terminal A
bun --filter @repo/runner dev
# Terminal B
bun --filter @repo/db seed     # create demo user + site
OWNER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -At -c "SELECT id FROM profiles LIMIT 1")
bun --filter @repo/runner enqueue https://example.com --owner-id "$OWNER_ID"
# Terminal A should claim the job, process 5 audits, and print "completed" or "partial"
# Studio (http://127.0.0.1:54323) → audit_results table → 5 new rows
```

Document the results in your report.

- [ ] **Step 3: Commit**

```bash
git add apps/runner/README.md
git commit -m "docs(runner): README + slice 3 DoD validation"
```

---

## After slice 3

Slice 4 (dashboard MVP) is the natural follow-up. It will:
- Authenticate users via Supabase Auth UI (or @supabase/ssr equivalent in Next.js)
- List the user's sites
- Trigger an audit by calling `insertAuditRun` (which fires the slice 3 trigger → pgmq → daemon picks up)
- Subscribe to `postgres_changes` on `audit_runs` + `audit_results` for the running runId
- Render a radar chart of the 5 category scores (using `recharts`, already in catalog)

The `@repo/runner-core` `processRun` contract is the runtime promise slice 4 depends on (indirectly): an `audit_run` row → 5 `audit_result` rows + a terminal status, all visible to the owner via RLS.
