import { getConfig, loggerFor } from '@webpilot/shared';
import { createApp } from './app';

const log = loggerFor('api');

export interface ListenOptions {
  host?: string;
  port?: number;
}

/**
 * Start the API listener using shared host/port configuration.
 *
 * Defaults remain loopback (`127.0.0.1:8787`) unless `WEBPILOT_HOST` /
 * `WEBPILOT_PORT` override them. Only host and port are read from config
 * so the health surface cannot leak the rest of the environment.
 */
export function startServer(options: ListenOptions = {}) {
  const config = getConfig();
  const host = options.host ?? config.host;
  const port = options.port ?? config.port;
  const app = createApp().listen({
    hostname: host,
    port,
  });

  const boundPort = app.server?.port ?? port;
  log.info('listening', { url: `http://${host}:${boundPort}` });
  return app;
}

export async function stopServer(app: ReturnType<typeof startServer>, signal?: string): Promise<void> {
  log.info('stopping', signal ? { signal } : undefined);
  await app.stop();
}

if (import.meta.main) {
  const app = startServer();
  let stopping = false;

  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    void stopServer(app, signal).finally(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
