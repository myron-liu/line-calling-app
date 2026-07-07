# Build from the repo root: docker build -f apps/web/Dockerfile
#   --build-arg NEXT_PUBLIC_API_URL=https://your-api.example.com .
# NEXT_PUBLIC_* vars are baked in at build time, not read at runtime, so the API
# URL must be supplied as a build arg (defaults to localhost for local testing).
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY packages/game-rules/package.json packages/game-rules/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/web/node_modules apps/web/node_modules
COPY package.json bun.lock ./
COPY packages/game-rules packages/game-rules
COPY apps/web apps/web

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
WORKDIR /app/apps/web
RUN bun run build

FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3100
ENV PORT=3100
CMD ["bun", "apps/web/server.js"]
