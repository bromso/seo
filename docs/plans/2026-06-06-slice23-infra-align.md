# Slice 23 — Infra & README Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all Docker, Kubernetes, devcontainer, and root README files into sync with the current monorepo reality (4 apps: `app`, `www`, `runner`, `story`; Supabase backend; web push). Drop all references to dead apps (`docs`, `legal`) and historical project names (`brand-monitor`, `kitchensink-react`, `Symbiora`).

**Architecture:** Pure documentation + configuration changes — zero application code touched, zero unit tests added. Mechanical transforms across 24 files: rename strings, delete dead subdirs, add one new Helm subchart (runner). Validation is structural — `helm lint`, `docker compose config`, grep-for-residuals.

**Tech Stack:** Helm 3 charts, Docker Compose v2, VS Code devcontainer JSON, Markdown. No new dependencies.

**Spec:** [`docs/plans/2026-06-06-slice23-infra-align-design.md`](2026-06-06-slice23-infra-align-design.md)

---

## Conventions used throughout

- Working branch: `feat/infra-align-slice23` (already created off `main`; spec committed at `4121c38`).
- Conventional commits: `docs(infra):` / `chore(infra):` / `feat(infra):`. The runner subchart is the only "feat" item.
- Husky pre-commit runs Biome + lint-staged + commitlint. **Never `--no-verify`.** YAML and shell files aren't lint-staged-managed, so Biome won't reformat them.
- Slice 22 left **188 app tests + 5 runner tests**. Slice 23 changes neither — final count stays the same.
- The runner has no HTTP surface — its Helm subchart has Deployment only (no Service, no Ingress).

---

## File map (24 files)

| Action | Path | Notes |
|---|---|---|
| Modify | `README.md` | T1: full rewrite |
| Modify | `docker-compose.yml` | T2: drop docs, add runner |
| Modify | `docker-compose.dev.yml` | T3: drop dead mounts/ports |
| Modify | `.devcontainer/devcontainer.json` | T3: rename + drop dead ports |
| Rename | `k8s/charts/brand-monitor/` → `k8s/charts/seo-audit/` | T4: `git mv` |
| Delete | `k8s/charts/seo-audit/charts/docs/` | T4 |
| Delete | `k8s/charts/seo-audit/charts/legal/` | T4 |
| Modify | `k8s/charts/seo-audit/Chart.yaml` | T4 (deps) + T5 (name) |
| Modify | `k8s/charts/seo-audit/values.yaml` | T5: name + drop blocks |
| Modify | `k8s/charts/seo-audit/values-dev.yaml` | T5 |
| Modify | `k8s/charts/seo-audit/values-staging.yaml` | T5 |
| Modify | `k8s/charts/seo-audit/values-production.yaml` | T5 |
| Modify | `k8s/charts/seo-audit/templates/_helpers.tpl` | T5: name swap |
| Modify | `k8s/charts/seo-audit/templates/namespace.yaml` | T5 |
| Modify | `k8s/charts/seo-audit/templates/ingress.yaml` | T5: drop docs/legal rules |
| Modify | `k8s/charts/seo-audit/charts/app/Chart.yaml` | T5: description |
| Modify | `k8s/charts/seo-audit/charts/app/values.yaml` | T5: image repo |
| Modify | `k8s/charts/seo-audit/charts/www/Chart.yaml` | T5 |
| Modify | `k8s/charts/seo-audit/charts/www/values.yaml` | T5 |
| Create | `k8s/charts/seo-audit/charts/runner/Chart.yaml` | T6 |
| Create | `k8s/charts/seo-audit/charts/runner/values.yaml` | T6 |
| Create | `k8s/charts/seo-audit/charts/runner/templates/_helpers.tpl` | T6 |
| Create | `k8s/charts/seo-audit/charts/runner/templates/deployment.yaml` | T6 |
| Modify | `k8s/scripts/build-images.sh` | T7: drop docs/legal, add runner |
| Modify | `k8s/scripts/k3d-create.sh` | T7: cluster name |
| Modify | `k8s/scripts/k3d-delete.sh` | T7 |
| Modify | `k8s/scripts/deploy-local.sh` | T7: chart path + namespace |
| Modify | `k8s/scripts/port-forward.sh` | T7: drop docs/legal |
| Modify | `k8s/README.md` | T8: full rewrite |

---

## Task 1: Rewrite root `README.md`

**Files:**
- Modify: `README.md`

No tests. Validation: the README's setup steps must be reproducible from a clean clone (verified manually).

### Step 1: Read the current state of the apps + DB README for accurate setup instructions

```bash
cat apps/app/README.md
cat apps/runner/README.md 2>/dev/null || echo "(no runner README)"
cat packages/db/README.md 2>/dev/null || echo "(no db README)"
```

Note the actual env var names and migration commands. Cross-reference before writing the new README.

### Step 2: Replace `README.md` entirely

Replace `README.md` with this content:

```markdown
# SEO Audit Monorepo

Multi-site SEO audit monorepo with offline-first PWA dashboard, daemon-based runner, web push notifications, and Supabase backend.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.4+-f9f1e1?logo=bun)](https://bun.sh/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.5-ef4444?logo=turborepo)](https://turbo.build/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06b6d4?logo=tailwindcss)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%2BAuth-3ECF8E?logo=supabase)](https://supabase.com/)

## Features

- **Multi-site dashboard** with offline-first IndexedDB cache (Serwist PWA).
- **Audit runner daemon** that processes queued runs against Lighthouse + on-page analyzers.
- **Web push notifications** on run completion.
- **Realtime fan-out** for live audit progress (Supabase Realtime + BroadcastChannel).
- **Idempotent audit triggers** with per-tab queue replay and Background Sync.

## Quick Start

```bash
# 1. Clone + install
git clone https://github.com/bromso/kitchensink-react.git seo
cd seo
bun install

# 2. Generate VAPID keys for push notifications (one-time)
npx web-push generate-vapid-keys

# 3. Copy + fill env files
cp apps/app/.env.example apps/app/.env.local
cp apps/www/.env.example apps/www/.env.local
cp apps/runner/.env.example apps/runner/.env

# 4. Start Supabase locally OR point env at a cloud project
supabase start

# 5. Apply DB migrations
bun --filter @repo/db migrate

# 6. Start web apps + Storybook
bun dev

# 7. Start the runner daemon (in a separate terminal)
bun --filter @repo/runner dev
```

This starts:
- **Dashboard** — http://app.localhost:3001
- **Marketing** — http://www.localhost:3000
- **Storybook** — http://localhost:6006
- **Runner** — headless daemon polling the audit queue

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 16 (App Router + Server Components) |
| **Runtime** | Bun |
| **Monorepo** | Turborepo |
| **UI Components** | shadcn/ui + Radix UI |
| **Styling** | Tailwind CSS v4 |
| **Backend** | Supabase (Postgres + Auth + Realtime) |
| **Database ORM** | Drizzle |
| **PWA / Service Worker** | Serwist 9 |
| **Push Notifications** | web-push (VAPID) |
| **Testing** | Vitest + Testing Library + happy-dom |
| **Linting** | Biome |
| **Animation** | Motion (formerly Framer Motion) |

## Project Structure

```
seo/
├── apps/
│   ├── app/      # Main dashboard (Next.js 16, PWA, port 3001)
│   ├── www/      # Marketing site (Next.js 16, port 3000)
│   ├── runner/   # Audit runner daemon (Node + Drizzle + web-push)
│   └── story/    # Storybook for packages/ui (port 6006)
├── packages/
│   ├── ui/                   # Shared shadcn/ui components
│   ├── db/                   # Drizzle schema + migrations
│   ├── audit-core/           # Audit type definitions
│   ├── audit-cli/            # Audit category packages aggregator
│   ├── audit-perf/           # Lighthouse Performance runner
│   ├── audit-seo/            # SEO checks
│   ├── audit-best-practices/ # Best practices checks
│   ├── audit-pwa/            # PWA checks
│   ├── audit-onpage/         # On-page SEO checks
│   ├── lighthouse-runner/    # Headless Lighthouse driver
│   ├── runner-core/          # Daemon polling + processRun loop
│   ├── tokens/               # Design tokens
│   └── typescript-config/    # Shared TS configuration
├── docker/                   # Production Dockerfiles
├── k8s/                      # Helm charts + scripts
└── docs/plans/               # Per-slice design docs + plans
```

## Development

```bash
# Run a specific app
bun --filter @repo/app dev      # Dashboard only
bun --filter @repo/www dev      # Marketing only
bun --filter @repo/runner dev   # Daemon only
bun --filter @repo/story dev    # Storybook only

# Run all tests
bun --filter @repo/app test     # 188 tests
bun --filter @repo/runner test  # 5 tests
bun --filter @repo/db test      # DB schema tests

# Build all apps
bun run build

# Lint and format
bun run lint
bun run format
```

## Running the Daemon

The runner polls the Postgres audit queue and processes audits via Lighthouse + on-page analyzers. After a successful run it sends a web push notification to every subscribed device.

Required env vars in `apps/runner/.env`:

```dotenv
POSTGRES_CONNECTION_STRING=postgres://postgres:postgres@localhost:54322/postgres

# VAPID keys for push delivery (generate with `npx web-push generate-vapid-keys`)
VAPID_PUBLIC_KEY=<base64url>
VAPID_PRIVATE_KEY=<base64url>
VAPID_EMAIL=mailto:you@example.com
```

If VAPID vars are missing, the daemon still processes audits — it just logs a single warning and skips push delivery.

## Docker + Kubernetes

- **Local Docker dev**: `docker compose -f docker-compose.dev.yml up` — runs all apps in a single container with hot reload.
- **Production Docker build**: `docker compose build` — uses `docker/*.Dockerfile` and `apps/runner/Dockerfile`.
- **Local k8s with k3d**: see [`k8s/README.md`](./k8s/README.md).
- **Devcontainer**: open the repo in VS Code → "Reopen in Container" — installs Bun, kubectl, helm, k3d.

## Committing Changes

This project enforces commit conventions using Git hooks (Husky + lint-staged + commitlint).

```bash
# Standard commit (auto-validated)
git commit -m "feat(app): add new feature"
```

See [CLAUDE.md](./CLAUDE.md) and [CONTRIBUTING.md](./CONTRIBUTING.md) for commit message format and project guidelines.

## Slice Documentation

Every feature ships via a slice with a design doc and an implementation plan. Browse `docs/plans/` for the full history (slice 1 through current).

## License

See [LICENSE](./LICENSE) for details.
```

### Step 3: Confirm the file is sane

```bash
head -20 README.md
wc -l README.md
```

Expected: starts with `# SEO Audit Monorepo`, approximately 130-180 lines.

### Step 4: Commit

```bash
git add README.md
git commit -m "docs(infra): rewrite root README for current monorepo"
```

---

## Task 2: Update `docker-compose.yml` (production)

**Files:**
- Modify: `docker-compose.yml`

### Step 1: Inspect current file

```bash
cat docker-compose.yml
```

Confirm: 3 services (`app`, `www`, `docs`), 2 networks (`frontend`, `backend`).

### Step 2: Replace `docker-compose.yml` entirely

```yaml
services:
  app:
    build:
      context: .
      dockerfile: docker/app.Dockerfile
    ports:
      - "3001:3001"
    env_file:
      - .env
    restart: unless-stopped
    networks:
      - frontend

  www:
    build:
      context: .
      dockerfile: docker/www.Dockerfile
    ports:
      - "3000:3000"
    env_file:
      - .env
    restart: unless-stopped
    networks:
      - frontend

  runner:
    build:
      context: .
      dockerfile: apps/runner/Dockerfile
    env_file:
      - apps/runner/.env
    restart: unless-stopped
    networks:
      - frontend

networks:
  frontend:
    driver: bridge
```

Three changes vs. the previous file:
1. `docs` service removed (its Dockerfile didn't exist anyway).
2. New `runner` service pointing at `apps/runner/Dockerfile` with `env_file: apps/runner/.env`.
3. `backend` network removed (unused).

Optionally add `env_file: - .env` to the `app` and `www` services so they can read Supabase config at runtime. The existing file didn't have this; the new file does.

### Step 3: Verify the file parses

```bash
docker compose -f docker-compose.yml config > /dev/null
```

Expected: exit 0 with no errors. If `docker compose` isn't installed, fall back to `docker-compose -f docker-compose.yml config`.

### Step 4: Verify the runner Dockerfile builds in this context (Risk #5)

```bash
docker compose -f docker-compose.yml build runner 2>&1 | tail -20
```

Expected: build succeeds. If it fails with "COPY: file not found" or similar, the runner's Dockerfile expects a different working directory.

**Fallback if the build fails:** add `target` and adjust context to `apps/runner` AND copy needed workspace bits. Worst case create a thin wrapper `docker/runner.Dockerfile` that sets the right context. Document the fix as a deviation.

If `docker` itself is not installed in the environment, skip this step and note "build verification deferred to manual" in the commit message + report.

### Step 5: Commit

```bash
git add docker-compose.yml
git commit -m "chore(infra): update docker-compose.yml — drop docs, add runner"
```

---

## Task 3: Update `docker-compose.dev.yml` + `.devcontainer/devcontainer.json`

**Files:**
- Modify: `docker-compose.dev.yml`
- Modify: `.devcontainer/devcontainer.json`

### Step 1: Read both files

```bash
cat docker-compose.dev.yml
cat .devcontainer/devcontainer.json
```

### Step 2: Edit `docker-compose.dev.yml`

Remove these two volume lines:

```yaml
      - /app/apps/docs/node_modules
      - /app/apps/legal/node_modules
```

Remove these two port lines:

```yaml
      - "3002:3002"
      - "3003:3003"
```

The rest stays unchanged. Final file should still have `apps/app/node_modules`, `apps/www/node_modules`, `apps/story/node_modules`, `packages/ui/node_modules`, `packages/tokens/node_modules` mounts and `3000`, `3001`, `6006` ports.

### Step 3: Edit `.devcontainer/devcontainer.json`

Four edits:
1. Change `"name": "Symbiora Dev"` → `"name": "SEO Audit Dev"`.
2. Remove `3002` and `3003` from `"forwardPorts"`. Resulting array: `[3000, 3001, 6006]`.
3. Remove the `"3002"` and `"3003"` entries from `"portsAttributes"`. Keep the entries for `3000`, `3001`, `6006`.
4. Replace the `postCreateCommand` value. Old:

```json
"postCreateCommand": "cd packages/tokens && bun run build && cd ../../apps/docs && bun run postinstall && cd ../legal && bun run postinstall",
```

New:

```json
"postCreateCommand": "cd packages/tokens && bun run build",
```

### Step 4: Verify both files parse

```bash
docker compose -f docker-compose.dev.yml config > /dev/null
python3 -m json.tool < .devcontainer/devcontainer.json > /dev/null
```

Both expected: exit 0. The devcontainer file contains JSONC comments (`//`); `python3 -m json.tool` may fail on them. Acceptable fallback: `node -e "JSON.parse(require('fs').readFileSync('.devcontainer/devcontainer.json','utf8').replace(/\/\/.*/g,''))"` (strip line comments before parsing).

### Step 5: Commit

```bash
git add docker-compose.dev.yml .devcontainer/devcontainer.json
git commit -m "chore(infra): update dev compose + devcontainer (drop docs/legal, rename)"
```

---

## Task 4: k8s — rename + delete dead subcharts + clean Chart.yaml deps

**Files:**
- Rename: `k8s/charts/brand-monitor/` → `k8s/charts/seo-audit/`
- Delete: `k8s/charts/seo-audit/charts/docs/` (recursive)
- Delete: `k8s/charts/seo-audit/charts/legal/` (recursive)
- Modify: `k8s/charts/seo-audit/Chart.yaml`

### Step 1: Verify current state

```bash
ls k8s/charts/brand-monitor
ls k8s/charts/brand-monitor/charts
```

Expected: confirms `Chart.yaml`, 4 values files, `templates/`, `charts/` exist; `charts/` contains `app`, `docs`, `legal`, `www`.

### Step 2: Rename the chart directory

```bash
git mv k8s/charts/brand-monitor k8s/charts/seo-audit
```

`git mv` preserves git history. Verify with `git status`.

### Step 3: Delete dead subcharts

```bash
git rm -rf k8s/charts/seo-audit/charts/docs k8s/charts/seo-audit/charts/legal
```

### Step 4: Update `k8s/charts/seo-audit/Chart.yaml`

Replace the file with:

```yaml
apiVersion: v2
name: seo-audit
description: SEO Audit monorepo Helm umbrella chart
type: application
version: 0.1.0
appVersion: "1.0.0"

dependencies:
  - name: app
    version: "0.1.0"
    repository: "file://./charts/app"
    condition: app.enabled
  - name: www
    version: "0.1.0"
    repository: "file://./charts/www"
    condition: www.enabled
  - name: runner
    version: "0.1.0"
    repository: "file://./charts/runner"
    condition: runner.enabled
```

Three changes vs. the previous file:
1. `name: kitchensink-react` → `name: seo-audit`.
2. `description: Symbiora monorepo Helm umbrella chart` → `description: SEO Audit monorepo Helm umbrella chart`.
3. Drop `docs` and `legal` dependencies; add `runner` dependency.

Note: the `runner` subchart files don't exist yet — they land in T6. `helm lint` may complain about missing dep until T6. That's expected.

### Step 5: Commit

```bash
git add -A k8s/charts/seo-audit
git commit -m "chore(infra): rename brand-monitor chart to seo-audit; drop docs/legal subcharts"
```

---

## Task 5: k8s — rewrite values files + templates + app/www subchart strings

**Files:**
- Modify: `k8s/charts/seo-audit/values.yaml`
- Modify: `k8s/charts/seo-audit/values-dev.yaml`
- Modify: `k8s/charts/seo-audit/values-staging.yaml`
- Modify: `k8s/charts/seo-audit/values-production.yaml`
- Modify: `k8s/charts/seo-audit/templates/_helpers.tpl`
- Modify: `k8s/charts/seo-audit/templates/namespace.yaml`
- Modify: `k8s/charts/seo-audit/templates/ingress.yaml`
- Modify: `k8s/charts/seo-audit/charts/app/Chart.yaml`
- Modify: `k8s/charts/seo-audit/charts/app/values.yaml`
- Modify: `k8s/charts/seo-audit/charts/www/Chart.yaml`
- Modify: `k8s/charts/seo-audit/charts/www/values.yaml`

This task does two mechanical things across all listed files:
1. **String replacements**: `kitchensink-react` → `seo-audit`; `Symbiora` → `SEO Audit`; `brand-monitor` → `seo-audit` (in case any remain).
2. **Drop `docs:` and `legal:` blocks** from the four top-level values files and the ingress template.

### Step 1: Run the bulk string substitution

From the repo root:

```bash
find k8s/charts/seo-audit -type f \( -name "*.yaml" -o -name "*.tpl" \) -print0 | \
  xargs -0 sed -i.bak \
    -e 's/kitchensink-react/seo-audit/g' \
    -e 's/Symbiora/SEO Audit/g' \
    -e 's/brand-monitor/seo-audit/g'

find k8s/charts/seo-audit -name "*.bak" -delete
```

Verify:

```bash
grep -rE "kitchensink-react|Symbiora|brand-monitor" k8s/charts/seo-audit && echo "RESIDUAL FOUND" || echo "clean"
```

Expected: `clean`. If `RESIDUAL FOUND`, manually fix the surviving references.

### Step 2: Drop `docs:` and `legal:` blocks from `values.yaml`

Open `k8s/charts/seo-audit/values.yaml`. After the bulk substitution it still has `docs:` and `legal:` subsections + ingress paths for them. Delete:

1. The entire `docs:` top-level block (subchart config — about 18 lines).
2. The entire `legal:` top-level block.
3. Inside the `ingress.hosts[0].paths` array, delete the two list items for `/docs` and `/legal` paths.

After edits, the values.yaml should have only `global`, `namespace`, `ingress`, `app`, `www`, and (added in T6) `runner` top-level keys.

### Step 3: Drop `docs:` and `legal:` blocks from `values-dev.yaml`

Same surgery: delete `docs:` and `legal:` top-level blocks. The dev file's ingress block already only had `www`, so no path edits needed.

### Step 4: Drop `docs:` and `legal:` blocks from `values-staging.yaml` and `values-production.yaml`

Open each, delete `docs:` and `legal:` blocks. Also delete any ingress path entries referencing `service: docs` or `service: legal`.

### Step 5: Edit `templates/ingress.yaml`

Open the file and confirm whether the template references the `docs`/`legal` services directly (vs. iterating over the `ingress.hosts` array). If it iterates from values, no edit needed (the values changes from T5 Step 2-4 are sufficient). If it hard-codes references, drop them.

Run this check:

```bash
grep -E "docs|legal" k8s/charts/seo-audit/templates/ingress.yaml
```

If the grep returns lines other than templating helpers, edit the file to remove them.

### Step 6: Update `charts/app/values.yaml` and `charts/www/values.yaml` image repos

In `k8s/charts/seo-audit/charts/app/values.yaml`, find the line:

```yaml
  repository: kitchensink-react/app
```

It became `repository: seo-audit/app` after the bulk substitution in Step 1. Verify:

```bash
grep "repository:" k8s/charts/seo-audit/charts/app/values.yaml k8s/charts/seo-audit/charts/www/values.yaml
```

Expected: both show `seo-audit/<app|www>`.

### Step 7: Verify helm chart lints

```bash
helm lint k8s/charts/seo-audit
```

Expected: a single warning about missing `runner` subchart (T6 hasn't run yet) or "chart linted" if helm is permissive. If it errors on missing `runner`, that's acceptable here — T6 will fix it.

To suppress the runner-missing error for this T5 verification, temporarily run helm lint excluding the runner dep:

```bash
# Alternative: dependency-update will fail without runner, that's expected.
helm dependency list k8s/charts/seo-audit || true
```

Just confirm there are no `kitchensink-react`/`Symbiora`/`brand-monitor` residuals (Step 1's grep already verified). Linting will be re-verified in T6 after the runner subchart exists.

### Step 8: Commit

```bash
git add k8s/charts/seo-audit
git commit -m "chore(infra): rewrite chart values + templates + app/www subcharts (rename + drop dead apps)"
```

---

## Task 6: k8s — add `runner` subchart

**Files:**
- Create: `k8s/charts/seo-audit/charts/runner/Chart.yaml`
- Create: `k8s/charts/seo-audit/charts/runner/values.yaml`
- Create: `k8s/charts/seo-audit/charts/runner/templates/_helpers.tpl`
- Create: `k8s/charts/seo-audit/charts/runner/templates/deployment.yaml`
- Modify: `k8s/charts/seo-audit/values.yaml` (add `runner:` block)
- Modify: `k8s/charts/seo-audit/values-dev.yaml` (add minimal runner block)
- Modify: `k8s/charts/seo-audit/values-staging.yaml` (add runner block)
- Modify: `k8s/charts/seo-audit/values-production.yaml` (add runner block)

### Step 1: Create `k8s/charts/seo-audit/charts/runner/Chart.yaml`

```yaml
apiVersion: v2
name: runner
description: SEO Audit daemon — polls the audit queue and sends push notifications
type: application
version: 0.1.0
appVersion: "1.0.0"
```

### Step 2: Create `k8s/charts/seo-audit/charts/runner/values.yaml`

```yaml
# Default values for runner subchart
replicaCount: 1

image:
  repository: seo-audit/runner
  tag: latest
  pullPolicy: IfNotPresent

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 512Mi

# Secrets reference — the operator creates a Kubernetes Secret with these keys
# and passes its name via global.runnerSecretName.
# Required keys: POSTGRES_CONNECTION_STRING, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
secretName: seo-audit-runner

nodeSelector: {}
tolerations: []
affinity: {}
```

### Step 3: Create `k8s/charts/seo-audit/charts/runner/templates/_helpers.tpl`

```
{{- define "runner.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "runner.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "runner.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "runner.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "runner.selectorLabels" -}}
app.kubernetes.io/name: {{ include "runner.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

### Step 4: Create `k8s/charts/seo-audit/charts/runner/templates/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "runner.fullname" . }}
  labels:
    {{- include "runner.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "runner.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "runner.selectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.global.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.global.imageRegistry }}{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          envFrom:
            - secretRef:
                name: {{ .Values.secretName | quote }}
          env:
            - name: NODE_ENV
              value: {{ .Values.global.environment | default "production" | quote }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

No Service, no Ingress, no HPA — the runner is a daemon with no HTTP surface. The Secret named by `secretName` must exist in the namespace before deploying; the operator creates it manually or via a sealed-secrets / SOPS workflow.

### Step 5: Add `runner:` block to `k8s/charts/seo-audit/values.yaml`

Append (at the bottom, after the `www:` block):

```yaml
runner:
  enabled: true
  replicaCount: 1
  image:
    repository: seo-audit/runner
    tag: latest
    pullPolicy: IfNotPresent
  resources:
    limits:
      cpu: 1000m
      memory: 1Gi
    requests:
      cpu: 250m
      memory: 512Mi
  secretName: seo-audit-runner
```

### Step 6: Add minimal `runner:` block to `k8s/charts/seo-audit/values-dev.yaml`

Append:

```yaml
runner:
  replicaCount: 1
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 256Mi
```

### Step 7: Add `runner:` blocks to staging + production values

In `values-staging.yaml`, append:

```yaml
runner:
  replicaCount: 1
  resources:
    limits:
      cpu: 1500m
      memory: 1.5Gi
    requests:
      cpu: 500m
      memory: 768Mi
```

In `values-production.yaml`, append:

```yaml
runner:
  replicaCount: 2
  resources:
    limits:
      cpu: 2000m
      memory: 2Gi
    requests:
      cpu: 750m
      memory: 1Gi
```

### Step 8: Verify chart lints and templates

```bash
helm lint k8s/charts/seo-audit
helm template k8s/charts/seo-audit -f k8s/charts/seo-audit/values-dev.yaml > /dev/null
```

Expected: lint reports 0 errors. The template command should render without errors. If lint complains about the `global` reference inside the runner deployment template, ensure the umbrella `values.yaml` has a `global:` section (it should — from the previous `kitchensink-react` chart).

### Step 9: Commit

```bash
git add k8s/charts/seo-audit/charts/runner k8s/charts/seo-audit/values.yaml k8s/charts/seo-audit/values-dev.yaml k8s/charts/seo-audit/values-staging.yaml k8s/charts/seo-audit/values-production.yaml
git commit -m "feat(infra): add runner Helm subchart (deployment + secret reference)"
```

---

## Task 7: k8s — update scripts

**Files:**
- Modify: `k8s/scripts/build-images.sh`
- Modify: `k8s/scripts/k3d-create.sh`
- Modify: `k8s/scripts/k3d-delete.sh`
- Modify: `k8s/scripts/deploy-local.sh`
- Modify: `k8s/scripts/port-forward.sh`

### Step 1: Bulk string substitution across scripts

```bash
find k8s/scripts -type f -name "*.sh" -print0 | \
  xargs -0 sed -i.bak \
    -e 's/kitchensink-react/seo-audit/g' \
    -e 's/brand-monitor/seo-audit/g'

find k8s/scripts -name "*.bak" -delete
```

Verify:

```bash
grep -rE "kitchensink-react|brand-monitor" k8s/scripts && echo "RESIDUAL" || echo "clean"
```

Expected: `clean`.

### Step 2: Edit `k8s/scripts/build-images.sh`

After the bulk substitution, the file still has `docs.Dockerfile` and `legal.Dockerfile` build commands that fail (those Dockerfiles never existed). Replace the entire file with:

```bash
#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-seo-audit}"
TAG="${TAG:-latest}"

echo "Building Docker images..."
echo ""

cd "$PROJECT_ROOT"

echo "Building seo-audit/app:$TAG..."
docker build -f docker/app.Dockerfile -t seo-audit/app:$TAG .

echo "Building seo-audit/www:$TAG..."
docker build -f docker/www.Dockerfile -t seo-audit/www:$TAG .

echo "Building seo-audit/runner:$TAG..."
docker build -f apps/runner/Dockerfile -t seo-audit/runner:$TAG .

echo ""
echo "Loading images into k3d cluster: $CLUSTER_NAME..."
echo ""

k3d image import seo-audit/app:$TAG -c "$CLUSTER_NAME"
k3d image import seo-audit/www:$TAG -c "$CLUSTER_NAME"
k3d image import seo-audit/runner:$TAG -c "$CLUSTER_NAME"

echo ""
echo "Images built and loaded successfully!"
```

### Step 3: Edit `k8s/scripts/deploy-local.sh`

After bulk substitution, the chart path inside the script may still reference `kitchensink-react`. The directory is now `seo-audit`. Verify the entire script:

```bash
cat k8s/scripts/deploy-local.sh
```

Adjust any chart path references from `k8s/charts/kitchensink-react` to `k8s/charts/seo-audit` (the substitution already handled this — verify). The script's namespace + release name should also be `seo-audit-dev` and `seo-audit`.

### Step 4: Edit `k8s/scripts/port-forward.sh`

Read the script. If it has port-forward commands for docs/legal services, remove them. The runner has no Service, so no port-forward entry is added for it. Keep only `app` (3001) and `www` (3000).

```bash
cat k8s/scripts/port-forward.sh
```

If the script port-forwards based on a hard-coded list including `docs` and `legal`, drop those entries. If it iterates dynamically over `kubectl get svc`, no edit needed.

### Step 5: Verify all scripts are executable

```bash
chmod +x k8s/scripts/*.sh
ls -la k8s/scripts
```

Expected: all `.sh` files have execute permission.

### Step 6: Commit

```bash
git add k8s/scripts
git commit -m "chore(infra): rewrite k8s scripts (rename + drop docs/legal + add runner)"
```

---

## Task 8: Rewrite `k8s/README.md`

**Files:**
- Modify: `k8s/README.md`

### Step 1: Replace `k8s/README.md` with the updated content

```markdown
# Kubernetes Deployment

Helm umbrella chart for deploying the SEO Audit monorepo on Kubernetes, with k3d-based local development.

## Prerequisites

The following tools are installed automatically in the devcontainer:

- **kubectl** — Kubernetes CLI
- **helm** — Kubernetes package manager
- **k3d** — Lightweight Kubernetes in Docker

Outside the devcontainer, install them manually.

## Quick Start (Local Development)

```bash
# Full setup: create cluster, build images, deploy
make k3d-setup

# Start port forwarding to access apps
make k8s-port-forward
```

Access your apps:
- **www**: http://localhost:3000
- **app**: http://localhost:3001

The **runner** is a headless daemon — no HTTP port is forwarded. Inspect with `kubectl logs`.

## Required Secrets

The runner needs a Kubernetes Secret with these keys in the deployment namespace:

```bash
kubectl create secret generic seo-audit-runner \
  --from-literal=POSTGRES_CONNECTION_STRING=postgres://... \
  --from-literal=VAPID_PUBLIC_KEY=... \
  --from-literal=VAPID_PRIVATE_KEY=... \
  --from-literal=VAPID_EMAIL=mailto:you@example.com \
  -n seo-audit-dev
```

The `app` and `www` containers don't currently consume any cluster secret (they connect to Supabase via env vars baked at build time or injected by your deployment platform).

## Available Commands

Run `make help` to see all available commands.

### Cluster Management

| Command | Description |
|---------|-------------|
| `make k3d-setup` | Full setup (create + build + deploy) |
| `make k3d-create` | Create k3d cluster only |
| `make k3d-delete` | Delete k3d cluster |

### Kubernetes Operations

| Command | Description |
|---------|-------------|
| `make k8s-build` | Build and load Docker images into k3d |
| `make k8s-deploy` | Deploy to local k3d cluster |
| `make k8s-undeploy` | Remove deployment from cluster |
| `make k8s-logs` | View logs from all pods |
| `make k8s-status` | Check deployment status |
| `make k8s-port-forward` | Start port forwarding to app + www |
| `make k8s-shell APP=app` | Open shell in a pod (app, www, runner) |

### Helm Operations

| Command | Description |
|---------|-------------|
| `make helm-template` | Render templates locally (debugging) |
| `make helm-lint` | Lint Helm charts |
| `make helm-deps` | Update Helm dependencies |

## Directory Structure

```
k8s/
├── charts/
│   └── seo-audit/                # Umbrella Helm chart
│       ├── Chart.yaml            # Chart definition with subchart deps
│       ├── values.yaml           # Default values
│       ├── values-dev.yaml       # Local k3d
│       ├── values-staging.yaml   # Staging
│       ├── values-production.yaml
│       ├── templates/            # Shared templates
│       │   ├── _helpers.tpl
│       │   ├── namespace.yaml
│       │   └── ingress.yaml
│       └── charts/               # Subcharts per service
│           ├── app/              # Dashboard (Next.js, port 3001)
│           ├── www/              # Marketing (Next.js, port 3000)
│           └── runner/           # Daemon (no HTTP port)
├── scripts/                      # Automation scripts
│   ├── k3d-create.sh
│   ├── k3d-delete.sh
│   ├── build-images.sh
│   ├── deploy-local.sh
│   └── port-forward.sh
└── README.md
```

## Environments

### Local Development (k3d)

Uses `values-dev.yaml`:
- Minimal resource limits
- Single replica per service
- No autoscaling
- Traefik ingress (k3d default)

### Staging

Uses `values-staging.yaml`:
- 2 replicas for app + www
- 1 runner replica
- Autoscaling for app + www
- NGINX ingress with TLS
- Images from ghcr.io

### Production

Uses `values-production.yaml`:
- 3 replicas for app + www, autoscaled 3–20
- 2 runner replicas
- TLS via cert-manager
- Rate limiting on ingress

## Deployment

### Manual

```bash
# Local k3d
helm upgrade --install seo-audit k8s/charts/seo-audit \
  -f k8s/charts/seo-audit/values-dev.yaml \
  --namespace seo-audit-dev \
  --create-namespace

# Staging
helm upgrade --install seo-audit k8s/charts/seo-audit \
  -f k8s/charts/seo-audit/values-staging.yaml \
  --namespace seo-audit-staging \
  --create-namespace

# Production
helm upgrade --install seo-audit k8s/charts/seo-audit \
  -f k8s/charts/seo-audit/values-production.yaml \
  --namespace seo-audit-prod \
  --create-namespace
```

## Troubleshooting

### Pods not starting

```bash
kubectl get pods -n seo-audit-dev
kubectl describe pod <pod-name> -n seo-audit-dev
kubectl logs <pod-name> -n seo-audit-dev
```

### Runner can't reach Postgres

Verify the `seo-audit-runner` Secret exists in the runner's namespace and contains `POSTGRES_CONNECTION_STRING`.

```bash
kubectl get secret seo-audit-runner -n seo-audit-dev -o yaml
```

### Images not found in k3d

```bash
make k8s-build
docker exec k3d-seo-audit-server-0 crictl images | grep seo-audit
```

### Helm deployment failed

```bash
helm list -n seo-audit-dev
helm history seo-audit -n seo-audit-dev
helm rollback seo-audit -n seo-audit-dev
```

## Health Checks

The `app` and `www` services expose `/api/health` endpoints. The runner emits log lines per poll cycle; check `kubectl logs`.

```bash
curl http://localhost:3000/api/health
curl http://localhost:3001/api/health
```
```

### Step 2: Commit

```bash
git add k8s/README.md
git commit -m "docs(infra): rewrite k8s README for seo-audit chart"
```

---

## Task 9: Final DoD sweep

**Files:** none.

### Step 1: Grep validation — no residual dead references in changed surfaces

```bash
grep -rE "brand-monitor|kitchensink-react|Symbiora|apps/docs|apps/legal" \
  README.md \
  k8s/ \
  docker-compose.yml \
  docker-compose.dev.yml \
  .devcontainer/ \
  docker/ \
  2>&1 | grep -v "^Binary" | grep -v "k8s/charts/seo-audit/charts/runner/" || echo "clean"
```

Expected: prints `clean` (no matches). If matches remain, fix them and re-run.

### Step 2: Compose config validation

```bash
docker compose -f docker-compose.yml config > /dev/null
docker compose -f docker-compose.dev.yml config > /dev/null
```

Both expected: exit 0.

### Step 3: Helm chart validation

```bash
helm lint k8s/charts/seo-audit
helm template k8s/charts/seo-audit -f k8s/charts/seo-audit/values-dev.yaml > /tmp/rendered.yaml
wc -l /tmp/rendered.yaml
```

Expected: lint clean, template renders ~100-300 lines of valid YAML. If template fails, investigate.

### Step 4: Application tests still pass

```bash
bun --filter @repo/app test
bun --filter @repo/runner test
bun --filter @repo/app check-types
bun --filter @repo/runner check-types
bun --filter @repo/app build
bun --filter @repo/runner build
bun --filter @repo/app lint
bun --filter @repo/runner lint
```

Expected: app 188, runner 5, all checks clean. Slice 23 changed no application code so nothing should break.

### Step 5: No commit

T9 is verify-only. The branch should now contain:
- `4121c38 docs(infra): slice 23 design — infra & README alignment` (pre-existing)
- 8 implementation commits from T1–T8.

```bash
git log --oneline main..HEAD
```

---

## Report Format

(For the implementer to fill in after T9.)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED
- DoD table:
  | # | Check | Result |
  |---|-------|--------|
  | 1 | `docker compose config` parses (both files) | … |
  | 2 | `docker compose build runner` succeeds | … |
  | 3 | `helm lint k8s/charts/seo-audit` clean | … |
  | 4 | `helm template` renders without errors | … |
  | 5 | Validation grep returns no residuals in changed surfaces | … |
  | 6 | `bun --filter @repo/app test` → 188 | … |
  | 7 | `bun --filter @repo/runner test` → 5 | … |
  | 8 | All checks (typecheck, build, lint) clean | … |
- Commit SHA list (8 implementation commits expected)
- Whether the runner Dockerfile built in compose context, or if you needed a wrapper
- Whether helm lint had any warnings worth flagging
- Slice 23 release note (one line)
- Any carry-forwards for slice 24

---

## After slice 23

Slice 24 candidates:

- Rename `@repo/mono` in root `package.json` + GitHub repo URL.
- Build & push container images via CI (GHCR).
- Vercel deployment recipe for app + www.
- Runner deployment recipe (Fly.io / Render / dedicated VM).
- Supabase migration CI automation.
- Notify on `partial` / `failed` push.
- Whoami endpoint, `/offline` polish, 60s ticker.
