#!/bin/bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-kitchensink-react}"
K3S_VERSION="${K3S_VERSION:-v1.28.4-k3s2}"

echo "Creating k3d cluster: $CLUSTER_NAME"

# Check if cluster already exists
if k3d cluster list | grep -q "$CLUSTER_NAME"; then
  echo "Cluster $CLUSTER_NAME already exists. Deleting..."
  k3d cluster delete "$CLUSTER_NAME"
fi

k3d cluster create "$CLUSTER_NAME" \
  --image "rancher/k3s:$K3S_VERSION" \
  --api-port 6550 \
  --servers 1 \
  --agents 2 \
  --port "80:80@loadbalancer" \
  --port "443:443@loadbalancer" \
  --port "3000:30000@loadbalancer" \
  --port "3001:30001@loadbalancer" \
  --port "3002:30002@loadbalancer" \
  --port "3003:30003@loadbalancer" \
  --wait

echo ""
echo "Cluster created successfully!"
echo ""
kubectl cluster-info
echo ""
kubectl get nodes
