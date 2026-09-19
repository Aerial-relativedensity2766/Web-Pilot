# Contributing to WebPilot

Thanks for helping. WebPilot is a **local-first** AI browser agent (Bun workspaces + Turborepo). Core packages and fixtures are usable today. **`apps/web` has a static accessible dashboard shell** (no live tasks). **`apps/api` is still a scaffold.**

## Prerequisites

- **Bun** matching the `packageManager` field in the root `package.json` (currently `bun@1.4.0`). Install from https://bun.sh
- Git
- For browser / integration / e2e work: Playwright browsers (`bunx playwright install`)

These steps were checked against Bun 1.4.x on Linux. If `bun install` fails on another minor, pin to the version declared in `package.json`.

## First-time setup (clean checkout)

```bash
git clone https://github.com/missarii/Web-Pilot.git
cd Web-Pilot
bun install
cp .env.example .env   # optional — defaults are safe
```

Start the local fixture site used by tests:

```bash
bun run test-site   # http://127.0.0.1:3001/test-site/
```

### Commands that work today

| Command | Notes |
| --- | --- |
| `bun install` | Install workspace dependencies |
| `bun run test-site` | Fixture site for integration/e2e |
| `bun run typecheck` | Turbo typecheck across workspaces |
| `bun run test:unit` | Vitest (`--passWithNoTests` — an empty run is **not** coverage) |
| `bun run test:integration` | Bun tests under `tests/integration` |
| `bun run test:e2e` | Playwright e2e (install browsers first) |
| `bun run build` | Turbo build |
| `bun run --filter @webpilot/web dev` | Dashboard shell at http://127.0.0.1:3000 (Node 24+; see `apps/web/README.md`) |

### Commands / areas that are not ready

| Area | Why |
| --- | --- |
| Live dashboard tasks / polished API product path | `apps/web` is a static preview shell; `apps/api` is still a scaffold — nothing here executes an agent |
| “All green” from unit tests alone | Prefer the suites that match your change; say N/A in the PR when a suite does not apply |

## Pull request workflow

1. Fork and branch from `main` (`docs/…`, `fix/…`, or `feat/…`).
2. Keep the PR focused on one issue.
3. Run `bun run typecheck` for TypeScript changes.
4. Run the tests that cover your change; report commands and results in the PR.
5. Describe **what** and **why**, and link the issue.

## Safety

- Do not commit secrets, real `.env` values, session stores, or personal browsing data.
- Sanitize logs. Do not upload private downloads from agent runs.
- Security issues: use GitHub **Security** advisories, not public issues.

## Related

- Issue/PR templates: `.github/` (issue #10)
- For large design changes, open an issue before coding

## README link

Please link this file from the README Contributing section:

```md
See [CONTRIBUTING.md](./CONTRIBUTING.md) for a quickstart. The dashboard is a static preview shell; the API is still a scaffold.
```
