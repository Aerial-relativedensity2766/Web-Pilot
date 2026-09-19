import { Elysia } from 'elysia';
import type { WebSocketMessage } from '@webpilot/schemas';
import { config, loggerFor } from '@webpilot/shared';
import { createAgentService, type AgentService } from './agent/service';
import { taskRoutes } from './routes/tasks';
import { downloadRoutes } from './routes/downloads';
import { systemRoutes } from './routes/system';

const log = loggerFor('api');

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

export interface CreateAppOptions {
  /** Inject a pre-built service (used by `server.ts` so shutdown can dispose it). */
  service?: AgentService;
}

/**
 * Local dev origins. The dashboard runs on `localhost:3000` while the API runs on
 * `127.0.0.1:8787`, and those are *different* origins even though both are the
 * user's own machine. Loopback origins are therefore always allowed: the API
 * only listens on loopback anyway, so this does not widen what is reachable —
 * it just lets the local dashboard talk to it.
 */
function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const configured = config.corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return origin;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Build the HTTP application without opening a port.
 *
 * Importing this module (or calling `createApp`) does not listen, launch a
 * browser, or load a model. The database connection is lazy as well, so tests
 * can exercise the routes without touching the user's data.
 */
export function createApp(options: CreateAppOptions = {}) {
  const service = options.service ?? createAgentService();
  const unsubscribe = new WeakMap<object, () => void>();

  const app = new Elysia({ name: 'webpilot-api' })
    .onRequest(({ request, set }) => {
      const origin = allowedOrigin(request.headers.get('origin'));
      const headers: Record<string, string> = {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        vary: 'origin',
      };
      if (origin) headers['access-control-allow-origin'] = origin;

      for (const [key, value] of Object.entries(headers)) {
        set.headers[key] = value;
      }

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
      }
      return undefined;
    })
    .get('/health', (): HealthResponse => HEALTH_RESPONSE)
    .use(systemRoutes(service))
    .use(taskRoutes(service))
    .use(downloadRoutes(service))
    /**
     * Live agent timeline. The client gets `hello`, the persisted history
     * (so a reload never loses the story) and then every new event.
     */
    .ws('/ws/tasks/:taskId', {
      open(ws) {
        const taskId = String(ws.data.params?.taskId ?? '');
        const send: (message: WebSocketMessage) => void = (message) => {
          // A closed socket throws here on purpose: the broadcaster uses that
          // signal to drop the dead subscriber.
          ws.send(JSON.stringify(message));
        };

        unsubscribe.set(ws, service.broadcaster.subscribe(send, taskId));
        service.broadcaster.hello(send, taskId);

        for (const event of service.listEvents(taskId)) {
          send({ kind: 'event', event });
        }
        const task = service.getTask(taskId);
        if (task) send({ kind: 'task', task });
        log.debug('ws client connected', { taskId });
      },
      message(ws, raw) {
        const text = typeof raw === 'string' ? raw : '';
        if (text === 'ping' || text.includes('"ping"')) service.broadcaster.pong((message) => {
          ws.send(JSON.stringify(message));
        });
        // Permission decisions intentionally go through REST: one auditable path.
      },
      close(ws) {
        unsubscribe.get(ws)?.();
        unsubscribe.delete(ws);
      },
    });

  serviceRegistry.set(app, service);
  return app;
}

/**
 * Associates every created app with the service that owns its runs, so shutdown
 * (`server.ts`) can cancel work and release the browser instead of orphaning it.
 */
const serviceRegistry = new WeakMap<object, AgentService>();

/** The `AgentService` backing an app created by `createApp`. */
export function serviceFor(app: object): AgentService | undefined {
  return serviceRegistry.get(app);
}

/** Stops the app's agent work (used by `stopServer`). */
export async function disposeApp(app: object): Promise<void> {
  await serviceRegistry.get(app)?.dispose();
  serviceRegistry.delete(app);
}

export type App = ReturnType<typeof createApp>;
