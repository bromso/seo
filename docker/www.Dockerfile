# apps/www - Marketing Site (port 3000)
FROM oven/bun:1 AS base
RUN apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS pruner
RUN bun add -g turbo@2.5.5
COPY . .
RUN turbo prune @repo/www --docker

FROM base AS installer
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/bun.lock ./bun.lock
RUN bun install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN bun turbo build --filter=@repo/www

FROM oven/bun:1-slim AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 nextjs
ENV NODE_ENV=production PORT=3000 HOSTNAME="0.0.0.0"
COPY --from=installer --chown=nextjs:nodejs /app/apps/www/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/www/.next/static ./apps/www/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/www/public ./apps/www/public
USER nextjs
EXPOSE 3000
CMD ["bun", "run", "apps/www/server.js"]
