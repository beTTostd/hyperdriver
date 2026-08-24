# syntax=docker/dockerfile:1

FROM node:22.13-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.13-bookworm-slim AS build

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:22.13-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    DATABASE_FILE=/app/data/hyperdriver.sqlite \
    UPLOADS_DIR=/app/uploads

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=node:node /app/scripts/migration-runner.mjs ./scripts/migration-runner.mjs
COPY --from=build --chown=node:node /app/scripts/backfill-replays.mjs ./scripts/backfill-replays.mjs
COPY --from=build --chown=node:node /app/scripts/cleanup-quarantine.mjs ./scripts/cleanup-quarantine.mjs
COPY --from=build --chown=node:node /app/scripts/seed.mjs ./scripts/seed.mjs
COPY --from=build --chown=node:node /app/lib/replay-telemetry-core.js ./lib/replay-telemetry-core.js
COPY --from=build --chown=node:node /app/talishar-local-history/replay-state.js ./talishar-local-history/replay-state.js
COPY docker/entrypoint.sh /usr/local/bin/hyperdriver-entrypoint

RUN chmod +x /usr/local/bin/hyperdriver-entrypoint \
    && mkdir -p /app/data /app/uploads \
    && chown -R node:node /app

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/hyperdriver-entrypoint"]
CMD ["node", "server.js"]
