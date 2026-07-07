# Build from the repo root: docker build -f apps/server/Dockerfile .
# (the server needs the workspace's packages/game-rules and root lockfile).
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/game-rules/package.json packages/game-rules/package.json
RUN bun install --frozen-lockfile

COPY packages/game-rules packages/game-rules
COPY apps/server apps/server

WORKDIR /app/apps/server
ENV NODE_ENV=production
EXPOSE 4000

# Migrations are a separate, explicit step (see DEPLOYMENT.md) — they need a
# plain session connection, not the transaction-pooled DATABASE_URL this
# container runs with, so they aren't run automatically on boot.
CMD ["bun", "run", "start"]
