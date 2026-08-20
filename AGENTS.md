# Repository Guidelines

## Project Structure & Module Organization

- `app/` contains the Next.js/Vite application routes and UI (`page.tsx`, route-specific CSS modules, and shared `globals.css`).
- `worker/` and `build/` contain the Cloudflare/Vinext worker entry point and build integration.
- `public/` stores static assets and replay fixtures, including `public/replays/recorded-match.json`.
- `tests/` contains Node’s built-in test suites; `db/` contains Drizzle schema and database access code.
- `talishar-local-history/` is the companion browser extension. Keep extension code self-contained there.
- `DESIGN_SYSTEM.md` defines the Hyperdriver visual language, colors, typography, and icon rules.

## Build, Test, and Development Commands

Use Node.js `>=22.13.0`.

```bash
npm install                 # install dependencies
npm run dev                 # start the local Vite/Vinext development server
npm run build               # build and validate the packaged Sites worker
npm test                    # build first, then run rendered HTML tests
npm run lint                # run ESLint with the Next.js TypeScript rules
npm run validate:artifact   # validate an existing dist/ artifact
npm run db:generate         # generate Drizzle migrations from schema changes
```

Run `npm run install:ci` when the repository’s controlled CI/runtime setup is required.

## Coding Style & Naming Conventions

Use TypeScript/TSX for application code and modern ESM syntax. Follow the existing two-space indentation, double-quoted strings, trailing commas, and semicolon style. Use PascalCase for React components, camelCase for variables/functions, and kebab-case for route or asset names where appropriate. Prefer colocated CSS modules for page-specific styles. Run `npm run lint` before submitting changes.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`, with files named `*.test.mjs` under `tests/`. Add or update tests when rendering, worker behavior, replay parsing, or public output changes. There is no configured coverage threshold; `npm test` is the required verification command and includes the production build.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects, consistent with the existing `Add project files` commit (for example, `Fix replay turn navigation`). Keep commits focused. Pull requests should explain the user-visible effect, list verification commands, and include screenshots or recordings for UI changes. Call out schema, asset, configuration, or deployment-impacting changes explicitly.

## Security & Configuration Tips

Do not commit secrets, generated runtime directories, or user replay data. Keep local tooling output inside the paths managed by `scripts/sites-env.sh`. Replay files are read in the browser; changes should preserve that local-only behavior unless the task explicitly requires otherwise.
