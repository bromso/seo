.PHONY: help k3d-setup k3d-create k3d-delete k8s-build k8s-deploy k8s-undeploy k8s-logs k8s-status k8s-port-forward k8s-shell

# Configuration
CLUSTER_NAME ?= kitchensink-react
NAMESPACE ?= kitchensink-react-dev
TAG ?= latest
RELEASE_NAME ?= kitchensink-react

# Colors for output
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[0;33m
NC := \033[0m # No Color

help: ## Show this help message
	@echo ""
	@echo "$(CYAN)Kubernetes Commands:$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Configuration:$(NC)"
	@echo "  CLUSTER_NAME=$(CLUSTER_NAME)"
	@echo "  NAMESPACE=$(NAMESPACE)"
	@echo "  TAG=$(TAG)"
	@echo ""

# =============================================================================
# K3D CLUSTER MANAGEMENT
# =============================================================================

k3d-setup: k3d-create k8s-build k8s-deploy ## Full setup: create cluster, build images, deploy
	@echo ""
	@echo "$(GREEN)k3d setup complete!$(NC)"
	@echo ""
	@echo "Run 'make k8s-port-forward' to access your apps:"
	@echo "  www:   http://localhost:3000"
	@echo "  app:   http://localhost:3001"
	@echo "  legal: http://localhost:3002"
	@echo "  docs:  http://localhost:3003"

k3d-create: ## Create k3d cluster
	@chmod +x k8s/scripts/*.sh
	@CLUSTER_NAME=$(CLUSTER_NAME) ./k8s/scripts/k3d-create.sh

k3d-delete: ## Delete k3d cluster
	@CLUSTER_NAME=$(CLUSTER_NAME) ./k8s/scripts/k3d-delete.sh

# =============================================================================
# KUBERNETES OPERATIONS
# =============================================================================

k8s-build: ## Build and load Docker images into k3d
	@CLUSTER_NAME=$(CLUSTER_NAME) TAG=$(TAG) ./k8s/scripts/build-images.sh

k8s-deploy: ## Deploy to local k3d cluster
	@NAMESPACE=$(NAMESPACE) RELEASE_NAME=$(RELEASE_NAME) ./k8s/scripts/deploy-local.sh

k8s-undeploy: ## Remove deployment from cluster
	@echo "Removing Helm release..."
	@helm uninstall $(RELEASE_NAME) -n $(NAMESPACE) 2>/dev/null || true
	@echo "Deleting namespace..."
	@kubectl delete namespace $(NAMESPACE) 2>/dev/null || true
	@echo "$(GREEN)Cleanup complete!$(NC)"

k8s-logs: ## View logs from all pods
	@kubectl logs -f -l app.kubernetes.io/instance=$(RELEASE_NAME) -n $(NAMESPACE) --all-containers --max-log-requests=10

k8s-status: ## Check deployment status
	@echo ""
	@echo "$(CYAN)=== Pods ===$(NC)"
	@kubectl get pods -n $(NAMESPACE)
	@echo ""
	@echo "$(CYAN)=== Services ===$(NC)"
	@kubectl get svc -n $(NAMESPACE)
	@echo ""
	@echo "$(CYAN)=== Ingress ===$(NC)"
	@kubectl get ingress -n $(NAMESPACE)
	@echo ""
	@echo "$(CYAN)=== HPA ===$(NC)"
	@kubectl get hpa -n $(NAMESPACE) 2>/dev/null || echo "No HPA configured"

k8s-port-forward: ## Start port forwarding to all services
	@NAMESPACE=$(NAMESPACE) ./k8s/scripts/port-forward.sh

k8s-shell: ## Open a shell in a running pod (APP=www|app|docs|legal)
	@kubectl exec -it -n $(NAMESPACE) $$(kubectl get pod -n $(NAMESPACE) -l app.kubernetes.io/name=$(APP) -o jsonpath='{.items[0].metadata.name}') -- /bin/sh

# =============================================================================
# HELM OPERATIONS
# =============================================================================

helm-template: ## Render Helm templates locally (for debugging)
	@cd k8s/charts/kitchensink-react && helm dependency update && helm template $(RELEASE_NAME) . -f values-dev.yaml

helm-lint: ## Lint Helm charts
	@cd k8s/charts/kitchensink-react && helm lint .

helm-deps: ## Update Helm dependencies
	@cd k8s/charts/kitchensink-react && helm dependency update

# =============================================================================
# DOCKER OPERATIONS (without k3d)
# =============================================================================

docker-build: ## Build all Docker images
	@echo "Building Docker images..."
	@docker build -f docker/app.Dockerfile -t kitchensink-react/app:$(TAG) .
	@docker build -f docker/www.Dockerfile -t kitchensink-react/www:$(TAG) .
	@docker build -f docker/docs.Dockerfile -t kitchensink-react/docs:$(TAG) .
	@docker build -f docker/legal.Dockerfile -t kitchensink-react/legal:$(TAG) .
	@echo "$(GREEN)Build complete!$(NC)"
