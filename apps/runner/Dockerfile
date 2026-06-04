# Stage 1: build
FROM oven/bun:1.3.4 AS builder
WORKDIR /app

# Workspace plumbing
COPY package.json bun.lock turbo.json ./
COPY packages packages
COPY apps/runner apps/runner

RUN bun install

# Build the slice 1 + slice 2 + slice 3 packages in topological order
RUN bun --filter @repo/audit-core build
RUN bun --filter @repo/lighthouse-runner build
RUN bun --filter @repo/audit-perf build
RUN bun --filter @repo/audit-seo build
RUN bun --filter @repo/audit-best-practices build
RUN bun --filter @repo/audit-pwa build
RUN bun --filter @repo/audit-onpage build
RUN bun --filter @repo/audit-cli build
RUN bun --filter @repo/db build
RUN bun --filter @repo/runner-core build
RUN bun --filter @repo/runner build

# Stage 2: runtime
FROM oven/bun:1.3.4-slim
WORKDIR /app

# Chromium (for Lighthouse) + minimal deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
    && rm -rf /var/lib/apt/lists/*

ENV LH_NO_SANDBOX=1
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Copy workspace manifests + lockfile (Bun needs these to resolve modules)
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/bun.lock /app/bun.lock
COPY --from=builder /app/apps/runner/package.json /app/apps/runner/package.json

# Copy built package dists (workspace deps resolved at runtime)
COPY --from=builder /app/packages /app/packages

# Re-run bun install in production mode to populate node_modules correctly
# --ignore-scripts skips the husky prepare hook which is not needed in the container
RUN bun install --production --frozen-lockfile --ignore-scripts

# Copy the runner dist last (after install to avoid cache busting)
COPY --from=builder /app/apps/runner/dist /app/apps/runner/dist

CMD ["bun", "run", "/app/apps/runner/dist/index.js", "start"]
