import { describe, expect, test } from 'bun:test';
import { createInitialState } from '@webpilot/agent-core';
import type { PermissionRequest } from '@webpilot/schemas';
import { createApp } from '../app';
import { createMemoryDatabase } from '../db/memory';
import { TaskStore } from '../db/store';
import { AgentService, type AgentRunner, type RunnerContext } from '../agent/service';

/** Route-level tests: real Elysia app, in-memory database, no browser, no model. */
function testApp(behaviour?: (context: RunnerContext) => Promise<'completed' | 'cancelled'>) {
  const db = createMemoryDatabase();
  const store = new TaskStore(() => db);

  const service = new AgentService({
    store,
    runnerFactory: (context): AgentRunner => ({
      async run(taskId, prompt) {
        context.channel.emit('TASK_STARTED', 'info', 'started');
        const outcome = behaviour ? await behaviour(context) : 'completed';
        return {
          taskId,
          status: outcome,
          steps: 2,
          downloaded: 0,
          error: null,
          state: createInitialState({ taskId, goal: prompt, maxSteps: 5, aiAvailable: false }),
        };
      },
      stop: () => undefined,
    }),
  });

  return { app: createApp({ service }), service };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://127.0.0.1${path}`, init);
}

function json(path: string, body: unknown): Request {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

describe('POST /tasks', () => {
  test('accepts a prompt, queues it, and does not open a listener', async () => {
    const { app, service } = testApp();
    const response = await app.handle(json('/tasks', { prompt: 'download 3 images of trees' }));
    const body = (await response.json()) as {
      task: { id: string; status: string; prompt: string };
    };

    expect(response.status).toBe(202);
    expect(body.task.status).toBe('queued');
    expect(body.task.id).toMatch(/^task-\d{4}$/);
    expect(body.task.prompt).toBe('download 3 images of trees');
    expect(app.server).toBeNull();
    await service.dispose();
  });

  test('rejects an empty or too-short prompt with the error envelope', async () => {
    const { app, service } = testApp();

    const empty = await app.handle(json('/tasks', { prompt: '   ' }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: { code: 'ACTION_INVALID' } });

    const missing = await app.handle(json('/tasks', {}));
    expect(missing.status).toBe(400);

    // Nothing is persisted for a rejected request.
    expect(service.listTasks()).toHaveLength(0);
    await service.dispose();
  });

  test('rejects unknown body fields instead of guessing', async () => {
    const { app, service } = testApp();
    const response = await app.handle(json('/tasks', { prompt: 'valid prompt', surprise: true }));

    expect(response.status).toBe(400);
    await service.dispose();
  });
});

describe('GET /tasks/:id and /tasks/:id/events', () => {
  test('returns the task, its timeline, and 404s for unknown ids', async () => {
    const { app, service } = testApp();
    const created = await app.handle(json('/tasks', { prompt: 'extract product prices' }));
    const { task } = (await created.json()) as { task: { id: string } };

    await waitFor(() => service.getTask(task.id)?.status === 'completed');

    const detail = await app.handle(request(`/tasks/${task.id}`));
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ task: { id: task.id, status: 'completed' } });

    const events = await app.handle(request(`/tasks/${task.id}/events`));
    const eventBody = (await events.json()) as {
      events: Array<{ type: string; sequence: number }>;
    };
    expect(eventBody.events[0]?.type).toBe('TASK_QUEUED');
    const sequences = eventBody.events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));

    const since = await app.handle(request(`/tasks/${task.id}/events?since=1`));
    const sinceBody = (await since.json()) as { events: Array<{ sequence: number }> };
    expect(sinceBody.events.every((event) => event.sequence > 1)).toBe(true);

    expect((await app.handle(request('/tasks/task-9999'))).status).toBe(404);
    expect((await app.handle(request('/tasks/task-9999/events'))).status).toBe(404);
    await service.dispose();
  });

  test('lists recent tasks newest first', async () => {
    const { app, service } = testApp();
    await app.handle(json('/tasks', { prompt: 'first task' }));
    await app.handle(json('/tasks', { prompt: 'second task' }));

    const response = await app.handle(request('/tasks'));
    const body = (await response.json()) as {
      tasks: Array<{ prompt: string }>;
      queueLength: number;
    };

    expect(response.status).toBe(200);
    expect(body.tasks.map((task) => task.prompt)).toEqual(['second task', 'first task']);
    expect(typeof body.queueLength).toBe('number');
    await service.dispose();
  });
});