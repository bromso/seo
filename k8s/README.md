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

- **www**: <http://localhost:3000>
- **app**: <http://localhost:3001>

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
| --- | --- |
| `make k3d-setup` | Full setup (create + build + deploy) |
| `make k3d-create` | Create k3d cluster only |
| `make k3d-delete` | Delete k3d cluster |

### Kubernetes Operations

| Command | Description |
| --- | --- |
| `make k8s-build` | Build and load Docker images into k3d |
| `make k8s-deploy` | Deploy to local k3d cluster |
| `make k8s-undeploy` | Remove deployment from cluster |
| `make k8s-logs` | View logs from all pods |
| `make k8s-status` | Check deployment status |
| `make k8s-port-forward` | Start port forwarding to app + www |
| `make k8s-shell APP=app` | Open shell in a pod (app, www, runner) |

### Helm Operations

| Command | Description |
| --- | --- |
| `make helm-template` | Render templates locally (debugging) |
| `make helm-lint` | Lint Helm charts |
| `make helm-deps` | Update Helm dependencies |

## Directory Structure

```text
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
