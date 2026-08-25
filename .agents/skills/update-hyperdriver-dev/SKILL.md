---
name: update-hyperdriver-dev
description: "Update, restart, and verify the Hyperdriver development environment defined by compose.dev.yaml, including dependency and migration-aware refreshes. Use for requests to update dev or the beta-linked development service; do not use for production deployments."
---

# Atualizar Hyperdriver dev

Update the Hyperdriver development service without overwriting source changes or production data.

## Scope

Treat `AGENTS.md`, `compose.dev.yaml`, `Dockerfile.dev`, `package.json`, `package-lock.json`, `.env.example`, migration files, and the current Git state as authoritative. Re-read them before acting because the workflow may change.

The current development topology is:

- Compose service: `hyperdriver-dev`
- Compose file: `compose.dev.yaml`
- Local port: `3101`
- Public origin configured by Compose: `https://beta.hyperdriver.com.br`
- SQLite data: `data/dev/db`
- Replay uploads: `data/dev/files`
- Source: bind-mounted at `/app`
- Dependencies: isolated in the container volume at `/app/node_modules`

Never substitute `compose.yaml`, port `3100`, `APP_URL=https://hyperdriver.com.br`, or anything under `data/prod`. If the user means production, use `$deploy-hyperdriver-production` instead.

## Update workflow

1. Inspect `git status --short`, the current branch and revision, the Compose state, and relevant recent logs. Preserve all existing tracked and untracked user changes.
2. Determine whether “update” means refresh the current worktree, synchronize from Git, or update a remote/shared dev host. Use current context when it is unambiguous; otherwise ask before a Git or remote mutation. The repository does not define a remote dev host or path, so never invent one.
3. If synchronizing source, fetch and use fast-forward-only integration. Do not reset, force-checkout, clean, stash, merge, or rebase user work unless explicitly requested. Stop on divergence or overlapping local changes.
4. Compare the old and new revisions. If migrations changed and `data/dev/db/hyperdriver.sqlite` exists, stop the dev service and take a consistent backup of the dev database, existing `-wal`/`-shm` companions, and uploads before restarting. Do not back up or modify production paths.
5. Validate with Node.js `>=22.13.0`. Run `npm run install:ci` when host dependencies are needed, then choose checks proportional to the update. For a shared beta/dev rollout, run `npm run lint`, `npm run verify:extension`, and `npm test`; do not start a known-broken revision.
6. Rebuild and recreate with `docker compose -f compose.dev.yaml up --build --detach`. Add `--renew-anon-volumes` when `package.json`, `package-lock.json`, the Node version, or `Dockerfile.dev` changed so `/app/node_modules` cannot remain stale. Never use `down -v` or prune commands as part of a routine update.
7. The development container runs `npm run db:migrate` before `next dev`. Capture bounded startup logs and stop on a migration checksum error, restart loop, dependency failure, or permission error.
8. Verify `docker compose -f compose.dev.yaml ps`, local readiness at `http://127.0.0.1:3101/api/health/ready`, and the changed user flow. When this is the shared beta service, also verify `https://beta.hyperdriver.com.br/api/health/ready`, expected HTTPS/security headers, login, replay access, and extension synchronization as applicable.

## Safety and authorization

A direct request to update dev authorizes the normal source/dependency/container refresh for the clearly identified dev target. It does not authorize deleting volumes or data, overwriting Git changes, changing DNS/TLS/secrets, deploying production, or restoring a database backup.

Do not display `.env.local`, environment dumps, passwords, tokens, cookies, database contents, or replay contents. Preserve existing dev secrets and mounts.

If startup fails after a source update, preserve diagnostic logs without secrets and return to the previous revision only when doing so will not overwrite user changes and migration compatibility is known. Database or upload restoration requires explicit confirmation because it can discard newer dev writes.

## Completion

Report the target, previous and current revisions, whether dependencies or migrations changed, commands/checks performed, container and readiness status, backup location if created, and any manual beta validation still pending. Do not claim success solely because the container process exists.
