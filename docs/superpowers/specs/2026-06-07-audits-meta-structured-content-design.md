# Audits: Meta, Structured, Content — Design

**Status:** approved (2026-06-07)
**Author:** Jonas + Claude (brainstorming session)

## Goal

Add 11 new user-facing HTML-level audit checks to the platform, sliced into three new audit packages, integrated into `apps/app` without dashboard or DB schema changes.

The original request listed 13 checks; sitemap.xml and robots.txt already exist in `packages/audit-onpage`. The remaining 11 user-facing checks expand to **14 Rules** in code because the Open Graph user-check splits into 4 rules (one per platform — facebook, twitter, pinterest, linkedin) per design decision Q4.

The 14 rules:

| # | Check | Package | Rule ID | Category |
|---|---|---|---|---|
| 1 | Meta viewport | audit-meta | `meta/viewport-missing` | on-page |
| 2 | Language (`<html lang>`) | audit-meta | `meta/lang-missing` | on-page |
| 3 | Doctype | audit-meta | `meta/doctype-missing` | on-page |
| 4 | Encoding (`<meta charset>`) | audit-meta | `meta/encoding-missing` | on-page |
| 5 | Favicon | audit-meta | `meta/favicon-missing` | on-page |
| 6 | HTTPS (scheme + mixed content) | audit-meta | `meta/https-*` | on-page |
| 7 | Schema.org / structured data | audit-structured | `structured/schema-org-invalid` | seo |
| 8 | Microformats | audit-structured | `structured/microformats-found` | seo |
| 9 | llms.txt | audit-structured | `structured/llms-txt-missing` | seo |
| 10 | Open Graph — Facebook | audit-structured | `structured/og-facebook-missing` | seo |
| 11 | Open Graph — Twitter | audit-structured | `structured/og-twitter-missing` | seo |
| 12 | Open Graph — Pinterest | audit-structured | `structured/og-pinterest-missing` | seo |
| 13 | Open Graph — LinkedIn | audit-structured | `structured/og-linkedin-missing` | seo |
| 14 | Keyword density (1/2/3/4-gram) | audit-content | `content/keyword-density` | seo |

## Decisions locked during brainstorming

1. **Three new packages**, not extending audit-onpage and not one grab-bag package. (`audit-meta`, `audit-structured`, `audit-content`.)
2. **Reuse the existing 5-value `Category` enum** in `audit-core`. No schema change. `audit-meta` → `on-page`; `audit-structured` and `audit-content` → `seo`.
3. **HTTPS scope** is scheme check + mixed-content scan of the already-fetched HTML. No TLS handshake, no HSTS, no cert validation.
4. **Open Graph is one rule per platform** (facebook, twitter, pinterest, linkedin) — each emits a single fail Issue listing missing required tags.
5. **Keyword density** surfaces as info-severity Issues with thresholds (one info Issue per n-gram listing top 10 terms; warn Issue per term where density > 5%).
6. **Single spec, single plan, ship all 3 packages together.** ~26 commits, ~30-40 TDD steps.
7. **Approach 1:** extract shared parse/fetch/Rule machinery into a new `@repo/audit-html-core` infra package, refactor `audit-onpage` to consume it, build the 3 new packages on it, and extend `audit-cli/src/aggregate.ts` with a per-category merger.

## Architecture

```
packages/
├── audit-core/                        (unchanged — Category enum stays 5 values)
├── audit-html-core/   ← NEW           shared parse/fetch/Rule/executor/score
│   └── consumed by: audit-onpage, audit-meta, audit-structured, audit-content
├── audit-onpage/      ← REFACTORED   delete src/parse.ts, fetch.ts, rules.ts, score.ts
│                                      now imports them from audit-html-core
│                                      rules untouched (still 8 rules)
├── audit-meta/        ← NEW           category: "on-page"
│   src/rules/
│     ├── viewport.ts
│     ├── lang.ts
│     ├── doctype.ts
│     ├── encoding.ts
│     ├── favicon.ts
│     └── https.ts
├── audit-structured/  ← NEW           category: "seo"
│   src/rules/
│     ├── schema-org.ts
│     ├── microformats.ts
│     ├── llms-txt.ts
│     ├── open-graph-facebook.ts
│     ├── open-graph-twitter.ts
│     ├── open-graph-pinterest.ts
│     └── open-graph-linkedin.ts
└── audit-content/     ← NEW           category: "seo"
    src/
      ├── rules/keyword-density.ts
      └── stopwords-en.ts

packages/audit-cli/src/
├── aggregate.ts       ← MODIFIED      adds meta/structured/content to AuditPackages
│                                      adds mergeByCategory() to fold shared-category
│                                      results into one AuditResult per category
└── lib.ts             ← MODIFIED      wires the 3 new packages into defaultPackages

apps/app/                              (no app changes in this slice —
                                       new issues appear in existing on-page/seo tabs)
```

**Network footprint per audit run:** existing 1 page fetch + 1 robots HEAD + 1 sitemap HEAD, plus 1 favicon HEAD + 1 llms.txt HEAD = 5 small HTTP requests total. All other rules read the already-fetched HTML.

## Data flow

### Single-package flow (unchanged from today)

```
fetchPage(url) → FetchedPage { html, headers, status, finalUrl }
              ↓
        parse(html) → CheerioAPI ($)
              ↓
   RULES.map(r → executeRule(r, { $, page }))   // Promise.all
              ↓
        deriveScore(RULES, outcomes) → { score, issues }
              ↓
   withTiming(...) wraps → AuditResult { status, category, score, issues, raw, timing }
```

Each new package follows this exactly. `audit-html-core` exports the shared pieces; each package supplies its own `RULES` array and its own `category` token.

### Aggregate-level flow with the merger

```
aggregate(url, opts) →
  [auditOnpage(url), auditMeta(url), auditStructured(url), auditContent(url),
   auditPerf, auditSeo, auditBP, auditPwa]  // all Promise.all'd
                              ↓
                    AuditResult[]                  // one per package call
                              ↓
                    mergeByCategory()              // NEW
                              ↓
            AuditResult[]                          // one per category
```

### `mergeByCategory(results: AuditResult[]): AuditResult[]` contract

The actual `AuditResult` discriminated union from `@repo/audit-core` is `status: "success" | "partial" | "failed"` (NOT `"skipped"` / `"failure"`). `score` is a required integer 0-100. `failed` results have no `score` or `issues` — only an `error`. The merger must produce a result that passes `AuditResultSchema.parse`.

| Field | Merge rule |
|---|---|
| `category` | shared (the grouping key) |
| `status` | If at least one contributor is `success` or `partial` → `partial` when any other contributor is `failed`/`partial`, else `success`. If ALL contributors are `failed` → `failed`. |
| `score` (when success/partial) | weighted average of contributors' scores (only success/partial contributors), weighted by their rule-weight totals from `raw.ruleSummary`. Rounded to integer 0-100. |
| `issues` (when success/partial) | concatenation of contributors' issues, preserving rule IDs |
| `raw` (when success/partial) | `{ [packageName]: contributorRaw }` keyed object |
| `partialReasons` (when partial) | `["<packageName> failed: <error.message>", ...]` for each `failed`/`partial` contributor |
| `error` (when all failed) | merged: `{ code: "UNKNOWN", message: "all contributors failed: <pkg1>: <msg1>; <pkg2>: <msg2>", retryable: false }` |
| `durationMs` | `max(end) - min(start)` across contributors |
| `startedAt` | min of contributors' `startedAt` |
| `url`, `requestedUrl` | first contributor's values (same URL, same audit run) |
| `packageName` | `"merged"` (sentinel) |
| `packageVersion` | `"merged"` |

Single-package categories pass through untouched — `mergeByCategory` only modifies results whose category has more than one contributor. So `perf`, `pwa`, `best-practices` are unaffected.

**Why weighted-average score, not min:** min lets a single tiny package tank the whole `seo` score. Weighted average means a 1-rule package contributes proportionally to its weight share. Contributor weights come from `raw.ruleSummary[].weight` (each contributor already exposes this).

**Edge cases:**
- One contributor `failed`, others `success` → merged is `partial`, score computed from the success contributors only, `partialReasons` lists the failed one.
- One contributor `partial` (has score + partialReasons), others `success` → merged is `partial`, score computed from all (partial has a score), partialReasons concatenated.
- All `failed` → merged is `failed` with aggregated error message. No `score`/`issues`.
- Contributor weights sum to 0 (very unlikely, but possible if every rule in every contributor skipped) → fall back to score `100` (matches `deriveScore`'s same behavior for a single-package empty case).
- Merged result is validated against `AuditResultSchema` at the boundary in `audit-cli/src/index.ts` (already happens today).

## Per-rule specifications

### audit-meta (category: `"on-page"`) — 6 rules

#### `meta/viewport-missing` — weight 4

- **Check:** `$('head > meta[name="viewport"]').first()` exists AND its `content` contains `width=device-width`.
- **Fail (error):** "Missing viewport meta tag" if absent; "Viewport meta does not include `width=device-width`" if present but malformed.
- **Recommendation:** `<meta name="viewport" content="width=device-width, initial-scale=1">`

#### `meta/lang-missing` — weight 3

- **Check:** `$('html').attr('lang')` is non-empty AND matches loose BCP-47 shape `/^[a-z]{2,3}(-[a-zA-Z0-9]{1,8})*$/i`.
- **Fail (warn):** "Missing or malformed `lang` attribute on `<html>`".
- **Rationale:** loose regex is intentional — better to accept `zh-Hans-CN` or `pt-BR` than reject them.

#### `meta/doctype-missing` — weight 2

- **Check:** raw `page.html` first 200 chars matches `/^\s*<!doctype\s+html\s*>/i`.
- **Note:** cheerio strips the doctype during parse, so this rule reads `page.html` directly, not `$`.
- **Fail (warn):** "Missing or non-HTML5 doctype".

#### `meta/encoding-missing` — weight 2

- **Check:** `$('head > meta[charset]')` present AND value is `utf-8` (case-insensitive). Fallback: `<meta http-equiv="Content-Type">` with `charset=utf-8`.
- **Fail (warn):** "Missing `<meta charset>`" / "Charset is not utf-8".
- **Edge case:** must be in `<head>`, not anywhere; inside `<body>` is too late.

#### `meta/favicon-missing` — weight 1, `runAsync`

- **Check:** any `<link rel~="icon">` exists AND a HEAD request to its resolved URL returns 200. If no link tag, fall back to `HEAD /favicon.ico`.
- **Fail (info):** "Favicon not found" with the URL probed.
- **Network:** 5s timeout, respects audit-level `opts.signal`.

#### `meta/https` — weight 5, `runAsync`

Two sub-checks under one rule ID family:
- `meta/https-scheme` — `new URL(page.finalUrl).protocol === 'https:'`. Fail (error) if `http:`.
- `meta/https-mixed-content` — scan `$('img[src], script[src], link[href], iframe[src]')` for `http://` URLs (excluding `http://localhost`, `http://127.0.0.1`, `http://[::1]`). Also scan inline `<style>` and `style=` attributes for `url(http://…)`. Skip `data:`, `blob:`, and anchor `<a href>` (links aren't mixed content; only resource loads are).
- **Fail (error):** "Mixed content: N HTTP resources on HTTPS page" with the first 5 URLs in the Issue's `occurrences[]`.

### audit-structured (category: `"seo"`) — 7 rules

#### `structured/schema-org-invalid` — weight 4

- **Check:** each `<script type="application/ld+json">` parses as JSON AND has `@context` containing `schema.org`.
- **Pass:** at least one valid JSON-LD block.
- **Fail (warn):** "No structured data" if no blocks; "Invalid JSON-LD" with per-block occurrences `{ scriptIndex, snippet, parseError }` if blocks exist but fail to parse or lack `@context`.

#### `structured/microformats-found` — weight 1, info-only

- **Check:** classes matching `/^(h-card|h-entry|h-event|h-feed|h-recipe|h-resume|h-review|h-product)$/` anywhere in the document (exact-token match via `~=`).
- **Always passes**; emits an `info` Issue documenting detected microformats. Absence is not a fault.

#### `structured/llms-txt-missing` — weight 1, `runAsync`

- **Check:** HEAD to `new URL('/llms.txt', page.finalUrl)`. Pass on 200, fail (info) on 404, skip on other errors. 5s timeout.

#### `structured/og-{facebook,twitter,pinterest,linkedin}-missing` — weight 2 each

Each emits one fail (warn) Issue listing missing required tags.

| Rule | Required tags |
|---|---|
| `og-facebook` | `og:title`, `og:type`, `og:image`, `og:url` |
| `og-twitter` | `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image` (falls back to `og:*` equivalents) |
| `og-pinterest` | `og:image`, `og:description` (info-flag if `og:image:width` < 600px) |
| `og-linkedin` | `og:title`, `og:image`, `og:description`, `og:url` |

- **Read both** `property="og:*"` AND `name="og:*"` attributes (some sites use the wrong one).

### audit-content (category: `"seo"`) — 1 rule

#### `content/keyword-density` — weight 1, info + warn

**Pipeline:**
1. Extract visible text: `$('body').clone().find('script,style,noscript').remove().end().text()`
2. Normalize: lowercase, strip non-letter chars (Unicode-aware via `/[\p{L}]+/gu`), collapse whitespace
3. Tokenize on whitespace → words
4. Filter stopwords from 1-grams only (~50-word English list at `packages/audit-content/src/stopwords-en.ts`). 2/3/4-grams keep all words ("the best way" is meaningful).
5. Build n-grams for n ∈ [1, 2, 3, 4]
6. For each n, compute density = `count(term) / total_ngrams_of_size_n`
7. Take top 10 per n

**Issues emitted:**
- **Per n-gram, one `info` Issue** titled "Top {n}-word phrases" with the top 10 in `occurrences[]` as `{ term, count, density }`.
- **One `warn` Issue per term where density > 5%** titled "Possible keyword stuffing: \"{term}\" appears in {density}% of {n}-grams".

**Skip:** if `total tokens < 50` (too noisy to be useful). Cap at first 100k tokens for performance.

**v1 is English-only.** Documented in the rule's recommendation. v2 can add language detection + per-language stopwords.

## Error handling

Every rule returns `pass`, `fail`, or `skip` — no thrown errors leak past `executeRule`. The shared executor (in `audit-html-core`) wraps each rule in `try/catch` and converts unexpected throws to `skip` with `reason: \`unexpected: ${err.message}\``. A single broken rule never fails the whole audit.

### Side-fetch failure modes (favicon, llms.txt)

| Failure mode | Outcome |
|---|---|
| `404` | `fail` (info severity) |
| `>= 400` other than 404 | `skip` with reason `\`HTTP ${status}\`` |
| network error (DNS, refused, TLS) | `skip` with reason `\`fetch failed: ${err.message}\`` |
| timeout (default 5s) | `skip` with reason `"timeout"` |

Each side-fetch uses `AbortSignal.timeout(opts.timeoutMs ?? 5000)` and respects the audit-level signal. HEAD requests (not GET) — only the status code is needed.

### Aggregate merger edge cases

- **One contributor failed, others succeeded** → merged status is `"partial"`, score from succeeded contributors only, `partialReasons` lists the failed one.
- **All contributors failed** → merged status is `"failed"` with aggregated error.
- **Contributor weights sum to 0** → merged score falls back to `100` (matches `deriveScore`'s same-package behavior).

## Testing strategy

| Layer | What | How |
|---|---|---|
| Each rule | 1 happy-path + 2-3 failure modes per rule | vitest in each package's `test/rules/` |
| Network rules | success / 404 / timeout / network error | `msw` (already a dev dep in audit-onpage) |
| `audit-html-core` | parse, fetch, executor wraps throws, score derivation | unit tests carried over from `audit-onpage` during the extraction |
| `audit-onpage` post-refactor | existing test suite continues to pass unchanged | run `bun --filter @repo/audit-onpage test` after the refactor commit |
| Per-package `audit()` integration | end-to-end with fixture HTML | one test per package |
| `mergeByCategory` | merges, status logic, weighted score math, null handling | unit test in `audit-cli/test/aggregate.test.ts` |
| `aggregate.ts` end-to-end | full audit run with stubbed packages → merged results | integration test |

## Rollout — commit order

Every commit leaves `bun run build && bun run lint && bun turbo test` green.

```
1.  chore(audit-html-core): scaffold package
2.  refactor(audit-onpage): move parse/fetch/rules/score machinery to @repo/audit-html-core
3.  chore(audit-meta): scaffold package
4.  feat(audit-meta): viewport rule + test
5.  feat(audit-meta): lang rule + test
6.  feat(audit-meta): doctype rule + test
7.  feat(audit-meta): encoding rule + test
8.  feat(audit-meta): favicon rule + test
9.  feat(audit-meta): https scheme + mixed content rule + test
10. feat(audit-meta): wire RULES + audit() entrypoint + integration test
11. chore(audit-structured): scaffold package
12. feat(audit-structured): schema-org rule + test
13. feat(audit-structured): microformats rule + test
14. feat(audit-structured): llms.txt rule + test
15. feat(audit-structured): og-facebook rule + test
16. feat(audit-structured): og-twitter rule + test
17. feat(audit-structured): og-pinterest rule + test
18. feat(audit-structured): og-linkedin rule + test
19. feat(audit-structured): wire RULES + audit() entrypoint + integration test
20. chore(audit-content): scaffold package + stopwords-en.ts
21. feat(audit-content): keyword density rule + test
22. feat(audit-content): wire RULES + audit() entrypoint + integration test
23. feat(audit-cli): extend AuditPackages with meta/structured/content
24. feat(audit-cli): mergeByCategory + unit tests
25. feat(audit-cli): wire new packages into defaultPackages + integration test
26. chore: catalog any new shared deps surfaced during impl
```

**Commit 2 is the riskiest** (refactor of working code). Strategy: the existing `audit-onpage` test suite must pass unchanged. Any test failure during the refactor is a real regression; fix in the same commit.

**Commits 23-25 ship as a unit** so `aggregate` is never partially wired.

## Out of scope for this slice

- **No new Category enum values.** If a future audit truly needs a `metadata` tab, it's a separate slice with a schema change.
- **No dashboard changes in `apps/app`.** The merged results appear in existing on-page and seo tabs.
- **No DB schema or view changes.** `latest_scores_per_site` already keys by `(site_id, category)`.
- **No keyword density visualization.** v1 is info Issues. A future bar chart can read `raw[packageName]` without re-running audits.
- **No multilingual stopwords.** English-only, documented.
- **No TLS posture beyond scheme + mixed content.**
- **No new `--only` CLI category flag** for the new packages. They piggyback on `--only on-page` and `--only seo`.
- **No competitor-comparison wiring.** This is purely an audit-shape change.

## Risk register

| Risk | Mitigation |
|---|---|
| Refactor commit regresses audit-onpage | Existing audit-onpage test suite (23 tests across 8 rule files) must pass unchanged before the commit ships |
| Merger weighted-average produces surprising scores | Unit test with hand-calculated expected values |
| HEAD requests slow down audits | 5s per-side-fetch timeout + Promise.all parallelism |
| OG validation noisy for partial-tag sites | Per-platform issues with explicit missing-tag lists |
| Keyword density misfires on JS-rendered SPAs | Same limitation `audit-onpage` already has. Documented as expected. |
| Stopword list too narrow → fake top terms | Start with 50; track which audits look weird; expand. Configuration change, not code change. |

## Test gate before each commit

```bash
bun --filter @repo/audit-html-core test
bun --filter @repo/audit-onpage test
bun --filter @repo/audit-meta test
bun --filter @repo/audit-structured test
bun --filter @repo/audit-content test
bun --filter @repo/audit-cli test
bun turbo check-types
bun run lint
```
