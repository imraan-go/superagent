# Multi-target image for api, worker and web. Build from the repo root:
#   docker build -f infra/deploy/Dockerfile --target api    -t superagent-api .
#   docker build -f infra/deploy/Dockerfile --target worker -t superagent-worker .
#   docker build -f infra/deploy/Dockerfile --target web    --build-arg API_INTERNAL_URL=http://api.internal:3001 -t superagent-web .
# Pin the base image by digest before production use (docker buildx imagetools inspect node:24-bookworm-slim).
# No secrets are baked in: all credentials come from the runtime secret manager as env vars.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS web-build
ARG API_INTERNAL_URL
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN test -n "$API_INTERNAL_URL" && pnpm --filter @superagent/web build

FROM base AS runtime
ENV NODE_ENV=production APP_ENV=production
RUN useradd --system --uid 10001 --home /app app

# Runtime images run binaries from node_modules directly (no package manager at runtime) and the
# app files stay root-owned and read-only to the unprivileged user.
FROM runtime AS api
COPY --from=deps /app /app
USER app
WORKDIR /app/apps/api
ENV API_HOST=0.0.0.0 API_PORT=3001
EXPOSE 3001
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]

FROM runtime AS worker
COPY --from=deps /app /app
USER app
WORKDIR /app/apps/worker
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]

FROM runtime AS web
COPY --from=web-build /app /app
USER app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
