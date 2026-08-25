---
name: deploy-hyperdriver-production
description: "Prepare, execute, verify, and, when necessary, roll back production deployments of hyperdriver.com.br. Use for release, rollout, promotion, or production-deploy requests for the Hyperdriver repository; do not use for local development or beta-only deployments."
---

# Deploy Hyperdriver em produção

Deploy the Hyperdriver application to `https://hyperdriver.com.br` while preserving its single-instance SQLite and local-upload consistency guarantees.

## Required context

Read [references/production-runbook.md](references/production-runbook.md) before taking deployment action. Treat `AGENTS.md`, `ARCHITECTURE.md`, `compose.yaml`, `Dockerfile`, `docker/entrypoint.sh`, `.github/workflows/ci.yml`, and the current Git state as authoritative and re-read the relevant files because they can change.

The repository does not define the production host, remote application path, SSH alias, reverse proxy, image registry, or secret manager. Discover these through read-only configuration or receive them from the user. Never invent them, infer production from beta credentials, or print secret values.

## Authorization boundary

A request to deploy authorizes normal release actions against the named Hyperdriver environment, but not destructive recovery, DNS changes, certificate changes, secret rotation, database replacement, or deletion of volumes/images/backups.

Before the first production mutation, summarize the exact revision or immutable image, target, backup destination, expected downtime, validation performed, and rollback point. Ask for explicit confirmation unless the user has already clearly authorized immediate deployment of that exact release to production in the current request.

Stop and ask for direction when the deployment target or access method is unknown, beta did not pass, the working tree is dirty in a way that can affect the release, the revision is not traceable, the backup fails, a migration checksum fails, readiness fails, or rollback would require restoring data.

## Operating rules

- Deploy one application instance only while SQLite and uploads use local storage. Do not scale horizontally.
- Promote the same validated commit or image digest from beta to production. A rebuild is not proof of artifact identity; if the platform cannot promote an immutable artifact, report that limitation before production.
- Run the repository's required gates: lockfile-exact install, dependency audit, lint, extension verification, tests, and standalone artifact validation. Reuse trustworthy CI results only when they correspond exactly to the release revision and their status can be verified.
- Roll out to beta first and validate it. Do not use production as the first deployment target.
- Before production migrations or backfill, stop the application and create a consistent, restorable snapshot of the SQLite database, any `-wal`/`-shm` files that exist, and uploads. Record the release revision or image digest and checksums with the snapshot.
- Preserve `APP_URL=https://hyperdriver.com.br`, the persistent database/upload mounts, and the existing production secrets. `ADMIN_INITIAL_PASSWORD` is bootstrap-only; do not introduce or rotate it for a routine release.
- Expect the container entrypoint to run migration, quarantine cleanup, replay backfill, and seed before starting the server. Capture these logs and treat any non-zero exit as a failed rollout.
- Keep production logs and command output free of passwords, cookies, tokens, replay contents, and environment dumps.
- Do not automatically restore a data snapshot. Code rollback is acceptable only when schema compatibility is established; data rollback needs explicit confirmation because it discards writes after the snapshot.

## Completion

Consider the deployment complete only after production readiness, public HTTPS behavior, security headers, authenticated login/library access, replay reading, and extension synchronization are verified at an appropriate level. Report the deployed revision or digest, backup identifier, checks performed, resulting health, any manual checks still owed, and the rollback point. Do not claim success from a running container alone.
