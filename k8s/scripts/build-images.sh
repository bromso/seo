#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-kitchensink-react}"
TAG="${TAG:-latest}"

echo "Building Docker images..."
echo ""

cd "$PROJECT_ROOT"

# Build all production images
echo "Building kitchensink-react/app:$TAG..."
docker build -f docker/app.Dockerfile -t kitchensink-react/app:$TAG .

echo "Building kitchensink-react/www:$TAG..."
docker build -f docker/www.Dockerfile -t kitchensink-react/www:$TAG .

echo "Building kitchensink-react/docs:$TAG..."
docker build -f docker/docs.Dockerfile -t kitchensink-react/docs:$TAG .

echo "Building kitchensink-react/legal:$TAG..."
docker build -f docker/legal.Dockerfile -t kitchensink-react/legal:$TAG .

echo ""
echo "Loading images into k3d cluster..."
echo ""

k3d image import kitchensink-react/app:$TAG -c "$CLUSTER_NAME"
k3d image import kitchensink-react/www:$TAG -c "$CLUSTER_NAME"
k3d image import kitchensink-react/docs:$TAG -c "$CLUSTER_NAME"
k3d image import kitchensink-react/legal:$TAG -c "$CLUSTER_NAME"

echo ""
echo "Images built and loaded successfully!"
