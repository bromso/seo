# Docker Operations

Manage Docker containers for the project.

## Arguments
- `$ARGUMENTS` - Action and optional app: `build [app]`, `up`, `down`, or `dev`

## Instructions

Parse the arguments and run the appropriate Docker command:

1. **`build [app]`**: Build Docker image(s)
   - With app name: `make build-<app>` (e.g., `make build-www`)
   - Without app: `make build` to build all images

2. **`up`**: Start production containers
   ```bash
   docker compose up -d
   ```

3. **`down`**: Stop and remove containers
   ```bash
   docker compose down
   ```

4. **`dev`**: Start development containers
   ```bash
   docker compose -f docker-compose.dev.yml up
   ```

Report:
- Container status after operations
- Any errors or issues encountered
- Port mappings for running services
