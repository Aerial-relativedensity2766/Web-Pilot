# WebPilot

Local-first AI browser agent that turns natural-language tasks into safe, structured browser actions — running entirely on your machine, with no cloud calls.

> **Status:** early development (v0.1.0). Core engine, planners, browser automation, extraction and download pipeline are in place; the API server and web dashboard are scaffolds.

## What it does

Give WebPilot a prompt like *"download 20 sunset wallpapers"* or *"extract all product prices from https://example.com"*. It:

1. **Plans** the task — locally with a deterministic rule-based planner, or with a small on-device LLM (Transformers.js, quantized, e.g. Qwen2.5-0.5B) when AI planning is enabled.
2. **Executes** the plan step by step in a Playwright-managed browser (Chromium/Firefox/WebKit): navigate, click, type, extract, download.
3. **Observes** each page and **evaluates** progress, replanning on failure with bounded recovery.
4. **Ranks** candidates (images, links, texts) with a hybrid lexical + semantic scoring pipeline (BM25-style lexical scoring plus optional local embeddings via `all-MiniLM-L6-v2`).
5. **Downloads** media with hashing, MIME validation, allowlists, size/count limits and an explicit permission gate.

## Monorepo layout

Bun workspaces + Turborepo.

```
apps/
  api/          Elysia API server (tasks, downloads, settings, models, SQLite + WebSockets) — scaffold
  web/          SolidStart dashboard — scaffold
  test-site/    Local fixture site used for integration/e2e tests
packages/
  shared/         Config, resource limits, logging, cancellation, event bus, path/text/URL/MIME/hash utils
  schemas/        Zod-style schemas: actions, events, page state, errors, agent state, task plans
  browser-core/   Playwright browser lifecycle + controller (navigate/click/type/observe)
  extraction-core/ Page extraction (images, links, text blocks, tables)
  download-core/  Download pipeline: queueing, validation, hashing, manifest
  ai-core/        Rule planner + local LLM planner + candidate ranking (lexical/semantic)
  agent-core/     The agent engine: plan → validate → permission → execute → observe → replan loop
```

## Getting started

Prerequisites: [Bun](https://bun.sh) ≥ 1.1 and a Chromium-based browser (Playwright browsers are used).

```bash
bun install
cp .env.example .env   # optional — every value has a safe default
bun run dev            # run all apps/packages in parallel (turbo)
```

Run the local test site (fixture pages for integration tests):

```bash
bun run test-site      # http://127.0.0.1:3001/test-site/
```

### Scripts

| Script | Description |
| --- | --- |
| `bun run build` | Build all packages/apps (turbo) |
| `bun run typecheck` | Typecheck all workspaces |
| `bun run test:unit` | Unit tests (vitest) |
| `bun run test:integration` | Integration tests (bun test) |
| `bun run test:e2e` | Playwright end-to-end tests |
| `bun run test:all` | Unit + integration + e2e |
| `bun run db:generate` / `db:studio` | Drizzle ORM migrations / studio |
| `bun run api` | Start the API server |

## Configuration

Everything is configured via environment variables (see [`.env.example`](./.env.example)); defaults live in `packages/shared/src/config.ts`. Key groups:

- **API** — `WEBPILOT_PORT` (8787), `WEBPILOT_HOST`, `WEBPILOT_CORS_ORIGIN`
- **Storage** — data/downloads/screenshots/sessions/model dirs, SQLite URL (`data/`)
- **Browser** — engine (`chromium`), headless, nav/action timeouts, max tabs
- **Limits** — max agent steps (30), max downloads (100), max file size (25 MB), task time cap
- **Local AI** — enable/disable, model id, quantization (`q4`), max new tokens, embedding model
- **Safety** — download host allowlist, download confirmation requirement

## Architecture notes

- **Agent loop** (`packages/agent-core`): each step goes *plan → validate → permission → execute → observe → evaluate*; failures are recorded with typed error codes and passed through a replanner with bounded recovery, then abort.
- **Permission gate**: permission-sensitive actions (e.g. downloads) emit a `PERMISSION_REQUESTED` event and pause until the host application grants/denies, with optional "remember" caching.
- **Planning**: `ai-core` tries the local LLM planner first; on failure it falls back to the deterministic rule planner, so the agent always produces a valid `TaskPlan`.
- **Cancellation**: cooperative cancellation tokens + `withTimeout` wrappers throughout; hard resource caps are enforced centrally.
- **Events**: a typed event bus emits structured agent events (`AI_THINKING`, `ACTION_PLANNED`, `ACTION_COMPLETED`, `ACTION_FAILED`, `PERMISSION_*`, …) consumed by the API/WebSocket layer.

## Testing

- `tests/unit` — pure-logic tests (vitest)
- `tests/integration` — real browser + local test site (bun test)
- `tests/e2e` — Playwright

## License

MIT
