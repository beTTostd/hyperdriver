# Runbook de produção do Hyperdriver

Use this runbook for a real release. Adapt command syntax to the discovered deployment platform without weakening the invariants below.

## 1. Establish the release and target

1. Read the repository instructions and deployment files named by `SKILL.md`.
2. Inspect `git status --short`, the current branch, release commit, `origin/main`, and tags or image metadata. Do not include unrelated local changes in a release.
3. Identify the beta and production targets, application paths, deployment mechanism, reverse proxy, persistent paths or volumes, secret source, and backup destination from existing configuration or user-provided context.
4. Confirm Node.js is at least `22.13.0` wherever repository builds run.
5. Determine whether the release contains migrations, changes to `db/`, the entrypoint, Docker/Compose files, public assets, or the extension ZIP. Call these out in the release summary.

If any target-specific value is unavailable, stop before mutation and ask for that value. Do not turn illustrative names into live commands.

## 2. Validate the release

For the exact release revision, run or verify successful CI equivalents of:

```bash
npm run install:ci
npm audit --omit=dev --audit-level=high
npm run lint
npm run verify:extension
npm test
npm run validate:artifact
```

`npm test` already performs a production build. Do not deploy if a required gate fails. Record the commit SHA and, when images are used, the image digest. Prefer building once and promoting that digest through beta and production.

## 3. Prove the release in beta

Back up beta using the same consistency rules as production, deploy the exact candidate artifact, and wait for readiness. Verify:

- `GET /api/health/live` and `GET /api/health/ready` succeed;
- HTTPS and the expected security headers are present;
- login works and the replay library loads;
- an owned replay can be opened;
- extension synchronization reaches beta without affecting the production sync state;
- startup logs show successful migration, cleanup, backfill, and seed and do not expose secrets.

Resolve failures and repeat beta with a newly identified candidate. Never silently deploy a different commit or digest to production.

## 4. Prepare the production change

Present a concise change summary containing:

- production target and deployment mechanism;
- commit SHA and immutable image digest, when applicable;
- successful local/CI and beta evidence;
- configuration or migration impact;
- backup destination and retention expectation;
- expected downtime and rollback point.

Obtain confirmation at this boundary unless the current request already explicitly authorizes immediate deployment of this exact candidate.

## 5. Take a consistent production snapshot

1. Record the current production revision or image digest and current health.
2. Put the service into the platform's maintenance flow if one exists, then stop the single application instance so SQLite and uploads cannot change.
3. Snapshot the SQLite database together with existing `-wal` and `-shm` companions, or use SQLite's backup API.
4. Snapshot the complete uploads directory from the same stopped interval, preserving ownership and permissions.
5. Create checksums and a small manifest containing timestamp, source paths/volume identifiers, deployed revision/digest, and application version if available. Do not put secrets in the manifest.
6. Verify that the backup is readable and the expected database and uploads are present before continuing.

If the snapshot or its verification fails, keep the release stopped only as long as necessary to safely return the previous version to service. Do not migrate or deploy.

## 6. Deploy

Use the already-discovered platform procedure. Maintain these application settings:

```text
NODE_ENV=production
PORT=3100
APP_URL=https://hyperdriver.com.br
DATABASE_FILE=/app/data/hyperdriver.sqlite
UPLOADS_DIR=/app/uploads
```

Preserve the existing secret values and persistent mounts. Do not set `ADMIN_INITIAL_PASSWORD` during a routine deploy. Ensure only one application instance uses the local SQLite/upload storage.

Start the candidate and capture bounded startup logs. The current container entrypoint runs, in order:

1. `scripts/migrate.mjs`
2. `scripts/cleanup-quarantine.mjs`
3. `scripts/backfill-replays.mjs`
4. `scripts/seed.mjs`
5. the standalone Next.js server

Do not bypass this sequence unless the repository's current deployment files explicitly changed it. A migration checksum mismatch or any startup failure ends the rollout.

## 7. Verify production

Check from both the service network, when available, and the public origin:

- live and ready endpoints return success;
- `https://hyperdriver.com.br` presents a valid certificate and expected content;
- security headers include the repository-defined CSP and protections, and private pages remain `no-store`;
- logs show no restart loop, migration error, SQLite error, permission error, or secret/replay leakage;
- persistent database and upload paths are mounted and writable by the runtime user;
- login, replay library, replay reading, and extension synchronization work with an authorized test account or are explicitly assigned as manual checks.

Use bounded retries based on the configured health check (`30s` interval, `5s` timeout, `3` retries, `20s` start period). If readiness never stabilizes, treat the rollout as failed rather than waiting indefinitely.

## 8. Failure and rollback

First preserve diagnostic logs without secrets. Then choose the least destructive compatible response:

- If startup failed before schema/data changes, redeploy the recorded prior artifact.
- If migrations are additive and the prior application is confirmed compatible, roll back code to the prior immutable artifact while retaining current data.
- If compatibility is uncertain or writes occurred after migration, stop and request a decision. Do not guess.
- Restore the database and uploads only as one matched snapshot, with the application stopped, and only after explicit authorization acknowledging loss of post-snapshot writes.

After rollback, repeat readiness and functional checks and report both the failed and restored revisions.

## 9. Handoff record

Report:

- deployed commit and image digest;
- beta and production targets;
- backup identifier, timestamp, and verification result;
- CI/local gates and beta checks used;
- production health and functional checks;
- migrations or backfill observed;
- unresolved manual checks or warnings;
- previous artifact and snapshot available for rollback.
