#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAMESPACE="${NAMESPACE:-kitchensink-react-dev}"
RELEASE_NAME="${RELEASE_NAME:-kitchensink-react}"

cd "$PROJECT_ROOT/k8s/charts/kitchensink-react"

echo "Updating Helm dependencies..."
helm dependency update

echo ""
echo "Deploying to namespace: $NAMESPACE"
echo ""

# Deploy with local dev values
helm upgrade --install "$RELEASE_NAME" . \
  -f values-dev.yaml \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --wait \
  --timeout 5m

echo ""
echo "Deployment complete!"
echo ""
echo "=== Pods ==="
kubectl get pods -n "$NAMESPACE"
echo ""
echo "=== Services ==="
kubectl get svc -n "$NAMESPACE"
echo ""
echo "=== Ingress ==="
kubectl get ingress -n "$NAMESPACE"
