# syntax=docker/dockerfile:1

# Multi-stage build producing Next's standalone server. The host has ~26 GB of
# disk and ~5 GB of free RAM alongside the live agent stack, so the final image
# carries only the runtime (IMPLEMENTATION_PLAN risks R1/R2).

FROM node:22-alpine AS deps
WORKDIR /app
# libc6-compat: some native deps expect glibc symbols on Alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci


FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Cap the heap so a build cannot starve the agent stack sharing this host.
ENV NODE_OPTIONS=--max-old-space-size=3072
# Build-time env only — real secrets are injected at runtime via env_file.
# These satisfy src/server/env.ts during prerender; none are baked into output.
ENV APP_URL=http://localhost:3100 \
    PANEL_SECRET_KEY=build-time-placeholder-key-32-bytes-base64== \
    DATABASE_URL=postgres://panel:panel@db:5432/panel \
    LHOS_BASE_URL=https://placeholder.invalid \
    LHOS_MCP_TOKEN=placeholder \
    LHOS_APPROVE_TOKEN=placeholder \
    LHOS_VNC_URL=https://placeholder.invalid/ \
    E2B_API_URL=http://placeholder.invalid:3000 \
    E2B_API_KEY=placeholder
RUN npm run build


FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0

# Run unprivileged; `node` already exists in the base image.
RUN mkdir -p /data/uploads && chown -R node:node /data

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Runtime-read configuration (model registry + settings schema).
COPY --from=builder --chown=node:node /app/config ./config
# Migrations are applied by `npm run db:migrate` from the host, not on boot —
# an automatic migration on container start would race a rolling restart.
COPY --from=builder --chown=node:node /app/src/server/db/migrations ./migrations

USER node
EXPOSE 3100

CMD ["node", "server.js"]
