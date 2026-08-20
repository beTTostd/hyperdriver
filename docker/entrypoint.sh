#!/bin/sh
set -eu

database_file="${DATABASE_FILE:-/app/data/hyperdriver.sqlite}"
database_dir="$(dirname "$database_file")"
uploads_dir="${UPLOADS_DIR:-/app/uploads}"

mkdir -p "$database_dir" "$uploads_dir"

node /app/scripts/migrate.mjs
node /app/scripts/seed.mjs

# Bind mounts are commonly created as root on Linux. Make the persistent
# directories writable by the unprivileged runtime user before dropping
# privileges for the application process.
chown -R node:node "$database_dir" "$uploads_dir"

if [ "$(id -u)" -eq 0 ]; then
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
