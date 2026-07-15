# Build from the repo root: docker build -f apps/web/Dockerfile
#   --build-arg NEXT_PUBLIC_API_URL=https://your-api.example.com
#   --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
#   --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .
# NEXT_PUBLIC_* vars are baked in at build time, not read at runtime, so the API
# URL must be supplied as a build arg (defaults to localhost for local testing).
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/game-rules/package.json packages/game-rules/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/game-rules packages/game-rules
COPY apps/web apps/web

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
WORKDIR /app/apps/web
# A fresh version on every build with real code changes (this RUN sits after
# COPY apps/web above, so Docker's layer cache only re-executes it when
# something actually changed) - lets the client wipe stale localStorage on
# its own the moment it loads a new build, with no manual version bump to
# remember (see lib/storage/store.ts's sweepStaleStorageOnNewBuild).
RUN echo "NEXT_PUBLIC_APP_VERSION=$(date +%s)" >> .env.production
RUN bun run build

FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
# No apps/web/public directory exists yet (no static assets); add this line
# back if one gets created.

EXPOSE 3100
ENV PORT=3100
CMD ["bun", "apps/web/server.js"]
