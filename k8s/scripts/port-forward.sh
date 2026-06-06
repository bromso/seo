#!/bin/bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-seo-audit-dev}"

echo "Setting up port forwarding..."
echo ""
echo "Access your apps at:"
echo "  www:   http://localhost:3000"
echo "  app:   http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop all port forwards"
echo ""

# Function to cleanup background processes
cleanup() {
  echo ""
  echo "Stopping port forwards..."
  kill $(jobs -p) 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM

# Run port-forwards in parallel
kubectl port-forward -n "$NAMESPACE" svc/seo-audit-www 3000:3000 &
kubectl port-forward -n "$NAMESPACE" svc/seo-audit-app 3001:3001 &

# Wait for all background jobs
wait
