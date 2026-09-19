import { afterEach, describe, expect, test } from 'bun:test';
import { HEALTH_RESPONSE } from './app';
import { startServer, stopServer } from './server';

describe('startServer', () => {
  let app: ReturnType<typeof startServer> | undefined;

  afterEach(async () => {
    if (!app) return;
    await stopServer(app);
    app = undefined;
  });

  test('listens on loopback and releases the port on stop', async () => {
    app = startServer({ host: '127.0.0.1', port: 0 });
    const port = app.server?.port;
    expect(port).toBeGreaterThan(0);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(HEALTH_RESPONSE);

    await stopServer(app);
    app = undefined;

    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});
