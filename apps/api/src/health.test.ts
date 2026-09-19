import { describe, expect, test } from 'bun:test';
import { createApp, HEALTH_RESPONSE } from './app';

const SENSITIVE = /WEBPILOT_|password|secret|token|api[-_]?key|authorization|\/data\/|\/models\//i;

function request(path: string, method = 'GET'): Request {
  return new Request(`http://127.0.0.1${path}`, { method });
}

describe('createApp', () => {
  test('does not open a listener', () => {
    const app = createApp();
    expect(app.server).toBeNull();
  });
});

describe('GET /health', () => {
  test('returns the documented JSON payload', async () => {
    const app = createApp();
    const response = await app.handle(request('/health'));
    const body: unknown = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toContain('application/json');
    expect(body).toEqual(HEALTH_RESPONSE);
    expect(Object.keys(body as object).sort()).toEqual(['ok', 'service']);
    expect(serialized).not.toMatch(SENSITIVE);
    expect(app.server).toBeNull();
  });
});

describe('unknown route', () => {
  test('returns 404 without leaking environment details', async () => {
    const app = createApp();
    const response = await app.handle(request('/definitely-not-a-route'));
    const serialized = await response.text();

    expect(response.status).toBe(404);
    expect(serialized).not.toMatch(SENSITIVE);
    expect(app.server).toBeNull();
  });
});
