FROM oven/bun:1

# Install system dependencies as root
RUN apt-get update && apt-get install -y git curl vim && rm -rf /var/lib/apt/lists/*
RUN bun add -g turbo@2.5.5

WORKDIR /app

# Change ownership to bun user BEFORE copying files
RUN chown -R bun:bun /app

# Switch to bun user for all subsequent operations
USER bun

# Copy package files with correct ownership
COPY --chown=bun:bun package.json bun.lock turbo.json ./
COPY --chown=bun:bun apps/app/package.json ./apps/app/
COPY --chown=bun:bun apps/www/package.json ./apps/www/
COPY --chown=bun:bun apps/docs/package.json ./apps/docs/
COPY --chown=bun:bun apps/legal/package.json ./apps/legal/
COPY --chown=bun:bun apps/story/package.json ./apps/story/
COPY --chown=bun:bun packages/ui/package.json ./packages/ui/
COPY --chown=bun:bun packages/tokens/package.json ./packages/tokens/
COPY --chown=bun:bun packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies as bun user (fixes permission issues)
RUN bun install --ignore-scripts

EXPOSE 3000 3001 3002 3003 6006
CMD ["bun", "dev"]
