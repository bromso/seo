# Slice 23 — Infra & README Alignment (Design)

**Date:** 2026-06-06
**Branch (when implementing):** `feat/infra-align-slice23`
**Carry-forward from:** Slice 22 (push delivery done; infra docs/configs now visibly stale)

---

## Goal

Bring all Docker, Kubernetes, devcontainer, and README files into sync with the current monorepo reality: 4 apps (`app`, `www`, `runner`, `story`), Supabase backend, web push (slices 21/22), Drizzle migrations, Serwist PWA. Drop all references to apps that don't exist (`docs`, `legal`) and project names that no longer apply (`brand-monitor`, `kitchensink-react`, `Symbiora`).

Result: a fresh clone can be brought up locally by following the README, and a future operator can deploy the current 3 deployable apps to k8s via Helm without hitting dangling references.

---

## Non-Goals (slice 24+)

- Rename `@repo/mono` in root `package.json`.
- Update the GitHub repo URL (`bromso/kitchensink-react`).
- Build/push container images via CI.
- Update `.github/workflows/` for deploy.
- A real-world Vercel deployment recipe.
- Runner deployment recipe (Fly.io / Render / dedicated VM).
- Supabase migration CI automation.

This slice is documentation + configuration only. No application code changes; no unit tests added.

---

## Naming decisions

- **README display name**: "SEO Audit Monorepo".
- **Helm chart name**: `seo-audit` (replaces `brand-monitor`).
- **Devcontainer name**: "SEO Audit Dev" (replaces "Symbiora Dev").
- **Internal `package.json` name** (`@repo/mono`) — unchanged (out of scope).
- **GitHub repo URL** — unchanged (out of scope).

---

## File-by-file plan

### `README.md` (root) — full rewrite

Replace the boilerplate content with content reflecting the actual product:

**Sections:**
- Title + one-paragraph description: "Multi-site SEO audit monorepo with offline-first PWA dashboard, daemon-based runner, web push notifications, and Supabase backend."
- Tech stack table: Next.js 16, Bun, Turborepo, Tailwind v4, shadcn/ui, motion, **Supabase**, **Drizzle ORM**, **Serwist (PWA)**, **web-push**, Vitest, Biome.
- Apps list:
  - `app` (dashboard) — http://app.localhost:3001
  - `www` (marketing) — http://www.localhost:3000
  - `runner` (daemon) — headless
  - `story` (Storybook) — http://localhost:6006
- **Quick Start** with the actual setup flow:
  1. `bun install`
  2. Copy `.env.example` → `.env.local` per app + `apps/runner/.env`; fill Supabase + VAPID values
  3. `supabase start` (local) OR point `SUPABASE_URL` at a cloud project
  4. `bun --filter @repo/db migrate` to apply 6 migrations
  5. `bun dev` for web apps; `bun --filter @repo/runner dev` for the daemon
- **Running the daemon** subsection: VAPID env var note, daemon dev command, what completion-push looks like.
- **Project Structure** block: current `apps/` and `packages/` reality.
- **Tooling** subsection: link `apps/app/README.md`, `apps/runner/README.md`, `packages/db/README.md`, `CLAUDE.md`.
- Drop dead references to `apps/docs`, `apps/legal`, "Boilerplate", localhost:3002, localhost:3003.

### `docker-compose.yml` (production-shaped)

Three changes:
- Drop the `docs` service (its `docker/docs.Dockerfile` doesn't exist — currently broken).
- Add a `runner` service pointing at `apps/runner/Dockerfile` with required env vars (Supabase + VAPID).
- Drop the unused `backend` network (only `frontend` was ever used).

Resulting file:

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

### `docker-compose.dev.yml`

Drop volume mounts and ports for dead apps:
- Remove `/app/apps/docs/node_modules` and `/app/apps/legal/node_modules` volume entries.
- Remove port mappings `3002:3002` and `3003:3003` (legal, docs).
- Keep `3000`, `3001`, `6006`.
- Keep the commented-out `postgres` / `redis` stubs (already opt-in, no harm).

### `docker/` Dockerfiles

- Keep `app.Dockerfile`, `www.Dockerfile`, `dev.Dockerfile`.
- **No new files.** `docker-compose.yml` points at the existing `apps/runner/Dockerfile` for the runner — no duplication.
- Verify in T2 that `docker compose build runner` actually succeeds against `apps/runner/Dockerfile` with the repo-root context.

### `.devcontainer/devcontainer.json`

Four changes:
- `"name"`: rename from `"Symbiora Dev"` to `"SEO Audit Dev"`.
- `forwardPorts`: drop `3002` and `3003`.
- `portsAttributes`: drop entries for `3002` (Legal) and `3003` (Docs).
- `postCreateCommand`: replace with `"cd packages/tokens && bun run build"` — drop the `apps/docs && bun run postinstall && cd ../legal && bun run postinstall` chunks.
- No other changes (VS Code extensions, settings, port forwarding for the live ports — all stay).

### `.devcontainer/docker-compose.yml`

No change — it's purely a docker-in-docker overlay that's still valid.

### `k8s/` — full refactor

**Directory rename:** `k8s/charts/brand-monitor/` → `k8s/charts/seo-audit/`

**Delete entire subdirectories:**
- `k8s/charts/seo-audit/charts/docs/`
- `k8s/charts/seo-audit/charts/legal/`

**New subchart:** `k8s/charts/seo-audit/charts/runner/`
- `Chart.yaml` — `name: runner`, `appVersion: 1.0.0`
- `values.yaml` — image, replicas (1), env-from-secret references for `POSTGRES_CONNECTION_STRING`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`. No Service, no Ingress (headless daemon).
- `templates/deployment.yaml` — single Deployment, env from secret, no probes (the runner has no HTTP surface for liveness checks; rely on restart-on-crash).
- No `templates/service.yaml`, no `templates/ingress.yaml`.

**Update existing files** (`Chart.yaml`, `values.yaml`, `values-dev.yaml`, `values-staging.yaml`, `values-production.yaml`):
- Drop `docs:` and `legal:` blocks.
- Add a `runner:` block (image config, env-from-secret).
- Update dependency list in umbrella `Chart.yaml` — drop docs/legal, add runner.

**Update templates** (`_helpers.tpl`, `namespace.yaml`, `ingress.yaml`):
- Replace any `brand-monitor` literal in helper names / labels with `seo-audit`.
- Drop docs/legal ingress rules.

**Update scripts** (5 files in `k8s/scripts/`):
- `build-images.sh` — drop docs/legal image builds, add runner.
- `k3d-create.sh` — rename cluster name if it references `brand-monitor`.
- `k3d-delete.sh` — same.
- `deploy-local.sh` — drop docs/legal services, update chart path.
- `port-forward.sh` — drop docs/legal port-forwards (runner has no HTTP port to forward).

**Rewrite `k8s/README.md`:**
- Replace all `kitchensink-react`, `brand-monitor`, `Symbiora` references with `seo-audit`.
- Update apps list: drop docs/legal, add runner.
- Update env vars section: document the 4 secrets needed (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_CONNECTION_STRING`) + VAPID trio.
- Update commands table.

### Tests, validation, and DoD

This slice is **infra-only — zero unit tests**. Validation is structural:

- `docker compose -f docker-compose.yml config` parses cleanly (no broken refs).
- `docker compose -f docker-compose.dev.yml config` parses cleanly.
- `docker compose build runner` succeeds (proves `apps/runner/Dockerfile` works with the new compose context).
- `helm lint k8s/charts/seo-audit` returns 0.
- `helm template k8s/charts/seo-audit -f k8s/charts/seo-audit/values-dev.yaml` produces valid YAML (no unrendered placeholders).
- `grep -rE "brand-monitor|kitchensink-react|Symbiora|apps/docs|apps/legal" README.md k8s/ docker-compose*.yml .devcontainer/ docker/` returns zero matches in the changed surfaces.
- Existing test suites must still pass:
  - `bun --filter @repo/app test` → 188
  - `bun --filter @repo/runner test` → 5
  - All builds + lint clean.

---

## Files (full list)

| Action | Path | Notes |
|---|---|---|
| Modify | `README.md` | Replace boilerplate with current reality |
| Modify | `docker-compose.yml` | Drop docs, add runner |
| Modify | `docker-compose.dev.yml` | Drop docs/legal mounts + ports |
| Modify | `.devcontainer/devcontainer.json` | Rename + drop dead ports + fix postCreate |
| Rename | `k8s/charts/brand-monitor/` → `k8s/charts/seo-audit/` | Project rename |
| Delete | `k8s/charts/seo-audit/charts/docs/` (recursive) | Dead app |
| Delete | `k8s/charts/seo-audit/charts/legal/` (recursive) | Dead app |
| Create | `k8s/charts/seo-audit/charts/runner/Chart.yaml` | New subchart |
| Create | `k8s/charts/seo-audit/charts/runner/values.yaml` | Subchart defaults |
| Create | `k8s/charts/seo-audit/charts/runner/templates/deployment.yaml` | Single Deployment |
| Modify | `k8s/charts/seo-audit/Chart.yaml` | Rename + dep list |
| Modify | `k8s/charts/seo-audit/values.yaml` | Drop dead, add runner |
| Modify | `k8s/charts/seo-audit/values-dev.yaml` | Same |
| Modify | `k8s/charts/seo-audit/values-staging.yaml` | Same |
| Modify | `k8s/charts/seo-audit/values-production.yaml` | Same |
| Modify | `k8s/charts/seo-audit/templates/_helpers.tpl` | Name swap |
| Modify | `k8s/charts/seo-audit/templates/namespace.yaml` | Name swap |
| Modify | `k8s/charts/seo-audit/templates/ingress.yaml` | Drop docs/legal rules |
| Modify | `k8s/scripts/build-images.sh` | Drop docs/legal, add runner |
| Modify | `k8s/scripts/k3d-create.sh` | Cluster name |
| Modify | `k8s/scripts/k3d-delete.sh` | Cluster name |
| Modify | `k8s/scripts/deploy-local.sh` | Drop dead services, fix chart path |
| Modify | `k8s/scripts/port-forward.sh` | Drop docs/legal ports |
| Modify | `k8s/README.md` | Full rewrite |

**Tests delta: 188 app + 5 runner — UNCHANGED.**

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | New runner subchart misses an env var users actually need | medium | Document all 4 (`POSTGRES_CONNECTION_STRING`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`) in values.yaml as commented defaults + a "secrets required" note in README. |
| 2 | Helm template rename breaks an external reference | low | We don't deploy to k8s today (verified by absence of CI). Renaming is safe. |
| 3 | README's "Supabase + DB migrate" flow doesn't match actual local dev | medium | Cross-reference against `apps/app/README.md`, `apps/runner/README.md`, and `packages/db/README.md` before writing the new README in T1. |
| 4 | Devcontainer changes break existing users mid-session | low | Devcontainer changes only affect new container builds. Existing containers keep working until rebuilt. |
| 5 | `apps/runner/Dockerfile` doesn't build in compose context (different working-dir assumptions) | medium | Test `docker compose build runner` in T2; if it fails, either adjust the compose context or add a `docker/runner.Dockerfile` wrapper. |
| 6 | grep validation finds residual references in places not in scope (e.g. CI workflows) | low | The validation grep is scoped to the changed surfaces (`README.md k8s/ docker-compose*.yml .devcontainer/ docker/`). Other references are explicit non-goals. |

---

## Definition of Done

- [ ] `docker compose -f docker-compose.yml config` parses (no broken refs)
- [ ] `docker compose -f docker-compose.dev.yml config` parses
- [ ] `docker compose build runner` succeeds
- [ ] `helm lint k8s/charts/seo-audit` returns 0
- [ ] `helm template k8s/charts/seo-audit -f k8s/charts/seo-audit/values-dev.yaml` produces valid YAML
- [ ] Validation grep returns zero matches in the changed surfaces
- [ ] `bun --filter @repo/app test` still 188
- [ ] `bun --filter @repo/runner test` still 5
- [ ] All builds + lint clean
- [ ] README's setup flow reproducible from a clean clone

---

## Slice 24 candidates (carry-forward)

- Rename `@repo/mono` in root `package.json` + update GitHub repo URL.
- Build & push container images via CI (GHCR).
- Vercel deployment recipe for `app` + `www`.
- Runner deployment recipe (Fly.io / Render / dedicated VM).
- Supabase migration CI automation.
- Notify on `partial` / `failed` push (deferred from slice 22).
- Whoami endpoint, `/offline` polish, 60s ticker.
