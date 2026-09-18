import { Elysia } from 'elysia';

/**
 * Documented `GET /health` JSON body.
 *
 * This payload is intentionally static and minimal. It must never include
 * environment values, local filesystem paths, process details, or secrets.
 */
export type HealthResponse = {
  readonly ok: true;
  readonly service: 'webpilot-api';
};

export const HEALTH_RESPONSE: HealthResponse = {
  ok: true,
  service: 'webpilot-api',
};

/**
 * Build the HTTP application without opening a port.
 *
 * Importing this module (or calling `createApp`) does not listen, launch a
 * browser, or load a model. Listening belongs in `server.ts`.
 */
export function createApp() {
  return new Elysia({ name: 'webpilot-api' }).get('/health', (): HealthResponse => HEALTH_RESPONSE);
}

export type App = ReturnType<typeof createApp>;
