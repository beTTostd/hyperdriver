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
COPY docker/entrypoint.sh /usr/local/bin/hyperdriver-entrypoint

RUN chmod +x /usr/local/bin/hyperdriver-entrypoint \
    && mkdir -p /app/data /app/uploads \
    && chown -R node:node /app

EXPOSE 3100

ENTRYPOINT ["/usr/local/bin/hyperdriver-entrypoint"]
CMD ["node", "server.js"]
