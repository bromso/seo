# Kubernetes Deployment

This directory contains Kubernetes configurations for deploying Symbiora using Helm charts and k3d for local development.

## Prerequisites

The following tools are installed automatically in the devcontainer:

- **kubectl** - Kubernetes CLI
- **helm** - Kubernetes package manager
- **k3d** - Lightweight Kubernetes in Docker

If running outside the devcontainer, install these tools manually.

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
- **legal**: http://localhost:3002
- **docs**: http://localhost:3003

## Available Commands

Run `make help` to see all available commands:

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
| `make k8s-port-forward` | Start port forwarding to all services |
| `make k8s-shell APP=www` | Open shell in a pod (www, app, docs, legal) |

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
│   └── kitchensink-react/           # Umbrella Helm chart
│       ├── Chart.yaml           # Chart definition with dependencies
│       ├── values.yaml          # Default values
│       ├── values-dev.yaml      # Local k3d development
│       ├── values-staging.yaml  # Staging environment
│       ├── values-production.yaml # Production environment
│       ├── templates/           # Shared templates
│       │   ├── _helpers.tpl
│       │   ├── namespace.yaml
│       │   └── ingress.yaml
│       └── charts/              # Subcharts per app
│           ├── app/
│           ├── www/
│           ├── docs/
│           └── legal/
├── scripts/                     # Automation scripts
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
- Single replica per app
- No autoscaling
- Traefik ingress (k3d default)

### Staging

Uses `values-staging.yaml`:
- 2 replicas per app
- Autoscaling enabled
- NGINX ingress with TLS
- Images from ghcr.io

### Production

Uses `values-production.yaml`:
- 3 replicas per app
- Autoscaling enabled (3-20 replicas)
- Higher resource limits
- TLS with cert-manager
- Rate limiting

## Production Deployment

### Prerequisites

1. Configure your Kubernetes cluster access
2. Create a GitHub secret `KUBECONFIG` with your cluster kubeconfig
3. Push images to GitHub Container Registry (automated via CI)

### Manual Deployment

```bash
# Deploy to staging
helm upgrade --install kitchensink-react k8s/charts/kitchensink-react \
  -f k8s/charts/kitchensink-react/values-staging.yaml \
  --namespace kitchensink-react-staging \
  --create-namespace

# Deploy to production
helm upgrade --install kitchensink-react k8s/charts/kitchensink-react \
  -f k8s/charts/kitchensink-react/values-production.yaml \
  --namespace kitchensink-react-prod \
  --create-namespace
```

### Automated Deployment (GitHub Actions)

Use the "Deploy to Kubernetes" workflow:
1. Go to Actions > Deploy to Kubernetes
2. Click "Run workflow"
3. Select environment (staging/production)
4. Enter image tag
5. Click "Run workflow"

## Customization

### Adding Environment Variables

Edit the deployment template in the subchart:

```yaml
# k8s/charts/kitchensink-react/charts/app/templates/deployment.yaml
env:
  - name: MY_VAR
    value: "my-value"
```

Or use values:

```yaml
# values-production.yaml
app:
  env:
    MY_VAR: "my-value"
```

### Changing Resource Limits

Edit the appropriate values file:

```yaml
app:
  resources:
    limits:
      cpu: 1000m
      memory: 1Gi
    requests:
      cpu: 250m
      memory: 512Mi
```

### Enabling Autoscaling

```yaml
app:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
```

## Troubleshooting

### Pods not starting

```bash
# Check pod status
kubectl get pods -n kitchensink-react-dev

# Describe pod for events
kubectl describe pod <pod-name> -n kitchensink-react-dev

# Check logs
kubectl logs <pod-name> -n kitchensink-react-dev
```

### Images not found in k3d

```bash
# Rebuild and reload images
make k8s-build

# Verify images are loaded
docker exec k3d-kitchensink-react-server-0 crictl images | grep kitchensink-react
```

### Helm deployment failed

```bash
# Check Helm release status
helm list -n kitchensink-react-dev

# Get release history
helm history kitchensink-react -n kitchensink-react-dev

# Rollback if needed
helm rollback kitchensink-react -n kitchensink-react-dev
```

### Port forwarding not working

```bash
# Check if services exist
kubectl get svc -n kitchensink-react-dev

# Try manual port forward
kubectl port-forward svc/kitchensink-react-www 3000:3000 -n kitchensink-react-dev
```

## Health Checks

All apps expose a health endpoint at `/api/health`:

```bash
# Check health via port-forward
curl http://localhost:3000/api/health

# Response
{"status":"healthy","timestamp":"2024-01-01T00:00:00.000Z","app":"kitchensink-react-www"}
```
