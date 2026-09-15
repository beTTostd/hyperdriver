#!/bin/sh
set -u

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
while true; do
  node /app/scripts/backup.mjs || true
  sleep "$interval"
done
