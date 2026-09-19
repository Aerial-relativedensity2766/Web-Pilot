# `@webpilot/web`

Accessible SolidStart dashboard **shell**. Live tasks, agent events, auth, models, and downloads are out of scope.

## Scripts

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `vite dev --port 3000` | Local dashboard at http://127.0.0.1:3000 |
| `build` | `vite build` | Production output under `.output/` |
| `start` | `node .output/server/index.mjs` | Serve the production build |
| `typecheck` | `tsc --noEmit -p tsconfig.json` | Real TypeScript check |

From the repo root:

```bash
bun install
bun run --filter @webpilot/web typecheck
bun run --filter @webpilot/web build
bun run --filter @webpilot/web dev
```

## Toolchain blockers

The workspace originally declared **SolidStart 2 + Vite 8 + Vinxi 0.5** and used `vinxi` scripts. Those pieces do not form one stack:

- `@solidjs/start@2` is Vite-native. It does **not** use Vinxi. Official v2 apps run `vite dev` / `vite build`.
- `vinxi` belongs to SolidStart 1 (`app.config.ts`). It cannot load the Start 2 Vite plugin.
- SolidStart 2’s documented production adapter is **Nitro v3** (`nitro` + `nitro/vite`). That is a server adapter, not a UI framework. It was added so `build` / `start` work.
- SolidStart 2 documents **Node.js 24+**. Bun remains the workspace package manager (`bun@1.4.0`).

`vinxi` was therefore removed from this package’s scripts and dependencies. No analytics, hosted fonts, cloud APIs, or extra UI kit were added. UnoCSS stays as the declared utility layer; layout and contrast live in local `app.css` and the repo logo (`docs/web-pilot.png`).
