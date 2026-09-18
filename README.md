<div align="center">

<img src="docs/web-pilot.png" alt="WebPilot logo" width="360" />

# 🌐 WebPilot

**A local-first, privacy-respecting AI browser agent — free and open source.**

</div>

WebPilot turns natural-language tasks into safe, structured browser actions. Ask it to *"download 20 sunset wallpapers"* or *"extract all product prices from https://example.com"*, and it plans, browses, extracts and downloads — entirely on your machine, with **no cloud calls, no telemetry, no data ever leaving your device**.

> **Status:** early development (v0.1.0). The core engine, planners, browser automation, extraction and download pipeline are working; the API server and web dashboard are scaffolds. Contributions are very welcome!

---

## 💡 Vision

The web is increasingly gated behind accounts, ads and cloud services — and the AI agents that automate it are mostly cloud-hosted, closed-source, and asking you to hand over your browsing data.

**WebPilot is the opposite of that.** We believe:

- **Your data stays yours.** Every task, page, download and model inference happens locally. WebPilot works offline (or on your LAN) and phones home to no one.
- **Small models, big value.** Instead of relying on frontier cloud LLMs, WebPilot runs compact open-weights models (e.g. Qwen2.5-0.5B via Transformers.js) directly in-process — plus a deterministic rule-based planner that needs *no model at all*. The agent must work even when AI is disabled.
- **Safety is not optional.** An agent that drives a real browser and downloads real files needs hard resource caps, host allowlists, MIME validation, and an explicit human permission gate for sensitive actions. We build the guardrails first, not as an afterthought.
- **Open source, forever.** MIT licensed, community-driven. If you want an AI agent you can actually audit — line by line — this is it.

Long term, WebPilot aims to be a **self-hosted personal web assistant**: a dashboard where you describe what you want from the web, watch the agent work live, and keep every artifact in a local library you fully control.

## ✨ Features

- 🧠 **Hybrid planning** — local LLM planner with automatic fallback to a deterministic rule planner, so a valid plan always exists
- 🖥️ **Real browser automation** — Playwright-powered (Chromium/Firefox/WebKit): navigate, click, type, observe
- 🔍 **Page extraction** — images, links, text blocks and tables from any page
- 🏆 **Smart candidate ranking** — hybrid lexical + semantic scoring with optional local embeddings (`all-MiniLM-L6-v2`)
- 📥 **Safe download pipeline** — queueing, deduplication, SHA-256 hashing, MIME validation, size/count limits, manifest
- 🔐 **Permission gate** — sensitive actions pause for human approval (grantable with "remember")
- 🔁 **Self-healing loop** — observation, completion evaluation and bounded replanning on failure
- 🚦 **Full observability** — typed agent events streamed over WebSockets; cooperative cancellation everywhere
- 🔒 **Local-first AI** — quantized models run in-process; zero external API calls

## 📦 Monorepo layout

[Bun](https://bun.sh) workspaces + [Turborepo](https://turbo.build):

```
apps/
  api/          Elysia API server: tasks, downloads, settings, models, SQLite + WebSockets (scaffold)
  web/          SolidStart dashboard: task input, live agent timeline, downloads (scaffold)
  test-site/    Local fixture site for integration/e2e tests
packages/
  shared/         Config, resource limits, logging, cancellation, event bus, utilities
  schemas/        Schemas: actions, events, page state, errors, agent state, task plans
  browser-core/   Playwright browser lifecycle + controller
  extraction-core/  Page extraction (images, links, text, tables)
  download-core/  Download pipeline: queueing, validation, hashing, manifest
  ai-core/        Rule planner, local LLM planner, candidate ranking
  agent-core/     The agent engine: plan → validate → permission → execute → observe → replan
```

## 🚀 Getting started

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.1 and a browser (Playwright browsers are used).

```bash
git clone https://github.com/missarii/Web-Pilot.git
cd Web-Pilot
bun install
cp .env.example .env   # optional — every value has a safe default
bun run dev            # run everything in parallel
```

Launch the local fixture site used by tests:

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

## ⚙️ Configuration

Everything is configured via environment variables (see [`.env.example`](./.env.example)); defaults live in `packages/shared/src/config.ts`.

- **API** — `WEBPILOT_PORT` (8787), `WEBPILOT_HOST`, `WEBPILOT_CORS_ORIGIN`
- **Storage** — data/downloads/screenshots/sessions/model dirs, SQLite URL
- **Browser** — engine (`chromium`), headless, nav/action timeouts, max tabs
- **Limits** — max agent steps (30), max downloads (100), max file size (25 MB), task time cap
- **Local AI** — enable/disable, model id, quantization (`q4`), max new tokens, embedding model
- **Safety** — download host allowlist, download confirmation requirement

## 🏗️ Architecture

- **Agent loop** (`agent-core`): every step runs *plan → validate → permission → execute → observe → evaluate*. Failures are recorded with typed error codes and passed through a replanner with bounded recovery before aborting.
- **Always-a-plan guarantee** (`ai-core`): the local LLM planner is tried first; any failure falls back to the deterministic rule planner.
- **Permission gate**: permission-sensitive actions emit `PERMISSION_REQUESTED` and pause until the host app (or user) decides; decisions can be cached with "remember".
- **Hard limits**: step counts, download counts, file sizes and task durations are capped centrally.
- **Events**: a typed event bus emits structured events (`AI_THINKING`, `ACTION_PLANNED`, `ACTION_COMPLETED`, `ACTION_FAILED`, `PERMISSION_*`, …) consumed by the API/WebSocket layer.

## Testing

- `tests/unit` — pure-logic tests (vitest)
- `tests/integration` — real browser + local test site (bun test)
- `tests/e2e` — Playwright

GitHub Actions on pull requests and pushes to `main` runs `bun run typecheck` and `bun run test:unit` only. That is **not** complete coverage: `apps/api` and `apps/web` currently skip typecheck while those scaffolds have no sources, and `test:unit` allows an empty suite (`--passWithNoTests`). Integration and e2e tests are not part of this first workflow.

## 🗺️ Roadmap

- [x] Agent engine loop with validation, permissions and replanning
- [x] Rule-based + local LLM planning
- [x] Browser automation, extraction and safe download pipeline
- [x] Hybrid lexical/semantic candidate ranking
- [ ] Elysia API server with SQLite persistence and live WebSocket events
- [ ] SolidStart dashboard (task input, agent timeline, download library, model status)
- [ ] Session recording and replay
- [ ] Plugin API for custom actions and extractors
- [ ] Headless CLI (`webpilot "download 10 cat pictures"`)

## 🤝 Contributing

Contributions are welcome and encouraged — bug fixes, new actions/extractors, planner improvements, docs, tests, UI.

1. Fork the repository and create your branch from `main`.
2. Make your changes; keep them typed (`bun run typecheck` must pass).
3. Add or update tests where reasonable (`bun run test:unit`, `bun run test:integration`).
4. Open a pull request describing **what** and **why**.

Good first contributions: unit tests for `ai-core` planning/ranking, `download-core` naming/dedupe, the API server implementation, dashboard components. For larger changes, open an issue first so we can align on the design.

## 🐛 Reporting issues

Open a [GitHub issue](https://github.com/missarii/Web-Pilot/issues) with your OS, Bun version, the prompt you used, relevant logs (`WEBPILOT_LOG_LEVEL=debug`), and what you expected vs. what happened. **Never paste personal data or session files.**

## 🔒 Security

Found a security-relevant bug (e.g. a way to escape the sandbox or limits)? Please open a private security advisory via the GitHub **Security** tab rather than a public issue.

## 📜 License

[MIT](./LICENSE) — free to use, modify and ship. See the license file for details.
