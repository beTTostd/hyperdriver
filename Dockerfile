# syntax=docker/dockerfile:1

FROM node:22.13-bookworm-slim AS build

WORKDIR /app

# Install dependencies in a separate layer so source-only changes reuse the
# package installation cache.
COPY package.json package-lock.json ./
RUN npm ci

# The hosting control plane normally provides this file. The local Docker
# image has no Cloudflare bindings, so use an empty manifest when one was not
# supplied with the build context. Copy it before the source so a real
# `.openai/hosting.json` from the build context can override the fallback.
COPY docker/hosting.json .openai/hosting.json
COPY . .

RUN npm run build

FROM node:22.13-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    DATABASE_FILE=/app/data/hyperdriver.sqlite \
    UPLOADS_DIR=/app/uploads \
    WRANGLER_WRITE_LOGS=false \
    WRANGLER_LOG_PATH=/tmp/wrangler/logs \
    MINIFLARE_REGISTRY_PATH=/tmp/wrangler/registry

# Vinext is currently a devDependency, but its CLI is required by `npm start`.
# Keep the lockfile-installed node_modules tree in the runtime image.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/next.config.ts /app/vite.config.ts ./
COPY --from=build /app/.openai ./.openai
COPY docker/entrypoint.sh /usr/local/bin/hyperdriver-entrypoint

RUN chmod +x /usr/local/bin/hyperdriver-entrypoint \
    && mkdir -p /app/data /tmp/wrangler/logs /tmp/wrangler/registry \
    && chown -R node:node /app /tmp/wrangler

EXPOSE 3100

ENTRYPOINT ["/usr/local/bin/hyperdriver-entrypoint"]
CMD ["npm", "start"]
