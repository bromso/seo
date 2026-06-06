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
